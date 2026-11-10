import { describe, it, expect, vi, afterEach } from "vitest";
import demo from "../config/demo-treasury.json";
import { buildRegisterKind, buildSwapKind, parseRegisterKind, parseSwapKind, STORAGE_DEPOSIT_YOCTO } from "../lib/swap-proposal";
import { checkRegistration, checkSwapDeposit, SWAP_BLOCKED_MESSAGE } from "../lib/guard";
import { freshLiveQuote, missingSetup, quoteMinutesLeft, readQuote, readStatus, requestQuote, swapPhase, tidepoolEnabled, toBase } from "../lib/tidepool";
import { buildDescription, buildRegisterDescription, buildSwapDescription, STEP2_POINTER } from "../lib/proposal-text";

const T = demo.tidepool;
const DAO = "dao.sputnikv2.testnet";
const DEP = "a".repeat(64);
const AMT = toBase(T.swapUsdc);
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const quoteJson = (o: { deadline?: string; recipient?: string; refundTo?: string; amount?: string; dep?: string; dry?: boolean } = {}) => ({
  timestamp: "2026-11-10T12:00:00.000Z", signature: "ed25519:x",
  quoteRequest: { originAsset: T.originAsset, destinationAsset: T.destinationAsset, recipient: o.recipient ?? DAO, refundTo: o.refundTo ?? DAO },
  quote: {
    amountIn: o.amount ?? AMT, amountOut: "2843133778571428525920000", minAmountOut: "2814702440785714240660800", amountOutUsd: "9.95", timeEstimate: 10,
    ...(o.dry ? {} : { depositAddress: o.dep ?? DEP, deadline: o.deadline ?? new Date(Date.now() + 30 * 60_000).toISOString() }),
  },
});

describe("swap proposal shape", () => {
  const swap = { tokenContract: T.originContract, depositAddress: DEP, amountBase: AMT };
  it("round-trips: what we file is exactly what we read back", () => {
    expect(parseSwapKind(buildSwapKind(swap))).toEqual(swap);
  });
  it("is one call to the test-USDC contract: register the address (0.00125 NEAR) then ft_transfer (1 yocto)", () => {
    const fc = buildSwapKind(swap).FunctionCall;
    expect(fc.receiver_id).toBe(T.originContract);
    expect(fc.actions.map((a) => a.method_name)).toEqual(["storage_deposit", "ft_transfer"]);
    expect(fc.actions[0].deposit).toBe(STORAGE_DEPOSIT_YOCTO);
    expect(fc.actions[1].deposit).toBe("1");
  });
  it("refuses any other shape (wrong contract, extra action, other receiver, bad amount, plain transfer)", () => {
    const k = buildSwapKind(swap);
    const clone = () => JSON.parse(JSON.stringify(k));
    const wrongContract = clone(); wrongContract.FunctionCall.receiver_id = "evil.testnet";
    const extra = clone(); extra.FunctionCall.actions.push(extra.FunctionCall.actions[1]);
    const otherReceiver = clone(); otherReceiver.FunctionCall.actions[1].args = Buffer.from(JSON.stringify({ receiver_id: "bob.testnet", amount: AMT })).toString("base64");
    const bigDeposit = clone(); bigDeposit.FunctionCall.actions[1].deposit = "1000000000000000000000000";
    const badAmount = clone(); badAmount.FunctionCall.actions[1].args = Buffer.from(JSON.stringify({ receiver_id: DEP, amount: "-5" })).toString("base64");
    for (const bad of [wrongContract, extra, otherReceiver, bigDeposit, badAmount, { Transfer: { token_id: "", receiver_id: DAO, amount: "1" } }, null, "Vote"]) expect(parseSwapKind(bad)).toBeNull();
  });
});

