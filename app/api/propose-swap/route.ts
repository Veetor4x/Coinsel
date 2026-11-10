// Step 2: file a REAL swap-deposit proposal. The agent still only asks (add_proposal); the council decides.
// Flow: guard -> check treasury holds the test USDC -> fresh live Tidepool quote (re-quoted if it would expire soon)
//       -> check the swap pays back to the DAO -> agent files the proposal. Amount and destination are decided HERE.
import { NextResponse } from "next/server";
import demo from "@/config/demo-treasury.json";
import { checkObligations, checkSwapDeposit, checkText, SWAP_BLOCKED_MESSAGE } from "@/lib/guard";
import { parseObligations } from "@/lib/obligations";
import { fileSwapProposal } from "@/lib/chain-write";
import { getCouncil, getRecentProposals } from "@/lib/sputnik";
import { freshLiveQuote, getSwapStatus, swapReadiness, tidepoolEnabled, toBase, TIDEPOOL_LABEL } from "@/lib/tidepool";
import { buildSwapDescription } from "@/lib/proposal-text";
import { explorerAccountUrl } from "@/lib/near";
import { env } from "@/lib/env";

export const maxDuration = 60;
const HEX = /^[0-9a-f]{64}$/;
const T = demo.tidepool;

export async function POST(req: Request) {
  const dao = env("DAO_ACCOUNT_ID");
  if (!tidepoolEnabled()) return NextResponse.json({ error: "The real test swap is switched off on this server." }, { status: 403 });
  const b = await req.json().catch(() => null);
  const obs = parseObligations(b?.obligations ?? []);
  const text = typeof b?.advice?.text === "string" ? b.advice.text.slice(0, 1200) : "";
  if (!dao || !obs || !text || !HEX.test(b?.advice?.responseHash ?? "") || !HEX.test(b?.attestationHash ?? "")) {
    return NextResponse.json({ error: "Run the analysis first, then file the suggestion." }, { status: 400 });
  }
  const bad = [checkObligations(obs), checkText(text)].find((c) => !c.ok);
  if (bad && !bad.ok) return NextResponse.json({ status: "blocked", message: bad.message, outside: bad.outside }, { status: 403 });

  try {
    // One open swap at a time (so the same test USDC can't be promised twice).
    const [council, recent] = await Promise.all([getCouncil(dao), getRecentProposals(dao, 8)]);
    const open = recent.find((p) => p.swap && p.status === "InProgress" && council.agent.includes(p.proposer));
    // An open swap whose quote has already expired can't be approved any more (demo voting refuses it), so it doesn't block a new one.
    const openStatus = open?.swap ? await getSwapStatus(open.swap.depositAddress).catch(() => null) : null;
    const openExpired = !!openStatus && (openStatus.status === "FAILED" || (!!openStatus.deadline && Date.parse(openStatus.deadline) < Date.now()));
    if (open && !openExpired) return NextResponse.json({ error: `Swap suggestion #${open.id} is still waiting for the council. Vote on it first (or reset the demo).`, proposalId: open.id }, { status: 409 });

    const ready = await swapReadiness(dao);
    if (ready.missing.length) return NextResponse.json({ error: ready.missing[0], missing: ready.missing, readiness: ready }, { status: 409 });

    // Fresh live quote now (never a stale one). freshLiveQuote re-quotes once if it would expire too soon.
    const quote = await freshLiveQuote(dao, T.swapUsdc);
    const amountBase = toBase(T.swapUsdc);
    const swap = { tokenContract: T.originContract, depositAddress: quote.depositAddress!, amountBase };
    // Last safety check, using what Tidepool itself says about this deposit address.
    const status = await getSwapStatus(swap.depositAddress);
    const g = checkSwapDeposit({ swap, dao, maxBase: BigInt(toBase(T.maxUsdc)), originContract: T.originContract, originAsset: T.originAsset, destinationAsset: T.destinationAsset }, status);
    if (!g.ok) return NextResponse.json({ status: "blocked", message: g.message, outside: g.outside }, { status: 403 });

    const description = buildSwapDescription({ advice: text, quote, dao, model: String(b.advice.model ?? "").slice(0, 80), responseHash: b.advice.responseHash, attestationHash: b.attestationHash });
    const { proposalId, txHash } = await fileSwapProposal({ dao, swap, description });
    return NextResponse.json({
      status: "filed", proposalId, label: TIDEPOOL_LABEL, quote, txHash,
      txUrl: `https://testnet.nearblocks.io/txns/${txHash}`, daoUrl: explorerAccountUrl(dao),
    });
  } catch (e) {
    const m = (e as Error).message;
    return NextResponse.json({ error: `Couldn't file the swap suggestion: ${m || SWAP_BLOCKED_MESSAGE}` }, { status: 502 });
  }
}
