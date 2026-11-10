import { describe, it, expect } from "vitest";
import demo from "../config/demo-treasury.json";
import { analyze } from "../lib/engine";
import { gapNear, toEngineInputs } from "../lib/engine-inputs";
import { checkText } from "../lib/guard";
import { TRICK_NOTE } from "../lib/trick";

const treasury = (dao: number, payroll: number) => ({
  onChain: { nearBalance: dao, tokens: [] }, payroll: { nearBalance: payroll },
  demo: { demoNearUsdPrice: demo.demoNearUsdPrice, otherChainBalances: demo.otherChainBalances },
});

describe("the suggestion moves the whole gap", () => {
  it("equals the total shortfall in NEAR (demo: 9.5 + 0.5 NEAR vs 13 due = 3 NEAR = $3,000)", () => {
    const { balances, obligations } = toEngineInputs(treasury(9.5, 0.5), demo.obligations);
    const h = analyze(balances, obligations);
    const short = h.shortfalls.reduce((s, x) => s + x.shortUsd, 0);
    expect(short).toBe(3000);
    expect(gapNear(h, demo.demoNearUsdPrice)).toBe(3);
  });
  it("is 0 when nothing is short", () => {
    const { balances, obligations } = toEngineInputs(treasury(20, 0.5), demo.obligations);
    expect(gapNear(analyze(balances, obligations), demo.demoNearUsdPrice)).toBe(0);
  });
  it("rounds up to a cent of NEAR so the gap is never under-covered", () => {
    expect(gapNear({ shortfalls: [{ shortUsd: 3000.5 }] }, 1000)).toBe(3.01);
  });
});

describe("trick note", () => {
  it("is flagged by the guard (this is what shows the 'Remove the note' button)", () => {
    expect(checkText(TRICK_NOTE).ok).toBe(false);
    expect(checkText("Milestone 1 of 2").ok).toBe(true);
  });
});
