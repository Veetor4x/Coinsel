/**
 * Step 3: give the agent account its ONLY key: a function-call key restricted to
 * receiver = the DAO, method = add_proposal. Then DELETE the temporary full-access key,
 * so the agent can never transfer funds or change itself. Then verify.
 */
import { Account, nearToYocto } from "near-api-js";
import { loadState, saveState, writeEnvFile, newKey, mask, provider } from "./_lib";

async function main() {
  const s = loadState();
  if (!s.agent || !s.daoAccountId) throw new Error("Run setup:accounts and setup:dao first.");
  const { agent, daoAccountId } = s;

  // Safety: confirm the DAO's policy gives the agent AddProposal only and bond is 0.
  const policy: any = await provider.callFunction({ contractId: daoAccountId, method: "get_policy", args: {} });
  const role = policy.roles.find((r: any) => r.kind?.Group?.includes(agent.accountId));
  if (!role || policy.proposal_bond !== "0") throw new Error("DAO policy does not match Coinsel expectations. Aborting.");
  console.log("DAO policy OK. Agent role permissions:", role.permissions.join(", "));

  if (!agent.functionCallSecretKey) {
    if (!agent.fullAccessSecretKey) throw new Error("No setup key left in state; cannot add the function-call key.");
    const acct = new Account(agent.accountId, provider, agent.fullAccessSecretKey as `ed25519:${string}`);
    const fc = newKey();
    await acct.addFunctionCallAccessKey({
      publicKey: fc.publicKey,
      contractId: daoAccountId,
      methodNames: ["add_proposal"],
      allowance: nearToYocto("0.25"), // gas budget for the key; refill by re-running with a new key if it runs low
    });
    agent.functionCallSecretKey = fc.secretKey;
    saveState(s);
    console.log(`+ added function-call key ${mask(fc.secretKey)} (receiver ${daoAccountId}, method add_proposal)`);
  }
  if (agent.fullAccessSecretKey) {
    const acct = new Account(agent.accountId, provider, agent.fullAccessSecretKey as `ed25519:${string}`);
    const { KeyPair } = await import("near-api-js");
    const pub = KeyPair.fromString(agent.fullAccessSecretKey as `ed25519:${string}`).getPublicKey().toString();
    await acct.deleteKey(pub);
    delete agent.fullAccessSecretKey;
    saveState(s);
    console.log("+ deleted the temporary full-access key");
  }

  // Verify on-chain: exactly one key, and it is a restricted function-call key.
  const keys = await provider.viewAccessKeyList({ accountId: agent.accountId });
  const perms = keys.keys.map((k: any) => k.access_key.permission);
  const ok = perms.length === 1 && typeof perms[0] === "object" && perms[0].FunctionCall?.receiver_id === daoAccountId &&
    JSON.stringify(perms[0].FunctionCall.method_names) === JSON.stringify(["add_proposal"]);
  console.log(ok ? "VERIFIED: agent has exactly 1 key, function-call, add_proposal on the DAO only." : "WARNING: agent keys not as expected:\n" + JSON.stringify(perms, null, 2));
  console.log(`Wrote values to ${writeEnvFile(s)}`);
  if (!ok) process.exit(1);
}
main().catch((e) => { console.error("FAILED:", e?.message ?? e); process.exit(1); });
