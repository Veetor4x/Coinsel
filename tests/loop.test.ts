import { describe, it, expect, vi, afterEach } from "vitest";
import { usdcToQuote, getDryQuote } from "../lib/intents";
import { buildDescription } from "../lib/proposal-text";
import { parseObligations } from "../lib/obligations";
import { toEngineInputs, totalNear } from "../lib/engine-inputs";
import { analyze } from "../lib/engine";
import demo from "../config/demo-treasury.json";

afterEach(() => vi.unstubAllGlobals());

describe("quote", () => {
  it("sizes the quote to the gap (step 2 refills what step 1 took out), with a minimum", () => {
    expect(usdcToQuote(0)).toBe(demo.intents.minUsdc);
    expect(usdcToQuote(3000)).toBe(3000);
    expect(usdcToQuote(2999.4)).toBe(3000);
  });
  it("is a dry run and never throws on failure", async () => {
    const f = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ message: "boom" }), { status: 500 }));
    vi.stubGlobal("fetch", f);
    const q = await getDryQuote(15);
    expect(q.ok).toBe(false);
    expect(JSON.parse((f.mock.calls[0][1] as RequestInit).body as string).dry).toBe(true);
    expect(q.label).toMatch(/no money moved/);
  });
});

describe("proposal text + inputs", () => {
  it("description carries advice, amount, quote and both hashes", () => {
    const d = buildDescription({
      advice: "Short on payroll.", amountNear: 3, amountUsd: 3000, receiver: "p.testnet", model: "m",
      quote: { ok: true, label: "", fromLabel: "", toLabel: "", amountInUsdc: 25, amountInUsd: 25, amountOutUsd: 24.9, amountOutNear: 6.87, minAmountOutNear: 6, timeEstimateSec: 45, signature: "", quotedAt: "now" },
      responseHash: "a".repeat(64), attestationHash: "b".repeat(64),
    });
    for (const s of ["Short on payroll.", "3 NEAR", "$3,000", "p.testnet", "25 USDC", "Step 1", "Step 2", "main reserve", "sha256:" + "a".repeat(64), "sha256:" + "b".repeat(64), "only suggest"]) expect(d).toContain(s);
  });
  it("rejects malformed payout lists", () => {
    expect(parseObligations("x")).toBeNull();
    expect(parseObligations([{ amountNear: -1, dueInDays: 1 }])).toBeNull();
    expect(parseObligations([{ id: "a", label: "A", amountNear: 1, dueInDays: 2.4, note: "n" }])?.[0].dueInDays).toBe(2);
  });
  it("moving NEAR from the reserve to payroll keeps the total but fixes payroll", () => {
    const mk = (dao: number, pay: number) => ({ onChain: { nearBalance: dao, tokens: [] }, payroll: { nearBalance: pay }, demo: { demoNearUsdPrice: 1000, otherChainBalances: [] } });
    expect(totalNear(mk(10, 8))).toBe(totalNear(mk(7, 11)));
    const run = (t: ReturnType<typeof mk>) => { const i = toEngineInputs(t, demo.obligations); return analyze(i.balances, i.obligations); };
    expect(run(mk(10, 8)).gapUsd).toBe(3000);
    expect(run(mk(7, 11)).gapUsd).toBe(0);
  });
});
