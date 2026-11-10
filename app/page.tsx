"use client";
import { useEffect, useMemo, useState } from "react";
import { analyze, type Balance, type Severity } from "@/lib/engine";
import AskCoinsel from "./AskCoinsel";

type Obligation = { id: string; label: string; amountNear: number; dueInDays: number; kind: string; note: string };
type Data = {
  network: string; dao: string; explorerUrl: string; fetchedAt: string;
  onChain: { nearBalance: number; tokens: { contractId: string; symbol: string; amount: number }[] };
  council: { members: string[]; threshold: number; agent: string[]; proposalBond: string };
  proposals: { id: number; proposer: string; description: string; kind: string; status: string }[];
  demo: { demoNearUsdPrice: number; obligations: Obligation[]; otherChainBalances: { chain: string; symbol: string; amount: number; usdValue: number }[] };
};

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const near = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} NEAR`;
const short = (id: string) => (id.length > 26 ? id.slice(0, 12) + "…" + id.slice(-12) : id);
const nb = (id: string) => `https://testnet.nearblocks.io/address/${id}`;

function Logo() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
      <path d="M18 4a14 14 0 1 0 13.6 10.8" fill="none" stroke="#F2F2EE" strokeWidth="2" strokeLinecap="round" opacity=".85" />
      <circle cx="18" cy="18" r="5" fill="#C6FF3D" />
      <circle cx="30" cy="9" r="2.4" fill="#C6FF3D" />
    </svg>
  );
}
function Badge({ kind }: { kind: "real" | "demo" }) {
  return kind === "real" ? (
    <span className="rounded-full border border-[#C6FF3D]/40 bg-[#C6FF3D]/10 px-2 py-0.5 text-[11px] font-medium text-[#C6FF3D]">Real · test network</span>
  ) : (
    <span className="rounded-full border border-[#FFC56E]/40 bg-[#FFC56E]/10 px-2 py-0.5 text-[11px] font-medium text-[#FFC56E]">Demo data</span>
  );
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
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-2xl font-semibold ${c}`}>{value}</div>
    </div>
  );
}
function Card({ title, right, children, className = "" }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-[#262A2E] bg-[#121315] p-5 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export default function Home() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [obs, setObs] = useState<Obligation[]>([]); // client-side only, no database

  const load = () => {
    fetch("/api/treasury").then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Request failed");
      setError(null); setData(j); setObs((cur) => (cur.length ? cur : j.demo.obligations));
    }).catch((e) => setError(e.message));
  };
  useEffect(() => { load(); }, []);

  const calc = useMemo(() => {
    if (!data) return null;
    const price = data.demo.demoNearUsdPrice;
    const bal = data.onChain.nearBalance;
    const due = (days: number) => obs.filter((o) => o.dueInDays <= days).reduce((s, o) => s + (+o.amountNear || 0), 0);
    const totalDue = obs.reduce((s, o) => s + (+o.amountNear || 0), 0);
    const first = obs.length ? Math.min(...obs.map((o) => o.dueInDays)) : null;
    const dueAtFirst = first === null ? 0 : due(first);
    const otherUsd = data.demo.otherChainBalances.reduce((s, b) => s + b.usdValue, 0);
    return { price, bal, totalDue, first, dueAtFirst, shortBy: Math.max(0, dueAtFirst - bal), otherUsd, realUsd: bal * price };
  }, [data, obs]);

  const health = useMemo(() => {
    if (!data) return null;
    const price = data.demo.demoNearUsdPrice;
    const balances: Balance[] = [
      { chain: "NEAR", symbol: "NEAR", amount: data.onChain.nearBalance, usdValue: data.onChain.nearBalance * price, source: "real" },
      ...data.onChain.tokens.map((t): Balance => ({ chain: "NEAR", symbol: t.symbol, amount: t.amount, usdValue: 0, source: "real" })),
      ...data.demo.otherChainBalances.map((b): Balance => ({ chain: b.chain, symbol: b.symbol, amount: b.amount, usdValue: b.usdValue, source: "demo" })),
    ];
    return analyze(balances, obs.map((o) => ({ id: o.id, label: o.label, amountUsd: (+o.amountNear || 0) * price, dueInDays: o.dueInDays, chain: "NEAR" })));
  }, [data, obs]);

  const update = (id: string, patch: Partial<Obligation>) => setObs((l) => l.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const add = () => setObs((l) => [...l, { id: "new-" + Date.now(), label: "New payout", amountNear: 1, dueInDays: 14, kind: "payroll", note: "" }]);
  const input = "w-full rounded-md border border-white/10 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-[#C6FF3D]/60";

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 font-[family-name:var(--font-syne)] text-2xl font-extrabold tracking-[0.45em] text-[#F2F2EE] sm:text-3xl">
            <Logo />C O I N S E L
          </h1>
          <p className="mt-2 text-zinc-400">Counsel for your coins. Never control.</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="rounded-full border border-white/10 px-3 py-1 text-zinc-400">NEAR {data?.network ?? "testnet"}</span>
          {data && <a className="rounded-full border border-[#C6FF3D]/40 px-3 py-1 text-[#C6FF3D] hover:bg-[#C6FF3D]/10" href={data.explorerUrl} target="_blank" rel="noreferrer">{short(data.dao)} ↗</a>}
        </div>
      </header>

      {error && (
        <div className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          {error} <button onClick={() => { setError(null); load(); }} className="ml-2 underline">Retry</button>
        </div>
      )}
      {!data && !error && <p className="text-zinc-500">Reading the treasury…</p>}

      {data && calc && (
        <div className="grid gap-5 md:grid-cols-3">
          <Card title="Total treasury" className="md:col-span-1" right={<Badge kind="real" />}>
            <div className="text-4xl font-semibold">{usd(calc.realUsd)}</div>
            <p className="mt-1 text-sm text-zinc-400">{near(calc.bal)} on-chain × ${calc.price} <span className="text-[#FFC56E]">(fixed demo price)</span></p>
            <div className="mt-4 border-t border-white/10 pt-3 text-sm text-zinc-400">
              + {usd(calc.otherUsd)} of USDC on Ethereum <span className="text-[#FFC56E]">(demo money, not counted above)</span>
              <div className="mt-1 text-zinc-200">Combined: {usd(calc.realUsd + calc.otherUsd)}</div>
            </div>
          </Card>

          <Card title="Money by network" className="md:col-span-2">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-zinc-500"><tr><th className="pb-2">Network</th><th>Asset</th><th className="text-right">Amount</th><th className="text-right">Source</th></tr></thead>
              <tbody className="divide-y divide-white/5">
                <tr><td className="py-2">NEAR testnet</td><td>NEAR</td><td className="text-right">{calc.bal.toLocaleString("en-US", { maximumFractionDigits: 3 })}</td><td className="text-right"><Badge kind="real" /></td></tr>
                {data.onChain.tokens.map((t) => (
                  <tr key={t.contractId}><td className="py-2">NEAR testnet</td><td>{t.symbol}</td><td className="text-right">{t.amount.toLocaleString()}</td><td className="text-right"><Badge kind="real" /></td></tr>
                ))}
                {data.demo.otherChainBalances.map((b) => (
                  <tr key={b.chain + b.symbol}><td className="py-2">{b.chain}</td><td>{b.symbol}</td><td className="text-right">{b.amount.toLocaleString()}</td><td className="text-right"><Badge kind="demo" /></td></tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Upcoming payouts" className="md:col-span-2" right={<Badge kind="demo" />}>
            {obs.length === 0 && <p className="text-sm text-zinc-500">No payouts yet.</p>}
            <div className="space-y-2">
              {obs.map((o) => (
                <div key={o.id} className="grid grid-cols-12 items-center gap-2">
                  <input aria-label="Label" className={`${input} col-span-5`} value={o.label} maxLength={80} onChange={(e) => update(o.id, { label: e.target.value })} />
                  <input aria-label="Amount (NEAR)" type="number" min={0} step="0.1" className={`${input} col-span-2`} value={o.amountNear} onChange={(e) => update(o.id, { amountNear: Math.max(0, +e.target.value) })} />
                  <input aria-label="Due in days" type="number" min={0} step="1" className={`${input} col-span-2`} value={o.dueInDays} onChange={(e) => update(o.id, { dueInDays: Math.max(0, Math.round(+e.target.value)) })} />
                  <input aria-label="Note" placeholder="note" className={`${input} col-span-2`} value={o.note} maxLength={200} onChange={(e) => update(o.id, { note: e.target.value })} />
                  <button aria-label="Remove" className="col-span-1 text-zinc-500 hover:text-red-400" onClick={() => setObs((l) => l.filter((x) => x.id !== o.id))}>✕</button>
                </div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-12 gap-2 text-[11px] text-zinc-500"><span className="col-span-5">Label</span><span className="col-span-2">NEAR</span><span className="col-span-2">Due in (days)</span><span className="col-span-3">Note</span></div>
            <div className="mt-4 flex items-center justify-between text-sm">
              <button onClick={add} className="rounded-lg border border-white/15 px-3 py-1.5 hover:bg-white/5">+ Add payout</button>
              <span className="text-zinc-400">Total {near(calc.totalDue)} · changes stay in your browser only</span>
            </div>
          </Card>

          <Card title="Council" right={<Badge kind="real" />}>
            <div className="text-3xl font-semibold">{data.council.threshold} of {data.council.members.length}</div>
            <p className="mb-3 text-sm text-zinc-400">approvals needed before anything happens</p>
            <ul className="space-y-1 text-sm">
              {data.council.members.map((m) => <li key={m}><a className="text-zinc-300 hover:text-[#C6FF3D]" href={nb(m)} target="_blank" rel="noreferrer">{short(m)} ↗</a></li>)}
            </ul>
            <p className="mt-3 border-t border-white/10 pt-3 text-xs text-zinc-500">
              Coinsel agent <span className="text-zinc-300">{data.council.agent.map(short).join(", ") || "—"}</span> can only <b>suggest</b>. It can&apos;t send money.
            </p>
          </Card>

          <Card title="Health check" className="md:col-span-3" right={<span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-zinc-500">Plain maths, no AI</span>}>
            {health && (
              <>
                <div className="mb-4 grid gap-3 sm:grid-cols-3">
                  <Stat label="Money lasts" value={health.runwayDays === null ? "No payouts due" : `${health.runwayDays} days`} tone={health.shortfalls.length ? "bad" : health.runwayDays !== null && health.runwayDays < 30 ? "warn" : "good"} />
                  <Stat label="Can't be paid yet" value={health.shortfalls.length ? usd(health.shortfalls.reduce((s, x) => s + x.shortUsd, 0)) : "Nothing"} tone={health.shortfalls.length ? "bad" : "good"} />
                  <Stat label="Sitting unused" value={usd(health.totalIdleUsd)} tone="neutral" />
                </div>
                <ul className="space-y-2">
                  {health.findings.map((f) => (
                    <li key={f.id} className={`rounded-xl border p-3 ${TONE[f.severity]}`}>
                      <div className="text-sm font-semibold">{f.title}</div>
                      <div className="text-sm opacity-90">{f.detail}</div>
                    </li>
                  ))}
                </ul>
                <AskCoinsel obligations={obs.map((o) => ({ id: o.id, label: o.label, amountNear: o.amountNear, dueInDays: o.dueInDays }))} />
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

          <Card title="Recent suggestions" className="md:col-span-3" right={<Badge kind="real" />}>
            {data.proposals.length === 0 ? <p className="text-sm text-zinc-500">No suggestions filed yet.</p> : (
              <ul className="divide-y divide-white/5 text-sm">
                {data.proposals.map((p) => (
                  <li key={p.id} className="flex justify-between gap-3 py-2"><span className="truncate">#{p.id} · {p.kind} · {p.description}</span><span className="text-zinc-400">{p.status}</span></li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
      <footer className="mt-10 text-xs text-zinc-600">Test network only. Coinsel can only suggest — it can&apos;t send money. Yellow badges mark demo data.</footer>
    </div>
  );
}
