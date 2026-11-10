// Shared (browser + server) glue: turns treasury data + payout list into the health engine's inputs.
import type { Balance, Obligation as EngineObligation } from "./engine";

export type UiObligation = { id: string; label: string; amountNear: number; dueInDays: number; kind: string; note: string };
type T = {
  onChain: { nearBalance: number; tokens: { symbol: string; amount: number }[] };
  payroll: { nearBalance: number };
  demo: { demoNearUsdPrice: number; otherChainBalances: { chain: string; symbol: string; amount: number; usdValue: number }[] };
};

/** NEAR in the DAO + its own payroll account (both DAO-owned, so moving money between them changes nothing). */
export const totalNear = (t: T) => t.onChain.nearBalance + t.payroll.nearBalance;

export function toEngineInputs(t: T, obs: UiObligation[]): { balances: Balance[]; obligations: EngineObligation[] } {
  const price = t.demo.demoNearUsdPrice;
  const n = totalNear(t);
  return {
    balances: [
      { chain: "NEAR", symbol: "NEAR", amount: n, usdValue: n * price, source: "real" },
      ...t.onChain.tokens.map((x): Balance => ({ chain: "NEAR", symbol: x.symbol, amount: x.amount, usdValue: 0, source: "real" })),
      ...t.demo.otherChainBalances.map((b): Balance => ({ chain: b.chain, symbol: b.symbol, amount: b.amount, usdValue: b.usdValue, source: "demo" })),
    ],
    obligations: obs.map((o) => ({ id: o.id, label: o.label, amountUsd: (+o.amountNear || 0) * price, dueInDays: o.dueInDays, chain: "NEAR" })),
  };
}
