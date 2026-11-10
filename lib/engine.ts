// Coinsel health engine — deterministic code. NO AI in here.
// Inputs: balances + obligations. Outputs: runway, shortfalls, idle funds, findings.

export type Source = "real" | "demo";

export type Balance = {
  chain: string; // e.g. "NEAR", "Ethereum"
  symbol: string;
  amount: number; // in `symbol` units
  usdValue: number;
  source: Source;
  /** Held on purpose to top up payouts (the main DAO account). Never counted as "idle". */
  reserve?: boolean;
};

export type Obligation = {
  id: string;
  label: string;
  amountUsd: number;
  dueInDays: number;
  /** Chain the payout is made from. Only that chain's money can cover it. */
  chain: string;
};

export type Severity = "critical" | "warning" | "info" | "ok";

export type Shortfall = {
  obligationId: string;
  label: string;
  dueInDays: number;
  amountUsd: number;
  /** How much of this payout cannot be covered (after earlier payouts). */
  shortUsd: number;
  /** Money still available on that chain right before this payout. */
  availableUsd: number;
};

export type IdleFunds = { chain: string; symbol: string; idleUsd: number; source: Source };

export type Finding = { id: string; severity: Severity; title: string; detail: string };

export type HealthReport = {
  totalUsd: number;
  /** Days until the money on the payout chain runs out. null = no payouts, so it never runs out. */
  runwayDays: number | null;
  /** Date label for the first uncovered payout, in days from today. */
  firstShortfallInDays: number | null;
  shortfalls: Shortfall[];
  idle: IdleFunds[];
  totalIdleUsd: number;
  /** Total that payouts cannot cover from their own account. */
  gapUsd: number;
  /** Spare money in the reserve that could be moved over to cover the gap. */
  reserveUsd: number;
  reserveCoversGap: boolean;
  findings: Finding[];
};

export const IDLE_WINDOW_DAYS = 30;
export const LOW_RUNWAY_DAYS = 30;
const EPS = 0.005; // half a cent

const round2 = (n: number) => Math.round(n * 100) / 100;
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