describe("guard: swap deposit", () => {
  const swap = { tokenContract: T.originContract, depositAddress: DEP, amountBase: AMT };
  const args = { swap, dao: DAO, maxBase: BigInt(toBase(T.maxUsdc)), originContract: T.originContract, originAsset: T.originAsset, destinationAsset: T.destinationAsset };
  const st = (r: object = {}) => ({ request: { recipient: DAO, refundTo: DAO, originAsset: T.originAsset, destinationAsset: T.destinationAsset, amountIn: AMT, ...r } });
  it("allows a swap that pays out AND refunds to the DAO", () => expect(checkSwapDeposit(args, st()).ok).toBe(true));
  it("refuses when the output or the refund goes anywhere else", () => {
    for (const r of [{ recipient: "bob.testnet" }, { refundTo: "bob.testnet" }, { recipient: undefined }, { recipient: DAO + ".evil.testnet" }]) {
      const g = checkSwapDeposit(args, st(r));
      expect(g.ok).toBe(false);
      expect(!g.ok && g.message).toBe(SWAP_BLOCKED_MESSAGE);
    }
  });
  it("refuses a different token, a different pair, a different amount, or too much", () => {
    expect(checkSwapDeposit({ ...args, swap: { ...swap, tokenContract: "other.testnet" } }, st()).ok).toBe(false);
    expect(checkSwapDeposit(args, st({ destinationAsset: "nep141:other" })).ok).toBe(false);
    expect(checkSwapDeposit(args, st({ amountIn: "1" })).ok).toBe(false);
    const big = toBase(T.maxUsdc + 1);
    expect(checkSwapDeposit({ ...args, swap: { ...swap, amountBase: big } }, st({ amountIn: big })).ok).toBe(false);
  });
});

describe("tidepool quotes", () => {
  it("is OFF unless TIDEPOOL_SWAP_ENABLED=true (the live site is unchanged until you switch it on)", () => {
    vi.stubEnv("TIDEPOOL_SWAP_ENABLED", "");
    expect(tidepoolEnabled()).toBe(false);
    vi.stubEnv("TIDEPOOL_SWAP_ENABLED", "true");
    expect(tidepoolEnabled()).toBe(true);
  });
  it("reads a good live quote and a good dry quote", () => {
    const live = readQuote(quoteJson(), { dao: DAO, amountBase: AMT, live: true });
    expect(live.depositAddress).toBe(DEP);
    expect(live.amountInUsdc).toBe(T.swapUsdc);
    expect(live.amountOutWnear).toBeCloseTo(2.8431, 3);
    expect(readQuote(quoteJson({ dry: true }), { dao: DAO, amountBase: AMT, live: false }).depositAddress).toBeUndefined();
  });
  it("rejects a quote that doesn't pay back to the DAO, has another amount, or has a bad deposit address", () => {
    const want = { dao: DAO, amountBase: AMT, live: true };
    expect(() => readQuote(quoteJson({ recipient: "bob.testnet" }), want)).toThrow(/pay back/);
    expect(() => readQuote(quoteJson({ refundTo: "bob.testnet" }), want)).toThrow(/pay back/);
    expect(() => readQuote(quoteJson({ amount: "1" }), want)).toThrow(/different swap/);
    expect(() => readQuote(quoteJson({ dep: "bob.testnet" }), want)).toThrow(/deposit address/);
    expect(() => readQuote(quoteJson({ dry: true }), want)).toThrow(/deposit address/);
  });
  it("asks for a REAL (non-dry) quote with output and refund both to the DAO, and never sends secrets", async () => {
    vi.stubEnv("TIDEPOOL_API_KEY", "k");
    const f = vi.fn().mockImplementation(async () => new Response(JSON.stringify(quoteJson()), { status: 200 }));
    vi.stubGlobal("fetch", f);
    await requestQuote({ dao: DAO, usdc: T.swapUsdc, live: true });
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(f.mock.calls[0][0]).toMatch(/\/v0\/quote$/);
    expect(body).toMatchObject({ dry: false, recipient: DAO, recipientType: "DESTINATION_CHAIN", refundTo: DAO, refundType: "ORIGIN_CHAIN", depositType: "ORIGIN_CHAIN", amount: AMT });
    expect(JSON.stringify(body)).not.toContain('"k"');
    await requestQuote({ dao: DAO, usdc: T.swapUsdc, live: false }).catch(() => {});
  });
  it("sends a DRY request for the preview", async () => {
    const f = vi.fn().mockImplementation(async () => new Response(JSON.stringify(quoteJson({ dry: true })), { status: 200 }));
    vi.stubGlobal("fetch", f);
    await requestQuote({ dao: DAO, usdc: T.swapUsdc, live: false });
    expect(JSON.parse((f.mock.calls[0][1] as RequestInit).body as string).dry).toBe(true);
  });
});

