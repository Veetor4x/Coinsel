// Private AI advice via NEAR AI Cloud (OpenAI-compatible). The AI only EXPLAINS numbers our code computed.
// It gets no notes, no keys, no way to act. Its output is untrusted text.
import { createHash } from "node:crypto";
import { modelId } from "./attestation";
import type { HealthReport } from "./engine";
import type { QuoteResult } from "./intents";

const BASE = (process.env.NEARAI_BASE_URL || "https://cloud-api.near.ai/v1").replace(/\/$/, "");

export type Advice = { text: string; model: string; responseHash: string };

export type AdviceFacts = {
  nearBalance: number; nearUsdPrice: number; totalDueNear: number; transferNear: number; payrollAccount: string;
  idleUsdcOnEthereum: number; health: HealthReport; quote: QuoteResult | null;
};

export function buildPrompt(f: AdviceFacts): { system: string; user: string } {
  const h = f.health;
  const lines = [
    `Treasury on NEAR: ${f.nearBalance.toFixed(2)} NEAR (fixed demo price $${f.nearUsdPrice} per NEAR).`,
    `Upcoming payouts total ${f.totalDueNear.toFixed(2)} NEAR.`,
    h.shortfalls.length ? `First payouts can't be fully paid in ${h.firstShortfallInDays} days; total shortfall $${h.shortfalls.reduce((s, x) => s + x.shortUsd, 0).toFixed(0)}.` : "Every payout is covered.",
    `Money lasts about ${h.runwayDays ?? "unlimited"} days.`,
    `Unused money: $${f.idleUsdcOnEthereum.toLocaleString("en-US")} of USDC on Ethereum (demo data).`,
    f.quote?.ok ? `A real price quote says ${f.quote.amountInUsdc} USDC from Ethereum would become about ${f.quote.amountOutNear.toFixed(2)} NEAR.` : "No price quote is available right now.",
    `Proposed first step: move ${f.transferNear} NEAR from the treasury to the DAO's own payroll account so payroll can start. It is only a first step; the rest of the gap needs the cross-chain step.`,
  ];
  return {
    system:
      "You are Coinsel, a calm treasury adviser for a community. Write for a non-crypto person: short plain sentences, no jargon, no markdown, no bullet symbols. " +
      "Use ONLY the facts given; never invent numbers. Say what is wrong, then what to do, then that the council decides. " +
      "Remind them you can only suggest and can't send money. Maximum 110 words.",
    user: lines.join("\n"),
  };
}

export async function getAdvice(f: AdviceFacts): Promise<Advice> {
  const { system, user } = buildPrompt(f);
  const model = modelId();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.NEARAI_API_KEY ?? ""}` },
    body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: 1500, temperature: 0.2, stream: false }),
    cache: "no-store",
    signal: AbortSignal.timeout(60000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error?.message || `AI service answered ${res.status}`);
  const text = String(j?.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!text) throw new Error("The AI returned an empty answer.");
  return { text: text.slice(0, 1200), model, responseHash: "sha256:" + createHash("sha256").update(text).digest("hex") };
}
