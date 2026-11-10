// Builds the plain-English proposal description the council reads on-chain.
import type { QuoteResult } from "./intents";

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export function buildDescription(a: {
  advice: string; amountNear: number; amountUsd: number; receiver: string; quote: QuoteResult; model: string; responseHash: string; attestationHash: string;
}): string {
  const q = a.quote.ok
    ? `Cross-chain step (real price quote, no money moved): ${a.quote.amountInUsdc.toLocaleString("en-US")} USDC on Ethereum would become about ${money(a.quote.amountOutUsd)} of NEAR via NEAR Intents (quoted ${a.quote.quotedAt}).`
    : "Cross-chain step: no price quote was available when this was written.";
  return [
    "COINSEL SUGGESTION (written by private AI; the council decides)",
    `What: move ${a.amountNear} NEAR (about ${money(a.amountUsd)} at demo scale) from the treasury to the payroll account ${a.receiver} (a DAO-owned account).`,
    `Why: ${a.advice.replace(/\s+/g, " ").trim()}`,
    q,
    `Private AI check: verified. Model ${a.model}. Attestation sha256:${a.attestationHash}. Answer sha256:${a.responseHash}.`,
    "Demo scale: testnet amounts are shown at real-world size. Coinsel can only suggest. It cannot send money or vote.",
  ].join("\n");
}
