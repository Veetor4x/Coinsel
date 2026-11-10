/**
 * One-time setup for the REAL test swap (Step 2). TESTNET ONLY.
 * Registers the DAO on the two Tidepool test-token contracts so it can hold test USDC and receive test wNEAR.
 * Needs env: FUNDER_ACCOUNT_ID, FUNDER_PRIVATE_KEY (any testnet account with ~0.01 NEAR), DAO_ACCOUNT_ID.
 * Costs 0.00125 NEAR per token contract (only if not yet registered). It moves no tokens. Safe to run twice.
 * Run with --check to only look (needs just DAO_ACCOUNT_ID).
 */
import { Account, nearToYocto } from "near-api-js";
import demo from "../config/demo-treasury.json";
import { provider } from "./_lib";

const T = demo.tidepool;

async function view(contract: string, method: string, args: Record<string, unknown>): Promise<unknown> {
  const r: any = await provider.callFunction({ contractId: contract, method, args }).catch(() => null);
  return r;
}

async function main() {
  const { FUNDER_ACCOUNT_ID, FUNDER_PRIVATE_KEY, DAO_ACCOUNT_ID } = process.env;
  if (!DAO_ACCOUNT_ID) throw new Error("Set DAO_ACCOUNT_ID.");
  const checkOnly = process.argv.includes("--check");
  if (!checkOnly && (!FUNDER_ACCOUNT_ID || !FUNDER_PRIVATE_KEY)) throw new Error("Set FUNDER_ACCOUNT_ID and FUNDER_PRIVATE_KEY (or use --check).");
  const funder = checkOnly ? null : new Account(FUNDER_ACCOUNT_ID!, provider, FUNDER_PRIVATE_KEY as `ed25519:${string}`);
  for (const [label, contract, dec] of [[T.originLabel, T.originContract, T.originDecimals], [T.destinationLabel, T.destinationContract, T.destinationDecimals]] as const) {
    const reg = await view(contract, "storage_balance_of", { account_id: DAO_ACCOUNT_ID });
    const bal = await view(contract, "ft_balance_of", { account_id: DAO_ACCOUNT_ID });
    const have = bal ? Number(BigInt(String(bal))) / 10 ** dec : 0;
    if (reg) console.log(`= ${label}: already registered (balance ${have})`);
    else if (!funder) console.log(`- ${label}: NOT registered yet (run without --check to fix)`);
    else {
      await funder.callFunction({ contractId: contract, methodName: "storage_deposit", args: { account_id: DAO_ACCOUNT_ID, registration_only: true }, deposit: nearToYocto("0.00125"), gas: 30_000_000_000_000n });
      console.log(`+ ${label}: registered ${DAO_ACCOUNT_ID}`);
    }
  }
}
main().catch((e) => { console.error("FAILED:", e?.message ?? e); process.exit(1); });
