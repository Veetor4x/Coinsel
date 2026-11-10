// File a real Sputnik Transfer proposal using the agent's add_proposal-only key.
// The receiver and amount are decided HERE (never by the browser or the AI).
import { NextResponse } from "next/server";
import demo from "@/config/demo-treasury.json";
import { checkDestination, checkObligations, checkText } from "@/lib/guard";
import { parseObligations } from "@/lib/obligations";
import { loadTreasury, spendableNear } from "@/lib/treasury";
import { analyze } from "@/lib/engine";
import { gapNear, toEngineInputs } from "@/lib/engine-inputs";
import { getDryQuote, usdcToQuote } from "@/lib/intents";
import { buildDescription } from "@/lib/proposal-text";
import { fileTransferProposal } from "@/lib/chain-write";
import { explorerAccountUrl } from "@/lib/near";

export const maxDuration = 60;
const HEX = /^[0-9a-f]{64}$/;

export async function POST(req: Request) {
  const dao = process.env.DAO_ACCOUNT_ID;
  const b = await req.json().catch(() => null);
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
    const spend = await spendableNear(dao);
    // Recomputed here from the chain + the payouts, so it always equals the gap the advice named.
    const t = await loadTreasury();
    const { balances, obligations } = toEngineInputs(t, obs);
    const amountNear = gapNear(analyze(balances, obligations), demo.demoNearUsdPrice);
    if (amountNear <= 0) return NextResponse.json({ error: "Nothing is short right now, so there is nothing to file." }, { status: 409 });
    if (amountNear > spend + 1e-9) return NextResponse.json({ error: `The main account can only spare ${spend.toFixed(2)} NEAR but the gap is ${amountNear} NEAR. Top it up from the test faucet, then try again.` }, { status: 409 });
    // Same size as the quote the advice quoted, so the numbers the council reads agree.
    const q = Number(b?.quoteUsdc);
    const quote = await getDryQuote(Number.isFinite(q) && q >= 1 && q <= 100000 ? q : usdcToQuote(12));
    const description = buildDescription({
      advice: text, amountNear, amountUsd: amountNear * demo.demoNearUsdPrice, receiver: demo.payrollAccountId, quote,
      model: String(b.advice.model ?? "").slice(0, 80), responseHash: b.advice.responseHash, attestationHash: b.attestationHash,
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
