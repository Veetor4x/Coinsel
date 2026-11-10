// DEMO ONLY: put the treasury back to its starting story (payroll short by the starting gap).
// The payroll account sends its surplus back to the DAO. That is the only thing this can do.
import { NextResponse } from "next/server";
import demo from "@/config/demo-treasury.json";
import { checkDestination } from "@/lib/guard";
import { loadTreasury } from "@/lib/treasury";
import { closeOpenSuggestions, sendPayrollToDao } from "@/lib/chain-write";
import { planReset, startingPayrollNear } from "@/lib/demo-reset";
import { getCouncil, getNearBalance } from "@/lib/sputnik";
import { env, isDemoMode } from "@/lib/env";

export const maxDuration = 60;

// One reset at a time. (Simple in-memory lock: enough for a demo; on serverless it covers one instance.)
let running = false;
let lastDone = 0;
const COOLDOWN_MS = 8000;

export async function POST() {
  if (!isDemoMode()) return NextResponse.json({ status: "error", message: "Reset is switched off on this server." }, { status: 403 });
  const dao = env("DAO_ACCOUNT_ID");
  if (!dao || !env("PAYROLL_PRIVATE_KEY")) return NextResponse.json({ status: "error", message: "Reset isn't set up on this server yet." }, { status: 500 });
  if (running || Date.now() - lastDone < COOLDOWN_MS) {
    return NextResponse.json({ status: "busy", message: "Someone just reset the demo. Give it a few seconds, then refresh." }, { status: 409 });
  }
  running = true;
  try {
    const t = await loadTreasury();
    // First close old pending suggestions (demo council votes Reject), so nobody can approve a stale one later.
    // Only plain transfers that the Coinsel agent filed are touched.
    const agents = (await getCouncil(dao)).agent;
    const open = t.proposals.filter((p) => p.status === "InProgress" && p.kind === "Transfer" && agents.includes(p.proposer)).map((p) => p.id).slice(0, 4);
    const closedCount = open.length ? await closeOpenSuggestions(dao, open) : 0;
    const plan = planReset({ payrollNear: t.payroll.nearBalance, startNear: startingPayrollNear(), reserveSpendableNear: t.reserve.spendableNear, gapNear: demo.startingGapNear });
    if (plan.action === "needs-topup") return NextResponse.json({ status: "needs-topup", message: "Demo needs a top-up", why: plan.reason }, { status: 409 });
    if (plan.action === "none") return NextResponse.json({ status: closedCount ? "reset" : "already", message: plan.reason, movedNear: 0, closed: closedCount });
    const dest = checkDestination(dao);
    if (!dest.ok) return NextResponse.json({ status: "error", message: dest.message }, { status: 403 });
    const { txHash } = await sendPayrollToDao(dao, demo.payrollAccountId, plan.sendNear);
    // The chain read can lag a moment: wait until the payroll balance shows the drop.
    for (let i = 0; i < 8; i++) {
      if ((await getNearBalance(demo.payrollAccountId)) < t.payroll.nearBalance - plan.sendNear / 2) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return NextResponse.json({ status: "reset", movedNear: plan.sendNear, closed: closedCount, txHash, txUrl: `https://testnet.nearblocks.io/txns/${txHash}` });
  } catch (e) {
    return NextResponse.json({ status: "error", message: `Couldn't reset: ${(e as Error).message}` }, { status: 502 });
  } finally {
    running = false;
    lastDone = Date.now();
  }
}
