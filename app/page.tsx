"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyze, type Severity } from "@/lib/engine";
import { gapNear, toEngineInputs, totalNear, type UiObligation as Obligation } from "@/lib/engine-inputs";
import { duplicateMessage, findDuplicate, pendingOverlap } from "@/lib/safety";
import { TRICK_NOTE } from "@/lib/trick";
import { checkText } from "@/lib/guard";
import demo from "@/config/demo-treasury.json";
import type { Treasury } from "@/lib/treasury";
import type { QuoteResult } from "@/lib/intents";
import type { HealthReport } from "@/lib/engine";
import { VerifiedPanel, type AttestationView } from "./AskCoinsel";
import { Hero, Marquee, Safety, type Live } from "./Hero";
import { Burst, CounselLog, SoundToggle } from "./Extras";
import { ThemeToggle } from "./ThemeToggle";
import { CountUp, useInView, useReducedMotion } from "./motion";
import { sound } from "@/lib/sound";
import { SwapStep, type SwapPreview } from "./SwapStep";

type Data = Omit<Treasury, "proposals"> & { proposals: (Treasury["proposals"][number])[] };
type Ok = {
  status: "ok"; health: HealthReport; quote: QuoteResult; quoteUsdc: number; swap?: SwapPreview; attestation: AttestationView; attestationHash: string;
  advice: { text: string; model: string; responseHash: string; requestHash: string }; transferNear: number; transferUsd: number; payrollAccount: string; canAfford: boolean; spendableNear: number;
};
type Analysis =
  | Ok
  | { status: "blocked"; message: string; why: string; outside: string[]; label?: string }
  | { status: "unverified"; attestation: AttestationView | null }
  | { status: "error"; message: string };
type Proposal = Data["proposals"][number];
type Filed = { proposalId: number; amountNear: number; receiver: string; txUrl: string };

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const near = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} NEAR`;
const short = (id: string) => (id.length > 26 ? id.slice(0, 12) + "…" + id.slice(-12) : id);
const SHOWN_SUGGESTIONS = 3;
const deadline = () => Date.now() + 30000;
const nb = (id: string) => `https://testnet.nearblocks.io/address/${id}`;
const mono = "font-[family-name:var(--font-mono-jb)]";

