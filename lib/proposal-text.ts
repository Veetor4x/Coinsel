// Builds the plain-English proposal description the council reads on-chain.
// Two steps, same numbers as the advice and the screen: (1) this proposal, (2) a cross-chain quote.
import type { QuoteResult } from "./intents";
import type { TidepoolQuote } from "./tidepool";
import demo from "@/config/demo-treasury.json";

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export function buildDescription(a: {
  advice: string; amountNear: number; amountUsd: number; receiver: string; quote: QuoteResult; model: string; responseHash: string; attestationHash: string;
  /** When the real testnet swap is switched on, Step 2 is its own proposal; this line says so instead of the quote-only text. */
  step2Override?: string;
  /** Fingerprint of the payout list this was written for (see lib/fingerprint.ts). Lets the vote check refuse a swapped list. */
  payoutFingerprint?: string;
}): string {
  const q = a.step2Override ?? (a.quote.ok
    ? `Step 2 (later, on another network, quote only): refill the main reserve from idle USDC on Ethereum via NEAR Intents. Real price quote, no money moved: ${a.quote.amountInUsdc.toLocaleString("en-US")} USDC would become about ${money(a.quote.amountOutUsd)} of NEAR (quoted ${a.quote.quotedAt}).`
    : "Step 2 (later, on another network, quote only): refill the main reserve from idle USDC on Ethereum via NEAR Intents. No price quote was available when this was written.");
  return [
    "COINSEL SUGGESTION (written by private AI; the council decides)",
    `What: move ${a.amountNear} NEAR (about ${money(a.amountUsd)} at demo scale) from the main reserve to the payroll account ${a.receiver} (a DAO-owned account).`,
    `Step 1 (this proposal, on NEAR): that ${money(a.amountUsd)} is exactly what payroll is short.`,
    q,
    `Why: ${a.advice.replace(/\s+/g, " ").trim()}`,
    `Private AI check: verified. Model ${a.model}. Attestation sha256:${a.attestationHash}. Answer sha256:${a.responseHash}.`,
    "Demo scale: testnet amounts are shown at real-world size. Coinsel can only suggest. It cannot send money or vote.",
    ...(a.payoutFingerprint ? [`Payout list fingerprint: ${a.payoutFingerprint}`] : []),
  ].join("\n");
}

const T = demo.tidepool;
export const STEP2_POINTER = `Step 2 (later): a separate suggestion swaps ${T.originLabel} the treasury already holds for ${T.destinationLabel} on ${T.label}, paid back into the main reserve.`;

/** The Step 2 proposal text the council reads on-chain. Plain facts, same numbers as the screen. */
export function buildSwapDescription(a: {
  advice: string; quote: TidepoolQuote; dao: string; model: string; responseHash: string; attestationHash: string;
}): string {
  const q = a.quote;
  return [
    "COINSEL SUGGESTION · STEP 2 (written by private AI; the council decides)",
    `What: swap ${q.amountInUsdc} ${T.originLabel} the treasury holds for about ${q.amountOutWnear.toFixed(4)} ${T.destinationLabel} on ${T.label}. The ${T.destinationLabel} is paid back to the main reserve (${a.dao}).`,
    `Where the ${T.originLabel} goes: to the one-time swap deposit address ${q.depositAddress}, made by Tidepool for this swap only. If the swap fails, Tidepool refunds to ${a.dao}.`,
    `Quote valid until ${q.deadline}. If the council votes after that, nothing is swapped and the coins come back.`,
    `Test tokens with no value, on a community sandbox (not run by NEAR). A small fixed test amount, not the demo-scale gap in Step 1. Real transaction, test network.`,
    `Why: ${a.advice.replace(/\s+/g, " ").trim()}`,
    `Private AI check: verified. Model ${a.model}. Attestation sha256:${a.attestationHash}. Answer sha256:${a.responseHash}.`,
    "Coinsel can only suggest. It cannot send money or vote.",
  ].join("\n");
}

/** Setup proposal text: plain facts, no AI involved. */
export function buildRegisterDescription(a: { tokenContract: string; label: string; dao: string; why: string }): string {
  return [
    "COINSEL SUGGESTION · SETUP (the council decides)",
    `What: register the treasury (${a.dao}) on the ${a.label} token contract (${a.tokenContract}) so it ${a.why}. One-time fee of 0.00125 NEAR, paid by the treasury. Nothing else moves.`,
    `This is a test token on ${T.label}. It has no value.`,
    "Coinsel can only suggest. It cannot send money or vote.",
  ].join("\n");
}
