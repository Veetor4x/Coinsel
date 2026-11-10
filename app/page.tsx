"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyze, type Severity } from "@/lib/engine";
import { toEngineInputs, totalNear, type UiObligation as Obligation } from "@/lib/engine-inputs";
import { TRICK_NOTE } from "@/lib/trick";
import { checkText } from "@/lib/guard";
import demo from "@/config/demo-treasury.json";
import type { Treasury } from "@/lib/treasury";
import type { QuoteResult } from "@/lib/intents";
import type { HealthReport } from "@/lib/engine";
import { VerifiedPanel, type AttestationView } from "./AskCoinsel";

type Data = Omit<Treasury, "proposals"> & { proposals: (Treasury["proposals"][number])[] };
type Ok = {
  status: "ok"; health: HealthReport; quote: QuoteResult; quoteUsdc: number; attestation: AttestationView; attestationHash: string;
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
      <path d="M18 4a14 14 0 1 0 13.6 10.8" fill="none" stroke="#F2F2EE" strokeWidth="2" strokeLinecap="round" opacity=".85" />
      <circle cx="18" cy="18" r="5" fill="#C6FF3D" />
      <circle cx="30" cy="9" r="2.4" fill="#C6FF3D" />
    </svg>
  );
}
function Badge({ kind, children }: { kind: "real" | "demo" | "warn"; children?: React.ReactNode }) {
  const c = { real: "border-[#C6FF3D]/40 bg-[#C6FF3D]/10 text-[#C6FF3D]", demo: "border-[#FFC56E]/40 bg-[#FFC56E]/10 text-[#FFC56E]", warn: "border-[#FF9A82]/40 bg-[#FF9A82]/10 text-[#FF9A82]" }[kind];
  return <span className={`max-w-full rounded-full border px-2 py-0.5 text-[11px] font-medium ${c}`}>{children ?? (kind === "real" ? "Real · test network" : "Demo data")}</span>;
}
const TONE: Record<Severity, string> = {
  critical: "border-[#FF9A82]/40 bg-[#FF9A82]/10 text-[#FF9A82]",
  warning: "border-[#FFC56E]/40 bg-[#FFC56E]/10 text-[#FFC56E]",
  info: "border-white/10 bg-white/5 text-zinc-200",
  ok: "border-[#C6FF3D]/40 bg-[#C6FF3D]/10 text-[#C6FF3D]",
};
function Stat({ label, value, tone }: { label: string; value: string; tone: "good" | "warn" | "bad" | "neutral" }) {
  const c = { good: "text-[#C6FF3D]", warn: "text-[#FFC56E]", bad: "text-[#FF9A82]", neutral: "text-zinc-100" }[tone];
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`break-words text-2xl font-semibold ${c}`}>{value}</div>
    </div>
  );
}
function Card({ title, right, children, className = "" }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-[#262A2E] bg-[#121315] p-4 sm:p-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className={`${mono} text-xs font-semibold uppercase tracking-wider text-zinc-400`}>{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}
const btn = "max-w-full whitespace-normal rounded-lg bg-[#C6FF3D] px-4 py-2 text-sm font-semibold text-[#0C0D0E] hover:brightness-110 disabled:opacity-50";
const btnGhost = "max-w-full whitespace-normal rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-50";

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
      known.current.clear(); setAnalysis(null); setFiled(null);
      if (data) setObs(data.demo.obligations);
      if (data && j.movedNear) {
        const expectedNear = data.demo.startingPayrollNear; // reset always lands on the known starting amount
        expectPayroll.current = { near: expectedNear, until: deadline() };
        setData((d) => (d ? withPayroll(d, expectedNear) : d));
      }
      setResetMsg(j.status === "already" ? "Already at the starting point." : "Done — payroll is short again. Press “Get advice” to start.");
      await load(); [2500, 6000].forEach((ms) => setTimeout(load, ms));
    } catch (e) { setResetMsg((e as Error).message); } finally { setBusy(null); }
  }
  const update = (id: string, patch: Partial<Obligation>) => setObs((l) => l.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const add = () => setObs((l) => [...l, { id: "new-" + Date.now(), label: "New payout", amountNear: 1, dueInDays: 14, kind: "payroll", note: "" }]);
  const input = "w-full rounded-md border border-white/10 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-[#C6FF3D]/60";

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
    setBusy("analyze"); setAnalysis(null);
    try {
      const r = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ obligations: list }) });
      const j = await r.json();
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
      setFiled(j); await load();
    } catch (e) { setNotice((e as Error).message); } finally { setBusy(null); }
  }
  async function vote(proposalId: number, member: number) {
    setBusy(member); setNotice(null);
    try {
      const r = await fetch("/api/demo-vote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId, member }) });
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
      setNotice(j.executed ? "Approved by 2 of 3 — the transfer ran on the test network. Balances below are now updated." : `Council ${member} approved. ${j.approvals} of ${data?.council.threshold ?? 2} so far.`);
      await load();
      if (j.executed) [2500, 7000].forEach((ms) => setTimeout(load, ms)); // balances can lag a few seconds
    } catch (e) { setNotice((e as Error).message); } finally { setBusy(null); }
  }

  const a = analysis;
  const suggestion = (p: Proposal) => {
    if (!data) return null;
    const firstLine = p.description.split("\n").find((l) => l.startsWith("What:")) ?? p.description.split("\n")[0];
    return (
      <li key={p.id} className="min-w-0 py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="min-w-0 break-words">#{p.id} · {firstLine.replace(/^What: /, "")}</span>
          <span className={`${mono} text-xs ${p.status === "Approved" ? "text-[#C6FF3D]" : p.status === "InProgress" ? "text-[#FFC56E]" : "text-zinc-400"}`}>
            {p.status === "InProgress" ? `Waiting for votes · ${p.approvals} of ${data.council.threshold}` : p.status === "Approved" ? "Approved — money moved" : p.status}
          </span>
        </div>
        {p.status === "InProgress" && data.demoMode && p.kind === "Transfer" && (
          <div className="mt-2">
            <div className="flex flex-wrap gap-2">
              {data.demoCouncil.map((m) => {
                const voted = p.voters.includes(m.accountId);
                return <button key={m.index} className={btnGhost} disabled={busy !== null || voted} onClick={() => vote(p.id, m.index)}>{voted ? `Council ${m.index} approved ✓` : busy === m.index ? "Signing…" : `Approve as Council ${m.index}`}</button>;
              })}
            </div>
            <p className="mt-2 text-xs text-[#FFC56E]">Demo mode — in real use, each council member signs with their own wallet.</p>
          </div>
        )}
        <details className="mt-1 text-xs text-zinc-500"><summary className="cursor-pointer">Full text</summary><pre className="mt-1 whitespace-pre-wrap break-words">{p.description}</pre></details>
      </li>
    );
  };
  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl px-4 py-6 sm:px-5 sm:py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3 sm:mb-8">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 font-[family-name:var(--font-syne)] text-xl font-extrabold tracking-[0.3em] text-[#F2F2EE] sm:gap-3 sm:text-3xl sm:tracking-[0.45em]">
            <Logo />COINSEL
          </h1>
          <p className="mt-2 text-zinc-400">Counsel for your coins. Never control.</p>
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-sm sm:gap-3">
          <span className="rounded-full border border-white/10 px-3 py-1 text-zinc-400">NEAR {data?.network ?? "testnet"}</span>
          {data && <a className="max-w-full truncate rounded-full border border-[#C6FF3D]/40 px-3 py-1 text-[#C6FF3D] hover:bg-[#C6FF3D]/10" href={data.explorerUrl} target="_blank" rel="noreferrer">{short(data.dao)} ↗</a>}
        </div>
      </header>

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
            <div className="text-4xl font-semibold">{usd(calc.realUsd)}</div>
            <p className="mt-1 text-sm text-zinc-400">{near(calc.bal)} <span className="text-[#FFC56E]">(shown at demo scale)</span></p>
            <div className="mt-3 space-y-1 text-sm text-zinc-300">
              <div className="flex justify-between"><span>Main reserve</span><span>{near(data.onChain.nearBalance)}</span></div>
              <div className="flex justify-between"><span><a className="hover:text-[#C6FF3D]" href={data.payroll.explorerUrl} target="_blank" rel="noreferrer">Payroll account (pays everyone) ↗</a></span><span>{near(data.payroll.nearBalance)}</span></div>
            </div>
            <div className="mt-4 border-t border-white/10 pt-3 text-sm text-zinc-400">
              + {usd(calc.otherUsd)} of USDC on Ethereum <span className="text-[#FFC56E]">(demo money, not counted above)</span>
              <div className="mt-1 text-zinc-200">Combined: {usd(calc.realUsd + calc.otherUsd)}</div>
            </div>
          </Card>

          <Card title="Money by network" className="md:col-span-2">
            <ul className="divide-y divide-white/5 text-sm">
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
                  <div key={o.id} className="grid grid-cols-6 items-end gap-2 rounded-lg border border-white/5 p-2 sm:grid-cols-12 sm:items-center sm:border-0 sm:p-0">
                    <label className="col-span-5 min-w-0 sm:col-span-5"><span className={lab}>Label</span><input aria-label="Label" className={input} value={o.label} maxLength={80} onChange={(e) => update(o.id, { label: e.target.value })} /></label>
                    <button aria-label="Remove" className="col-span-1 pb-1 text-zinc-500 hover:text-red-400 sm:col-span-1 sm:col-start-12 sm:row-start-1 sm:pb-0" onClick={() => setObs((l) => l.filter((x) => x.id !== o.id))}>✕</button>
                    <label className="col-span-2 min-w-0 sm:col-span-2"><span className={lab}>NEAR</span><input aria-label="Amount (NEAR)" type="number" min={0} step="0.1" className={input} value={o.amountNear} onChange={(e) => update(o.id, { amountNear: Math.max(0, +e.target.value) })} /></label>
                    <label className="col-span-2 min-w-0 sm:col-span-2"><span className={lab}>Due in (days)</span><input aria-label="Due in days" type="number" min={0} step="1" className={input} value={o.dueInDays} onChange={(e) => update(o.id, { dueInDays: Math.max(0, Math.round(+e.target.value)) })} /></label>
                    <label className="col-span-2 min-w-0 sm:col-span-2"><span className={lab}>Note</span><input aria-label="Note" placeholder="note" className={`${input} ${flagged ? "!border-[#FF9A82]" : o.note ? "!border-[#FFC56E]/50" : ""}`} value={o.note} maxLength={200} onChange={(e) => update(o.id, { note: e.target.value })} /></label>
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
              {data.council.members.map((m) => <li key={m} className="min-w-0 truncate"><a className="text-zinc-300 hover:text-[#C6FF3D]" href={nb(m)} target="_blank" rel="noreferrer">{short(m)} ↗</a></li>)}
            </ul>
            <p className="mt-3 border-t border-white/10 pt-3 text-xs text-zinc-500">
              Coinsel agent <span className="break-all text-zinc-300">{data.council.agent.map(short).join(", ") || "—"}</span> can only <b>suggest</b>. It can&apos;t send money.
            </p>
          </Card>

          <Card title="Health check" className="md:col-span-3" right={<span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-zinc-500">Plain maths, no AI</span>}>
            {health && (
              <>
                <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat label="Payroll account" value={health.gapUsd > 0 ? `Short by ${usd(health.gapUsd)}` : "Covered"} tone={health.gapUsd > 0 ? "bad" : "good"} />
                  <Stat label="Payroll money lasts" value={health.runwayDays === null ? "No payouts due" : `${health.runwayDays} days`} tone={health.shortfalls.length ? "bad" : health.runwayDays !== null && health.runwayDays < 30 ? "warn" : "good"} />
                  <Stat label="Main reserve can spare" value={usd(health.reserveUsd)} tone={health.gapUsd > 0 && !health.reserveCoversGap ? "bad" : "neutral"} />
                  <Stat label="Sitting unused" value={usd(health.totalIdleUsd)} tone="neutral" />
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

          <Card title="Counsel" className="md:col-span-3" right={<span className="max-w-full rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-zinc-500">It can only suggest. It can&apos;t send money.</span>}>
            <div className="flex flex-wrap items-center gap-3">
              <button className={btn} disabled={busy !== null} onClick={() => runAnalysis()}>{busy === "analyze" ? "Working…" : "Get advice"}</button>
              <button className={`${btnGhost} border-[#FFC56E]/40 text-[#FFC56E]`} disabled={busy !== null || obs.length === 0} onClick={tryTheTrick}>Try the trick</button>
              <span className="min-w-0 text-xs text-zinc-500">“Try the trick” adds a sneaky note — “{TRICK_NOTE}” — to see what Coinsel does.</span>
            </div>
            {busy === "analyze" && <p className="mt-4 text-sm text-zinc-400">Checking the AI is really private first, then writing your advice. This takes about 15 seconds.</p>}

            {a?.status === "blocked" && (
              <div className="mt-4 rounded-xl border border-[#FF9A82]/40 bg-[#FF9A82]/10 p-4" role="alert">
                <div className="font-semibold text-[#FF9A82]">{suspicious.length || !a.label ? a.message : "That note is gone, so Coinsel can advise again."}</div>
                <p className="mt-1 text-sm text-zinc-300">{a.label ? `The note on “${a.label}” ` : "A note "}asked to send money to <b className={`${mono} break-all`}>{a.outside.join(", ")}</b>. That address isn&apos;t in the treasury&apos;s own list, so Coinsel ignored it.</p>
                <p className="mt-1 text-sm text-zinc-400">Even without this check, Coinsel can&apos;t move money: it can only suggest, and the council has to vote.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {suspicious.length > 0 && <button className={btn} onClick={removeNotes}>Remove the note</button>}
                </div>
                <details className="mt-2 text-xs text-zinc-500"><summary className="cursor-pointer">Details</summary>Guard rule: proposals may only send to accounts listed as DAO-owned in config. Notes and AI text are treated as untrusted.</details>
              </div>
            )}

            {a?.status === "unverified" && (
              <div className="mt-4 rounded-xl border border-[#FFC56E]/40 bg-[#FFC56E]/10 p-4" role="alert">
                <div className="font-semibold text-[#FFC56E]">Couldn&apos;t verify this time</div>
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
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500"><span className={mono}>ADVICE</span><Badge kind="real">Written by private AI</Badge></div>
                    <p className="break-words text-[15px] leading-relaxed text-zinc-100">{a.advice.text}</p>
                  </div>
                  <div className="mt-3 rounded-xl border border-[#C6FF3D]/30 bg-[#C6FF3D]/5 p-4 text-sm">
                    <div className="mb-1 flex flex-wrap items-center gap-2"><span className="font-semibold">Step 1 · On the test network</span><Badge kind="real">Council votes</Badge></div>
                    {a.transferNear > 0 ? (
                      <p className="text-zinc-300">Move <b>{near(a.transferNear)}</b> <span className="text-[#FFC56E]">(≈ {usd(a.transferUsd)} at demo scale — exactly what payroll is short)</span> from the main reserve to the payroll account (<a className="underline" href={nb(a.payrollAccount)} target="_blank" rel="noreferrer">{short(a.payrollAccount)}</a>). It only goes to an account the treasury owns.</p>
                    ) : <p className="text-zinc-300">Payroll is covered, so there is nothing to move.</p>}
                    {!filed && a.transferNear > 0 && <button className={`${btn} mt-3`} disabled={busy !== null || !a.canAfford} onClick={() => fileIt(a)}>{busy === "file" ? "Filing…" : "File step 1 for the council"}</button>}
                    {a.transferNear > 0 && !a.canAfford && <p className="mt-2 text-xs text-[#FFC56E]">Demo needs a top-up: the main reserve can only spare {near(a.spendableNear)} (the rest pays for storage), but the gap is {near(a.transferNear)}.</p>}
                    {filed && (
                      <p className="mt-3 text-zinc-200">Filed as suggestion <b>#{filed.proposalId}</b>. <a className="text-[#C6FF3D] underline" href={filed.txUrl} target="_blank" rel="noreferrer">See it on the explorer ↗</a><br /><span className="text-xs text-zinc-500">Now the council votes — see “Suggestions” below.</span></p>
                    )}
                  </div>
                  <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-4 text-sm">
                    <div className="mb-1 flex flex-wrap items-center gap-2"><span className="font-semibold">Step 2 · Later, on another network</span><Badge kind="demo">Quote only</Badge></div>
                    <p className="mb-1 text-zinc-400">Refill the main reserve from the idle USDC on Ethereum.</p>
                    {a.quote.ok ? (
                      <p className="text-zinc-300">{a.quote.amountInUsdc.toLocaleString("en-US")} USDC on Ethereum would become about <b>{usd(a.quote.amountOutUsd)}</b> of NEAR in about {a.quote.timeEstimateSec} seconds.</p>
                    ) : <p className="text-[#FFC56E]">{a.quote.error}</p>}
                    <p className="mt-1 text-xs text-zinc-500">{a.quote.label}</p>
                  </div>
                </div>
                <div className="min-w-0 lg:col-span-2"><VerifiedPanel a={a.attestation} hashes={{ request: a.advice.requestHash, response: a.advice.responseHash }} /></div>
              </div>
            )}
          </Card>

          <Card title="Suggestions" className="md:col-span-3" right={<Badge kind="real" />}>
            {notice && <div className="mb-3 rounded-lg border border-[#C6FF3D]/30 bg-[#C6FF3D]/5 p-3 text-sm text-zinc-200" role="status">{notice}</div>}
            {data.proposals.length === 0 ? <p className="text-sm text-zinc-500">No suggestions filed yet. Press “Get advice”.</p> : (
              <>
                <ul className="divide-y divide-white/5 text-sm">{data.proposals.slice(0, SHOWN_SUGGESTIONS).map(suggestion)}</ul>
                {data.proposals.length > SHOWN_SUGGESTIONS && (
                  <details className="mt-3 border-t border-white/5 pt-3">
                    <summary className="cursor-pointer text-xs text-zinc-500">Older ({data.proposals.length - SHOWN_SUGGESTIONS})</summary>
                    <ul className="divide-y divide-white/5 text-sm">{data.proposals.slice(SHOWN_SUGGESTIONS).map(suggestion)}</ul>
                  </details>
                )}
              </>
            )}
          </Card>
        </div>
      )}
      {data && calc && (
        <section className="mt-5 min-w-0 rounded-2xl border border-dashed border-[#FFC56E]/40 bg-[#121315] p-4 sm:p-5">
          <div className="mb-2 flex flex-wrap items-center gap-2"><h2 className={`${mono} text-xs font-semibold uppercase tracking-wider text-zinc-400`}>Demo controls</h2><Badge kind="demo">Demo only</Badge></div>
          <p className="text-sm text-zinc-300">Want to try it again from the start? Reset puts the money back so payroll is short by {usd(data.demo.startingGapNear * data.demo.demoNearUsdPrice)} again. Test network only.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className={btnGhost} disabled={busy !== null || !data.demoMode} onClick={resetDemo}>{busy === "reset" ? "Resetting…" : "Reset demo"}</button>
            {!data.demoMode && <span className="text-xs text-zinc-500">Reset is switched off on this server.</span>}
          </div>
          {needsTopup && <p className="mt-3 rounded-lg border border-[#FFC56E]/40 bg-[#FFC56E]/10 p-3 text-sm text-[#FFC56E]" role="alert"><b>Demo needs a top-up.</b> The main reserve doesn&apos;t have enough spare test NEAR to cover the gap. Send a few test NEAR from the faucet to <span className={`${mono} break-all`}>{data.dao}</span>.</p>}
          {resetMsg && <p className="mt-3 text-sm text-zinc-200" role="status">{resetMsg}</p>}
        </section>
      )}
      <footer className="mt-10 text-xs text-zinc-600">Test network only. Coinsel can only suggest — it can&apos;t send money. Yellow badges mark demo data.</footer>
    </div>
  );
}
