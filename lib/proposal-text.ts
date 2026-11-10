// Builds the plain-English proposal description the council reads on-chain.
import type { QuoteResult } from "./intents";

export function buildDescription(a: {
  advice: string; amountNear: number; receiver: string; quote: QuoteResult; model: string; responseHash: string; attestationHash: string;
}): string {
  const q = a.quote.ok
    ? `Cross-chain step (price quote only, no money moved): ${a.quote.amountInUsdc} USDC on Ethereum would become about ${a.quote.amountOutNear.toFixed(2)} NEAR via NEAR Intents (quoted ${a.quote.quotedAt}).`
    : "Cross-chain step: no price quote was available when this was written.";
  return [
    "COINSEL SUGGESTION (written by private AI; the council decides)",
    `What: move ${a.amountNear} NEAR from the treasury to the payroll account ${a.receiver} (a DAO-owned account).`,
    `Why: ${a.advice.replace(/\s+/g, " ").trim()}`,
    q,
    `Private AI check: verified. Model ${a.model}. Attestation ${a.attestationHash}. Answer ${a.responseHash}.`,
    "Coinsel can only suggest. It cannot send money or vote.",
  ].join("\n");
}