describe("quote expiry", () => {
  it("re-quotes once when the first live quote would expire too soon, and uses the second", async () => {
    const now = Date.now();
    const short = quoteJson({ deadline: new Date(now + 2 * 60_000).toISOString(), dep: "b".repeat(64) });
    const long = quoteJson({ deadline: new Date(now + 30 * 60_000).toISOString(), dep: "c".repeat(64) });
    const f = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(short))).mockResolvedValueOnce(new Response(JSON.stringify(long)));
    vi.stubGlobal("fetch", f);
    const q = await freshLiveQuote(DAO, T.swapUsdc, () => now);
    expect(f).toHaveBeenCalledTimes(2);
    expect(q.depositAddress).toBe("c".repeat(64));
  });
  it("gives up with a clear message if both quotes are too short", async () => {
    const now = Date.now();
    const short = () => new Response(JSON.stringify(quoteJson({ deadline: new Date(now + 60_000).toISOString() })));
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => short()));
    await expect(freshLiveQuote(DAO, T.swapUsdc, () => now)).rejects.toThrow(/expire too quickly/);
  });
  it("counts the minutes left", () => {
    expect(quoteMinutesLeft(new Date(1_000_000 + 5 * 60_000).toISOString(), 1_000_000)).toBe(5);
    expect(quoteMinutesLeft(undefined, 0)).toBeLessThan(0);
  });
});

describe("status: Quoted → Filed → Approved → Swapping → Done / Refunded / Failed", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  const future = "2026-11-10T12:20:00Z", past = "2026-11-10T11:50:00Z";
  const ph = (proposal: string, tidepool?: string, deadline = future) => swapPhase({ proposal, tidepool, deadline, now });
  it("walks the happy path", () => {
    expect(ph("InProgress", "PENDING_DEPOSIT")).toBe("filed");
    expect(ph("Approved", "PENDING_DEPOSIT")).toBe("approved");
    expect(ph("Approved", "KNOWN_DEPOSIT_TX")).toBe("swapping");
    expect(ph("Approved", "PROCESSING")).toBe("swapping");
    expect(ph("Approved", "SUCCESS")).toBe("done");
  });
  it("shows refunds and failures", () => {
    expect(ph("Approved", "REFUNDED")).toBe("refunded");
    expect(ph("Approved", "FAILED")).toBe("failed");
    expect(ph("Failed", undefined)).toBe("failed");
  });
  it("handles an expired quote before approval, and one that was never paid", () => {
    expect(ph("InProgress", "PENDING_DEPOSIT", past)).toBe("expired");
    expect(ph("InProgress", "FAILED", future)).toBe("expired");
    expect(ph("Approved", "PENDING_DEPOSIT", past)).toBe("failed");
  });
  it("a rejected or removed suggestion moves nothing", () => {
    expect(ph("Rejected")).toBe("rejected");
    expect(ph("Removed")).toBe("rejected");
  });
  it("still works if Tidepool can't be reached", () => {
    expect(swapPhase({ proposal: "InProgress", now })).toBe("filed");
    expect(swapPhase({ proposal: "Approved", now })).toBe("approved");
  });
  it("reads Tidepool's status JSON safely (bad hashes are dropped)", () => {
    const s = readStatus({ status: "SUCCESS", swapDetails: { nearTxHashes: ["FF748tdK7Dn75oRUjh6drpuJV9ZeR1uX9K717aZjrP6k", "<script>"], refundReason: "X" }, quoteResponse: { quoteRequest: { recipient: DAO }, quote: { deadline: future } } });
    expect(s.nearTxHashes).toEqual(["FF748tdK7Dn75oRUjh6drpuJV9ZeR1uX9K717aZjrP6k"]);
    expect(s.request.recipient).toBe(DAO);
  });
});

