// Minimal read-only NEAR RPC helpers (no keys needed). Testnet only.
export const NETWORK = process.env.NEAR_NETWORK || "testnet";
export const RPC_URL = process.env.NEAR_RPC_URL || "https://rpc.testnet.fastnear.com";
export const EXPLORER = "https://testnet.nearblocks.io";
export const explorerAccountUrl = (id: string) => `${EXPLORER}/address/${id}`;

const YOCTO = 10n ** 24n;

/** yoctoNEAR string -> NEAR number (display precision is enough; math on bigint stays exact elsewhere). */
export function yoctoToNear(y: string | bigint): number {
  const v = BigInt(y);
  return Number(v / (YOCTO / 10000n)) / 10000;
}

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "coinsel", method, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error.data || j.error.message || "RPC error");
  const r = j.result;
  if (r?.error) throw new Error(r.error);
  return r as T;
}

export async function viewAccount(accountId: string): Promise<{ amount: string; locked: string; storage_usage: number }> {
  return rpc("query", { request_type: "view_account", finality: "final", account_id: accountId });
}

export async function viewFunction<T>(contractId: string, method: string, args: object = {}): Promise<T> {
  const r = await rpc<{ result: number[] }>("query", {
    request_type: "call_function",
    finality: "final",
    account_id: contractId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(r.result).toString("utf8")) as T;
}
