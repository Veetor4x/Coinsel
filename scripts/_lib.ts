// Shared helpers for the testnet setup scripts. TESTNET ONLY.
import { JsonRpcProvider, KeyPairEd25519, yoctoToNear, nearToYocto } from "near-api-js";
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";

export const NETWORK = "testnet";
// Official public testnet RPC (checked 2026-11-09). Override with NEAR_RPC_URL.
export const RPC_URL = process.env.NEAR_RPC_URL || "https://rpc.testnet.fastnear.com";
// Sputnik DAO v2 factory on testnet (checked on-chain 2026-11-09: has get_dao_list, 5k+ DAOs).
export const SPUTNIK_FACTORY = "sputnikv2.testnet";

export const provider = new JsonRpcProvider({ url: RPC_URL });

const DIR = join(process.cwd(), ".secrets");
const STATE_FILE = join(DIR, "state.json");
const ENV_FILE = join(DIR, "coinsel-testnet.env");

export type State = {
  prefix: string;
  funder?: { accountId: string; secretKey: string };
  council?: { accountId: string; secretKey: string }[];
  agent?: { accountId: string; fullAccessSecretKey?: string; functionCallSecretKey?: string };
  daoAccountId?: string;
};

export function loadState(): State {
  if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  const prefix = process.env.COINSEL_PREFIX || "coinsel" + Math.random().toString(36).slice(2, 6);
  return { prefix };
}

export function saveState(s: State) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  chmodSync(STATE_FILE, 0o600);
}

/** Write NAME=value lines (full secrets) to a gitignored file. Never printed to the terminal. */
export function writeEnvFile(s: State) {
  const lines = [
    "# Coinsel testnet values. PASTE INTO your cloud environment / Vercel env vars. NEVER COMMIT.",
    `NEAR_NETWORK=${NETWORK}`,
    `NEAR_RPC_URL=${RPC_URL}`,
    s.daoAccountId ? `DAO_ACCOUNT_ID=${s.daoAccountId}` : "# DAO_ACCOUNT_ID=(run create-dao)",
    s.agent ? `AGENT_ACCOUNT_ID=${s.agent.accountId}` : "# AGENT_ACCOUNT_ID=(run create-accounts)",
    s.agent?.functionCallSecretKey
      ? `AGENT_FUNCTION_CALL_PRIVATE_KEY=${s.agent.functionCallSecretKey}`
      : "# AGENT_FUNCTION_CALL_PRIVATE_KEY=(run add-agent-key)",
    ...(s.council ?? []).flatMap((c, i) => [
      `COUNCIL_${i + 1}_ACCOUNT_ID=${c.accountId}`,
      `COUNCIL_${i + 1}_PRIVATE_KEY=${c.secretKey}`,
    ]),
    "DEMO_MODE=true",
  ];
  mkdirSync(DIR, { recursive: true });
  writeFileSync(ENV_FILE, lines.join("\n") + "\n");
  chmodSync(ENV_FILE, 0o600);
  return ENV_FILE;
}

export function newKey() {
  const kp = KeyPairEd25519.fromRandom();
  return { secretKey: kp.toString(), publicKey: kp.getPublicKey().toString() };
}

/** Show only the start of a secret, e.g. ed25519:3k9f…(hidden). */
export const mask = (k: string) => k.slice(0, 12) + "…(hidden)";

export async function accountExists(id: string): Promise<boolean> {
  try {
    await provider.viewAccount({ accountId: id });
    return true;
  } catch {
    return false;
  }
}

export async function balanceNear(id: string): Promise<number> {
  try {
    const a = await provider.viewAccount({ accountId: id });
    return Number(yoctoToNear(BigInt(a.amount), 4));
  } catch {
    return 0;
  }
}

export { nearToYocto, yoctoToNear };