describe("setup hints + text", () => {
  it("says what the treasury is missing, in plain words", () => {
    expect(missingSetup({ daoUsdc: 100, usdcRegistered: true, wnearRegistered: true })).toEqual([]);
    expect(missingSetup({ daoUsdc: 0, usdcRegistered: false, wnearRegistered: false })).toHaveLength(2);
    expect(missingSetup({ daoUsdc: 3, usdcRegistered: true, wnearRegistered: true })[0]).toMatch(/needs 10 test USDC \(it has 3\)/);
  });
  it("the proposal text names the sandbox, the amounts, the deposit address, the refund and the quote deadline", () => {
    const q = readQuote(quoteJson(), { dao: DAO, amountBase: AMT, live: true });
    const d = buildSwapDescription({ advice: "Short on payroll.", quote: q, dao: DAO, model: "m", responseHash: "a".repeat(64), attestationHash: "b".repeat(64) });
    for (const s of [T.label, "10 test USDC", "test wNEAR", DEP, "refunds to " + DAO, "Quote valid until", "no value", "sha256:" + "a".repeat(64), "only suggest"]) expect(d).toContain(s);
    expect(d.split("\n")[1]).toMatch(/^What: /);
  });
  it("Step 1's text only points at the real swap when told to; otherwise it stays 'quote only'", () => {
    const base = { advice: "A.", amountNear: 3, amountUsd: 3000, receiver: "p.testnet", model: "m", responseHash: "a".repeat(64), attestationHash: "b".repeat(64), quote: { ok: false as const, label: "", error: "x" } };
    expect(buildDescription(base)).toContain("quote only");
    const d = buildDescription({ ...base, step2Override: STEP2_POINTER });
    expect(d).toContain(STEP2_POINTER);
    expect(d).not.toContain("quote only");
  });
});

describe("setup: register the DAO on the Tidepool token contracts", () => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
  const clone = (k: object) => JSON.parse(JSON.stringify(k));
  const allowed = [T.originContract, T.destinationContract];
  it("round-trips for both token contracts, and is one storage_deposit for the DAO itself (0.00125 NEAR)", () => {
    for (const c of allowed) {
      const k = buildRegisterKind(c, DAO);
      expect(parseRegisterKind(k)).toEqual({ tokenContract: c, accountId: DAO });
      expect(k.FunctionCall.actions).toHaveLength(1);
      expect(k.FunctionCall.actions[0].method_name).toBe("storage_deposit");
      expect(k.FunctionCall.actions[0].deposit).toBe(STORAGE_DEPOSIT_YOCTO);
    }
  });
  it("refuses anything else: other contract, other method, extra action, extra args, other deposit, swap or transfer shapes", () => {
    const k = buildRegisterKind(T.originContract, DAO);
    const mut = (f: (x: ReturnType<typeof buildRegisterKind>) => void) => { const c = clone(k); f(c); return c; };
    const bad = [
      mut((c) => { c.FunctionCall.receiver_id = "evil.testnet"; }),
      mut((c) => { c.FunctionCall.actions[0].method_name = "ft_transfer"; }),
      mut((c) => { c.FunctionCall.actions.push(c.FunctionCall.actions[0]); }),
      mut((c) => { c.FunctionCall.actions[0].args = b64({ account_id: DAO, registration_only: true, extra: 1 }); }),
      mut((c) => { c.FunctionCall.actions[0].args = b64({ account_id: DAO, registration_only: false }); }),
      mut((c) => { c.FunctionCall.actions[0].deposit = "10000000000000000000000000"; }),
      buildSwapKind({ tokenContract: T.originContract, depositAddress: DEP, amountBase: AMT }),
      { Transfer: { token_id: "", receiver_id: DAO, amount: "1" } }, null,
    ];
    for (const x of bad) expect(parseRegisterKind(x)).toBeNull();
  });
  it("a swap proposal is never read as a setup proposal, and vice versa", () => {
    expect(parseSwapKind(buildRegisterKind(T.originContract, DAO))).toBeNull();
  });
  it("guard: only the DAO itself, only the two token contracts", () => {
    expect(checkRegistration({ tokenContract: T.originContract, accountId: DAO }, DAO, allowed).ok).toBe(true);
    expect(checkRegistration({ tokenContract: T.originContract, accountId: "bob.testnet" }, DAO, allowed).ok).toBe(false);
    expect(checkRegistration({ tokenContract: "evil.testnet", accountId: DAO }, DAO, allowed).ok).toBe(false);
  });
  it("proposal text is plain and says what it costs", () => {
    const d = buildRegisterDescription({ tokenContract: T.originContract, label: T.originLabel, dao: DAO, why: "can hold it" });
    for (const s of ["register the treasury", DAO, T.originContract, "0.00125 NEAR", "no value", "only suggest"]) expect(d).toContain(s);
    expect(d.split("\n")[1]).toMatch(/^What: /);
  });
});
