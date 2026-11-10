// Loads everything the app shows about the treasury. Server-side only (reads the chain over RPC).
import demo from "@/config/demo-treasury.json";
import { NETWORK, explorerAccountUrl, viewAccount, yoctoToNear } from "./near";
import { demoCouncil } from "./chain-write";
import { getCouncil, getFtBalance, getNearBalance, getRecentProposals } from "./sputnik";
import { startingPayrollNear } from "./demo-reset";

/** A small cushion the main account keeps on top of its storage. */
export const RESERVE_CUSHION_NEAR = 0.05;

export async function loadTreasury() {
  const dao = process.env.DAO_ACCOUNT_ID;
  if (!dao) throw new Error("DAO_ACCOUNT_ID is not set on the server.");
  const payroll = demo.payrollAccountId;
  const [daoAccount, payrollBalance, council, proposals, fts] = await Promise.all([
    viewAccount(dao),
    getNearBalance(payroll).catch(() => 0),
    getCouncil(dao),
    getRecentProposals(dao, 8),
    Promise.all(demo.trackedTokens.map((t) => getFtBalance(dao, t).catch(() => null))),
  ]);
  const nearBalance = yoctoToNear(daoAccount.amount);
  const spendable = Math.max(0, nearBalance - (daoAccount.storage_usage * 1e19) / 1e24 - RESERVE_CUSHION_NEAR);
  return {
    network: NETWORK,
    dao,
    explorerUrl: explorerAccountUrl(dao),
    payroll: { accountId: payroll, explorerUrl: explorerAccountUrl(payroll), nearBalance: payrollBalance },
    fetchedAt: new Date().toISOString(),
    reserve: { spendableNear: Math.round(spendable * 10000) / 10000 },
    onChain: { nearBalance, tokens: fts.filter((x): x is NonNullable<typeof x> => !!x) },
    council,
    proposals,
    demoMode: process.env.DEMO_MODE === "true",
    // Public account ids only (never keys): which demo button signs as which council account.
    demoCouncil: process.env.DEMO_MODE === "true" ? demoCouncil().map((m) => ({ index: m.index, accountId: m.accountId })) : [],
    demo: {
      note: demo._note,
      demoNearUsdPrice: demo.demoNearUsdPrice,
      startingGapNear: demo.startingGapNear,
      startingPayrollNear: startingPayrollNear(),
      obligations: demo.obligations,
      otherChainBalances: demo.otherChainBalances,
    },
  };
}
export type Treasury = Awaited<ReturnType<typeof loadTreasury>>;

/** NEAR the DAO can safely move right now: balance minus the storage it must keep, minus a small cushion. */
export async function spendableNear(account: string, cushion = RESERVE_CUSHION_NEAR): Promise<number> {
  const a = await viewAccount(account);
  const storageNear = (a.storage_usage * 1e19) / 1e24;
  return Math.max(0, yoctoToNear(a.amount) - storageNear - cushion);
}
