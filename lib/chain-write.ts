/* eslint-disable @typescript-eslint/no-explicit-any -- chain/attestation JSON is untyped; every field is checked before use */
// The only code that SIGNS transactions. Server-side only.
//  - The AGENT signs with a function-call key: it can only call add_proposal on the DAO.
//  - Demo council members sign act_proposal (DEMO_MODE only) with testnet keys.
import { Account, actions, nearToYocto } from "near-api-js";
import { RPC_URL } from "./near";
import { getProposal } from "./sputnik";
import { env } from "./env";

const TGAS = 10n ** 12n;

function account(id: string, key: string) {
  return new Account(id, RPC_URL, key as `ed25519:${string}`);
}

function successValue(outcome: any): unknown {
  const v = outcome?.status?.SuccessValue;
  if (v === undefined || v === "") return undefined;
  try { return JSON.parse(Buffer.from(v, "base64").toString("utf8")); } catch { return undefined; }
}

/** The agent files a NEAR Transfer proposal to a DAO-owned receiver. Returns the new proposal id + tx hash. */
export async function fileTransferProposal(args: { dao: string; receiver: string; amountNear: number; description: string }) {
  const id = env("AGENT_ACCOUNT_ID"), key = env("AGENT_FUNCTION_CALL_PRIVATE_KEY");
  if (!id || !key) throw new Error("The Coinsel agent isn't set up on this server (AGENT_ACCOUNT_ID / AGENT_FUNCTION_CALL_PRIVATE_KEY).");
  const outcome: any = await account(id, key).signAndSendTransaction({
    receiverId: args.dao,
    actions: [
      actions.functionCall(
        "add_proposal",
        { proposal: { description: args.description, kind: { Transfer: { token_id: "", receiver_id: args.receiver, amount: nearToYocto(String(args.amountNear) as `${number}`).toString() } } } },
        30n * TGAS,
        0n, // function-call keys cannot attach a deposit; the DAO's proposal bond is 0
      ),
    ],
    waitUntil: "FINAL",
  });
  const proposalId = successValue(outcome);
  if (typeof proposalId !== "number") throw new Error("The DAO did not accept the proposal.");
  return { proposalId, txHash: String(outcome.transaction_outcome?.id ?? outcome.transaction?.hash ?? "") };
}

/** DEMO RESET: the payroll account sends NEAR back to the DAO. The destination is always the DAO; nothing else can be signed here. */
export async function sendPayrollToDao(dao: string, payrollId: string, amountNear: number) {
  const key = env("PAYROLL_PRIVATE_KEY");
  if (!key) throw new Error("Reset isn't set up on this server (PAYROLL_PRIVATE_KEY).");
  const yocto = nearToYocto(amountNear.toFixed(4) as `${number}`);
  const outcome: any = await account(payrollId, key).signAndSendTransaction({ receiverId: dao, actions: [actions.transfer(yocto)], waitUntil: "FINAL" });
  return { txHash: String(outcome.transaction_outcome?.id ?? "") };
}

export function demoCouncil(): { index: number; accountId: string; key: string }[] {
  return [1, 2, 3].flatMap((i) => {
    const accountId = env(`COUNCIL_${i}_ACCOUNT_ID`), key = env(`COUNCIL_${i}_PRIVATE_KEY`);
    return accountId && key ? [{ index: i, accountId, key }] : [];
  });
}

/** DEMO MODE: a demo council member approves. In real use each member signs with their own wallet. */
export async function approveAsCouncil(dao: string, proposalId: number, member: { accountId: string; key: string }) {
  const outcome: any = await account(member.accountId, member.key).signAndSendTransaction({
    receiverId: dao,
    actions: [actions.functionCall("act_proposal", { id: proposalId, action: "VoteApprove" }, 100n * TGAS, 0n)],
    waitUntil: "FINAL",
  });
  return { txHash: String(outcome.transaction_outcome?.id ?? "") };
}

/** Wait (briefly) for a proposal to leave InProgress, e.g. after the approving vote triggers the transfer. */
export async function settledProposal(dao: string, id: number, tries = 8) {
  let p = await getProposal(dao, id);
  for (let i = 0; i < tries && p.status === "InProgress" && p.approvals >= 2; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    p = await getProposal(dao, id);
  }
  return p;
}

/** DEMO RESET: a demo council member votes Reject on an open suggestion. */
export async function rejectAsCouncil(dao: string, proposalId: number, member: { accountId: string; key: string }) {
  const outcome: any = await account(member.accountId, member.key).signAndSendTransaction({
    receiverId: dao,
    actions: [actions.functionCall("act_proposal", { id: proposalId, action: "VoteReject" }, 100n * TGAS, 0n)],
    waitUntil: "FINAL",
  });
  return { txHash: String(outcome.transaction_outcome?.id ?? "") };
}

/**
 * DEMO RESET: close every Coinsel suggestion that is still waiting for votes, so nobody can approve a stale one.
 * Demo council members vote Reject until it is closed. Only open Transfer suggestions filed by the agent are touched.
 * Returns how many were closed.
 */
export async function closeOpenSuggestions(dao: string, openIds: number[]): Promise<number> {
  const members = demoCouncil();
  let closed = 0;
  for (const id of openIds) {
    let p = await getProposal(dao, id);
    for (const m of members) {
      if (p.status !== "InProgress") break;
      if (p.voters.includes(m.accountId)) continue; // already voted (e.g. approved earlier)
      await rejectAsCouncil(dao, id, m);
      p = await getProposal(dao, id);
    }
    if (p.status !== "InProgress") closed++;
  }
  return closed;
}