function Logo() {
  return (
    <svg className="h-8 w-8 shrink-0 sm:h-9 sm:w-9" width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
      <path d="M18 4a14 14 0 1 0 13.6 10.8" fill="none" className="stroke-fg" strokeWidth="2" strokeLinecap="round" opacity=".85" />
      <circle cx="18" cy="18" r="5" className="fill-accent" />
      <circle cx="30" cy="9" r="2.4" className="fill-accent" />
    </svg>
  );
}
function Badge({ kind, children }: { kind: "real" | "demo" | "warn"; children?: React.ReactNode }) {
  const c = { real: "border-accent/40 bg-accent/10 text-accent", demo: "border-demo/40 bg-demo/10 text-demo", warn: "border-warn/40 bg-warn/10 text-warn" }[kind];
  return <span className={`max-w-full rounded-full border px-2 py-0.5 text-[11px] font-medium ${c}`}>{children ?? (kind === "real" ? "Real · test network" : "Demo data")}</span>;
}
const TONE: Record<Severity, string> = {
  critical: "border-warn/40 bg-warn/10 text-warn",
  warning: "border-demo/40 bg-demo/10 text-demo",
  info: "border-line/10 bg-line/5 text-zinc-200",
  ok: "border-accent/40 bg-accent/10 text-accent",
};
function Stat({ label, value, tone, burst }: { label: string; value: React.ReactNode; tone: "good" | "warn" | "bad" | "neutral"; burst?: number }) {
  const c = { good: "text-accent", warn: "text-demo", bad: "text-warn", neutral: "text-zinc-100" }[tone];
  return (
    <div key={burst} className={`relative min-w-0 rounded-xl border bg-sunk p-3 transition-colors duration-700 ${burst ? "burst-pop border-accent/60" : "border-line/10"}`}>
      {!!burst && <Burst key={burst} />}
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`break-words text-2xl font-semibold ${c}`}>{value}</div>
    </div>
  );
}
function Card({ title, right, children, className = "", id }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  const [ref, seen] = useInView<HTMLElement>(); // rises in when scrolled into view
  return (
    <section id={id} ref={ref} className={`reveal ${seen ? "in" : ""} min-w-0 rounded-2xl glass border p-4 sm:p-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className={`${mono} text-xs font-semibold uppercase tracking-wider text-zinc-400`}>{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}
const btn = "max-w-full whitespace-normal rounded-lg bg-[#C6FF3D] px-4 py-2 text-sm font-semibold text-[#0C0D0E] hover:brightness-110 disabled:opacity-50";
const btnGhost = "max-w-full whitespace-normal rounded-lg border border-line/15 px-3 py-1.5 text-sm hover:bg-line/5 disabled:opacity-50";

export default function Home() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [obs, setObs] = useState<Obligation[]>([]); // client-side only, no database
  const [busy, setBusy] = useState<null | "analyze" | "file" | "reset" | number>(null);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [topupFromServer, setTopupFromServer] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [filed, setFiled] = useState<Filed | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [logDone, setLogDone] = useState(false); // the counsel log types its last two lines once the answer is in
  const [swapKey, setSwapKey] = useState(0); // bumps on Reset so the Step 2 tracker starts clean
  const [burst, setBurst] = useState(0); // bumps each time payroll flips to "Covered"
  const reduceMotion = useReducedMotion();
  // Vote results we already know. The chain read can lag a few seconds behind, so never let a stale read undo them.
  const known = useRef<Map<number, { status: string; approvals: number; voters: string[] }>>(new Map());

  const applyKnown = (p: Proposal): Proposal => {
    const k = known.current.get(p.id);
    if (!k) return p;
    const done = k.status !== "InProgress";
    if (p.status !== "InProgress" && p.status !== k.status && !done) return p;
    return { ...p, status: done ? k.status : p.status, approvals: Math.max(p.approvals, k.approvals), voters: [...new Set([...p.voters, ...k.voters])] };
  };
  // After a vote or reset we know what the payroll balance should become. A lagging chain read must not undo it.
  const expectPayroll = useRef<{ near: number; until: number } | null>(null);
  // Set the payroll balance to what it must become (absolute, so a read that already caught up is never counted twice).
  const withPayroll = (d: Data, expected: number): Data => {
    const diff = expected - d.payroll.nearBalance;
    if (Math.abs(diff) < 0.01) return d;
    return {
      ...d,
      payroll: { ...d.payroll, nearBalance: expected },
      onChain: { ...d.onChain, nearBalance: d.onChain.nearBalance - diff },
      reserve: { spendableNear: Math.max(0, d.reserve.spendableNear - diff) },
    };
  };
  const load = useCallback(() => {
    return fetch("/api/treasury", { cache: "no-store" }).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Request failed");
      setError(null);
      setData((prev) => {
        let d: Data = { ...j, proposals: (j.proposals as Proposal[]).map(applyKnown) };
        const e = expectPayroll.current;
        if (e) {
          if (Math.abs(j.payroll.nearBalance - e.near) < 0.01 || Date.now() > e.until) expectPayroll.current = null;
          else if (prev) d = { ...d, payroll: prev.payroll, onChain: prev.onChain, reserve: prev.reserve };
        }
        return d;
      });
      setObs((cur) => (cur.length ? cur : j.demo.obligations));
    }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Live updates: while a suggestion is waiting for votes, refresh every 5 seconds.
  const open = data?.proposals.some((p) => p.status === "InProgress") ?? false;
  useEffect(() => {
    if (!open) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [open, load]);

  const calc = useMemo(() => {
    if (!data) return null;
    const price = data.demo.demoNearUsdPrice;
    const bal = totalNear(data);
    const totalDue = obs.reduce((s, o) => s + (+o.amountNear || 0), 0);
    return { price, bal, totalDue, otherUsd: data.demo.otherChainBalances.reduce((s, b) => s + b.usdValue, 0), realUsd: bal * price };
  }, [data, obs]);

  const health = useMemo(() => {
    if (!data) return null;
    const { balances, obligations } = toEngineInputs(data, obs);
    return analyze(balances, obligations);
  }, [data, obs]);

  // Payroll just became "Covered" because money arrived: play the pulse + the warm chord.
  const prevPay = useRef<{ gap: number; near: number } | null>(null);
  useEffect(() => {
    if (!health || !data) return;
    const prev = prevPay.current;
    prevPay.current = { gap: health.gapUsd, near: data.payroll.nearBalance };
    if (prev && prev.gap > 0 && health.gapUsd === 0 && data.payroll.nearBalance > prev.near) {
      setBurst((b) => b + 1);
      sound.success();
    }
  }, [health, data]);

  const live: Live | null = useMemo(() => {
    if (!data || !health) return null;
    const due = obs.filter((o) => +o.amountNear > 0).map((o) => o.dueInDays);
    return { payrollUsd: data.payroll.nearBalance * data.demo.demoNearUsdPrice, reserveUsd: health.reserveUsd, daysToPayday: due.length ? Math.min(...due) : null, gapUsd: health.gapUsd };
  }, [data, health, obs]);

  // Not enough spare NEAR in the reserve to cover the starting gap (counting what a reset would send back).
  const needsTopup = topupFromServer || (!!data && data.reserve.spendableNear + Math.max(0, data.payroll.nearBalance - data.demo.startingPayrollNear) + 1e-9 < data.demo.startingGapNear);
  async function resetDemo() {
    setBusy("reset"); setResetMsg(null); setNotice(null); setTopupFromServer(false);
    try {
      const r = await fetch("/api/reset-demo", { method: "POST" });
      const j = await r.json();
      if (j.status === "needs-topup") { setTopupFromServer(true); setResetMsg(j.why); return; }
      if (j.status === "busy" || j.status === "error") { setResetMsg(j.message); return; }
      // Back to the starting story: default payouts, no old advice.
      known.current.clear(); setAnalysis(null); setFiled(null); setSwapKey((k) => k + 1);
      if (data) setObs(data.demo.obligations);
      if (data && j.movedNear) {
        const expectedNear = data.demo.startingPayrollNear; // reset always lands on the known starting amount
        expectPayroll.current = { near: expectedNear, until: deadline() };
        setData((d) => (d ? withPayroll(d, expectedNear) : d));
      }
      const closedMsg = j.closed ? ` ${j.closed} old suggestion${j.closed === 1 ? " was" : "s were"} closed, so nobody can approve a stale one.` : "";
      setResetMsg(j.status === "already" ? "Already at the starting point." : `Done — payroll is short again.${closedMsg} Press “Get advice” to start.`);
      await load(); [2500, 6000].forEach((ms) => setTimeout(load, ms));
    } catch (e) { setResetMsg((e as Error).message); } finally { setBusy(null); }
  }
  const update = (id: string, patch: Partial<Obligation>) => setObs((l) => l.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const add = () => setObs((l) => [...l, { id: "new-" + Date.now(), label: "New payout", amountNear: 1, dueInDays: 14, kind: "payroll", note: "" }]);
  const input = "w-full rounded-md border border-line/10 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-accent/60";

  const suspicious = obs.filter((o) => !checkText(o.note).ok);
  function removeNotes() {
    setObs((l) => l.map((o) => (checkText(o.note).ok ? o : { ...o, note: "" })));
    setAnalysis(null);
  }
  async function runAnalysis(list: Obligation[] = obs) {
    setFiled(null); setNotice(null);
    // Never silent: a suspicious note stops the advice here, with a clear reason and a way out.
    const bad = list.find((o) => !checkText(o.note).ok);
    if (bad) {
      setAnalysis({ status: "blocked", message: "Coinsel won't advise while a suspicious note is in your payouts", label: bad.label,
        outside: [...new Set(list.flatMap((o) => { const r = checkText(o.note); return r.ok ? [] : r.outside; }))],
        why: "A note asked to send money to an address the treasury doesn't own." });
      return;
    }
    setBusy("analyze"); setAnalysis(null); setLogDone(false);
    try {
      const r = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ obligations: list }) });
      const j = await r.json();
      // On success, let the log type "Proof checked ✓ / Suggestion ready" before the advice appears.
      if (j.status === "ok") { setLogDone(true); await new Promise((res) => setTimeout(res, reduceMotion ? 0 : 1500)); }
      setAnalysis(r.ok || j.status ? j : { status: "error", message: j.error || "Something went wrong." });
    } catch (e) {
      setAnalysis({ status: "error", message: (e as Error).message });
    } finally { setBusy(null); }
  }
  function tryTheTrick() {
    const list = obs.map((o, i) => (i === 0 ? { ...o, note: TRICK_NOTE } : o));
    setObs(list);
    runAnalysis(list);
  }
  async function fileIt(a: Ok) {
    setBusy("file"); setNotice(null);
    try {
      const r = await fetch("/api/propose", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ obligations: obs, advice: a.advice, attestationHash: a.attestationHash, quoteUsdc: a.quoteUsdc }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || j.error || "Couldn't file it.");
      setFiled(j); sound.chime(); await load();
    } catch (e) { setNotice((e as Error).message); } finally { setBusy(null); }
  }
  async function vote(proposalId: number, member: number) {
    setBusy(member); setNotice(null);
    try {
      const r = await fetch("/api/demo-vote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId, member, obligations: obs }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "The vote didn't go through.");
      const who = data?.demoCouncil.find((m) => m.index === member)?.accountId;
      const prev = data?.proposals.find((x) => x.id === proposalId);
      known.current.set(proposalId, { status: j.status, approvals: j.approvals, voters: [...(prev?.voters ?? []), ...(who ? [who] : [])] });
      // Update the card right now; the chain read below confirms it.
      const moved = j.executed && prev?.amountNear ? prev.amountNear : 0;
      const expectedNear = (data?.payroll.nearBalance ?? 0) + moved;
      if (moved && data) expectPayroll.current = { near: expectedNear, until: deadline() };
      setData((d) => {
        if (!d) return d;
        const n = { ...d, proposals: d.proposals.map((x) => (x.id === proposalId ? applyKnown(x) : x)) };
        return moved ? withPayroll(n, expectedNear) : n;
      });
      setNotice(j.executed ? (prev?.register ? "Approved by 2 of 3 — the treasury is being registered. Step 2 will update in a moment." : prev?.swap ? "Approved by 2 of 3 — the test USDC was sent to the swap. Watch Step 2 for the result." : "Approved by 2 of 3 — the transfer ran on the test network. Balances below are now updated.") : `Council ${member} approved. ${j.approvals} of ${data?.council.threshold ?? 2} so far.`);
      await load();
      if (j.executed) [2500, 7000].forEach((ms) => setTimeout(load, ms)); // balances can lag a few seconds
    } catch (e) { setNotice((e as Error).message); } finally { setBusy(null); }
  }

  const a = analysis;
  const suggestion = (p: Proposal) => {
    if (!data) return null;
    const firstLine = p.description.split("\n").find((l) => l.startsWith("What:")) ?? p.description.split("\n")[0];
    // Warn the approver BEFORE they vote if this exact transfer is a copy of one already waiting or already sent.
    const dup = p.status === "InProgress" && health ? findDuplicate(p, data.proposals, { gapNear: gapNear(health, data.demo.demoNearUsdPrice), now: Date.parse(data.fetchedAt) }) : null;
    const over = !dup && p.status === "InProgress" && p.kind === "Transfer" && health ? pendingOverlap(p, data.proposals, { gapNear: gapNear(health, data.demo.demoNearUsdPrice), spendableNear: data.reserve.spendableNear, agents: data.council.agent }) : null;
    return (
      <li key={p.id} className="min-w-0 py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="min-w-0 break-words">#{p.id} · {firstLine.replace(/^What: /, "")}</span>
          <span className={`${mono} text-xs ${p.status === "Approved" ? "text-accent" : p.status === "InProgress" ? "text-demo" : "text-zinc-400"}`}>
            {p.status === "InProgress" ? `Waiting for votes · ${p.approvals} of ${data.council.threshold}` : p.status === "Approved" ? (p.swap || p.register ? "Approved — see Step 2" : "Approved — money moved") : p.status}
          </span>
        </div>
        {over && <p className="mt-1 rounded-md border border-warn/40 bg-warn/10 px-2 py-1 text-xs text-warn" role="alert">⚠ {over} Don&apos;t approve this one.</p>}
        {dup && <p className="mt-1 rounded-md border border-warn/40 bg-warn/10 px-2 py-1 text-xs text-warn" role="alert">⚠ {duplicateMessage(dup)} Don&apos;t approve this one.</p>}
        {p.status === "InProgress" && data.demoMode && (p.kind === "Transfer" || !!p.swap || !!p.register) && (
          <div className="mt-2">
            <div className="flex flex-wrap gap-2">
              {data.demoCouncil.map((m) => {
                const voted = p.voters.includes(m.accountId);
                return <button key={m.index} className={btnGhost} disabled={busy !== null || voted} onClick={() => vote(p.id, m.index)}>{voted ? `Council ${m.index} approved ✓` : busy === m.index ? "Signing…" : `Approve as Council ${m.index}`}</button>;
              })}
            </div>
            <p className="mt-2 text-xs text-demo">Demo mode — in real use, each council member signs with their own wallet.</p>
          </div>
        )}
        <details className="mt-1 text-xs text-zinc-500"><summary className="cursor-pointer">Full text</summary><pre className="mt-1 whitespace-pre-wrap break-words">{p.description}</pre></details>
      </li>
    );
  };
  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl px-4 py-6 sm:px-5 sm:py-8">
      <SoundToggle />
      <header className="mb-2 flex flex-wrap items-end justify-between gap-3 pr-12 sm:mb-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 font-[family-name:var(--font-syne)] text-xl font-extrabold tracking-[0.3em] text-fg sm:gap-3 sm:text-3xl sm:tracking-[0.45em]">
            <Logo />COINSEL
          </h1>
          <p className="mt-2 text-zinc-400">Counsel for your coins. Never control.</p>
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-sm sm:gap-3">
          <ThemeToggle />
          <span className="rounded-full border border-line/10 px-3 py-1 text-zinc-400">NEAR {data?.network ?? "testnet"}</span>
          {data && <a className="max-w-full truncate rounded-full border border-accent/40 px-3 py-1 text-accent hover:bg-accent/10" href={data.explorerUrl} target="_blank" rel="noreferrer">{short(data.dao)} ↗</a>}
        </div>
      </header>

      <Hero live={live} />
      <Marquee />

      {error && (
        <div className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          {error} <button onClick={load} className="ml-2 underline">Retry</button>
        </div>
      )}
      {!data && !error && <p className="text-zinc-500">Reading the treasury…</p>}

      {data && calc && (
        <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-3">
          <div className="md:col-span-3 -mb-2 flex flex-wrap items-center gap-2 text-xs">
            <Badge kind="demo">{demo.demoScaleLabel}</Badge>
            <span className="min-w-0 text-zinc-500">1 test NEAR is shown as {usd(calc.price)}. Amounts in NEAR, accounts and explorer links are real.</span>
          </div>
          <Card title="Total treasury" className="md:col-span-1" right={<Badge kind="real" />}>
            <div className="text-4xl font-semibold"><CountUp value={calc.realUsd} format={usd} /></div>
            <p className="mt-1 text-sm text-zinc-400">{near(calc.bal)} <span className="text-demo">(shown at demo scale)</span></p>
            <div className="mt-3 space-y-1 text-sm text-zinc-300">
              <div className="flex justify-between"><span>Main reserve</span><span>{near(data.onChain.nearBalance)}</span></div>
              <div className="flex justify-between"><span><a className="hover:text-accent" href={data.payroll.explorerUrl} target="_blank" rel="noreferrer">Payroll account (pays everyone) ↗</a></span><span>{near(data.payroll.nearBalance)}</span></div>
            </div>
            <div className="mt-4 border-t border-line/10 pt-3 text-sm text-zinc-400">
              + {usd(calc.otherUsd)} of USDC on Ethereum <span className="text-demo">(demo money, not counted above)</span>
              <div className="mt-1 text-zinc-200">Combined: {usd(calc.realUsd + calc.otherUsd)}</div>
            </div>
          </Card>

          <Card title="Money by network" className="md:col-span-2">
            <ul className="divide-y divide-line/5 text-sm">
              <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"><span className="min-w-0">NEAR testnet · payroll account</span><span className="flex flex-wrap items-center gap-2"><span>{data.payroll.nearBalance.toLocaleString("en-US", { maximumFractionDigits: 3 })}</span><Badge kind="real" /></span></li>
              <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"><span className="min-w-0">NEAR testnet · main reserve</span><span className="flex flex-wrap items-center gap-2"><span>{data.onChain.nearBalance.toLocaleString("en-US", { maximumFractionDigits: 3 })}</span><Badge kind="real" /></span></li>
              {data.onChain.tokens.map((t) => (
                <li key={t.contractId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"><span className="min-w-0">NEAR testnet · {t.symbol}</span><span className="flex flex-wrap items-center gap-2"><span>{t.amount.toLocaleString()}</span><Badge kind="real" /></span></li>
              ))}
              {data.demo.otherChainBalances.map((b) => (
                <li key={b.chain + b.symbol} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"><span className="min-w-0">{b.chain} · {b.symbol}</span><span className="flex flex-wrap items-center gap-2"><span>{b.amount.toLocaleString()}</span><Badge kind="demo" /></span></li>
              ))}
            </ul>
          </Card>

          <Card title="Upcoming payouts" className="md:col-span-2" right={<Badge kind="demo" />}>
            {obs.length === 0 && <p className="text-sm text-zinc-500">No payouts yet.</p>}
            <div className="space-y-3">
              {obs.map((o) => {
                const flagged = !checkText(o.note).ok;
                const lab = "mb-0.5 block text-[11px] text-zinc-500 sm:hidden";
                return (
                  <div key={o.id} className="grid grid-cols-6 items-end gap-2 rounded-lg border border-line/5 p-2 sm:grid-cols-12 sm:items-center sm:border-0 sm:p-0">
                    <label className="col-span-5 min-w-0 sm:col-span-5"><span className={lab}>Label</span><input aria-label="Label" className={input} value={o.label} maxLength={80} onChange={(e) => update(o.id, { label: e.target.value })} /></label>
                    <button aria-label="Remove" className="col-span-1 pb-1 text-zinc-500 hover:text-red-400 sm:col-span-1 sm:col-start-12 sm:row-start-1 sm:pb-0" onClick={() => setObs((l) => l.filter((x) => x.id !== o.id))}>✕</button>
                    <label className="col-span-2 min-w-0 sm:col-span-2"><span className={lab}>NEAR</span><input aria-label="Amount (NEAR)" type="number" min={0} step="0.1" className={input} value={o.amountNear} onChange={(e) => update(o.id, { amountNear: Math.max(0, +e.target.value) })} /></label>
                    <label className="col-span-2 min-w-0 sm:col-span-2"><span className={lab}>Due in (days)</span><input aria-label="Due in days" type="number" min={0} step="1" className={input} value={o.dueInDays} onChange={(e) => update(o.id, { dueInDays: Math.max(0, Math.round(+e.target.value)) })} /></label>
                    <label className="col-span-2 min-w-0 sm:col-span-2"><span className={lab}>Note</span><input aria-label="Note" placeholder="note" className={`${input} ${flagged ? "!border-warn" : o.note ? "!border-demo/50" : ""}`} value={o.note} maxLength={200} onChange={(e) => update(o.id, { note: e.target.value })} /></label>
                  </div>
                );
              })}
            </div>
            <div className="mt-1 hidden grid-cols-12 gap-2 text-[11px] text-zinc-500 sm:grid"><span className="col-span-5">Label</span><span className="col-span-2">NEAR</span><span className="col-span-2">Due in (days)</span><span className="col-span-2">Note</span></div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
              <button onClick={add} className={btnGhost}>+ Add payout</button>
              <span className="min-w-0 text-zinc-400">Total {near(calc.totalDue)} ({usd(calc.totalDue * calc.price)}) · changes stay in your browser only</span>
            </div>
          </Card>

          <Card title="Council" right={<Badge kind="real" />}>
            <div className="text-3xl font-semibold">{data.council.threshold} of {data.council.members.length}</div>
            <p className="mb-3 text-sm text-zinc-400">approvals needed before anything happens</p>
            <ul className="space-y-1 text-sm">
              {data.council.members.map((m) => <li key={m} className="min-w-0 truncate"><a className="text-zinc-300 hover:text-accent" href={nb(m)} target="_blank" rel="noreferrer">{short(m)} ↗</a></li>)}
            </ul>
            <p className="mt-3 border-t border-line/10 pt-3 text-xs text-zinc-500">
              Coinsel agent <span className="break-all text-zinc-300">{data.council.agent.map(short).join(", ") || "—"}</span> can only <b>suggest</b>. It can&apos;t send money.
            </p>
          </Card>

          <Card id="health" title="Health check" className="md:col-span-3" right={<span className="rounded-full border border-line/10 px-2 py-0.5 text-[11px] text-zinc-500">Plain maths, no AI</span>}>
            {health && (
              <>
                <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat burst={burst} label="Payroll account" value={health.gapUsd > 0 ? <>Short by <CountUp value={health.gapUsd} format={usd} /></> : "Covered ✓"} tone={health.gapUsd > 0 ? "bad" : "good"} />
                  <Stat label="Payroll money lasts" value={health.runwayDays === null ? "No payouts due" : <><CountUp value={health.runwayDays} /> days</>} tone={health.shortfalls.length ? "bad" : health.runwayDays !== null && health.runwayDays < 30 ? "warn" : "good"} />
                  <Stat label="Main reserve can spare" value={<CountUp value={health.reserveUsd} format={usd} />} tone={health.gapUsd > 0 && !health.reserveCoversGap ? "bad" : "neutral"} />
                  <Stat label="Sitting unused" value={<CountUp value={health.totalIdleUsd} format={usd} />} tone="neutral" />
                </div>
                <p className="mb-3 text-xs text-zinc-500">Payouts are paid from the payroll account: it holds {near(data.payroll.nearBalance)} and {near(calc.totalDue)} is due. The main reserve tops it up when needed.</p>
                <ul className="space-y-2">
                  {health.findings.map((f) => (
                    <li key={f.id} className={`rounded-xl border p-3 ${TONE[f.severity]}`}>
                      <div className="text-sm font-semibold">{f.title}</div>
                      <div className="text-sm opacity-90">{f.detail}</div>
                    </li>
                  ))}
                </ul>
                {health.shortfalls.length > 0 && (
                  <details className="mt-3 text-xs text-zinc-500">
                    <summary className="cursor-pointer">Details</summary>
                    <ul className="mt-2 space-y-1">
                      {health.shortfalls.map((s) => <li key={s.obligationId}>{s.label}: due in {s.dueInDays} days, needs {usd(s.amountUsd)}, {usd(s.availableUsd)} left → short {usd(s.shortUsd)}</li>)}
                    </ul>
                    <p className="mt-2">Payouts are paid in date order, each from money on its own network. Prices use the fixed demo rate.</p>
                  </details>
                )}
              </>
            )}
          </Card>

          <Card title="Counsel" className="md:col-span-3" right={<span className="max-w-full rounded-full border border-line/10 px-2 py-0.5 text-[11px] text-zinc-500">It can only suggest. It can&apos;t send money.</span>}>
            <div className="flex flex-wrap items-center gap-3">
              <button className={btn} disabled={busy !== null} onClick={() => runAnalysis()}>{busy === "analyze" ? "Working…" : "Get advice"}</button>
              <button className={`${btnGhost} border-demo/40 text-demo`} disabled={busy !== null || obs.length === 0} onClick={tryTheTrick}>Try the trick</button>
              <span className="min-w-0 text-xs text-zinc-500">“Try the trick” adds a sneaky note — “{TRICK_NOTE}” — to see what Coinsel does.</span>
            </div>
            {busy === "analyze" && (
              <>
                <CounselLog done={logDone} readLines={["Reading your treasury…", !health || !live ? "Checking your payouts…" : live.daysToPayday === null ? "No payouts are due" : health.gapUsd > 0 ? `Payday in ${live.daysToPayday} day${live.daysToPayday === 1 ? "" : "s"}, short ${usd(health.gapUsd)}` : `Payday in ${live.daysToPayday} day${live.daysToPayday === 1 ? "" : "s"}, the money is there`, "Thinking privately…"]} />
                <p className="mt-2 text-xs text-zinc-500">We check the AI is really private first, then write your advice. About 15 seconds.</p>
              </>
            )}

            {a?.status === "blocked" && (
              <div className="mt-4 rounded-xl border border-warn/40 bg-warn/10 p-4" role="alert">
                <div className="font-semibold text-warn">{suspicious.length || !a.label ? a.message : "That note is gone, so Coinsel can advise again."}</div>
                <p className="mt-1 text-sm text-zinc-300">{a.label ? `The note on “${a.label}” ` : "A note "}asked to send money to <b className={`${mono} break-all`}>{a.outside.join(", ")}</b>. That address isn&apos;t in the treasury&apos;s own list, so Coinsel ignored it.</p>
                <p className="mt-1 text-sm text-zinc-400">Even without this check, Coinsel can&apos;t move money: it can only suggest, and the council has to vote.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {suspicious.length > 0 && <button className={btn} onClick={removeNotes}>Remove the note</button>}
                </div>
                <details className="mt-2 text-xs text-zinc-500"><summary className="cursor-pointer">Details</summary>Guard rule: proposals may only send to accounts listed as DAO-owned in config. Notes and AI text are treated as untrusted.</details>
              </div>
            )}

            {a?.status === "unverified" && (
              <div className="mt-4 rounded-xl border border-demo/40 bg-demo/10 p-4" role="alert">
                <div className="font-semibold text-demo">Couldn&apos;t verify this time</div>
                <p className="mt-1 text-sm text-zinc-300">We only show advice from an AI we could check is private, and the check didn&apos;t pass (we tried twice). Nothing was sent to the AI.</p>
                <button className={`${btn} mt-3`} disabled={busy !== null} onClick={() => runAnalysis()}>Try again</button>
                <details className="mt-2 text-xs text-zinc-500"><summary className="cursor-pointer">Details</summary>{(a.attestation?.checks ?? []).filter((c) => c.status !== "pass").map((c) => `${c.id}: ${c.details}`).join(" · ") || "The proof service did not answer."}</details>
              </div>
            )}

            {a?.status === "error" && (
              <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300" role="alert">
                {a.message} <button className="ml-2 underline" onClick={() => runAnalysis()}>Try again</button>
              </div>
            )}

            {a?.status === "ok" && (
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-5">
                <div className="min-w-0 lg:col-span-3">
                  <div className="float rounded-xl border border-line/10 bg-sunk p-4">
                    <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500"><span className={mono}>ADVICE</span><Badge kind="real">Written by private AI</Badge></div>
                    <p className="break-words text-[15px] leading-relaxed text-zinc-100">{a.advice.text}</p>
                  </div>
                  <div className="mt-3 rounded-xl border border-accent/30 bg-accent/5 p-4 text-sm">
                    <div className="mb-1 flex flex-wrap items-center gap-2"><span className="font-semibold">Step 1 · On the test network</span><Badge kind="real">Council votes</Badge></div>
                    {a.transferNear > 0 ? (
                      <p className="text-zinc-300">Move <b>{near(a.transferNear)}</b> <span className="text-demo">(≈ {usd(a.transferUsd)} at demo scale — exactly what payroll is short)</span> from the main reserve to the payroll account (<a className="underline" href={nb(a.payrollAccount)} target="_blank" rel="noreferrer">{short(a.payrollAccount)}</a>). It only goes to an account the treasury owns.</p>
                    ) : <p className="text-zinc-300">Payroll is covered, so there is nothing to move.</p>}
                    {!filed && a.transferNear > 0 && <button className={`${btn} mt-3`} disabled={busy !== null || !a.canAfford} onClick={() => fileIt(a)}>{busy === "file" ? "Filing…" : "File step 1 for the council"}</button>}
                    {a.transferNear > 0 && !a.canAfford && <p className="mt-2 text-xs text-demo">Demo needs a top-up: the main reserve can only spare {near(a.spendableNear)} (the rest pays for storage), but the gap is {near(a.transferNear)}.</p>}
                    {filed && (
                      <p className="float float-b mt-3 text-zinc-200">Filed as suggestion <b>#{filed.proposalId}</b>. <a className="text-accent underline" href={filed.txUrl} target="_blank" rel="noreferrer">See it on the explorer ↗</a><br /><span className="text-xs text-zinc-500">Now the council votes — see “Suggestions” below.</span></p>
                    )}
                  </div>
                  <SwapStep dao={data.dao} swap={a.swap} quote={a.quote} advice={a.advice} attestationHash={a.attestationHash} obligations={obs}
                    key={swapKey} proposals={data.proposals} busyElsewhere={busy !== null} onChanged={load} />
                </div>
                <div className="min-w-0 lg:col-span-2"><VerifiedPanel a={a.attestation} hashes={{ request: a.advice.requestHash, response: a.advice.responseHash }} /></div>
              </div>
            )}
          </Card>

          <Card title="Suggestions" className="md:col-span-3" right={<Badge kind="real" />}>
            {notice && <div className="mb-3 rounded-lg border border-accent/30 bg-accent/5 p-3 text-sm text-zinc-200" role="status">{notice}</div>}
            {data.proposals.length === 0 ? <p className="text-sm text-zinc-500">No suggestions filed yet. Press “Get advice”.</p> : (
              <>
                <ul className="divide-y divide-line/5 text-sm">{data.proposals.slice(0, SHOWN_SUGGESTIONS).map(suggestion)}</ul>
                {data.proposals.length > SHOWN_SUGGESTIONS && (
                  <details className="mt-3 border-t border-line/5 pt-3">
                    <summary className="cursor-pointer text-xs text-zinc-500">Older ({data.proposals.length - SHOWN_SUGGESTIONS})</summary>
                    <ul className="divide-y divide-line/5 text-sm">{data.proposals.slice(SHOWN_SUGGESTIONS).map(suggestion)}</ul>
                  </details>
                )}
              </>
            )}
          </Card>
        </div>
      )}
      <Safety />
      {data && calc && (
        <section className="mt-5 min-w-0 rounded-2xl glass border border-dashed border-demo/40 p-4 sm:p-5">
          <div className="mb-2 flex flex-wrap items-center gap-2"><h2 className={`${mono} text-xs font-semibold uppercase tracking-wider text-zinc-400`}>Demo controls</h2><Badge kind="demo">Demo only</Badge></div>
          <p className="text-sm text-zinc-300">Want to try it again from the start? Reset puts the money back so payroll is short by {usd(data.demo.startingGapNear * data.demo.demoNearUsdPrice)} again. Test network only.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className={btnGhost} disabled={busy !== null || !data.demoMode} onClick={resetDemo}>{busy === "reset" ? "Resetting…" : "Reset demo"}</button>
            {!data.demoMode && <span className="text-xs text-zinc-500">Reset is switched off on this server.</span>}
          </div>
          {needsTopup && <p className="mt-3 rounded-lg border border-demo/40 bg-demo/10 p-3 text-sm text-demo" role="alert"><b>Demo needs a top-up.</b> The main reserve doesn&apos;t have enough spare test NEAR to cover the gap. Send a few test NEAR from the faucet to <span className={`${mono} break-all`}>{data.dao}</span>.</p>}
          {resetMsg && <p className="mt-3 text-sm text-zinc-200" role="status">{resetMsg}</p>}
        </section>
      )}
      <footer className="mt-10 text-xs text-zinc-600">Test network only. Coinsel can only suggest — it can&apos;t send money. Yellow badges mark demo data.</footer>
    </div>
  );
}
