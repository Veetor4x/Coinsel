import { describe, it, expect } from "vitest";
import demo from "../config/demo-treasury.json";
import { analyze } from "../lib/engine";
import { gapNear, toEngineInputs } from "../lib/engine-inputs";
import { checkText } from "../lib/guard";
import { TRICK_NOTE } from "../lib/trick";
import { planReset, startingPayrollNear } from "../lib/demo-reset";

// dao = main reserve (spare = balance - ~5.5 NEAR storage), payroll = pays everyone.
const treasury = (daoSpare: number, payroll: number) => ({
  onChain: { nearBalance: daoSpare + 5.5, tokens: [] }, reserve: { spendableNear: daoSpare }, payroll: { nearBalance: payroll },
  demo: { demoNearUsdPrice: demo.demoNearUsdPrice, otherChainBalances: demo.otherChainBalances },
});
const health = (daoSpare: number, payroll: number) => { const i = toEngineInputs(treasury(daoSpare, payroll), demo.obligations); return analyze(i.balances, i.obligations); };

describe("payroll is paid from the payroll account; the reserve tops it up", () => {
  const start = startingPayrollNear();
  it("starting state: payroll short by exactly the starting gap, reserve can cover it", () => {
    expect(start).toBe(8);
    const h = health(4.5, start);
    expect(h.gapUsd).toBe(demo.startingGapNear * demo.demoNearUsdPrice);
    expect(h.gapUsd).toBe(3000);
    expect(h.firstShortfallInDays).toBe(9); // "payroll short in 9 days"
    expect(h.runwayDays).toBe(9);
    expect(h.reserveUsd).toBe(4500);
    expect(h.reserveCoversGap).toBe(true);
    expect(h.findings.find((f) => f.severity === "critical")).toBeTruthy();
    expect(gapNear(h, demo.demoNearUsdPrice)).toBe(3);
  });
  it("after the council moves the gap to payroll it flips to covered and runway grows", () => {
    const before = health(4.5, start), after = health(1.5, start + 3);
    expect(after.gapUsd).toBe(0);
    expect(after.shortfalls).toHaveLength(0);
    expect(after.findings.some((f) => f.id === "covered" && f.severity === "ok")).toBe(true);
    expect(after.findings.some((f) => f.severity === "critical")).toBe(false);
    expect(after.runwayDays!).toBeGreaterThan(before.runwayDays!);
    expect(gapNear(after, demo.demoNearUsdPrice)).toBe(0);
  });
  it("the reserve is never called 'idle'; the Ethereum USDC still is", () => {
    const h = health(4.5, start);
    expect(h.idle.some((i) => i.chain === "Reserve")).toBe(false);
    expect(h.idle.some((i) => i.symbol === "USDC")).toBe(true);
  });
  it("says so when the reserve cannot cover the gap", () => {
    const h = health(1, start);
    expect(h.reserveCoversGap).toBe(false);
    expect(h.findings.some((f) => f.id === "reserve-short")).toBe(true);
  });
  it("ignores gas dust below 0.01 NEAR", () => {
    expect(health(4.5, 7.99996).gapUsd).toBe(3000);
    expect(health(4.5, 11.0001).gapUsd).toBe(0);
  });
  it("rounds the gap up to a cent of NEAR so it is never under-covered", () => {
    expect(gapNear({ shortfalls: [{ shortUsd: 3000.5 }] }, 1000)).toBe(3.01);
  });
});

describe("reset demo plan", () => {
  const base = { startNear: 8, reserveSpendableNear: 4.5, gapNear: 3 };
  it("sends the surplus back, leaving a little for gas", () => {
    const p = planReset({ ...base, payrollNear: 11.0001 });
    expect(p).toEqual({ action: "send", sendNear: 2.9996 });
  });
  it("does nothing when already at the start", () => {
    expect(planReset({ ...base, payrollNear: 8.0002 }).action).toBe("none");
  });
  it("asks for a top-up instead of failing when the reserve is too low", () => {
    expect(planReset({ ...base, payrollNear: 8, reserveSpendableNear: 1 }).action).toBe("needs-topup");
    expect(planReset({ ...base, payrollNear: 7 }).action).toBe("needs-topup");
  });
  it("counts what the reset sends back towards the reserve", () => {
    expect(planReset({ ...base, payrollNear: 11, reserveSpendableNear: 1.6 }).action).toBe("send");
  });
});

describe("trick note", () => {
  it("is flagged by the guard (this is what shows the 'Remove the note' button)", () => {
    expect(checkText(TRICK_NOTE).ok).toBe(false);
    expect(checkText("Milestone 1 of 2").ok).toBe(true);
  });
});
