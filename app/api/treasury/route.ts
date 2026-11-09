import { NextResponse } from "next/server";
import demo from "@/config/demo-treasury.json";
import { NETWORK, explorerAccountUrl } from "@/lib/near";
import { getCouncil, getFtBalance, getNearBalance, getRecentProposals } from "@/lib/sputnik";

export async function GET() {
  const dao = process.env.DAO_ACCOUNT_ID;
  if (!dao) return NextResponse.json({ error: "DAO_ACCOUNT_ID is not set on the server." }, { status: 500 });
  try {
    const [nearBalance, council, proposals, fts] = await Promise.all([
      getNearBalance(dao),
      getCouncil(dao),
      getRecentProposals(dao),
      Promise.all(demo.trackedTokens.map((t) => getFtBalance(dao, t).catch(() => null))),
    ]);
    return NextResponse.json({
      network: NETWORK,
      dao,
      explorerUrl: explorerAccountUrl(dao),
      fetchedAt: new Date().toISOString(),
      onChain: { nearBalance, tokens: fts.filter(Boolean) },
      council,
      proposals,
      demo: {
        note: demo._note,
        demoNearUsdPrice: demo.demoNearUsdPrice,
        obligations: demo.obligations,
        otherChainBalances: demo.otherChainBalances,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: `Could not read the DAO from NEAR ${NETWORK}: ${(e as Error).message}` }, { status: 502 });
  }
}
