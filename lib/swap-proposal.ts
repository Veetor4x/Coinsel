// Step 2 proposal shape (pure, tested). One Sputnik FunctionCall to the test-USDC contract with exactly two actions:
//   1. storage_deposit  -> registers the swap's one-time deposit address on the token contract (0.00125 NEAR, paid by the DAO)
//   2. ft_transfer      -> sends the test USDC to that deposit address (1 yoctoNEAR, as the token standard requires)
// Nothing else is ever accepted as a "swap proposal": parseSwapKind returns null for any other shape.
import demo from "@/config/demo-treasury.json";

export const STORAGE_DEPOSIT_YOCTO = "1250000000000000000000"; // 0.00125 NEAR
export const FT_DEPOSIT_YOCTO = "1";
export const STORAGE_GAS = "30000000000000"; // 30 Tgas
export const TRANSFER_GAS = "30000000000000";
/** Both actions + the DAO's own bookkeeping need more than the default 100 Tgas used for plain NEAR transfers. */
export const SWAP_VOTE_TGAS = 200n;

export type ParsedSwap = { tokenContract: string; depositAddress: string; amountBase: string };

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64");
const unb64 = (s: unknown): unknown => { try { return JSON.parse(Buffer.from(String(s), "base64").toString("utf8")); } catch { return null; } };
const DEPOSIT_ADDRESS = /^[0-9a-f]{64}$/;
const AMOUNT = /^[1-9][0-9]{0,15}$/;

export function buildSwapKind(a: ParsedSwap) {
  return {
    FunctionCall: {
      receiver_id: a.tokenContract,
      actions: [
        { method_name: "storage_deposit", args: b64({ account_id: a.depositAddress, registration_only: true }), deposit: STORAGE_DEPOSIT_YOCTO, gas: STORAGE_GAS },
        { method_name: "ft_transfer", args: b64({ receiver_id: a.depositAddress, amount: a.amountBase }), deposit: FT_DEPOSIT_YOCTO, gas: TRANSFER_GAS },
      ],
    },
  };
}

/** Strict reader: returns the swap only if the proposal is EXACTLY what buildSwapKind makes. */
export function parseSwapKind(kind: unknown): ParsedSwap | null {
  const fc = (kind as { FunctionCall?: { receiver_id?: unknown; actions?: unknown } } | null)?.FunctionCall;
  if (!fc || fc.receiver_id !== demo.tidepool.originContract || !Array.isArray(fc.actions) || fc.actions.length !== 2) return null;
  const [s, t] = fc.actions as { method_name?: string; args?: string; deposit?: string }[];
  if (s?.method_name !== "storage_deposit" || t?.method_name !== "ft_transfer") return null;
  if (String(s.deposit) !== STORAGE_DEPOSIT_YOCTO || String(t.deposit) !== FT_DEPOSIT_YOCTO) return null;
  const sa = unb64(s.args) as { account_id?: unknown; registration_only?: unknown } | null;
  const ta = unb64(t.args) as { receiver_id?: unknown; amount?: unknown } | null;
  if (!sa || !ta) return null;
  const dep = String(sa.account_id);
  if (!DEPOSIT_ADDRESS.test(dep) || sa.registration_only !== true || ta.receiver_id !== dep || !AMOUNT.test(String(ta.amount))) return null;
  return { tokenContract: fc.receiver_id, depositAddress: dep, amountBase: String(ta.amount) };
}
