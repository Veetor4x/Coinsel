// DEMO MODE ONLY: the demo server signs a council vote with a testnet council key.
// In real use each council member signs with their own wallet.
import { NextResponse } from "next/server";
import { checkDestination, checkRegistration, checkSwapDeposit } from "@/lib/guard";
import { getProposal, getCouncil } from "@/lib/sputnik";
import { approveAsCouncil, demoCouncil, settledProposal } from "@/lib/chain-write";
import { env, isDemoMode } from "@/lib/env";
import demo from "@/config/demo-treasury.json";
import { getSwapStatus, quoteMinutesLeft, tidepoolEnabled, toBase } from "@/lib/tidepool";
import { SWAP_VOTE_TGAS } from "@/lib/swap-proposal";
import { readJson } from "@/lib/validate";
import { parseObligations } from "@/lib/obligations";
import { loadTreasury } from "@/lib/treasury";
import { analyze } from "@/lib/engine";
import { gapNear, toEngineInputs } from "@/lib/engine-inputs";
import { payoutFingerprint } from "@/lib/fingerprint";
import { checkTransferApproval, isPayrollReceiver } from "@/lib/safety";
import { getNearBalance } from "@/lib/sputnik";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isDemoMode()) return NextResponse.json({ error: "Demo voting is switched off on this server." }, { status: 403 });
  const dao = env("DAO_ACCOUNT_ID");
  const b = (await readJson(req)) as { proposalId?: unknown; member?: unknown; obligations?: unknown } | null;
  const id = Number(b?.proposalId), n = Number(b?.member);
  if (!dao || !Number.isInteger(id) || id < 0 || ![1, 2, 3].includes(n)) return NextResponse.json({ error: "Pick a suggestion and a council member (1, 2 or 3)." }, { status: 400 });
  const member = demoCouncil().find((m) => m.index === n);
  if (!member) return NextResponse.json({ error: `Demo council member ${n} isn't set up on this server.` }, { status: 500 });

  try {
    const p = await getProposal(dao, id);
    // Even in demo mode, only two kinds of suggestion can be approved here:
    //  - plain NEAR transfers to the DAO's own accounts, or
    //  - a Coinsel Step 2 swap whose Tidepool quote pays back to the DAO (checked below, with a quote that has not expired).
    const council = await getCouncil(dao);
    const isSwap = !!p.swap && p.kind === "FunctionCall" && tidepoolEnabled() && council.agent.includes(p.proposer);
    // Setup: registering the DAO itself on one of the two Tidepool token contracts (exact shape only).
    const isRegister = !!p.register && p.kind === "FunctionCall" && tidepoolEnabled() && council.agent.includes(p.proposer)
      && checkRegistration(p.register, dao, [demo.tidepool.originContract, demo.tidepool.destinationContract]).ok;
    // Step 1 top-ups may only go to the DAO-owned payroll account (not "any owned account").
    const isOwnTransfer = p.kind === "Transfer" && isPayrollReceiver(p.receiver) && checkDestination(p.receiver!).ok;
    if (!isSwap && !isRegister && !isOwnTransfer) return NextResponse.json({ error: "Demo voting only approves transfers to the DAO's own accounts, Coinsel's own test swap, or its one-time setup." }, { status: 403 });
    if (isSwap && p.status === "InProgress") {
      const T = demo.tidepool;
      const st = await getSwapStatus(p.swap!.depositAddress).catch(() => null);
      if (!st) return NextResponse.json({ error: "Couldn't check the test swap service, so this vote was not signed. Try again in a moment." }, { status: 502 });
      const g = checkSwapDeposit({ swap: p.swap!, dao, maxBase: BigInt(toBase(T.maxUsdc)), originContract: T.originContract, originAsset: T.originAsset, destinationAsset: T.destinationAsset }, st);
      if (!g.ok) return NextResponse.json({ error: g.message }, { status: 403 });
      if (st.status !== "PENDING_DEPOSIT" || quoteMinutesLeft(st.deadline, Date.now()) < 1) {
        return NextResponse.json({ error: "This swap quote has expired, so approving it would swap nothing. File a fresh one (Get advice, then File step 2).", expired: true }, { status: 409 });
      }
    }
    // Step 1: re-check, from the chain and the payout list, that this exact top-up is still right before ANY vote is signed.
    if (isOwnTransfer && p.status === "InProgress") {
      const obs = parseObligations(b?.obligations ?? demo.obligations);
      if (!obs) return NextResponse.json({ error: "Those payouts don't look right. Reload the page and try again." }, { status: 400 });
      const t = await loadTreasury();
      const { balances, obligations } = toEngineInputs(t, obs);
      const gap = gapNear(analyze(balances, obligations), demo.demoNearUsdPrice);
      const ok = checkTransferApproval({ proposal: p, all: t.proposals, gapNear: gap, listFingerprint: payoutFingerprint(obs), now: Date.now(), spendableNear: t.reserve.spendableNear, agents: council.agent });
      if (!ok.ok) return NextResponse.json({ error: ok.message, code: ok.code, duplicateOf: ok.duplicate?.id }, { status: 409 });
    }
    if (p.status !== "InProgress") return NextResponse.json({ error: `This suggestion is already ${p.status}.` }, { status: 409 });
    if (p.voters.includes(member.accountId)) return NextResponse.json({ error: "Council member " + n + " already voted on this one." }, { status: 409 });
    if (!council.members.includes(member.accountId)) return NextResponse.json({ error: "That demo account isn't on the council." }, { status: 403 });

    const payrollBefore = isOwnTransfer ? await getNearBalance(demo.payrollAccountId).catch(() => null) : null;
    const { txHash } = await approveAsCouncil(dao, id, member, isSwap || isRegister ? SWAP_VOTE_TGAS : undefined);
    const after = await settledProposal(dao, id);
    // Wait (a few seconds) until the payroll balance shows the money, so the next gap check can't read a stale balance.
    if (after.status === "Approved" && isOwnTransfer && payrollBefore !== null && p.amountNear) {
      for (let i = 0; i < 6; i++) {
        if ((await getNearBalance(demo.payrollAccountId).catch(() => 0)) >= payrollBefore + p.amountNear / 2) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    return NextResponse.json({ status: after.status, approvals: after.approvals, member: n, txHash, txUrl: `https://testnet.nearblocks.io/txns/${txHash}`, executed: after.status === "Approved" });
  } catch (e) {
    return NextResponse.json({ error: `The vote didn't go through: ${(e as Error).message}` }, { status: 502 });
  }
}
