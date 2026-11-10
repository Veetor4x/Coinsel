// Analyze: guard -> engine -> quote -> VERIFY private AI (retry once) -> advice. Fail-closed: no unverified advice.
import { NextResponse } from "next/server";
import demo from "@/config/demo-treasury.json";
import { analyze } from "@/lib/engine";
import { toEngineInputs, totalNear } from "@/lib/engine-inputs";
import { parseObligations } from "@/lib/obligations";
import { checkObligations } from "@/lib/guard";
import { loadTreasury, spendableNear } from "@/lib/treasury";
import { getDryQuote, usdcToQuote } from "@/lib/intents";
import { verifyAttestation } from "@/lib/attestation";
import { getAdvice } from "@/lib/ai";

export const maxDuration = 90;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const obs = parseObligations(body?.obligations);
  if (!obs) return NextResponse.json({ error: "Those payouts don't look right. Check the amounts and dates." }, { status: 400 });

  // 1. Safety guard first: notes are untrusted text.
  const g = checkObligations(obs);
  if (!g.ok) {
    return NextResponse.json({ status: "blocked", message: g.message, outside: g.outside, label: g.label,
      why: "A note asked to send money to an address the treasury doesn't own, so Coinsel ignored it. Coinsel can't move money anyway: its only permission is to suggest, and the council has to vote." });
  }

  try {
    const t = await loadTreasury();
    const { balances, obligations } = toEngineInputs(t, obs);
    const health = analyze(balances, obligations);

    // 2. Real price quote for the cross-chain step (dry run).
    const shortUsd = health.shortfalls.reduce((s, x) => s + x.shortUsd, 0);
    const quoteUsdc = usdcToQuote(shortUsd);
    const quote = await getDryQuote(quoteUsdc);

    // 3. Private AI: verify FIRST (auto-retry once), only then send any data.
    const attestation = await verifyAttestation();
    if (!attestation.ok) {
      return NextResponse.json({ status: "unverified", health, attestation, message: "Couldn't verify this time" });
    }

    const spend = await spendableNear(t.dao);
    const transferNear = Math.round(Math.min(demo.payrollTransferNear, spend) * 100) / 100;
    const advice = await getAdvice({
      nearBalance: totalNear(t), nearUsdPrice: t.demo.demoNearUsdPrice, totalDueNear: obs.reduce((s, o) => s + o.amountNear, 0),
      transferNear, payrollAccount: t.payroll.accountId,
      idleUsdcOnEthereum: t.demo.otherChainBalances.reduce((s, b) => s + b.usdValue, 0), health, quote,
    });
    return NextResponse.json({ status: "ok", health, quote, quoteUsdc, attestation, advice, transferNear, payrollAccount: t.payroll.accountId });
  } catch (e) {
    return NextResponse.json({ status: "error", message: `Something went wrong while preparing advice: ${(e as Error).message}` }, { status: 502 });
  }
}
