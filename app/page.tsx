"use client";
import { useEffect, useMemo, useState } from "react";

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

function Badge({ kind }: { kind: "real" | "demo" }) {
  return kind === "real" ? (
    <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">Real · NEAR testnet</span>
  ) : (
    <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400">Demo data (not on-chain)</span>
  );
}
function Card({ title, right, children, className = "" }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-white/10 bg-zinc-900/60 p-5 ${className}`}>
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
    setError(null);
    fetch("/api/treasury").then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Request failed");
      setData(j); setObs((cur) => (cur.length ? cur : j.demo.obligations));
    }).catch((e) => setError(e.message));
  };
  useEffect(load, []);

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

  const update = (id: string, patch: Partial<Obligation>) => setObs((l) => l.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const add = () => setObs((l) => [...l, { id: "new-" + Date.now(), label: "New payout", amountNear: 1, dueInDays: 14, kind: "payroll", note: "" }]);
  const input = "w-full rounded-md border border-white/10 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-emerald-500/60";

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Coin<span className="text-emerald-400">sel</span></h1>
          <p className="mt-1 text-zinc-400">Counsel for your coins. Never control.</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="rounded-full border border-white/10 px-3 py-1 text-zinc-400">NEAR {data?.network ?? "testnet"}</span>
          {data && <a className="rounded-full border border-emerald-500/40 px-3 py-1 text-emerald-400 hover:bg-emerald-500/10" href={data.explorerUrl} target="_blank" rel="noreferrer">{short(data.dao)} ↗</a>}
        </div>
      </header>

      {error && (
        <div className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          {error} <button onClick={load} className="ml-2 underline">Retry</button>
        </div>
      )}
      {!data && !error && <p className="text-zinc-500">Reading the treasury from NEAR testnet…</p>}

      {data && calc && (
        <div className="grid gap-5 md:grid-cols-3">
          <Card title="Total treasury" className="md:col-span-1" right={<Badge kind="real" />}>
            <div className="text-4xl font-semibold">{usd(calc.realUsd)}</div>
            <p className="mt-1 text-sm text-zinc-400">{near(calc.bal)} on-chain × ${calc.price} <span className="text-amber-400">(fixed demo price)</span></p>
            <div className="mt-4 border-t border-white/10 pt-3 text-sm text-zinc-400">
              + {usd(calc.otherUsd)} idle USDC on Ethereum <span className="text-amber-400">(demo, not counted above)</span>
              <div className="mt-1 text-zinc-200">Combined: {usd(calc.realUsd + calc.otherUsd)}</div>
            </div>
          </Card>

          <Card title="Balances by chain" className="md:col-span-2">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-zinc-500"><tr><th className="pb-2">Chain</th><th>Asset</th><th className="text-right">Amount</th><th className="text-right">Source</th></tr></thead>
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

          <Card title="Upcoming obligations" className="md:col-span-2" right={<Badge kind="demo" />}>
            {obs.length === 0 && <p className="text-sm text-zinc-500">No obligations yet.</p>}
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
            <div className="mt-1 grid grid-cols-12 gap-2 text-[11px] text-zinc-500"><span className="col-span-5">Label</span><span className="col-span-2">NEAR</span><span className="col-span-2">Due in (days)</span><span className="col-span-3">Note (untrusted text)</span></div>
            <div className="mt-4 flex items-center justify-between text-sm">
              <button onClick={add} className="rounded-lg border border-white/15 px-3 py-1.5 hover:bg-white/5">+ Add payout</button>
              <span className="text-zinc-400">Total {near(calc.totalDue)} · edits live in your browser only</span>
            </div>
          </Card>

          <Card title="Council" right={<Badge kind="real" />}>
            <div className="text-3xl font-semibold">{data.council.threshold} of {data.council.members.length}</div>
            <p className="mb-3 text-sm text-zinc-400">approvals needed to execute</p>
            <ul className="space-y-1 text-sm">
              {data.council.members.map((m) => <li key={m}><a className="text-zinc-300 hover:text-emerald-400" href={nb(m)} target="_blank" rel="noreferrer">{short(m)} ↗</a></li>)}
            </ul>
            <p className="mt-3 border-t border-white/10 pt-3 text-xs text-zinc-500">
              Coinsel agent <span className="text-zinc-300">{data.council.agent.map(short).join(", ") || "—"}</span> can only <b>add proposals</b>. It cannot vote or move funds.
            </p>
          </Card>

          <Card title="Health" className="md:col-span-3" right={<span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-zinc-500">Coming Day 2</span>}>
            <p className="text-sm text-zinc-400">
              Quick look (not the health engine yet): the first payouts are due in <b className="text-zinc-200">{calc.first ?? "–"} days</b> and total{" "}
              <b className="text-zinc-200">{near(calc.dueAtFirst)}</b> against <b className="text-zinc-200">{near(calc.bal)}</b> on-chain
              {calc.shortBy > 0 ? <> → <b className="text-red-400">short by {near(calc.shortBy)}</b>.</> : <> → <b className="text-emerald-400">covered</b>.</>}
            </p>
            <p className="mt-2 text-xs text-zinc-600">Runway, shortfall dates, idle funds and private AI advice arrive with the health engine.</p>
          </Card>

          <Card title="Recent proposals" className="md:col-span-3" right={<Badge kind="real" />}>
            {data.proposals.length === 0 ? <p className="text-sm text-zinc-500">No proposals yet. Coinsel will file the first one on Day 3.</p> : (
              <ul className="divide-y divide-white/5 text-sm">
                {data.proposals.map((p) => (
                  <li key={p.id} className="flex justify-between gap-3 py-2"><span className="truncate">#{p.id} · {p.kind} · {p.description}</span><span className="text-zinc-400">{p.status}</span></li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
      <footer className="mt-10 text-xs text-zinc-600">Testnet only. Coinsel holds no keys to funds; its only on-chain permission is add_proposal. Yellow badges mark mocked data.</footer>
    </div>
  );
}
