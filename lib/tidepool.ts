/* eslint-disable @typescript-eslint/no-explicit-any -- Tidepool JSON is untyped; every field is checked before use */
// Tidepool = a community-run NEAR Intents TESTNET sandbox with a 1Click-compatible API (https://www.usetidepool.tech).
// We use only the plain /v0 quote + status calls. We do NOT use its /v1 agent wallets: the Coinsel agent never spends.
// Everything here runs on the server. Nothing is stored.
import demo from "@/config/demo-treasury.json";
import { env } from "./env";
import { viewFunction } from "./near";

const T = demo.tidepool;
export const TIDEPOOL_LABEL = T.label;
const BASE = () => (env("TIDEPOOL_API_URL") || "https://www.usetidepool.tech").replace(/\/$/, "");
/** Off unless TIDEPOOL_SWAP_ENABLED=true, so the live site keeps working exactly as before until it is switched on. */
export const tidepoolEnabled = () => env("TIDEPOOL_SWAP_ENABLED")?.toLowerCase() === "true";

const num = (s: unknown, decimals: number) => Number(BigInt(String(s).split(".")[0])) / 10 ** decimals;
export const toBase = (usdc: number) => BigInt(Math.round(usdc * 10 ** T.originDecimals)).toString();

const headers = () => ({ "content-type": "application/json", ...(env("TIDEPOOL_API_KEY") ? { "x-api-key": env("TIDEPOOL_API_KEY")! } : {}) });

export type TidepoolQuote = {
  amountInBase: string; amountInUsdc: number; amountOutWnear: number; minAmountOutWnear: number; amountOutUsd: number;
  timeEstimateSec: number; quotedAt: string; signature: string;
  /** Only on a real (non-dry) quote. */
  depositAddress?: string; deadline?: string;
};

/** Turn Tidepool's answer into our shape and make sure it is the swap we asked for (pure, tested). */
export function readQuote(j: any, want: { dao: string; amountBase: string; live: boolean }): TidepoolQuote {
  const q = j?.quote, r = j?.quoteRequest;
  if (!q || !r) throw new Error("Tidepool sent an answer we don't understand.");
  if (String(q.amountIn) !== want.amountBase || r.originAsset !== T.originAsset || r.destinationAsset !== T.destinationAsset) throw new Error("Tidepool quoted a different swap than we asked for.");
  if (r.recipient !== want.dao || r.refundTo !== want.dao) throw new Error("Tidepool quote doesn't pay back to the treasury.");
  const out: TidepoolQuote = {
    amountInBase: String(q.amountIn), amountInUsdc: num(q.amountIn, T.originDecimals), amountOutWnear: num(q.amountOut, T.destinationDecimals),
    minAmountOutWnear: num(q.minAmountOut, T.destinationDecimals), amountOutUsd: Number(q.amountOutUsd) || 0, timeEstimateSec: Number(q.timeEstimate) || 0,
    quotedAt: String(j.timestamp ?? new Date().toISOString()), signature: String(j.signature ?? ""),
  };
  if (want.live) {
    if (!/^[0-9a-f]{64}$/.test(String(q.depositAddress)) || !q.deadline || !Number.isFinite(Date.parse(q.deadline))) throw new Error("Tidepool didn't give a usable deposit address.");
    out.depositAddress = String(q.depositAddress); out.deadline = String(q.deadline);
  }
  return out;
}

