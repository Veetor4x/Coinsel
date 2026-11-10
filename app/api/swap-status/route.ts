// Where is the Step 2 swap? Read from the DAO proposal (on-chain) + Tidepool's status. Nothing is stored.
import { NextResponse } from "next/server";
import { getProposal } from "@/lib/sputnik";
import { getSwapStatus, PHASE_LABEL, swapPhase, TIDEPOOL_LABEL, tidepoolEnabled, type TidepoolStatus } from "@/lib/tidepool";
import { EXPLORER } from "@/lib/near";
import { env } from "@/lib/env";

export const maxDuration = 30;

export async function GET(req: Request) {
  const dao = env("DAO_ACCOUNT_ID");
  const id = Number(new URL(req.url).searchParams.get("proposalId"));
  if (!dao || !Number.isInteger(id) || id < 0) return NextResponse.json({ error: "Pick a swap suggestion." }, { status: 400 });
  if (!tidepoolEnabled()) return NextResponse.json({ error: "The real test swap is switched off on this server." }, { status: 403 });
  try {
    const p = await getProposal(dao, id);
    if (!p.swap) return NextResponse.json({ error: "That suggestion isn't a swap." }, { status: 404 });
    let tp: TidepoolStatus | null = null, tidepoolError: string | undefined;
    try { tp = await getSwapStatus(p.swap.depositAddress); } catch (e) { tidepoolError = (e as Error).message; }
    const phase = swapPhase({ proposal: p.status, tidepool: tp?.status, deadline: tp?.deadline, now: Date.now() });
    return NextResponse.json({
      proposalId: id, phase, label: PHASE_LABEL[phase], proposalStatus: p.status, approvals: p.approvals,
      final: ["done", "refunded", "failed", "expired", "rejected"].includes(phase),
      sandbox: TIDEPOOL_LABEL, tidepoolStatus: tp?.status ?? null, tidepoolError, deadline: tp?.deadline ?? null, note: tp?.note ?? null, refundReason: tp?.refundReason ?? null,
      amountInUsdc: Number(BigInt(p.swap.amountBase)) / 1e6, amountOutWnear: tp?.amountOutWnear ?? null, refundedUsdc: tp?.refundedAmountUsdc ?? null,
      depositAddress: p.swap.depositAddress,
      links: { depositAddress: `${EXPLORER}/address/${p.swap.depositAddress}`, txs: (tp?.nearTxHashes ?? []).map((h) => `${EXPLORER}/txns/${h}`) },
    });
  } catch (e) {
    return NextResponse.json({ error: `Couldn't read the swap status: ${(e as Error).message}` }, { status: 502 });
  }
}
