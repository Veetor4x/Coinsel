"use client";
// Step 2 card. Two modes:
//  - REAL TEST SWAP (when the server has TIDEPOOL_SWAP_ENABLED=true and the sandbox answers): file -> council votes -> Tidepool swaps -> result.
//  - QUOTE ONLY (the old card): a real-price quote on the main network; nothing moves. Also the fallback if the sandbox is down.
import { useCallback, useEffect, useRef, useState } from "react";
import type { QuoteResult } from "@/lib/intents";
import type { TidepoolQuote, SwapReadiness } from "@/lib/tidepool";

export type SwapPreview =
  | { enabled: false }
  | { enabled: true; label: string; swapUsdc: number; quote: TidepoolQuote | null; quoteError?: string; readiness: SwapReadiness | null };

type Status = {
  proposalId: number; phase: Phase; label: string; final: boolean; sandbox: string; tidepoolStatus: string | null; tidepoolError?: string;
  deadline: string | null; note: string | null; refundReason: string | null; amountInUsdc: number; amountOutWnear: number | null; refundedUsdc: number | null;
  approvals: number; depositAddress: string; links: { depositAddress: string; txs: string[] };
};
type Phase = "filed" | "approved" | "swapping" | "done" | "refunded" | "failed" | "expired" | "rejected";
type Proposal = { id: number; status: string; swap?: unknown; register?: unknown };

const STEPS = ["Quoted", "Filed", "Approved", "Swapping", "Done"] as const;
const AT: Record<Phase | "quoted", number> = { quoted: 0, filed: 1, approved: 2, swapping: 3, done: 4, refunded: 4, failed: 4, expired: 1, rejected: 1 };
const BAD: Phase[] = ["refunded", "failed", "expired", "rejected"];
const mono = "font-[family-name:var(--font-mono-jb)]";
const btn = "max-w-full whitespace-normal rounded-lg bg-[#C6FF3D] px-4 py-2 text-sm font-semibold text-[#0C0D0E] hover:brightness-110 disabled:opacity-50";
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });

function Pill({ kind, children }: { kind: "real" | "demo" | "warn"; children: React.ReactNode }) {
  const c = { real: "border-accent/40 bg-accent/10 text-accent", demo: "border-demo/40 bg-demo/10 text-demo", warn: "border-warn/40 bg-warn/10 text-warn" }[kind];
  return <span className={`max-w-full rounded-full border px-2 py-0.5 text-[11px] font-medium ${c}`}>{children}</span>;
}

function QuoteOnly({ quote }: { quote: QuoteResult }) {
  return (
    <>
      <p className="mb-1 text-zinc-400">Refill the main reserve from the idle USDC on Ethereum.</p>
      {quote.ok ? (
        <p className="text-zinc-300">{quote.amountInUsdc.toLocaleString("en-US")} USDC on Ethereum would become about <b>{usd(quote.amountOutUsd)}</b> of NEAR in about {quote.timeEstimateSec} seconds.</p>
      ) : <p className="text-demo">{quote.error}</p>}
      <p className="mt-1 text-xs text-zinc-500">{quote.label}</p>
    </>
  );
}

function Stepper({ at, phase }: { at: number; phase: Phase | null }) {
  const bad = phase && BAD.includes(phase);
  return (
    <ol className="my-3 flex flex-wrap gap-x-2 gap-y-1 text-xs" aria-label="Swap progress">
      {STEPS.map((s, i) => {
        const last = i === STEPS.length - 1;
        const label = last && bad ? (phase === "refunded" ? "Refunded" : "Failed") : s;
        const on = i <= at;
        const tone = on ? (last && bad ? "border-warn/50 bg-warn/10 text-warn" : "border-accent/40 bg-accent/10 text-accent") : "border-line/10 text-zinc-500";
        return <li key={s} className={`${mono} rounded-full border px-2 py-0.5 ${tone}`} aria-current={i === at ? "step" : undefined}>{i + 1}. {label}</li>;
      })}
    </ol>
  );
}

