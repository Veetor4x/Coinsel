import { describe, it, expect } from "vitest";
import { analyze, type Balance, type Obligation } from "../lib/engine";

const near = (usd: number): Balance => ({ chain: "NEAR", symbol: "NEAR", amount: usd / 3, usdValue: usd, source: "real" });
const eth = (usd: number): Balance => ({ chain: "Ethereum", symbol: "USDC", amount: usd, usdValue: usd, source: "demo" });
const pay = (id: string, usd: number, dueInDays: number, chain = "NEAR"): Obligation => ({ id, label: id, amountUsd: usd, dueInDays, chain });

describe("shortfall", () => {
  it("finds the shortfall amount and date", () => {
    const r = analyze([near(20)], [pay("a", 15, 9), pay("b", 15, 9)]);
    expect(r.shortfalls).toHaveLength(1);
    expect(r.shortfalls[0].obligationId).toBe("b");
    expect(r.shortfalls[0].shortUsd).toBe(10);
    expect(r.firstShortfallInDays).toBe(9);
    expect(r.runwayDays).toBe(9);
    expect(r.findings[0].severity).toBe("critical");
    expect(r.findings[0].title).toMatch(/9 days/);
  });
  it("cannot be covered by money on another chain", () => {
    const r = analyze([near(5), eth(1000)], [pay("a", 15, 9)]);
    expect(r.shortfalls[0].shortUsd).toBe(10);
    expect(r.findings.some((f) => f.id === "move-funds")).toBe(true);
  });
});

describe("no shortfall", () => {
  it("reports covered and no shortfalls", () => {
    const r = analyze([near(100)], [pay("a", 10, 9), pay("b", 10, 30)]);
    expect(r.shortfalls).toHaveLength(0);
    expect(r.firstShortfallInDays).toBeNull();
    expect(r.findings.some((f) => f.id === "covered")).toBe(true);
    expect(r.findings.some((f) => f.severity === "critical")).toBe(false);
  });
  it("projects runway from average daily spend when covered", () => {
    // 20 USD over 10 days = 2/day; 100 USD -> 50 days
    expect(analyze([near(100)], [pay("a", 20, 10)]).runwayDays).toBe(50);
  });
  it("warns when runway is under 30 days even if covered", () => {
    const r = analyze([near(25)], [pay("a", 20, 10)]);
    expect(r.shortfalls).toHaveLength(0);
    expect(r.runwayDays).toBe(12);
    expect(r.findings.some((f) => f.id === "low-runway")).toBe(true);
  });
});

describe("idle funds", () => {
  it("counts only money not needed in the next 30 days, per chain", () => {
    const r = analyze([near(50), eth(12500)], [pay("a", 20, 9), pay("far", 20, 45)]);
    const n = r.idle.find((i) => i.chain === "NEAR")!;
    const e = r.idle.find((i) => i.chain === "Ethereum")!;
    expect(n.idleUsd).toBe(30);
    expect(e.idleUsd).toBe(12500);
    expect(e.source).toBe("demo");
    expect(r.totalIdleUsd).toBe(12530);
    expect(r.findings.some((f) => f.id === "idle")).toBe(true);
  });
  it("has no idle funds when everything is needed", () => {
    const r = analyze([near(20)], [pay("a", 20, 5)]);
    expect(r.idle).toHaveLength(0);
  });
});

describe("multiple obligations", () => {
  it("uses money in due-date order and flags only what can't be paid", () => {
    const r = analyze([near(30)], [pay("late", 20, 20), pay("early", 20, 5)]);
    expect(r.shortfalls.map((s) => s.obligationId)).toEqual(["late"]);
    expect(r.shortfalls[0].shortUsd).toBe(10);
    expect(r.shortfalls[0].availableUsd).toBe(10);
    expect(r.runwayDays).toBe(20);
  });
  it("sums same-day payouts in the headline", () => {
    const five = ["a", "b", "c", "d", "e"].map((x) => pay(x, 6, 9));
    const r = analyze([near(12)], five);
    expect(r.shortfalls).toHaveLength(3);
    expect(r.findings[0].detail).toMatch(/3 payouts/);
    expect(r.findings[0].detail).toMatch(/\$18/);
  });
});

describe("empty treasury", () => {
  it("handles no balances and no payouts", () => {
    const r = analyze([], []);
    expect(r.totalUsd).toBe(0);
    expect(r.runwayDays).toBeNull();
    expect(r.shortfalls).toEqual([]);
    expect(r.idle).toEqual([]);
    expect(r.findings[0].id).toBe("empty");
  });
  it("empty treasury with payouts is critical", () => {
    const r = analyze([near(0)], [pay("a", 10, 3)]);
    expect(r.runwayDays).toBe(3);
    expect(r.shortfalls[0].shortUsd).toBe(10);
    expect(r.findings[0].severity).toBe("critical");
  });
  it("ignores junk numbers", () => {
    const r = analyze([near(NaN), near(-5)], [pay("a", NaN, 3), pay("b", -1, 3)]);
    expect(r.totalUsd).toBe(0);
    expect(r.shortfalls).toEqual([]);
  });
});

describe("alert wording", () => {
  it("leads with the total gap, not just the first day's gap", () => {
    const r = analyze(
      [{ chain: "P", symbol: "NEAR", amount: 1, usdValue: 100, source: "real" }],
      [
        { id: "a", label: "A", amountUsd: 200, dueInDays: 5, chain: "P" },
        { id: "b", label: "B", amountUsd: 300, dueInDays: 9, chain: "P" },
      ],
    );
    const f = r.findings.find((x) => x.id === "shortfall")!;
    expect(r.gapUsd).toBe(400);
    expect(f.detail.startsWith("We're short by $400")).toBe(true);
    expect(f.detail).toContain("$100 short that day");
  });
});
