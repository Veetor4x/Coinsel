// DEMO MODE ONLY: the demo server signs a council vote with a testnet council key.
// In real use each council member signs with their own wallet.
import { NextResponse } from "next/server";
import { checkDestination } from "@/lib/guard";
import { getProposal } from "@/lib/sputnik";
import { approveAsCouncil, demoCouncil, settledProposal } from "@/lib/chain-write";
import { getCouncil } from "@/lib/sputnik";
import { env, isDemoMode } from "@/lib/env";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isDemoMode()) return NextResponse.json({ error: "Demo voting is switched off on this server." }, { status: 403 });
  const dao = env("DAO_ACCOUNT_ID");
  const b = await req.json().catch(() => null);
  const id = Number(b?.proposalId), n = Number(b?.member);
  if (!dao || !Number.isInteger(id) || id < 0 || ![1, 2, 3].includes(n)) return NextResponse.json({ error: "Pick a suggestion and a council member (1, 2 or 3)." }, { status: 400 });
  const member = demoCouncil().find((m) => m.index === n);
  if (!member) return NextResponse.json({ error: `Demo council member ${n} isn't set up on this server.` }, { status: 500 });

  try {
    const p = await getProposal(dao, id);
    // Even in demo mode, only approve plain NEAR transfers to DAO-owned accounts that are still open.
    if (p.kind !== "Transfer" || !p.receiver || !checkDestination(p.receiver).ok) return NextResponse.json({ error: "Demo voting only approves transfers to the DAO's own accounts." }, { status: 403 });
    if (p.status !== "InProgress") return NextResponse.json({ error: `This suggestion is already ${p.status}.` }, { status: 409 });
    if (p.voters.includes(member.accountId)) return NextResponse.json({ error: "Council member " + n + " already voted on this one." }, { status: 409 });
    if (!(await getCouncil(dao)).members.includes(member.accountId)) return NextResponse.json({ error: "That demo account isn't on the council." }, { status: 403 });

    const { txHash } = await approveAsCouncil(dao, id, member);
    const after = await settledProposal(dao, id);
    return NextResponse.json({ status: after.status, approvals: after.approvals, member: n, txHash, txUrl: `https://testnet.nearblocks.io/txns/${txHash}`, executed: after.status === "Approved" });
  } catch (e) {
    return NextResponse.json({ error: `The vote didn't go through: ${(e as Error).message}` }, { status: 502 });
  }
}
