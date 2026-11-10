// File a real Sputnik Transfer proposal using the agent's add_proposal-only key.
// The receiver and amount are decided HERE (never by the browser or the AI).
import { NextResponse } from "next/server";
import demo from "@/config/demo-treasury.json";
import { checkDestination, checkObligations, checkText } from "@/lib/guard";
import { parseObligations } from "@/lib/obligations";
import { loadTreasury } from "@/lib/treasury";
import { analyze } from "@/lib/engine";
import { gapNear, toEngineInputs } from "@/lib/engine-inputs";
import { getDryQuote, usdcToQuote } from "@/lib/intents";
import { buildDescription } from "@/lib/proposal-text";
import { fileTransferProposal } from "@/lib/chain-write";
import { explorerAccountUrl } from "@/lib/near";
import { env } from "@/lib/env";
import { readJson } from "@/lib/validate";
import { withLock } from "@/lib/lock";
import { payoutFingerprint } from "@/lib/fingerprint";
import { checkAmountWithinGap, duplicateMessage, findDuplicate } from "@/lib/safety";
import { requestQuote, tidepoolEnabled } from "@/lib/tidepool";
import { STEP2_POINTER } from "@/lib/proposal-text";

export const maxDuration = 60;
const HEX = /^[0-9a-f]{64}$/;

export async function POST(req: Request) {
  const b = (await readJson(req)) as { obligations?: unknown; advice?: { text?: unknown; responseHash?: string; model?: unknown }; attestationHash?: string } | null;
  // One filing at a time, so two quick identical requests can't both pass the duplicate check below.
  return withLock("propose", () => handle(b));
}

async function handle(b: { obligations?: unknown; advice?: { text?: unknown; responseHash?: string; model?: unknown }; attestationHash?: string } | null) {
  const dao = env("DAO_ACCOUNT_ID");
  const obs = parseObligations(b?.obligations ?? []);
  const text = typeof b?.advice?.text === "string" ? b.advice.text.slice(0, 1200) : "";
  if (!dao || !obs || !text || !HEX.test(b?.advice?.responseHash ?? "") || !HEX.test(b?.attestationHash ?? "")) {
    return NextResponse.json({ error: "Run the analysis first, then file the suggestion." }, { status: 400 });
  }
  // Guard: notes and AI text are untrusted; the destination must be DAO-owned.
  const checks = [checkObligations(obs), checkText(text), checkDestination(demo.payrollAccountId)];
  const bad = checks.find((c) => !c.ok);
  if (bad && !bad.ok) return NextResponse.json({ status: "blocked", message: bad.message, outside: bad.outside }, { status: 403 });

  try {
    // Recomputed here from the chain + the payouts, so it always equals the gap the advice named.
    const t = await loadTreasury();
    const spend = t.reserve.spendableNear;
    const { balances, obligations } = toEngineInputs(t, obs);
    const health = analyze(balances, obligations);
    const amountNear = gapNear(health, demo.demoNearUsdPrice);
    // Already filed? An identical top-up that is waiting for votes, or one just sent this pay cycle, is never filed again.
    const proposed = { id: Number.MAX_SAFE_INTEGER, kind: "Transfer", receiver: demo.payrollAccountId, amountNear };
    const dup = amountNear > 0 ? findDuplicate(proposed, t.proposals, { gapNear: amountNear, now: Date.now() }) : null;
    if (dup) return NextResponse.json({ status: "duplicate", proposalId: dup.id, message: dup.kind === "pending" ? duplicateMessage(dup) : `Already filed as #${dup.id}. ${duplicateMessage(dup)}`, error: `Already filed as #${dup.id}.` }, { status: 409 });
    if (amountNear <= 0) {
      const sent = t.proposals.find((q) => q.kind === "Transfer" && q.status === "Approved" && q.receiver?.toLowerCase() === demo.payrollAccountId.toLowerCase() && Date.now() - Number(q.submissionTime) <= demo.limits.payCycleDays * 86_400_000);
      return NextResponse.json({ error: sent ? `Already filed as #${sent.id} and approved: payroll is covered.` : "Payroll is already covered, so there is nothing to file." }, { status: 409 });
    }
    const within = checkAmountWithinGap(amountNear, amountNear); // hard ceiling + sanity; the amount IS the recomputed gap, never a number from the browser
    if (!within.ok) return NextResponse.json({ error: within.message }, { status: 409 });
    if (amountNear > spend + 1e-9) return NextResponse.json({ error: `The main reserve can only spare ${spend.toFixed(2)} NEAR but the gap is ${amountNear} NEAR. Top it up from the test faucet, then try again.` }, { status: 409 });
    // Step 2 is sized from the same gap (never from the browser), so every number agrees.
    const quote = await getDryQuote(usdcToQuote(health.gapUsd));
    // If the real test swap is on AND reachable, Step 2 is its own suggestion; otherwise the text stays "quote only".
    const realStep2 = tidepoolEnabled() && (await requestQuote({ dao, usdc: demo.tidepool.swapUsdc, live: false }).then(() => true, () => false));
    const description = buildDescription({
      advice: text, amountNear, amountUsd: amountNear * demo.demoNearUsdPrice, receiver: demo.payrollAccountId, quote,
      model: String(b!.advice!.model ?? "").slice(0, 80), responseHash: b!.advice!.responseHash!, attestationHash: b!.attestationHash!,
      payoutFingerprint: payoutFingerprint(obs),
      step2Override: realStep2 ? STEP2_POINTER : undefined,
    });
    const { proposalId, txHash } = await fileTransferProposal({ dao, receiver: demo.payrollAccountId, amountNear, description });
    return NextResponse.json({
      status: "filed", proposalId, amountNear, receiver: demo.payrollAccountId, txHash, quote,
      txUrl: `https://testnet.nearblocks.io/txns/${txHash}`, daoUrl: explorerAccountUrl(dao),
    });
  } catch (e) {
    return NextResponse.json({ error: `Couldn't file the suggestion: ${(e as Error).message}` }, { status: 502 });
  }
}
