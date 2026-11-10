/* eslint-disable @typescript-eslint/no-explicit-any -- chain/attestation JSON is untyped; every field is checked before use */
// Read-only Sputnik DAO v2 helpers.
import { viewAccount, viewFunction, yoctoToNear } from "./near";
import { parseRegisterKind, parseSwapKind, type ParsedRegister, type ParsedSwap } from "./swap-proposal";

type RawPolicy = {
  roles: { name: string; kind: { Group?: string[] } | string; permissions: string[] }[];
  default_vote_policy: { threshold: string | [number, number] };
  proposal_bond: string;
};

export type CouncilInfo = { members: string[]; threshold: number; agent: string[]; proposalBond: string };

export async function getCouncil(dao: string): Promise<CouncilInfo> {
  const p = await viewFunction<RawPolicy>(dao, "get_policy");
  const group = (name: string) => {
    const r = p.roles.find((x) => x.name === name);
    return r && typeof r.kind === "object" && r.kind.Group ? r.kind.Group : [];
  };
  const t = p.default_vote_policy.threshold;
  return {
    members: group("council"),
    threshold: Array.isArray(t) ? Number(t[0]) : Number(t),
    agent: group("agent"),
    proposalBond: p.proposal_bond,
  };
}

export type ProposalSummary = {
  id: number; proposer: string; description: string; kind: string; status: string; submissionTime: string;
  /** For Transfer proposals. */
  receiver?: string; amountNear?: number;
  /** Set only when the proposal is exactly a Coinsel Step 2 swap deposit (see lib/swap-proposal.ts). */
  swap?: ParsedSwap;
  /** Set only when the proposal is exactly "register the DAO on a Tidepool token contract". */
  register?: ParsedRegister;
  approvals: number; voters: string[];
};

function summarize(p: any): ProposalSummary {
  const kindName = typeof p.kind === "string" ? p.kind : Object.keys(p.kind)[0];
  const t = kindName === "Transfer" ? p.kind.Transfer : null;
  const votes: Record<string, string> = p.votes ?? {};
  return {
    id: p.id,
    proposer: p.proposer,
    description: String(p.description ?? "").slice(0, 2000),
    kind: kindName,
    status: p.status,
    submissionTime: String(Math.floor(Number(BigInt(p.submission_time) / 1_000_000n))),
    receiver: t && !t.token_id ? t.receiver_id : undefined,
    amountNear: t && !t.token_id ? yoctoToNear(t.amount) : undefined,
    swap: kindName === "FunctionCall" ? parseSwapKind(p.kind) ?? undefined : undefined,
    register: kindName === "FunctionCall" ? parseRegisterKind(p.kind) ?? undefined : undefined,
    approvals: Object.values(votes).filter((v) => v === "Approve").length,
    voters: Object.keys(votes),
  };
}

export async function getProposal(dao: string, id: number): Promise<ProposalSummary & { rawKind: any }> {
  const p = await viewFunction<any>(dao, "get_proposal", { id });
  return { ...summarize(p), rawKind: p.kind };
}

export async function getRecentProposals(dao: string, max = 5): Promise<ProposalSummary[]> {
  const last = await viewFunction<number>(dao, "get_last_proposal_id");
  if (!last) return [];
  const from = Math.max(0, last - max);
  const raw = await viewFunction<any[]>(dao, "get_proposals", { from_index: from, limit: max });
  return raw.map(summarize).reverse();
}

export type FtBalance = { contractId: string; symbol: string; decimals: number; amount: number };

export async function getFtBalance(dao: string, contractId: string): Promise<FtBalance> {
  const [meta, raw] = await Promise.all([
    viewFunction<{ symbol: string; decimals: number }>(contractId, "ft_metadata"),
    viewFunction<string>(contractId, "ft_balance_of", { account_id: dao }),
  ]);
  return { contractId, symbol: meta.symbol, decimals: meta.decimals, amount: Number(BigInt(raw)) / 10 ** meta.decimals };
}

export async function getNearBalance(dao: string): Promise<number> {
  const a = await viewAccount(dao);
  return yoctoToNear(a.amount);
}
