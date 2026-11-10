import { describe, it, expect } from "vitest";
import demo from "../config/demo-treasury.json";

describe("demo treasury config", () => {
  it("has payroll for 5 roles due in 9 days and a later grant", () => {
    const payroll = demo.obligations.filter((o) => o.kind === "payroll");
    expect(payroll).toHaveLength(5);
    expect(payroll.every((o) => o.dueInDays === 9)).toBe(true);
    expect(demo.obligations.some((o) => o.kind === "grant" && o.dueInDays > 9)).toBe(true);
  });
  it("labels other-chain data as demo (note present)", () => {
    expect(demo._note).toMatch(/NOT on-chain/);
  });
});

describe("demo scale", () => {
  it("shows realistic sizes: 1 test NEAR = $1,000, payroll about $10,000, idle USDC about $40,000", () => {
    expect(demo.demoNearUsdPrice).toBe(1000);
    const payrollUsd = demo.obligations.filter((o) => o.kind === "payroll").reduce((s, o) => s + o.amountNear * demo.demoNearUsdPrice, 0);
    expect(payrollUsd).toBe(10000);
    expect(demo.otherChainBalances[0].usdValue).toBe(40000);
    expect(demo.demoScaleLabel).toBe("Demo scale — testnet amounts shown at real-world size");
  });
});