export function SwapStep({ dao, swap, quote, advice, attestationHash, obligations, proposals, busyElsewhere, onChanged }: {
  dao: string; swap?: SwapPreview; quote: QuoteResult; advice: { text: string; model: string; responseHash: string }; attestationHash: string;
  obligations: unknown[]; proposals: Proposal[]; busyElsewhere: boolean; onChanged: () => void;
}) {
  // `filedHere` = filed in this page session. Otherwise we pick a swap still in flight back up from the DAO (stateless: no database).
  // (The page remounts this component on Reset, so everything starts clean.)
  const [filedHere, setFiledHere] = useState<number | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [filing, setFiling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filedQuote, setFiledQuote] = useState<TidepoolQuote | null>(null);
  const lastPhase = useRef<string | null>(null);
  // What the treasury holds / whether it is registered. Starts from the analysis; refreshed while we wait for setup or coins.
  const [fresh, setFresh] = useState<SwapReadiness | null>(null);
  const [preparing, setPreparing] = useState(false);
  const ready = fresh ?? (swap?.enabled ? swap.readiness : null);
  const need = swap?.enabled ? swap.swapUsdc : 10;
  const unregistered = !!ready && (!ready.usdcRegistered || !ready.wnearRegistered);
  const waitingForCoins = !!ready && !unregistered && ready.daoUsdc < need;
  const setupOpen = proposals.filter((x) => x.register && x.status === "InProgress");
  const setupApproved = proposals.some((x) => x.register && x.status === "Approved");

  const inFlight = proposals.find((x) => x.swap && (x.status === "InProgress" || x.status === "Approved"))?.id ?? null;
  const tracked = filedHere ?? inFlight;
  const restored = filedHere === null;

  const poll = useCallback(async (id: number) => {
    try {
      const r = await fetch(`/api/swap-status?proposalId=${id}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't read the swap status.");
      setStatus(j as Status);
      if (lastPhase.current !== j.phase) { lastPhase.current = j.phase; onChanged(); }
    } catch (e) { setError((e as Error).message); }
  }, [onChanged]);
  useEffect(() => {
    if (tracked === null || (status?.proposalId === tracked && status.final)) return;
    const first = setTimeout(() => poll(tracked), 0);
    const t = setInterval(() => poll(tracked), 4000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [tracked, status?.proposalId, status?.final, poll]);

  const refresh = useCallback(async () => {
    try { const r = await fetch("/api/swap-readiness", { cache: "no-store" }); if (r.ok) setFresh(await r.json()); } catch { /* try again next tick */ }
  }, []);
  useEffect(() => {
    if (!unregistered && !waitingForCoins) return;
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
  }, [unregistered, waitingForCoins, refresh]);

  async function prepare() {
    setPreparing(true); setError(null);
    try {
      const r = await fetch("/api/propose-register", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't file the setup suggestions.");
      onChanged(); refresh();
    } catch (e) { setError((e as Error).message); } finally { setPreparing(false); }
  }

  async function file() {
    setFiling(true); setError(null);
    try {
      const r = await fetch("/api/propose-swap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ obligations, advice, attestationHash }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || j.error || "Couldn't file the swap suggestion.");
      setStatus(null); lastPhase.current = null; setFiledQuote(j.quote); setFiledHere(j.proposalId); onChanged();
    } catch (e) { setError((e as Error).message); } finally { setFiling(false); }
  }

  // ---- Quote-only mode (feature off, or the sandbox is down) ----
  if (!swap?.enabled || !swap.quote) {
    return (
      <div className="mt-3 rounded-xl border border-line/10 bg-sunk p-4 text-sm">
        <div className="mb-1 flex flex-wrap items-center gap-2"><span className="font-semibold">Step 2 · Later, on another network</span><Pill kind="demo">Quote only</Pill></div>
        {swap?.enabled && <p className="mb-2 text-demo">{swap.quoteError ?? "The test swap service isn't answering right now."} Showing the price quote instead.</p>}
        <QuoteOnly quote={quote} />
      </div>
    );
  }

  // ---- Real test swap ----
  const q = filedQuote ?? swap.quote;
  const canFile = !!ready && !unregistered && !waitingForCoins;
  const cur = status && status.proposalId === tracked ? status : null; // ignore a leftover answer about another suggestion
  const showTracker = tracked !== null && !(restored && cur?.final);
  const phase = showTracker ? cur?.phase ?? null : null;
  const at = phase ? AT[phase] : AT.quoted;
  return (
    <div className="mt-3 rounded-xl border border-line/10 bg-sunk p-4 text-sm">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="font-semibold">Step 2 · Later, on another network</span>
        <Pill kind="demo">{swap.label}</Pill>
      </div>
      <p className="text-zinc-300">
        Swap <b>{fmt(q.amountInUsdc)} test USDC</b> the treasury already holds for about <b>{fmt(q.amountOutWnear)} test wNEAR</b>, paid back into the main reserve. The council votes first.
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        A small real swap of test coins that have no value, run by a community sandbox (not by NEAR). It is not the demo-scale gap from Step 1. Details: the DAO sends the coins to a one-time swap address; if the swap fails they come back to the DAO.
      </p>
      <Stepper at={at} phase={phase} />

      {!showTracker && (
        <>
          {unregistered && (
            <div className="mb-3 rounded-lg border border-demo/40 bg-demo/10 p-3 text-xs text-demo">
              <p className="font-semibold">One-time setup needed</p>
              <p className="mt-1">The treasury must be registered on the test coins before it can hold or receive them (a 0.00125 NEAR fee each, paid by the treasury, approved by the council like Step 1).</p>
              {setupOpen.length > 0 ? (
                <p className="mt-2 text-zinc-200">Waiting for the council: approve {setupOpen.map((x) => `#${x.id}`).join(" and ")} in “Suggestions” below, as Council 1 and Council 2.</p>
              ) : setupApproved ? (
                <p className="mt-2 text-zinc-200">Approved. Waiting for the network to catch up… (if this stays over a minute, press “Get advice” again).</p>
              ) : (
                <button className={`${btn} mt-2`} disabled={preparing || busyElsewhere} onClick={prepare}>{preparing ? "Filing setup…" : "Prepare treasury for testnet swaps"}</button>
              )}
            </div>
          )}
          {waitingForCoins && ready && (
            <div className="mb-3 rounded-lg border border-accent/30 bg-accent/5 p-3 text-xs text-zinc-200">
              <p className="font-semibold text-accent">Ready, waiting for test USDC</p>
              <p className="mt-1">The treasury has {fmt(ready.daoUsdc)} of the {need} test USDC it needs. Claim test coins at app.usetidepool.tech/faucet (NEAR tab) for <span className="break-all font-[family-name:var(--font-mono-jb)]">{dao}</span>, or send them from your wallet. This updates by itself.</p>
            </div>
          )}
          <button className={btn} disabled={filing || busyElsewhere || !canFile} onClick={file}>{filing ? "Getting a fresh quote and filing…" : "File step 2 for the council"}</button>
          <p className="mt-2 text-xs text-zinc-500">Quoted {new Date(swap.quote.quotedAt).toLocaleTimeString()}. A fresh quote is requested when you file, and it is good for about 30 minutes.</p>
        </>
      )}

      {showTracker && (
        <div className="float" role="status" aria-live="polite">
          <p className="text-zinc-100"><b>{cur?.label ?? "Checking…"}</b> <span className="text-xs text-zinc-500">· suggestion #{tracked}</span></p>
          {phase === "filed" && <p className="mt-1 text-xs text-zinc-400">Approve it in “Suggestions” below ({cur?.approvals ?? 0} of 2 so far). {cur?.deadline && <>The quote expires at {new Date(cur.deadline).toLocaleTimeString()}.</>}</p>}
          {phase === "approved" && <p className="mt-1 text-xs text-zinc-400">The council said yes. Waiting for the sandbox to see the coins arrive…</p>}
          {phase === "swapping" && <p className="mt-1 text-xs text-zinc-400">The sandbox received the coins and is swapping (usually under a minute).</p>}
          {phase === "done" && <p className="mt-1 text-zinc-300">Done. {cur?.amountOutWnear ? <>The main reserve received <b>{fmt(cur.amountOutWnear)} test wNEAR</b>.</> : "The test wNEAR is in the main reserve."} It is a test token, shown separately from the NEAR balance above.</p>}
          {phase === "refunded" && <p className="mt-1 text-zinc-300">The swap couldn&apos;t complete{cur?.refundReason ? ` (${cur.refundReason.toLowerCase().replace(/_/g, " ")})` : ""}, so the test USDC went back to the treasury. Nothing was lost.</p>}
          {phase === "failed" && <p className="mt-1 text-demo">The swap didn&apos;t go through{cur?.note ? `: ${cur.note}` : ""}. Check the links below. Nothing else was touched.</p>}
          {phase === "expired" && <p className="mt-1 text-demo">The quote ran out before the council approved. No coins moved. <button className="underline" disabled={filing} onClick={file}>Get a fresh quote and file again</button> (the old suggestion can no longer be approved).</p>}
          {phase === "rejected" && <p className="mt-1 text-zinc-300">The council didn&apos;t approve it. No coins moved.</p>}
          {cur && (cur.links.txs.length > 0 || phase === "swapping" || phase === "done" || phase === "refunded") && (
            <p className="mt-2 flex flex-wrap gap-x-3 text-xs">
              <a className="text-accent underline" href={cur.links.depositAddress} target="_blank" rel="noreferrer">Swap address ↗</a>
              {cur.links.txs.map((u, i) => <a key={u} className="text-accent underline" href={u} target="_blank" rel="noreferrer">Transaction {i + 1} ↗</a>)}
            </p>
          )}
          {cur?.tidepoolError && <p className="mt-1 text-xs text-demo">The sandbox didn&apos;t answer the last check ({cur.tidepoolError}). Retrying.</p>}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-demo" role="alert">{error}</p>}

      <details className="mt-3 text-xs text-zinc-500">
        <summary className="cursor-pointer">Also: real-price quote on the main network (quote only)</summary>
        <div className="mt-2"><QuoteOnly quote={quote} /></div>
      </details>
    </div>
  );
}
