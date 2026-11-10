import type { Obligation } from "./engine";
import demo from "@/config/demo-treasury.json";

export type RawObligation = { id?: unknown; label?: unknown; amountNear?: unknown; dueInDays?: unknown };

/** Validate untrusted browser input. Notes are ignored on purpose: they are never sent to the AI. */
export function parseObligations(input: RawObligation[] | undefined, price: number): Obligation[] {
  if (!Array.isArray(input) || input.length > demo.limits.maxPayouts) throw new Error("Invalid payout list");
  return input.map((o, i) => {
    const amount = Number(o.amountNear);
    const due = Number(o.dueInDays);
    if (!Number.isFinite(amount) || amount < 0 || amount > demo.limits.maxPayoutNear) throw new Error("Invalid payout amount");
    if (!Number.isFinite(due) || due < 0 || due > demo.limits.maxDueDays) throw new Error("Invalid due date");
    return { id: String(o.id ?? i).slice(0, 40), label: String(o.label ?? "Payout").slice(0, 80), amountUsd: amount * price, dueInDays: Math.round(due), chain: "NEAR" };
  });
}

/** Read a JSON request body, but refuse anything big (a payout list is tiny). Returns null if too big or not JSON. */
export async function readJson(req: Request, maxBytes = 32_000): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) return null;
  const text = await req.text().catch(() => "");
  if (text.length > maxBytes) return null;
  try { return JSON.parse(text); } catch { return null; }
}
