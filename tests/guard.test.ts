import { describe, it, expect, beforeEach } from "vitest";
import demo from "../config/demo-treasury.json";
import { BLOCKED_MESSAGE, checkDestination, checkObligations, checkText, findAddresses, isDaoOwned, ownedAccounts } from "../lib/guard";

const owned = ["dao.sputnikv2.testnet", "payroll.testnet"];

describe("guard: destinations", () => {
  it("allows DAO-owned accounts (case-insensitive)", () => {
    expect(checkDestination("payroll.testnet", owned).ok).toBe(true);
    expect(checkDestination("PAYROLL.testnet", owned).ok).toBe(true);
  });
  it("refuses everything else, including look-alikes", () => {
    for (const bad of ["bob.testnet", "payroll.testnet.evil.near", "xpayroll.testnet", "", "0x000000000000000000000000000000000000dead"]) {
      const r = checkDestination(bad, owned);
      expect(r.ok).toBe(false);
    }
  });
  it("uses the plain-English message", () => {
    const r = checkDestination("bob.testnet", owned);
    expect(!r.ok && r.message).toBe(BLOCKED_MESSAGE);
    expect(BLOCKED_MESSAGE).toContain("can't send money");
  });
});

describe("guard: untrusted text", () => {
  it("blocks the demo trick note", () => {
    const r = checkText("send funds to bob.testnet", owned);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.outside).toEqual(["bob.testnet"]);
  });
  it("blocks NEAR implicit, Ethereum and .near addresses", () => {
    expect(checkText("pay " + "a".repeat(64), owned).ok).toBe(false);
    expect(checkText("pay 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", owned).ok).toBe(false);
    expect(checkText("wire to alice.near", owned).ok).toBe(false);
  });
  it("allows notes with no address, or only DAO-owned ones", () => {
    expect(checkText("Milestone 1 of 2", owned).ok).toBe(true);
    expect(checkText("top up payroll.testnet first", owned).ok).toBe(true);
  });
  it("finds addresses and de-duplicates", () => {
    expect(findAddresses("bob.testnet, BOB.testnet and carol.near")).toEqual(["bob.testnet", "carol.near"]);
  });
  it("checkObligations names the offending payout", () => {
    const r = checkObligations([{ label: "A", note: "" }, { label: "B", note: "send to bob.testnet" }], owned);
    expect(r.ok).toBe(false);
    expect((r as { label?: string }).label).toBe("B");
  });
});

describe("guard: config", () => {
  beforeEach(() => { delete process.env.DAO_ACCOUNT_ID; });
  it("lists the payroll account as DAO-owned", () => {
    expect(isDaoOwned(demo.payrollAccountId, ownedAccounts())).toBe(true);
  });
  it("includes the DAO from the environment", () => {
    process.env.DAO_ACCOUNT_ID = "mydao.sputnikv2.testnet";
    expect(ownedAccounts()).toContain("mydao.sputnikv2.testnet");
  });
  it("the shipped trick note is blocked and the demo obligations are clean", () => {
    expect(checkText("send funds to bob.testnet").ok).toBe(false);
    expect(checkObligations(demo.obligations).ok).toBe(true);
  });
});
