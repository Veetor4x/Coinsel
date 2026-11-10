import type { Obligation } from "./engine";

export type RawObligation = { id?: unknown; label?: unknown; amountNear?: unknown; dueInDays?: unknown };

/** Validate untrusted browser input. Notes are ignored on purpose: they are never sent to the AI. */
export function parseObligations(input: RawObligation[] | undefined, price: number): Obligation[] {
  if (!Array.isArray(input) || input.length > 30) throw new Error("Invalid payout list");
  return input.map((o, i) => {
    const amount = Number(o.amountNear);
    const due = Number(o.dueInDays);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) throw new Error("Invalid payout amount");
    if (!Number.isFinite(due) || due < 0 || due > 3650) throw new Error("Invalid due date");
    return { id: String(o.id ?? i).slice(0, 40), label: String(o.label ?? "Payout").slice(0, 80), amountUsd: amount * price, dueInDays: Math.round(due), chain: "NEAR" };
  });
}
