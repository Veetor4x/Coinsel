// DEMO ONLY: put the treasury back to its starting story (payroll short by the starting gap).
// The payroll account sends its surplus back to the DAO. That is the only thing this can do.
import { NextResponse } from "next/server";
import demo from "@/config/demo-treasury.json";
import { checkDestination } from "@/lib/guard";
import { loadTreasury } from "@/lib/treasury";
import { sendPayrollToDao } from "@/lib/chain-write";
import { planReset, startingPayrollNear } from "@/lib/demo-reset";
import { getNearBalance } from "@/lib/sputnik";

export const maxDuration = 60;

// One reset at a time. (Simple in-memory lock: enough for a demo; on serverless it covers one instance.)
let running = false;
let lastDone = 0;
const COOLDOWN_MS = 8000;

export async function POST() {
  if (process.env.DEMO_MODE !== "true") return NextResponse.json({ status: "error", message: "Reset is switched off on this server." }, { status: 403 });
  const dao = process.env.DAO_ACCOUNT_ID;
  if (!dao || !process.env.PAYROLL_PRIVATE_KEY) return NextResponse.json({ status: "error", message: "Reset isn't set up on this server yet." }, { status: 500 });
  if (running || Date.now() - lastDone < COOLDOWN_MS) {
    return NextResponse.json({ status: "busy", message: "Someone just reset the demo. Give it a few seconds, then refresh." }, { status: 409 });
  }
  running = true;
  try {
    const t = await loadTreasury();
    const plan = planReset({ payrollNear: t.payroll.nearBalance, startNear: startingPayrollNear(), reserveSpendableNear: t.reserve.spendableNear, gapNear: demo.startingGapNear });
    if (plan.action === "needs-topup") return NextResponse.json({ status: "needs-topup", message: "Demo needs a top-up", why: plan.reason }, { status: 409 });
    if (plan.action === "none") return NextResponse.json({ status: "already", message: plan.reason });
    const dest = checkDestination(dao);
    if (!dest.ok) return NextResponse.json({ status: "error", message: dest.message }, { status: 403 });
    const { txHash } = await sendPayrollToDao(dao, demo.payrollAccountId, plan.sendNear);
    // The chain read can lag a moment: wait until the payroll balance shows the drop.
    for (let i = 0; i < 8; i++) {
      if ((await getNearBalance(demo.payrollAccountId)) < t.payroll.nearBalance - plan.sendNear / 2) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return NextResponse.json({ status: "reset", movedNear: plan.sendNear, txHash, txUrl: `https://testnet.nearblocks.io/txns/${txHash}` });
  } catch (e) {
    return NextResponse.json({ status: "error", message: `Couldn't reset: ${(e as Error).message}` }, { status: 502 });
  } finally {
    running = false;
    lastDone = Date.now();
  }
}
