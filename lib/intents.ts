// NEAR Intents 1Click API: a REAL price quote with dry:true. Nothing is executed, no money moves.
// Docs: https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request
import demo from "@/config/demo-treasury.json";

const BASE = (process.env.ONECLICK_API_URL || "https://1click.chaindefuser.com").replace(/\/$/, "");
export const QUOTE_LABEL = "Real price quote — no money moved (NEAR Intents has no test network).";

export type QuoteResult =
  | {
      ok: true; label: string; fromLabel: string; toLabel: string;
      amountInUsdc: number; amountInUsd: number; amountOutNear: number; minAmountOutNear: number;
      timeEstimateSec: number; signature: string; quotedAt: string;
    }
  | { ok: false; label: string; error: string };

const num = (s: unknown, decimals: number) => Number(BigInt(String(s).split(".")[0])) / 10 ** decimals;

/** How many USDC to quote: cover the gap (+20% room), never below the minimum, whole dollars. */
export function usdcToQuote(shortUsd: number): number {
  const c = demo.intents;
  return Math.max(c.minUsdc, Math.ceil(Math.max(0, shortUsd) * 1.2));
}

async function once(usdc: number): Promise<QuoteResult> {
  const c = demo.intents;
  const res = await fetch(`${BASE}/v0/quote`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(process.env.ONECLICK_JWT ? { authorization: `Bearer ${process.env.ONECLICK_JWT}` } : {}) },
    body: JSON.stringify({
      dry: true,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: c.originAsset,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: c.destinationAsset,
      amount: String(Math.round(usdc * 10 ** c.originDecimals)),
      recipient: c.placeholderRecipient,
      recipientType: "DESTINATION_CHAIN",
      refundTo: c.placeholderRefundTo,
      refundType: "ORIGIN_CHAIN",
      deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.quote) throw new Error(j.message || `Quote service answered ${res.status}`);
  const q = j.quote;
  return {
    ok: true, label: QUOTE_LABEL, fromLabel: c.originLabel, toLabel: c.destinationLabel,
    amountInUsdc: num(q.amountIn, c.originDecimals), amountInUsd: Number(q.amountInUsd),
    amountOutNear: num(q.amountOut, c.destinationDecimals), minAmountOutNear: num(q.minAmountOut, c.destinationDecimals),
    timeEstimateSec: Number(q.timeEstimate) || 0, signature: String(j.signature ?? ""), quotedAt: String(j.timestamp ?? new Date().toISOString()),
  };
}

/** Fetch a quote; retry once; never throw (the app keeps working without it). */
export async function getDryQuote(usdc: number): Promise<QuoteResult> {
  let last = "unknown error";
  for (let i = 0; i < 2; i++) {
    try { return await once(usdc); } catch (e) { last = (e as Error).message; }
  }
  return { ok: false, label: QUOTE_LABEL, error: `Couldn't get a price quote right now (${last}). The suggestion can still be filed without it.` };
}