/** Ask Tidepool for a quote. dry = price only (nothing reserved); live = a deposit address that is valid until the deadline. */
export async function requestQuote(a: { dao: string; usdc: number; live: boolean }): Promise<TidepoolQuote> {
  const amountBase = toBase(a.usdc);
  const res = await fetch(`${BASE()}/v0/quote`, {
    method: "POST", headers: headers(), cache: "no-store", signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      dry: !a.live, swapType: "EXACT_INPUT", slippageTolerance: 100,
      originAsset: T.originAsset, depositType: "ORIGIN_CHAIN",
      destinationAsset: T.destinationAsset, amount: amountBase,
      // Output AND any refund go to the DAO (the main reserve). Never anywhere else.
      recipient: a.dao, recipientType: "DESTINATION_CHAIN", refundTo: a.dao, refundType: "ORIGIN_CHAIN",
      deadline: new Date(Date.now() + T.quoteMinutes * 60_000).toISOString(),
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.message || `Tidepool answered ${res.status}`);
  return readQuote(j, { dao: a.dao, amountBase, live: a.live });
}

/** A live quote that still has at least minQuoteMinutesLeft minutes left. Re-quotes once if Tidepool gives us a short one. */
export async function freshLiveQuote(dao: string, usdc: number, now = () => Date.now()): Promise<TidepoolQuote> {
  let last: TidepoolQuote | null = null;
  for (let i = 0; i < 2; i++) {
    last = await requestQuote({ dao, usdc, live: true });
    if (quoteMinutesLeft(last.deadline, now()) >= T.minQuoteMinutesLeft) return last;
  }
  throw new Error("Tidepool's quotes expire too quickly right now. Try again in a minute.");
}

export const quoteMinutesLeft = (deadline: string | undefined, now: number) => (deadline ? (Date.parse(deadline) - now) / 60_000 : -1);

export type TidepoolStatus = {
  status: string; deadline?: string; note?: string; refundReason?: string;
  nearTxHashes: string[]; refundedAmountUsdc?: number; amountOutWnear?: number;
  /** What the swap was set up as — used to double-check it pays back to the DAO. */
  request: { recipient?: string; refundTo?: string; originAsset?: string; destinationAsset?: string; amountIn?: string };
};

export function readStatus(j: any): TidepoolStatus {
  const r = j?.quoteResponse?.quoteRequest ?? {}, q = j?.quoteResponse?.quote ?? {}, d = j?.swapDetails ?? {};
  return {
    status: String(j?.status ?? "UNKNOWN"), deadline: q.deadline ? String(q.deadline) : undefined,
    note: j?.tidepool?.note ? String(j.tidepool.note).slice(0, 200) : undefined, refundReason: d.refundReason ? String(d.refundReason) : undefined,
    nearTxHashes: Array.isArray(d.nearTxHashes) ? d.nearTxHashes.map(String).filter((h: string) => /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(h)).slice(0, 6) : [],
    refundedAmountUsdc: d.refundedAmount ? num(d.refundedAmount, T.originDecimals) : undefined,
    amountOutWnear: d.amountOut ? num(d.amountOut, T.destinationDecimals) : undefined,
    request: { recipient: r.recipient, refundTo: r.refundTo, originAsset: r.originAsset, destinationAsset: r.destinationAsset, amountIn: q.amountIn },
  };
}

export async function getSwapStatus(depositAddress: string): Promise<TidepoolStatus> {
  const res = await fetch(`${BASE()}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(15000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.message || `Tidepool answered ${res.status}`);
  return readStatus(j);
}

// ---- What the DAO holds, and whether it is set up to receive the swap ----
export type SwapReadiness = { daoUsdc: number; daoWnear: number; usdcRegistered: boolean; wnearRegistered: boolean; missing: string[] };

export async function swapReadiness(dao: string): Promise<SwapReadiness> {
  const reg = (c: string) => viewFunction<unknown>(c, "storage_balance_of", { account_id: dao }).then((r) => r !== null).catch(() => false);
  const bal = (c: string, dec: number) => viewFunction<string>(c, "ft_balance_of", { account_id: dao }).then((r) => Number(BigInt(r)) / 10 ** dec).catch(() => 0);
  const [usdcRegistered, wnearRegistered, daoUsdc, daoWnear] = await Promise.all([
    reg(T.originContract), reg(T.destinationContract), bal(T.originContract, T.originDecimals), bal(T.destinationContract, T.destinationDecimals),
  ]);
  return { daoUsdc, daoWnear, usdcRegistered, wnearRegistered, missing: missingSetup({ daoUsdc, usdcRegistered, wnearRegistered }) };
}

/** Plain-English list of what is still missing before the swap can be filed (pure, tested). */
export function missingSetup(a: { daoUsdc: number; usdcRegistered: boolean; wnearRegistered: boolean }, needUsdc = T.swapUsdc): string[] {
  const m: string[] = [];
  if (!a.wnearRegistered) m.push(`The treasury isn't registered to receive ${T.destinationLabel} yet (one-time setup, see the README).`);
  if (!a.usdcRegistered || a.daoUsdc < needUsdc) m.push(`The treasury needs ${needUsdc} ${T.originLabel} (it has ${a.daoUsdc}). Claim them from the Tidepool faucet and send them to the treasury (see the README).`);
  return m;
}

// ---- Status the council and the viewer see: Quoted → Filed → Approved → Swapping → Done / Refunded / Failed ----
export type SwapPhase = "filed" | "approved" | "swapping" | "done" | "refunded" | "failed" | "expired" | "rejected";
export const PHASE_LABEL: Record<SwapPhase, string> = {
  filed: "Filed — waiting for the council", approved: "Approved — sending the test USDC", swapping: "Swapping", done: "Done",
  refunded: "Refunded — the test USDC came back to the treasury", failed: "Failed — nothing was swapped", expired: "Quote expired before the council approved", rejected: "Not approved — nothing moved",
};

/** Combine the DAO proposal status with Tidepool's status (pure, tested). */
export function swapPhase(a: { proposal: string; tidepool?: string; deadline?: string; now: number }): SwapPhase {
  const t = a.tidepool;
  if (t === "SUCCESS") return "done";
  if (t === "REFUNDED") return "refunded";
  const expired = !!a.deadline && Date.parse(a.deadline) < a.now;
  if (a.proposal === "InProgress") return expired || t === "FAILED" ? "expired" : "filed";
  if (a.proposal === "Approved") {
    if (t === "FAILED") return "failed";
    if (t === "PROCESSING" || t === "KNOWN_DEPOSIT_TX" || t === "INCOMPLETE_DEPOSIT") return "swapping";
    return expired && t === "PENDING_DEPOSIT" ? "failed" : "approved";
  }
  if (a.proposal === "Rejected" || a.proposal === "Removed" || a.proposal === "Expired") return "rejected";
  return "failed"; // e.g. "Failed" (the DAO couldn't run it) or "Moved"
}
