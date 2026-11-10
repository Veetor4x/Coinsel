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
