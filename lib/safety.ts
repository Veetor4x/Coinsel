// Safety checks for Step 1 top-ups (pure, tested; no network). Used at file time, at vote time and on the suggestion cards.
//  - duplicates: an identical top-up already pending, or already sent this pay cycle
//  - padding: a top-up can never be bigger than the real gap (recomputed from chain balances + the payout list)
//  - receiver: only the DAO-owned payroll account
import demo from "@/config/demo-treasury.json";

export const LIMITS = demo.limits;
const EPS = 0.005; // half a cent of NEAR: ignore gas dust

export type ProposalLite = { id: number; kind: string; status: string; receiver?: string; amountNear?: number; submissionTime: string };
export type Duplicate = { kind: "pending" | "sent"; id: number; submittedAt: number };

export const isPayrollReceiver = (r: unknown) => typeof r === "string" && r.trim().toLowerCase() === demo.payrollAccountId.toLowerCase();

/**
 * Is `p` a copy of another top-up? Same kind, receiver and amount, and either
 *  - the other one is still waiting for votes (the earlier id is the original), or
 *  - the other one was approved within the pay cycle AND its money is still in effect (the gap is already smaller than this top-up).
 * After a demo Reset the gap is back, so the old approved one no longer counts and the demo can be run again.
 */
export function findDuplicate(
  p: { id: number; kind: string; receiver?: string; amountNear?: number },
  all: ProposalLite[],
  o: { gapNear: number; now: number },
): Duplicate | null {
  if (p.kind !== "Transfer" || !p.receiver || p.amountNear === undefined) return null;
  const same = (q: ProposalLite) =>
    q.id !== p.id && q.kind === "Transfer" && q.receiver?.toLowerCase() === p.receiver!.toLowerCase() && q.amountNear !== undefined && Math.abs(q.amountNear - p.amountNear!) < 1e-6;
  const cycleMs = LIMITS.payCycleDays * 86_400_000;
  for (const q of all.filter(same).sort((a, b) => a.id - b.id)) {
    const at = Number(q.submissionTime);
    if (q.status === "InProgress" && q.id < p.id) return { kind: "pending", id: q.id, submittedAt: at };
    if (q.status === "Approved" && o.now - at <= cycleMs && o.gapNear < p.amountNear - EPS) return { kind: "sent", id: q.id, submittedAt: at };
  }
  return null;
}

export const duplicateMessage = (d: Duplicate, when = (t: number) => new Date(t).toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }) + " UTC") =>
  d.kind === "pending" ? `Already filed as #${d.id} and still waiting for votes.` : `Same transfer already sent in #${d.id} at ${when(d.submittedAt)}.`;

export type Check = { ok: true } | { ok: false; code: "receiver" | "amount" | "covered" | "padded" | "cap" | "duplicate" | "list-changed"; message: string; duplicate?: Duplicate };

/** The amount may never be bigger than the real gap, and never above the hard ceiling. */
export function checkAmountWithinGap(amountNear: number, gapNear: number): Check {
  if (!Number.isFinite(amountNear) || amountNear <= 0) return { ok: false, code: "amount", message: "That amount isn't valid." };
  if (amountNear > LIMITS.maxTopUpNear) return { ok: false, code: "cap", message: `That is more than the ${LIMITS.maxTopUpNear} NEAR limit for one top-up.` };
  if (gapNear <= EPS) return { ok: false, code: "covered", message: "Payroll is already covered, so there is nothing to move." };
  if (amountNear > gapNear + EPS) return { ok: false, code: "padded", message: `This asks for ${amountNear} NEAR but payroll is only short by ${gapNear} NEAR.` };
  return { ok: true };
}

/** Everything that must hold before a demo council vote is signed on a Step 1 top-up. */
export function checkTransferApproval(a: {
  proposal: ProposalLite & { description: string }; all: ProposalLite[]; gapNear: number; listFingerprint?: string; now: number;
}): Check {
  const p = a.proposal;
  if (!isPayrollReceiver(p.receiver)) return { ok: false, code: "receiver", message: "Demo voting only approves top-ups to the DAO's payroll account." };
  // The proposal text carries a fingerprint of the payout list it was written for. A different list can't be used to justify it.
  const m = /Payout list fingerprint: ([0-9a-f]{16})/.exec(p.description);
  if (m && a.listFingerprint !== m[1]) return { ok: false, code: "list-changed", message: "The payout list isn't the one this suggestion was written for. Reload the page and run Get advice again." };
  const gap = checkAmountWithinGap(p.amountNear ?? NaN, a.gapNear);
  const dup = findDuplicate(p, a.all, { gapNear: a.gapNear, now: a.now });
  // A copy of an earlier top-up is reported as a duplicate (clearer than "already covered").
  if (dup) return { ok: false, code: "duplicate", message: duplicateMessage(dup) + " Not approved.", duplicate: dup };
  return gap;
}
