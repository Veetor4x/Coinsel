// "Reset demo": puts the treasury back to its starting story so every visitor sees the same thing.
// Pure planning logic (tested). The signing happens in chain-write.ts and can only send payroll -> DAO.
import demo from "@/config/demo-treasury.json";

/** How much NEAR the payroll account holds at the start: everything due, minus the starting gap. */
export function startingPayrollNear(): number {
  const due = demo.obligations.reduce((s, o) => s + o.amountNear, 0);
  return Math.round((due - demo.startingGapNear) * 100) / 100;
}

/** Gas for the send comes out of the payroll account, so leave a little extra behind. */
export const FEE_BUFFER_NEAR = 0.0005;
const DUST = 0.005;

export type ResetPlan =
  | { action: "none"; reason: string }
  | { action: "send"; sendNear: number }
  | { action: "needs-topup"; reason: string };

export function planReset(a: { payrollNear: number; startNear: number; reserveSpendableNear: number; gapNear: number }): ResetPlan {
  const surplus = a.payrollNear - a.startNear;
  if (surplus < -DUST) return { action: "needs-topup", reason: "The payroll account holds less than the starting amount, so it can't be reset from here." };
  const sendNear = surplus > DUST ? Math.floor((surplus - FEE_BUFFER_NEAR) * 10000 + 1e-6) / 10000 : 0;
  // After the send, the reserve must be able to cover the starting gap.
  if (a.reserveSpendableNear + sendNear + 1e-9 < a.gapNear) return { action: "needs-topup", reason: "The main account doesn't have enough spare NEAR to cover the starting gap." };
  return sendNear > 0 ? { action: "send", sendNear } : { action: "none", reason: "Already at the starting point." };
}
