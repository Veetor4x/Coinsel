// Setup for the real Step 2 swap: ask the council to register the DAO on the Tidepool USDC and/or wNEAR contracts.
// The agent only files proposals (add_proposal). Each proposal is EXACTLY: storage_deposit for the DAO itself, paid by the DAO.
import { NextResponse } from "next/server";
import demo from "@/config/demo-treasury.json";
import { fileRegisterProposal } from "@/lib/chain-write";
import { getAllProposals, getCouncil } from "@/lib/sputnik";
import { swapReadiness, tidepoolEnabled } from "@/lib/tidepool";
import { buildRegisterDescription } from "@/lib/proposal-text";
import { spendableNear } from "@/lib/treasury";
import { env } from "@/lib/env";

export const maxDuration = 60;
const T = demo.tidepool;

export async function POST() {
  const dao = env("DAO_ACCOUNT_ID");
  if (!dao) return NextResponse.json({ error: "This server isn't connected to a DAO yet." }, { status: 400 });
  if (!tidepoolEnabled()) return NextResponse.json({ error: "The real test swap is switched off on this server." }, { status: 403 });
  try {
    const [ready, council, recent] = await Promise.all([swapReadiness(dao), getCouncil(dao), getAllProposals(dao)]);
    const todo = [
      { contract: T.originContract, label: T.originLabel, why: "can hold it", missing: !ready.usdcRegistered },
      { contract: T.destinationContract, label: T.destinationLabel, why: "can receive it", missing: !ready.wnearRegistered },
    ].filter((x) => x.missing);
    if (!todo.length) return NextResponse.json({ status: "ready", message: "The treasury is already set up.", filed: [] });
    if ((await spendableNear(dao)) < 0.01) return NextResponse.json({ error: "The treasury needs about 0.01 spare test NEAR to pay the one-time fees. Top it up from the NEAR faucet first." }, { status: 409 });
    const filed: { contract: string; label: string; proposalId: number; existing: boolean }[] = [];
    for (const x of todo) {
      // Never file the same setup twice: reuse one that is still waiting for votes.
      const open = recent.find((p) => p.register?.tokenContract === x.contract && p.status === "InProgress" && council.agent.includes(p.proposer));
      if (open) { filed.push({ contract: x.contract, label: x.label, proposalId: open.id, existing: true }); continue; }
      const { proposalId } = await fileRegisterProposal({ dao, tokenContract: x.contract, description: buildRegisterDescription({ tokenContract: x.contract, label: x.label, dao, why: x.why }) });
      filed.push({ contract: x.contract, label: x.label, proposalId, existing: false });
    }
    return NextResponse.json({ status: "filed", filed });
  } catch (e) {
    return NextResponse.json({ error: `Couldn't file the setup suggestions: ${(e as Error).message}` }, { status: 502 });
  }
}