function clean(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Analyse a treasury. Pure function: same input -> same output.
 * Rules:
 *  - Each payout can only be paid from money on its own chain.
 *  - Payouts are processed in due-date order; earlier payouts use up money first.
 *  - "Idle" = money on a chain that is not needed for any payout in the next 30 days.
 *  - Runway = days until the first payout that cannot be covered. If everything is covered
 *    and total payouts are > 0, runway is projected from the average daily spend.
 */
export function analyze(balances: Balance[], obligations: Obligation[]): HealthReport {
  const obs = obligations
    .map((o) => ({ ...o, amountUsd: clean(o.amountUsd), dueInDays: Math.max(0, Math.round(clean(o.dueInDays))) }))
    .filter((o) => o.amountUsd > 0)
    .sort((a, b) => a.dueInDays - b.dueInDays || a.id.localeCompare(b.id));

  const totalUsd = round2(balances.reduce((s, b) => s + clean(b.usdValue), 0));

  const available = new Map<string, number>();
  for (const b of balances) available.set(b.chain, (available.get(b.chain) ?? 0) + clean(b.usdValue));

  // Walk payouts in date order.
  const shortfalls: Shortfall[] = [];
  const left = new Map(available);
  for (const o of obs) {
    const have = left.get(o.chain) ?? 0;
    const paid = Math.min(have, o.amountUsd);
    const short = o.amountUsd - paid;
    left.set(o.chain, have - paid);
    if (short > EPS) {
      shortfalls.push({
        obligationId: o.id, label: o.label, dueInDays: o.dueInDays,
        amountUsd: round2(o.amountUsd), shortUsd: round2(short), availableUsd: round2(have),
      });
    }
  }

  // Runway.
  let runwayDays: number | null = null;
  const firstShortfallInDays = shortfalls.length ? shortfalls[0].dueInDays : null;
  const totalDue = obs.reduce((s, o) => s + o.amountUsd, 0);
  if (obs.length > 0) {
    if (firstShortfallInDays !== null) {
      runwayDays = firstShortfallInDays;
    } else {
      const horizon = Math.max(...obs.map((o) => o.dueInDays), 1);
      const perDay = totalDue / horizon;
      const payChains = new Set(obs.map((o) => o.chain));
      const payChainMoney = [...payChains].reduce((s, c) => s + (available.get(c) ?? 0), 0);
      runwayDays = perDay > 0 ? Math.floor(payChainMoney / perDay) : null;
    }
  }

  // Idle funds per chain: what's left after payouts due inside the window.
  const idle: IdleFunds[] = [];
  const neededSoon = new Map<string, number>();
  for (const o of obs) if (o.dueInDays <= IDLE_WINDOW_DAYS) neededSoon.set(o.chain, (neededSoon.get(o.chain) ?? 0) + o.amountUsd);
  const chainTotals = new Map<string, number>();
  const held = balances.filter((b) => !b.reserve); // the reserve is kept on purpose, so it is not "idle"
  for (const b of held) chainTotals.set(b.chain, (chainTotals.get(b.chain) ?? 0) + clean(b.usdValue));
  for (const b of held) {
    const chainTotal = chainTotals.get(b.chain) ?? 0;
    if (chainTotal <= 0 || clean(b.usdValue) <= 0) continue;
    const chainIdle = Math.max(0, chainTotal - (neededSoon.get(b.chain) ?? 0));
    const share = chainIdle * (clean(b.usdValue) / chainTotal);
    if (share > EPS) idle.push({ chain: b.chain, symbol: b.symbol, idleUsd: round2(share), source: b.source });
  }
  const totalIdleUsd = round2(idle.reduce((s, i) => s + i.idleUsd, 0));

  // Findings (plain English).
  const findings: Finding[] = [];
  if (balances.every((b) => clean(b.usdValue) === 0)) {
    findings.push({ id: "empty", severity: "critical", title: "The treasury is empty", detail: obs.length ? "There is no money to pay anyone." : "There is no money here yet." });
  }
  const shortTotal = round2(shortfalls.reduce((s, x) => s + x.shortUsd, 0));
  const reserveUsd = round2(balances.filter((b) => b.reserve).reduce((s, b) => s + clean(b.usdValue), 0));
  const reserveCoversGap = shortTotal > EPS && reserveUsd + EPS >= shortTotal;
  if (shortfalls.length) {
    const first = shortfalls[0];
    const sameDay = shortfalls.filter((s) => s.dueInDays === first.dueInDays);
    const dayShort = round2(sameDay.reduce((s, x) => s + x.shortUsd, 0));
    // Lead with the TOTAL gap: it is the number in the headline and the one the fix covers.
    const who = sameDay.length > 1 ? `${sameDay.length} payouts` : "A payout";
    const firstPart = shortfalls.length > sameDay.length
      ? ` It starts in ${days(first.dueInDays)} (${usd(dayShort)} short that day).`
      : ` ${who} due in ${days(first.dueInDays)} can't be fully paid.`;
    findings.push({
      id: "shortfall",
      severity: "critical",
      title: `${sameDay.length > 1 ? "Payouts are" : "A payout is"} short in ${days(first.dueInDays)}`,
      detail: `We're short by ${usd(shortTotal)} in total.${firstPart}`,
    });
  } else if (obs.length) {
    findings.push({ id: "covered", severity: "ok", title: "Every upcoming payout is covered", detail: `There is enough money for all ${obs.length} payout${obs.length === 1 ? "" : "s"} (${usd(totalDue)} in total).` });
  }
  if (shortTotal > EPS && reserveUsd > EPS) {
    findings.push(reserveCoversGap
      ? { id: "reserve-covers", severity: "warning", title: "The main reserve can cover the gap", detail: `The reserve has ${usd(reserveUsd)} to spare. Moving ${usd(shortTotal)} to the payroll account fixes it.` }
      : { id: "reserve-short", severity: "critical", title: "The main reserve can't cover the gap on its own", detail: `The reserve has ${usd(reserveUsd)} to spare, but ${usd(shortTotal)} is needed.` });
  }
  if (runwayDays !== null && firstShortfallInDays === null && runwayDays < LOW_RUNWAY_DAYS) {
    findings.push({ id: "low-runway", severity: "warning", title: "Running low", detail: `At this pace the money lasts about ${days(runwayDays)}.` });
  }
  if (totalIdleUsd > EPS) {
    const top = [...idle].sort((a, b) => b.idleUsd - a.idleUsd)[0];
    findings.push({
      id: "idle", severity: "info", title: "Some money is sitting unused",
      detail: `${usd(totalIdleUsd)} isn't needed in the next ${IDLE_WINDOW_DAYS} days. The biggest pile is ${usd(top.idleUsd)} of ${top.symbol} on ${top.chain}.`,
    });
  }
  // The classic case: short on one chain while idle money sits on another.
  if (shortfalls.length && totalIdleUsd > EPS) {
    const shortChains = new Set(obs.filter((o) => shortfalls.some((s) => s.obligationId === o.id)).map((o) => o.chain));
    const elsewhere = idle.filter((i) => !shortChains.has(i.chain)).reduce((s, i) => s + i.idleUsd, 0);
    if (elsewhere > EPS) {
      findings.push({ id: "move-funds", severity: "warning", title: "The fix may already be in the treasury", detail: `${usd(elsewhere)} is sitting unused on another network. Moving some of it could cover the gap.` });
    }
  }

  const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2, ok: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  return { totalUsd, runwayDays, firstShortfallInDays, shortfalls, idle, totalIdleUsd, gapUsd: shortTotal, reserveUsd, reserveCoversGap, findings };
}
