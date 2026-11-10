/**
 * Create the DAO's "payroll account" on NEAR TESTNET (paid for by the FUNDER).
 * Needs env: FUNDER_ACCOUNT_ID, FUNDER_PRIVATE_KEY, DAO_ACCOUNT_ID. The new account's key goes to
 * .secrets/payroll.env (gitignored). Coinsel itself never holds this key; the app only sends money TO it.
 */
import { Account, nearToYocto } from "near-api-js";
import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { accountExists, newKey, mask, provider, balanceNear } from "./_lib";

async function main() {
  const { FUNDER_ACCOUNT_ID, FUNDER_PRIVATE_KEY, DAO_ACCOUNT_ID } = process.env;
  if (!FUNDER_ACCOUNT_ID || !FUNDER_PRIVATE_KEY || !DAO_ACCOUNT_ID) throw new Error("Set FUNDER_ACCOUNT_ID, FUNDER_PRIVATE_KEY and DAO_ACCOUNT_ID.");
  const prefix = DAO_ACCOUNT_ID.split(".")[0].replace(/-treasury$/, "");
  const id = process.env.PAYROLL_ACCOUNT_ID || `${prefix}-payroll.testnet`;
  if (await accountExists(id)) { console.log(`= ${id} already exists (balance ${await balanceNear(id)} NEAR). Nothing to do.`); return; }
  const funder = new Account(FUNDER_ACCOUNT_ID, provider, FUNDER_PRIVATE_KEY as `ed25519:${string}`);
  const k = newKey();
  await funder.createAccount({ newAccountId: id, publicKey: k.publicKey, nearToTransfer: nearToYocto("0.1") });
  mkdirSync(".secrets", { recursive: true });
  writeFileSync(".secrets/payroll.env", `PAYROLL_ACCOUNT_ID=${id}\nPAYROLL_PRIVATE_KEY=${k.secretKey}\n`);
  chmodSync(".secrets/payroll.env", 0o600);
  console.log(`+ created ${id} with 0.1 NEAR (key ${mask(k.secretKey)} saved to .secrets/payroll.env)`);
}
main().catch((e) => { console.error("FAILED:", e?.message ?? e); process.exit(1); });
