// Builds the plain-English proposal description the council reads on-chain.
// Two steps, same numbers as the advice and the screen: (1) this proposal, (2) a cross-chain quote.
import type { QuoteResult } from "./intents";

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export function buildDescription(a: {
  advice: string; amountNear: number; amountUsd: number; receiver: string; quote: QuoteResult; model: string; responseHash: string; attestationHash: string;
}): string {
  const q = a.quote.ok
    ? `Step 2 (later, on another network, quote only): refill the main reserve from idle USDC on Ethereum via NEAR Intents. Real price quote, no money moved: ${a.quote.amountInUsdc.toLocaleString("en-US")} USDC would become about ${money(a.quote.amountOutUsd)} of NEAR (quoted ${a.quote.quotedAt}).`
    : "Step 2 (later, on another network, quote only): refill the main reserve from idle USDC on Ethereum via NEAR Intents. No price quote was available when this was written.";
  return [
    "COINSEL SUGGESTION (written by private AI; the council decides)",
    `What: move ${a.amountNear} NEAR (about ${money(a.amountUsd)} at demo scale) from the main reserve to the payroll account ${a.receiver} (a DAO-owned account).`,
    `Step 1 (this proposal, on NEAR): that ${money(a.amountUsd)} is exactly what payroll is short.`,
    q,
    `Why: ${a.advice.replace(/\s+/g, " ").trim()}`,
    `Private AI check: verified. Model ${a.model}. Attestation sha256:${a.attestationHash}. Answer sha256:${a.responseHash}.`,
    "Demo scale: testnet amounts are shown at real-world size. Coinsel can only suggest. It cannot send money or vote.",
  ].join("\n");
}
