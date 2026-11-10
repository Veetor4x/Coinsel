// Analyze: guard -> engine -> real price quote -> VERIFY private AI (retry once) -> advice -> verify signature.
// Fail-closed: advice is only returned when ALL checks pass. Nothing is stored.
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { analyze } from "@/lib/engine";
import { gapNear, toEngineInputs, totalNear } from "@/lib/engine-inputs";
import { parseObligations } from "@/lib/obligations";
import { checkObligations, checkText } from "@/lib/guard";
import { loadTreasury } from "@/lib/treasury";
import { getDryQuote, usdcToQuote } from "@/lib/intents";
import { summarize, verifyAnswer, verifyModel, type AttestationResult } from "@/lib/attestation";
import { getAdvice, getModel, type AdvicePlan } from "@/lib/ai";
import { env } from "@/lib/env";
import demo from "@/config/demo-treasury.json";
import { requestQuote, swapReadiness, tidepoolEnabled, TIDEPOOL_LABEL } from "@/lib/tidepool";

export const maxDuration = 120;

export async function POST(req: Request) {
  const apiKey = env("NEARAI_API_KEY");
  const body = await req.json().catch(() => null);
  const obs = parseObligations(body?.obligations);
  if (!obs) return NextResponse.json({ error: "Those payouts don't look right. Check the amounts and dates." }, { status: 400 });
  if (!apiKey) return NextResponse.json({ status: "error", message: "The server isn't set up for AI advice yet." }, { status: 500 });

  // 1. Safety guard first: notes are untrusted text (they are never sent to the AI either).
  const g = checkObligations(obs);
  if (!g.ok) {
    return NextResponse.json({ status: "blocked", message: g.message, outside: g.outside, label: g.label,
      why: "A note asked to send money to an address the treasury doesn't own, so Coinsel ignored it. Coinsel can't move money anyway: its only permission is to suggest, and the council has to vote." });
  }

  try {
    const t = await loadTreasury();
    const { balances, obligations } = toEngineInputs(t, obs);
    const health = analyze(balances, obligations);

    // 2. Real price quote for the cross-chain step (dry run). Sized in demo-scale USD.
    const shortUsd = health.gapUsd;
    const quoteUsdc = usdcToQuote(shortUsd);
    const quote = await getDryQuote(quoteUsdc);
    // The plan is decided HERE, in code. The AI only explains it.
    // Real testnet swap (Tidepool) preview. Never throws: if Tidepool is down the old quote-only card is shown instead.
    const swap = await swapPreview(t.dao);
    const plan: AdvicePlan | undefined = shortUsd > 0 ? {
      step1: { moveUsd: shortUsd, from: "main reserve", to: "payroll account" },
      step2: swap.enabled && swap.quote
        ? { sendUsdc: demo.tidepool.swapUsdc, fromNetwork: `the treasury's ${demo.tidepool.originLabel}`, via: TIDEPOOL_LABEL, receiveAboutUsd: null,
            note: "a small real swap of test coins on the test network (the coins have no value); it is filed as its own suggestion for the council" }
        : { sendUsdc: quoteUsdc, fromNetwork: "Ethereum", via: "NEAR Intents", receiveAboutUsd: quote.ok ? Math.round(quote.amountOutUsd) : null,
            note: "only a price quote for now; nothing moves" },
    } : undefined;

    // 3. Verify the AI is private BEFORE sending data, get advice, verify its signature.
    // Auto-retry once; still fail-closed (no unverified advice is ever returned).
    const model = getModel();
    let last: AttestationResult | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const pre = await verifyModel(model);
      last = pre.result;
      if (pre.result.status !== "verified") continue; // nothing was sent to the AI
      let out;
      try { out = await getAdvice(health, apiKey, fetch, plan); } catch { continue; }
      const signed = await verifyAnswer(out.model, out, pre.signer, apiKey);
      const checks = [...pre.result.checks, signed];
      const { status, headline } = summarize(checks);
      last = { ...pre.result, checks, status, headline };
      if (status !== "verified") continue;
      // AI text is untrusted: it may not point at addresses the DAO doesn't own.
      const ai = checkText(out.advice);
      if (!ai.ok) return NextResponse.json({ status: "blocked", message: ai.message, outside: ai.outside, why: "The AI's answer mentioned an address the treasury doesn't own, so it was thrown away." });

      const spend = t.reserve.spendableNear;
      // The suggestion moves the FULL gap the advice names (never a token amount).
      const transferNear = gapNear(health, t.demo.demoNearUsdPrice);
      const canAfford = transferNear <= spend + 1e-9;
      const attestationHash = createHash("sha256").update(JSON.stringify({ model, nonce: pre.nonce, checkedAt: last.checkedAt, checks: checks.map((c) => [c.id, c.status, c.details]) })).digest("hex");
      return NextResponse.json({
        status: "ok", health, quote, quoteUsdc, swap, attestation: last, attestationHash,
        advice: { text: out.advice, model: out.model, responseHash: out.responseHash, requestHash: out.requestHash },
        usage: out.usage, transferNear, canAfford, spendableNear: Math.round(spend * 100) / 100, transferUsd: transferNear * t.demo.demoNearUsdPrice, payrollAccount: t.payroll.accountId,
        totalNear: totalNear(t),
      });
    }
    return NextResponse.json({ status: "unverified", message: "Couldn't verify this time", attestation: last });
  } catch (e) {
    return NextResponse.json({ status: "error", message: `Something went wrong while preparing advice: ${(e as Error).message}` }, { status: 502 });
  }
}

/** Preview of the real Step 2 swap: a price-only quote plus what the treasury holds. Every failure becomes a plain message. */
async function swapPreview(dao: string) {
  if (!tidepoolEnabled()) return { enabled: false as const };
  const [q, r] = await Promise.allSettled([requestQuote({ dao, usdc: demo.tidepool.swapUsdc, live: false }), swapReadiness(dao)]);
  return {
    enabled: true as const, label: TIDEPOOL_LABEL, swapUsdc: demo.tidepool.swapUsdc,
    quote: q.status === "fulfilled" ? q.value : null,
    quoteError: q.status === "rejected" ? `Couldn't reach the test swap service right now (${(q.reason as Error).message}).` : undefined,
    readiness: r.status === "fulfilled" ? r.value : null,
  };
}
