/** Read-only check: prints the DAO's live policy (roles, bond, threshold). The policy is SET at creation by create-dao.ts. */
import { loadState, provider } from "./_lib";
async function main() {
  const daoId = process.env.DAO_ACCOUNT_ID || loadState().daoAccountId;
  if (!daoId) throw new Error("No DAO yet. Run setup:dao.");
  const p: any = await provider.callFunction({ contractId: daoId, method: "get_policy", args: {} });
  console.log(`DAO: ${daoId}\nproposal_bond: ${p.proposal_bond}\ndefault_vote_policy: ${JSON.stringify(p.default_vote_policy)}`);
  for (const r of p.roles) console.log(`role ${r.name}: ${JSON.stringify(r.kind)} -> ${r.permissions.join(", ")}`);
}
main().catch((e) => { console.error("FAILED:", e?.message ?? e); process.exit(1); });
