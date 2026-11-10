// Shared (browser + server) glue: turns treasury data + payout list into the health engine's inputs.
import type { Balance, Obligation as EngineObligation } from "./engine";

export type UiObligation = { id: string; label: string; amountNear: number; dueInDays: number; kind: string; note: string };
type T = {
  onChain: { nearBalance: number; tokens: { symbol: string; amount: number }[] };
  /** NEAR the main account can spare right now (balance minus storage). Defaults to its whole balance. */
  reserve?: { spendableNear: number };
  payroll: { nearBalance: number };
  demo: { demoNearUsdPrice: number; otherChainBalances: { chain: string; symbol: string; amount: number; usdValue: number }[] };
};

/** The payout chain: payouts are paid from the payroll account. The main DAO account is the reserve. */
export const PAYROLL_CHAIN = "Payroll account";
export const RESERVE_CHAIN = "Reserve";
const cents = (n: number) => Math.round(n * 100) / 100; // ignore gas dust below 0.01 NEAR

/** NEAR in the DAO + its own payroll account (both DAO-owned, so moving money between them changes nothing). */
export const totalNear = (t: T) => t.onChain.nearBalance + t.payroll.nearBalance;

/** The whole gap the advice names, in NEAR (rounded up to 0.01). The suggestion moves exactly this much. */
export function gapNear(health: { shortfalls: { shortUsd: number }[] }, price: number): number {
  const usd = health.shortfalls.reduce((s, x) => s + x.shortUsd, 0);
  return usd > 0 && price > 0 ? Math.ceil((usd / price) * 100 - 1e-6) / 100 : 0;
}

export function toEngineInputs(t: T, obs: UiObligation[]): { balances: Balance[]; obligations: EngineObligation[] } {
  const price = t.demo.demoNearUsdPrice;
  const payroll = cents(t.payroll.nearBalance);
  const spare = cents(Math.max(0, t.reserve?.spendableNear ?? t.onChain.nearBalance));
  return {
    balances: [
      { chain: PAYROLL_CHAIN, symbol: "NEAR", amount: payroll, usdValue: payroll * price, source: "real" },
      { chain: RESERVE_CHAIN, symbol: "NEAR", amount: spare, usdValue: spare * price, source: "real", reserve: true },
      ...t.onChain.tokens.map((x): Balance => ({ chain: RESERVE_CHAIN, symbol: x.symbol, amount: x.amount, usdValue: 0, source: "real", reserve: true })),
      ...t.demo.otherChainBalances.map((b): Balance => ({ chain: b.chain, symbol: b.symbol, amount: b.amount, usdValue: b.usdValue, source: "demo" })),
    ],
    obligations: obs.map((o) => ({ id: o.id, label: o.label, amountUsd: (+o.amountNear || 0) * price, dueInDays: o.dueInDays, chain: PAYROLL_CHAIN })),
  };
}
