import { describe, it, expect, vi, afterEach } from "vitest";
import { usdcToQuote, getDryQuote } from "../lib/intents";
import { buildDescription } from "../lib/proposal-text";
import { parseObligations } from "../lib/obligations";
import { toEngineInputs, totalNear } from "../lib/engine-inputs";
import { analyze } from "../lib/engine";
import demo from "../config/demo-treasury.json";

afterEach(() => vi.unstubAllGlobals());

describe("quote", () => {
  it("sizes the quote to the gap, with room and a minimum", () => {
    expect(usdcToQuote(0)).toBe(demo.intents.minUsdc);
    expect(usdcToQuote(100)).toBe(120);
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
      advice: "Short on payroll.", amountNear: 0.1, amountUsd: 100, receiver: "p.testnet", model: "m",
      quote: { ok: true, label: "", fromLabel: "", toLabel: "", amountInUsdc: 25, amountInUsd: 25, amountOutUsd: 24.9, amountOutNear: 6.87, minAmountOutNear: 6, timeEstimateSec: 45, signature: "", quotedAt: "now" },
      responseHash: "a".repeat(64), attestationHash: "b".repeat(64),
    });
    for (const s of ["Short on payroll.", "0.1 NEAR", "$100", "p.testnet", "25 USDC", "sha256:" + "a".repeat(64), "sha256:" + "b".repeat(64), "only suggest"]) expect(d).toContain(s);
  });
  it("rejects malformed payout lists", () => {
    expect(parseObligations("x")).toBeNull();
    expect(parseObligations([{ amountNear: -1, dueInDays: 1 }])).toBeNull();
    expect(parseObligations([{ id: "a", label: "A", amountNear: 1, dueInDays: 2.4, note: "n" }])?.[0].dueInDays).toBe(2);
  });
  it("moving NEAR between the DAO and its payroll account does not change the total or runway", () => {
    const mk = (dao: number, pay: number) => ({ onChain: { nearBalance: dao, tokens: [] }, payroll: { nearBalance: pay }, demo: { demoNearUsdPrice: 3, otherChainBalances: [] } });
    const obs = demo.obligations.map((o) => ({ ...o }));
    const run = (t: ReturnType<typeof mk>) => { const i = toEngineInputs(t, obs); return analyze(i.balances, i.obligations); };
    expect(totalNear(mk(6, 0.1))).toBeCloseTo(totalNear(mk(5.9, 0.2)), 9);
    expect(run(mk(6, 0.1)).runwayDays).toBe(run(mk(5.9, 0.2)).runwayDays);
  });
});
