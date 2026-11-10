import { NextResponse } from "next/server";
import demo from "@/config/demo-treasury.json";
import { analyze, type Balance } from "@/lib/engine";
import { parseObligations, type RawObligation } from "@/lib/validate";
import { getAdvice, getModel } from "@/lib/ai";
import { summarize, verifyAnswer, verifyModel } from "@/lib/attestation";
import { getNearBalance } from "@/lib/sputnik";

// Nothing is stored: no database, no logs of prompts or answers.
type In = { obligations?: RawObligation[] };

export async function POST(req: Request) {
  const apiKey = process.env.NEARAI_API_KEY;
  const dao = process.env.DAO_ACCOUNT_ID;
  if (!apiKey || !dao) return NextResponse.json({ error: "The server isn't set up for AI advice yet." }, { status: 500 });

  let body: In;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }

  try {
    const price = demo.demoNearUsdPrice;
    let obligations;
    try { obligations = parseObligations(body.obligations, price); }
    catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
    const near = await getNearBalance(dao); // real balance is re-read on the server, never trusted from the browser
    const balances: Balance[] = [
      { chain: "NEAR", symbol: "NEAR", amount: near, usdValue: near * price, source: "real" },
      ...demo.otherChainBalances.map((b): Balance => ({ chain: b.chain, symbol: b.symbol, amount: b.amount, usdValue: b.usdValue, source: "demo" })),
    ];
    const report = analyze(balances, obligations);

    // 1) Prove the AI is private BEFORE sending anything.
    const model = getModel();
    const pre = await verifyModel(model);
    if (pre.result.status !== "verified") {
      return NextResponse.json({ advice: null, attestation: pre.result, blocked: true, message: "We couldn't prove the AI is private, so nothing was sent to it." });
    }

    // 2) Ask for advice.
    const out = await getAdvice(report, apiKey);

    // 3) Check this exact answer was signed by the verified model.
    const signed = await verifyAnswer(out.model, out, pre.signer, apiKey);
    const checks = [...pre.result.checks, signed];
    const { status, headline } = summarize(checks);
    return NextResponse.json({
      advice: out.advice,
      attestation: { ...pre.result, checks, status, headline },
      usage: out.usage,
      hashes: { request: out.requestHash, response: out.responseHash },
    });
  } catch (e) {
    return NextResponse.json({ error: `Couldn't get advice this time: ${(e as Error).message}` }, { status: 502 });
  }
}
