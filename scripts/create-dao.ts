/**
 * Step 2: create the Sputnik DAO v2 on TESTNET via the official factory, with Coinsel's policy:
 *  - proposal_bond = "0"   (function-call keys cannot attach deposits)
 *  - role "council": 3 accounts, may vote/finalize; approval = 2 of 3
 *  - role "agent": the agent account may ONLY add transfer/call/vote proposals (no voting, no policy changes)
 *  - the default "everyone can add proposals" role is REMOVED
 */
import { Account, nearToYocto, teraToGas } from "near-api-js";
import { loadState, saveState, writeEnvFile, accountExists, balanceNear, provider, SPUTNIK_FACTORY } from "./_lib";

const DAO_DEPOSIT_NEAR = process.env.DAO_DEPOSIT_NEAR || "6"; // covers contract storage; rest is treasury balance
const DAY_NS = 86_400_000_000_000n;

export function buildPolicy(councilIds: string[], agentId: string) {
  return {
    roles: [
      {
        name: "council",
        kind: { Group: councilIds },
        permissions: ["*:Finalize", "*:AddProposal", "*:VoteApprove", "*:VoteReject", "*:VoteRemove"],
        vote_policy: {},
      },
      {
        name: "agent",
        kind: { Group: [agentId] },
        // Only these proposal kinds, only the AddProposal action. No voting, no policy/config/member changes.
        permissions: ["transfer:AddProposal", "call:AddProposal", "vote:AddProposal"],
        vote_policy: {},
      },
    ],
    default_vote_policy: { weight_kind: "RoleWeight", quorum: "0", threshold: "2" }, // 2 of 3 council members
    proposal_bond: "0",
    proposal_period: (7n * DAY_NS).toString(),
    bounty_bond: "0",
    bounty_forgiveness_period: DAY_NS.toString(),
  };
}

async function main() {
  const s = loadState();
  if (!s.funder || !s.council?.length || !s.agent) throw new Error("Run `npm run setup:accounts` first.");
  const name = `${s.prefix}-treasury`;
  const daoId = `${name}.${SPUTNIK_FACTORY}`;
  if (s.daoAccountId || (await accountExists(daoId))) {
    s.daoAccountId = daoId; saveState(s); writeEnvFile(s);
    console.log(`DAO already exists: ${daoId}. Next: npm run setup:agent-key`);
    return;
  }
  const bal = await balanceNear(s.funder.accountId);
  if (bal < Number(DAO_DEPOSIT_NEAR) + 0.5) {
    console.log(`Funder has ${bal} NEAR; need about ${Number(DAO_DEPOSIT_NEAR) + 0.5}. Top up ${s.funder.accountId} from the faucet and re-run.`);
    process.exit(2);
  }
  const policy = buildPolicy(s.council.map((c) => c.accountId), s.agent.accountId);
  const daoArgs = { config: { name, purpose: "Coinsel demo treasury (testnet)", metadata: "" }, policy };
  const funder = new Account(s.funder.accountId, provider, s.funder.secretKey as `ed25519:${string}`);
  const res = await funder.callFunction({
    contractId: SPUTNIK_FACTORY,
    methodName: "create",
    args: { name, args: Buffer.from(JSON.stringify(daoArgs)).toString("base64") },
    gas: teraToGas("150"),
    deposit: nearToYocto(DAO_DEPOSIT_NEAR as `${number}`),
  });
  if (res !== true) console.warn("Factory returned:", res, "(verifying on-chain...)");
  if (!(await accountExists(daoId))) throw new Error("DAO account was not created. Check the factory call / funder balance.");
  s.daoAccountId = daoId; saveState(s);
  console.log(`+ DAO created: ${daoId}\n  Explorer: https://testnet.nearblocks.io/address/${daoId}`);
  console.log(`Wrote values to ${writeEnvFile(s)}\nNext: npm run setup:agent-key`);
}
// Only run when executed directly (so tests can import buildPolicy).
if (process.argv[1] && /create-dao\.ts$/.test(process.argv[1])) {
  main().catch((e) => { console.error("FAILED:", e?.message ?? e); process.exit(1); });
}
