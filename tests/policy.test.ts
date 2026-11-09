import { describe, it, expect } from "vitest";
import { buildPolicy } from "../scripts/create-dao";

describe("DAO policy built by create-dao", () => {
  const p = buildPolicy(["c1.testnet", "c2.testnet", "c3.testnet"], "agent.testnet");
  it("has zero proposal bond (function-call keys cannot attach deposits)", () => {
    expect(p.proposal_bond).toBe("0");
  });
  it("agent role can ONLY add proposals (never vote or change policy)", () => {
    const agent = p.roles.find((r) => r.name === "agent")!;
    expect(agent.permissions.every((x) => x.endsWith(":AddProposal"))).toBe(true);
    expect(agent.permissions.some((x) => /^(\*|policy|config)/.test(x))).toBe(false);
  });
  it("council needs 2 of 3 and nobody else votes", () => {
    expect(p.default_vote_policy.threshold).toBe("2");
    expect(p.roles.filter((r) => r.permissions.some((x) => x.includes("Vote"))).map((r) => r.name)).toEqual(["council"]);
  });
  it("does not keep an 'everyone can add proposals' role", () => {
    expect(p.roles.some((r) => r.kind === ("Everyone" as unknown))).toBe(false);
  });
});
