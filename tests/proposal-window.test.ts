// Safety checks must see EVERY proposal, not just the last 20 (found by Clearance / Selliks).
import { describe, it, expect } from "vitest";
import demo from "../config/demo-treasury.json";
import { scanAllProposals, type ProposalReader } from "../lib/sputnik";
import { planTopUp, pendingTopUps, type ProposalLite } from "../lib/safety";

const PAY = demo.payrollAccountId;
const AGENT = "coinsel-agent.testnet";
const NOW = Date.parse("2026-11-10T12:00:00Z");
const yocto = (near: number) => (BigInt(Math.round(near * 100)) * 10n ** 22n).toString();

/** A fake chain: proposal 0 is a pending 3 NEAR top-up, the rest are 1 NEAR transfers to someone else (already rejected). */
function fakeChain(total: number) {
  const raw = Array.from({ length: total }, (_, id) => ({
    id, proposer: AGENT, description: `p${id}`, status: id === 0 ? "InProgress" : "Rejected", votes: {},
    submission_time: String(BigInt(NOW) * 1_000_000n),
    kind: { Transfer: { token_id: "", receiver_id: id === 0 ? PAY : "other.testnet", amount: yocto(id === 0 ? 3 : 1) } },
  }));
  const calls: { from: number; limit: number }[] = [];
  const reader: ProposalReader = {
    lastId: async () => total,
    page: async (from, limit) => { calls.push({ from, limit }); return raw.slice(from, from + limit); },
  };
  return { reader, calls };
}

describe("pending top-up older than the last 20 proposals", () => {
  it("scanAllProposals pages through everything (batches of 100), newest first, no gaps", async () => {
    const { reader, calls } = fakeChain(250);
    const all = await scanAllProposals(reader);
    expect(all).toHaveLength(250);
    expect(all[0].id).toBe(249);
    expect(all.at(-1)!.id).toBe(0);
    expect(calls).toEqual([{ from: 0, limit: 100 }, { from: 100, limit: 100 }, { from: 200, limit: 50 }]);
    expect(await scanAllProposals((await fakeChain(0)).reader)).toEqual([]);
  });

  it("a pending top-up followed by 25 other proposals still counts, so the full amount is NOT filed again", async () => {
    const { reader } = fakeChain(26); // #0 pending 3 NEAR, then 25 others
    const all = (await scanAllProposals(reader)) as unknown as ProposalLite[];
    const recent20 = all.slice(0, 20); // what the old code saw
    // old behaviour: the window forgets #0 and files the whole gap again
    expect(planTopUp({ gapNear: 3, all: recent20, spendableNear: 50, now: NOW, agents: [AGENT] })).toMatchObject({ action: "file", amountNear: 3 });
    // fixed behaviour: #0 is still pending
    expect(pendingTopUps(all, [AGENT]).map((q) => q.id)).toEqual([0]);
    expect(planTopUp({ gapNear: 3, all, spendableNear: 50, now: NOW, agents: [AGENT] })).toMatchObject({ action: "duplicate" });
    expect(planTopUp({ gapNear: 3.5, all, spendableNear: 50, now: NOW, agents: [AGENT] })).toMatchObject({ action: "file", amountNear: 0.5, pending: [0] });
    expect(planTopUp({ gapNear: 3.01, all, spendableNear: 50, now: NOW, agents: [AGENT] })).toMatchObject({ action: "covered", pending: [0] });
  });
});
