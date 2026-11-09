/**
 * Step 1: create 3 council accounts + 1 agent account on NEAR TESTNET.
 *
 * Needs ONE funded "funder" account. The script generates a fresh testnet key for it and prints its
 * address; you fund that address from the faucet (https://near-faucet.io or the form on
 * https://docs.near.org/getting-started/faucet) and re-run. Testnet only. Keys go to .secrets/ (gitignored).
 */
import { Account, KeyPair, keyToImplicitAddress, nearToYocto } from "near-api-js";
import { loadState, saveState, writeEnvFile, newKey, mask, accountExists, balanceNear, provider } from "./_lib";

const NEEDED_NEAR = 10; // 3x0.5 council + 1.5 agent + ~6 DAO (next step) + gas
const COUNCIL_NEAR = "0.5";
const AGENT_NEAR = "1.5";

async function main() {
  const s = loadState();
  if (!s.funder) {
    const k = newKey();
    s.funder = { accountId: keyToImplicitAddress(KeyPair.fromString(k.secretKey as `ed25519:${string}`).getPublicKey()), secretKey: k.secretKey };
    saveState(s);
    console.log("Generated a new TESTNET funder key (saved to .secrets/state.json, secret not shown):", mask(k.secretKey));
  }
  const bal = await balanceNear(s.funder.accountId);
  console.log(`\nFunder account : ${s.funder.accountId}\nBalance        : ${bal} NEAR (need >= ${NEEDED_NEAR})`);
  if (bal < NEEDED_NEAR) {
    console.log(`
>>> ACTION NEEDED: fund the funder address above with >= ${NEEDED_NEAR} testnet NEAR, then re-run this script.
    1. Open https://near-faucet.io  (or the form on https://docs.near.org/getting-started/faucet)
    2. Paste the funder address above, choose NEAR, click request. Repeat (or use the other faucet) until balance >= ${NEEDED_NEAR}.
    3. Re-run:  npm run setup:accounts`);
    process.exit(2);
  }

  const funder = new Account(s.funder.accountId, provider, s.funder.secretKey as `ed25519:${string}`);
  s.council ??= [];
  for (let i = 0; i < 3; i++) {
    const id = `${s.prefix}-council${i + 1}.testnet`;
    if (s.council[i]) { console.log(`= ${id} already in state`); continue; }
    if (await accountExists(id)) throw new Error(`${id} exists on-chain but its key is not in .secrets/state.json. Delete .secrets/ and pick a new COINSEL_PREFIX.`);
    const k = newKey();
    await funder.createAccount({ newAccountId: id, publicKey: k.publicKey, nearToTransfer: nearToYocto(COUNCIL_NEAR as `${number}`) });
    s.council[i] = { accountId: id, secretKey: k.secretKey };
    saveState(s);
    console.log(`+ created ${id}  key ${mask(k.secretKey)}`);
  }

  const agentId = `${s.prefix}-agent.testnet`;
  if (!s.agent) {
    if (await accountExists(agentId)) throw new Error(`${agentId} exists on-chain but is not in state. Delete .secrets/ and pick a new COINSEL_PREFIX.`);
    const k = newKey(); // TEMPORARY full-access key; add-agent-key.ts deletes it.
    await funder.createAccount({ newAccountId: agentId, publicKey: k.publicKey, nearToTransfer: nearToYocto(AGENT_NEAR as `${number}`) });
    s.agent = { accountId: agentId, fullAccessSecretKey: k.secretKey };
    saveState(s);
    console.log(`+ created ${agentId} (temporary setup key ${mask(k.secretKey)}; removed in add-agent-key step)`);
  }
  const f = writeEnvFile(s);
  console.log(`\nDone. Council: ${s.council.map((c) => c.accountId).join(", ")}\nAgent: ${s.agent.accountId}\nValues file (open it, don't paste in chat): ${f}\nNext: npm run setup:dao`);
}
main().catch((e) => { console.error("FAILED:", e?.message ?? e); process.exit(1); });
