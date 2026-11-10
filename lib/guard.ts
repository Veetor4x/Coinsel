// Safety guard. Money may only move to accounts the DAO owns (listed in config/demo-treasury.json).
// Obligation notes and AI text are UNTRUSTED: we scan them and refuse anything that points outside.
import demo from "@/config/demo-treasury.json";
import { env } from "./env";
import type { ParsedRegister, ParsedSwap } from "./swap-proposal";

const NEAR_ID = /\b(?:[a-z0-9]+(?:[-_][a-z0-9]+)*\.)+(?:testnet|near)\b/gi;
const IMPLICIT = /\b[0-9a-f]{64}\b/gi;
const EVM = /\b0x[0-9a-fA-F]{40}\b/g;

export const BLOCKED_MESSAGE =
  "Blocked: that address isn't yours. And Coinsel can't send money anyway — it can only suggest.";

/** The DAO-owned accounts: config list, plus the DAO from the environment. */
export function ownedAccounts(extra: (string | undefined)[] = [env("DAO_ACCOUNT_ID")]): string[] {
  const all = [...demo.daoOwnedAccounts, ...extra.filter((x): x is string => !!x)];
  return [...new Set(all.map((a) => a.toLowerCase()))];
}

export function isDaoOwned(account: string, owned: string[] = ownedAccounts()): boolean {
  return owned.includes(String(account).trim().toLowerCase());
}

/** Every account / wallet address mentioned in a piece of text. */
export function findAddresses(text: string): string[] {
  const hits = [...(text.match(NEAR_ID) ?? []), ...(text.match(IMPLICIT) ?? []), ...(text.match(EVM) ?? [])];
  return [...new Set(hits.map((h) => h.toLowerCase()))];
}

export type GuardResult = { ok: true } | { ok: false; message: string; outside: string[] };

/** Check a note (or any untrusted text): it may not point at an address the DAO doesn't own. */
export function checkText(text: string, owned: string[] = ownedAccounts()): GuardResult {
  const outside = findAddresses(text).filter((a) => !isDaoOwned(a, owned));
  return outside.length ? { ok: false, message: BLOCKED_MESSAGE, outside } : { ok: true };
}

/** Check a payment destination before a proposal is filed. */
export function checkDestination(receiver: string, owned: string[] = ownedAccounts()): GuardResult {
  return isDaoOwned(receiver, owned) ? { ok: true } : { ok: false, message: BLOCKED_MESSAGE, outside: [String(receiver)] };
}

/** Check all obligation notes. Returns the first problem, naming the payout it came from. */
export function checkObligations(obs: { label: string; note?: string }[], owned: string[] = ownedAccounts()): GuardResult & { label?: string } {
  for (const o of obs) {
    const r = checkText(`${o.note ?? ""}`, owned);
    if (!r.ok) return { ...r, label: o.label };
  }
  return { ok: true };
}

export const SWAP_BLOCKED_MESSAGE =
  "Blocked: this swap doesn't pay back to the treasury, so Coinsel won't touch it. And Coinsel can't send money anyway — it can only suggest.";

/**
 * Step 2 sends test USDC to a Tidepool deposit address (not a DAO-owned account). That is only allowed when
 * the swap behind that address is exactly what Coinsel asked for: right token, small amount, and BOTH the
 * swap output and any refund go to the DAO. `swap` comes from the proposal; `status` comes from Tidepool.
 */
export function checkSwapDeposit(
  a: { swap: ParsedSwap; dao: string; maxBase: bigint; originContract: string; originAsset: string; destinationAsset: string },
  status: { request: { recipient?: string; refundTo?: string; originAsset?: string; destinationAsset?: string; amountIn?: string } },
): GuardResult {
  const r = status.request;
  const fail = (what: string): GuardResult => ({ ok: false, message: SWAP_BLOCKED_MESSAGE, outside: [what] });
  if (a.swap.tokenContract !== a.originContract) return fail(a.swap.tokenContract);
  if (!/^[1-9][0-9]*$/.test(a.swap.amountBase) || BigInt(a.swap.amountBase) > a.maxBase) return fail("amount too large");
  if (r.originAsset !== a.originAsset || r.destinationAsset !== a.destinationAsset || r.amountIn !== a.swap.amountBase) return fail("different swap");
  if (!r.recipient || !isDaoOwned(r.recipient, [a.dao.toLowerCase()]) || !r.refundTo || !isDaoOwned(r.refundTo, [a.dao.toLowerCase()])) return fail(String(r.recipient ?? r.refundTo ?? "unknown"));
  return { ok: true };
}

/** A setup proposal may only register the DAO ITSELF on one of the two Tidepool token contracts (shape is checked by parseRegisterKind). */
export function checkRegistration(reg: ParsedRegister, dao: string, allowedContracts: string[]): GuardResult {
  if (!allowedContracts.includes(reg.tokenContract) || reg.accountId.toLowerCase() !== dao.toLowerCase()) return { ok: false, message: SWAP_BLOCKED_MESSAGE, outside: [reg.accountId] };
  return { ok: true };
}
