// Coinsel lib/attestation.ts — checks NEAR AI Cloud's "proof of privacy".
// Follows https://docs.near.ai/cloud/verification (gateway + NEAR model attestation,
// quote/nonce/signer bindings, response signatures). Nothing is stored server-side.
//
// Rule: a check is "pass" only if we actually verified it. Anything we could not
// verify is "unavailable" (or "fail" if the evidence is wrong). We never fake a pass.
import { createHash, randomBytes } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { getCollateral, verify as dcapVerify, PHALA_PCCS_URL } from "@phala/dcap-qvl";
import { env } from "./env";

export const NEARAI_BASE = (env("NEARAI_BASE_URL") || "https://cloud-api.near.ai/v1").replace(/\/$/, "");
export const NRAS_URL = "https://nras.attestation.nvidia.com/v3/attest/gpu";
/** Intel TDX statuses we accept (policy). Anything else is a failed check. */
export const ACCEPTED_TCB = ["UpToDate"];

export type CheckStatus = "pass" | "fail" | "unavailable";
export type Check = {
  id: string;
  /** Plain-English line for the panel. */
  label: string;
  /** What this line says when it FAILS or can't be checked. */
  problem: string;
  status: CheckStatus;
  /** Technical values, shown only under "details". */
  details?: string;
};
export type OverallStatus = "verified" | "failed" | "unavailable";
export type AttestationResult = {
  status: OverallStatus;
  headline: string;
  model: string;
  /** First 16 hex chars of the nonce we generated (the full value is not needed by the UI). */
  nonce: string;
  checkedAt: string;
  checks: Check[];
  tcbStatus?: string;
  signer?: string;
};

// ---------- pure helpers (unit-tested) ----------

/** Turn a list of checks into one honest verdict. One fail => failed. Otherwise any unavailable => unavailable. */
export function summarize(checks: Check[]): { status: OverallStatus; headline: string } {
  if (checks.some((c) => c.status === "fail")) {
    return { status: "failed", headline: "Privacy check FAILED — don't trust this answer" };
  }
  if (checks.length === 0 || checks.some((c) => c.status === "unavailable")) {
    return { status: "unavailable", headline: "Couldn't verify this time" };
  }
  return { status: "verified", headline: "Verified private — your data stayed private, and you can check that" };
}

export const sha256Hex = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const sha384 = (...p: Buffer[]) => { const h = createHash("sha384"); p.forEach((x) => h.update(x)); return h.digest(); };
const hex = (v: string) => Buffer.from(v.replace(/^0x/i, ""), "hex");
const asJson = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
export const short = (h: string, n = 10) => (h.length > n * 2 + 1 ? `${h.slice(0, n)}…${h.slice(-6)}` : h);

/** Replay the RTMR3 event log exactly as the NEAR AI docs describe. */
export function replayRtmr3(eventLog: unknown): Buffer {
  let rtmr3 = Buffer.alloc(48);
  for (const ev of asJson(eventLog) as any[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (ev.imr !== 3) continue;
    const t = Buffer.alloc(4);
    t.writeUInt32LE(ev.event_type);
    const digest = sha384(t, Buffer.from(":"), Buffer.from(ev.event, "utf8"), Buffer.from(":"), hex(ev.event_payload ?? ""));
    if (ev.digest && !hex(ev.digest).equals(digest)) throw new Error(`digest mismatch for event ${ev.event}`);
    rtmr3 = sha384(rtmr3, digest);
  }
  return rtmr3;
}

/** Ethereum-style EIP-191 signer recovery (ecdsa signatures from NEAR AI). */
export function recoverEthSigner(text: string, signature: string): string {
  const msg = Buffer.from(text, "utf8");
  const digest = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${msg.length}`), msg]));
  const sig = hex(signature);
  if (sig.length !== 65) throw new Error("bad signature length");
  const v = sig[64] >= 27 ? sig[64] - 27 : sig[64];
  // noble v2 "recovered" format: [recovery, r, s]
  const rec = Buffer.concat([Buffer.from([v]), sig.subarray(0, 64)]);
  const pub = secp256k1.recoverPublicKey(rec, digest, { prehash: false });
  const uncompressed = secp256k1.Point.fromBytes(pub).toBytes(false).subarray(1);
  return "0x" + Buffer.from(keccak_256(uncompressed).subarray(12)).toString("hex");
}

// ---------- dependencies (injectable for tests) ----------

export type Deps = {
  fetchJson: (url: string, init?: RequestInit) => Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Collateral fetch = network. Throws => "unavailable". */
  getCollateral: (quote: Buffer) => Promise<unknown>;
  /** Cryptographic quote verification. Throws => "fail". */
  verifyQuote: (quote: Buffer, collateral: unknown) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  now: () => number;
};

export const liveDeps: Deps = {
  async fetchJson(url, init) {
    const res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(45000) });
    let body: unknown = null;
    try { body = await res.json(); } catch { /* not json */ }
    return { status: res.status, body };
  },
  getCollateral: (q) => getCollateral(PHALA_PCCS_URL, q),
  verifyQuote: (q, c) => dcapVerify(q, c as never, Math.floor(Date.now() / 1000)),
  now: () => Date.now(),
};

// ---------- per-report checks ----------

type Part = { status: CheckStatus; details: string };
type ReportChecks = { quote: Part; debug: Part; nonce: Part; signer: Part; config: Part; eventLog: Part; tcb?: string };
const unav = (details: string): Part => ({ status: "unavailable", details });
const ok = (details: string): Part => ({ status: "pass", details });
const bad = (details: string): Part => ({ status: "fail", details });

async function checkReport(report: any, nonceHex: string, deps: Deps): Promise<ReportChecks> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: ReportChecks = {
    quote: unav("not checked"), debug: unav("not checked"), nonce: unav("not checked"),
    signer: unav("not checked"), config: unav("not checked"), eventLog: unav("not checked"),
  };
  if (!report?.intel_quote) { out.quote = bad("report has no Intel quote"); return out; }
  const quoteBytes = hex(report.intel_quote);

  let collateral: unknown;
  try { collateral = await deps.getCollateral(quoteBytes); }
  catch (e) { out.quote = unav(`couldn't fetch Intel collateral: ${(e as Error).message}`); return out; }

  let q: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const v = deps.verifyQuote(quoteBytes, collateral);
    out.tcb = String(v.status);
    if (v.report?.type !== "td10") throw new Error("not an Intel TDX quote");
    if (!ACCEPTED_TCB.includes(String(v.status))) throw new Error(`TCB status ${v.status} not accepted ${v.advisory_ids ?? ""}`);
    q = v.report.data;
    out.quote = ok(`Intel TDX quote valid, TCB ${v.status}, mr_td ${short(Buffer.from(q.mrTd).toString("hex"))}`);
  } catch (e) { out.quote = bad(`quote rejected: ${(e as Error).message}`); return out; }

  out.debug = (q.tdAttributes[0] & 1) ? bad("TDX debug mode is ON") : ok("debug mode off");

  // signer + nonce binding: report_data = identity(zero-padded to 32) || nonce
  try {
    const algo = report.signing_algo;
    const id = hex(report.signing_address);
    if ({ ecdsa: 20, ed25519: 32 }[algo as "ecdsa"] !== id.length) throw new Error("unsupported signing identity");
    const rd = Buffer.from(q.reportData);
    const wantId = Buffer.concat([id, Buffer.alloc(32 - id.length)]);
    out.signer = rd.subarray(0, 32).equals(wantId) ? ok(`signing key ${short(report.signing_address)} (${algo}) is bound by the quote`) : bad("quote does not bind the signing key");
    const nonceOk = rd.subarray(32).equals(hex(nonceHex)) && String(report.request_nonce).toLowerCase() === nonceHex.toLowerCase();
    out.nonce = nonceOk ? ok(`our random nonce ${short(nonceHex, 8)} is inside the signed quote`) : bad("nonce in quote does not match the one we sent");
  } catch (e) { out.signer = bad((e as Error).message); out.nonce = bad((e as Error).message); }

  try {
    const compose: string = asJson(report.info.tcb_info).app_compose;
    const want = Buffer.concat([Buffer.from([1]), createHash("sha256").update(compose, "utf8").digest(), Buffer.alloc(15)]);
    out.config = Buffer.from(q.mrConfigId).equals(want) ? ok(`app_compose sha256 ${short(sha256Hex(compose))} matches MRCONFIGID`) : bad("software configuration does not match the hardware record");
  } catch (e) { out.config = bad(`config check failed: ${(e as Error).message}`); }

  try {
    out.eventLog = replayRtmr3(report.event_log).equals(Buffer.from(q.rtMr3)) ? ok("event log replays to RTMR3") : bad("event log does not match RTMR3");
  } catch (e) { out.eventLog = bad((e as Error).message); }
  return out;
}

const combine = (...p: Part[]): Part => {
  const status: CheckStatus = p.some((x) => x.status === "fail") ? "fail" : p.some((x) => x.status === "unavailable") ? "unavailable" : "pass";
  return { status, details: p.map((x) => x.details).join("; ") };
};

async function checkGpu(report: any, nonceHex: string, deps: Deps): Promise<Part> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!report?.nvidia_payload) return unav("no GPU evidence in the report");
  try {
    const payload = asJson(report.nvidia_payload);
    if (String(payload.nonce).toLowerCase() !== nonceHex.toLowerCase()) return bad("GPU evidence nonce does not match ours");
    const r = await deps.fetchJson(NRAS_URL, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(payload) });
    if (r.status !== 200 || !Array.isArray(r.body)) return unav(`NVIDIA verifier answered ${r.status}`);
    const jwt = r.body.find((x: unknown) => Array.isArray(x) && x[0] === "JWT")?.[1];
    if (!jwt) return unav("NVIDIA verifier returned no verdict");
    const claims = JSON.parse(Buffer.from(String(jwt).split(".")[1], "base64url").toString("utf8"));
    return claims["x-nvidia-overall-att-result"] === true ? ok("NVIDIA verifier: GPU attestation true") : bad("NVIDIA verifier rejected the GPU evidence");
  } catch (e) { return unav(`GPU check unavailable: ${(e as Error).message}`); }
}

// ---------- public API ----------

export type AnswerProof = { chatId: string; requestHash: string; responseHash: string };

/**
 * Step 1 (BEFORE sending any data): fetch a fresh report with a random nonce and verify it.
 * Returns the checks plus the verified model signer, used later to check the answer's signature.
 */
export async function verifyModel(model: string, deps: Deps = liveDeps): Promise<{ result: AttestationResult; signer?: { address: string; algo: string }; nonce: string }> {
  const nonce = randomBytes(32).toString("hex"); // fresh every time, never reused
  const checks: Check[] = [];
  const finish = (signer?: { address: string; algo: string }) => {
    const { status, headline } = summarize(checks);
    return { nonce, signer, result: { status, headline, model, nonce: nonce.slice(0, 16), checkedAt: new Date(deps.now()).toISOString(), checks } as AttestationResult };
  };
  const add = (id: string, label: string, problem: string, p: Part) => checks.push({ id, label, problem, status: p.status, details: p.details });

  let body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const qs = new URLSearchParams({ model, provider: "near", signing_algo: "ecdsa", nonce });
    const r = await deps.fetchJson(`${NEARAI_BASE}/attestation/report?${qs}`, { headers: { accept: "application/json", "x-no-aliasing": "true" } });
    if (r.status !== 200 || !r.body) throw new Error(`HTTP ${r.status}`);
    body = r.body;
  } catch (e) {
    add("report", "Fetched a fresh proof from the AI provider", "Couldn't get a proof from the AI provider", unav(`attestation endpoint: ${(e as Error).message}`));
    return finish();
  }

  const candidates: any[] = body.model_attestations ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const wantedModel = candidates.filter((c) => c.model_name === model);
  if (wantedModel.length === 0) {
    add("model", "It's the model we asked for", "The provider didn't prove it is running the model we asked for", bad(`asked for ${model}; report models: ${candidates.map((c) => c.model_name).join(", ") || "none"}`));
    return finish();
  }
  add("model", "It's the model we asked for", "The provider didn't prove it is running the model we asked for", ok(`${model} (${wantedModel.length} report${wantedModel.length > 1 ? "s" : ""}, all verified below)`));

  const gw = await checkReport(body.gateway_attestation, nonce, deps);
  const models = await Promise.all(wantedModel.map((c) => checkReport(c, nonce, deps)));
  const all = (f: (r: ReportChecks) => Part) => combine(...models.map(f));

  add("hardware", "Ran inside sealed hardware", "Couldn't confirm the AI ran inside sealed hardware", combine(all((r) => r.quote), all((r) => r.debug)));
  add("untouched", "Its software wasn't tampered with", "Couldn't confirm the AI's software is untouched", combine(all((r) => r.config), all((r) => r.eventLog)));
  add("fresh", "Fresh proof, not replayed", "Couldn't confirm the proof is fresh", combine(all((r) => r.nonce), gw.nonce));
  add("key", "The proof is tied to the key that signs its answers", "Couldn't tie the proof to the answer-signing key", all((r) => r.signer));
  add("gpu", "The chips doing the thinking are genuine", "Couldn't confirm the AI's chips with NVIDIA", combine(...(await Promise.all(wantedModel.map((c) => checkGpu(c, nonce, deps))))));
  add("gateway", "The service in front of it is sealed too", "Couldn't confirm the service in front of the AI", combine(gw.quote, gw.debug, gw.config, gw.eventLog, gw.signer));

  const first = wantedModel[0];
  const result = finish({ address: String(first.signing_address), algo: String(first.signing_algo) });
  result.result.tcbStatus = models[0]?.tcb;
  result.result.signer = first.signing_address;
  return result;
}

/**
 * Step 2 (AFTER the answer): check that the answer was signed by the verified model.
 * `signature_kind` must be provider_tee and the signer must equal the verified model signer.
 */
export async function verifyAnswer(
  model: string, proof: AnswerProof, signer: { address: string; algo: string } | undefined, apiKey: string, deps: Deps = liveDeps,
): Promise<Check> {
  const label = "This exact answer was signed by that model";
  const problem = "Couldn't confirm the answer was signed by the verified model";
  if (!signer) return { id: "signed", label, problem, status: "unavailable", details: "no verified signer to compare with" };
  if (signer.algo !== "ecdsa") return { id: "signed", label, problem, status: "unavailable", details: `unsupported algorithm ${signer.algo}` };
  let last = "no signature yet";
  for (let i = 0; i < 3; i++) {
    try {
      const r = await deps.fetchJson(`${NEARAI_BASE}/signature/${encodeURIComponent(proof.chatId)}?signing_algo=ecdsa`, { headers: { accept: "application/json", authorization: `Bearer ${apiKey}` } });
      const b = r.body;
      if (r.status === 200 && b?.signature && b?.text) {
        if (b.signature_kind !== "provider_tee") return { id: "signed", label, problem, status: "unavailable", details: `signature_kind is ${b.signature_kind}, not provider_tee` };
        const expected = `${model}:${proof.requestHash}:${proof.responseHash}`;
        if (b.text !== expected) return { id: "signed", label, problem, status: "fail", details: "signed text does not match our request/response hashes" };
        const who = recoverEthSigner(b.text, b.signature);
        if (who.toLowerCase() !== signer.address.toLowerCase() || String(b.signing_address).toLowerCase() !== signer.address.toLowerCase()) {
          return { id: "signed", label, problem, status: "fail", details: `signature came from ${short(who)}, not the verified key` };
        }
        return { id: "signed", label, problem, status: "pass", details: `request ${short(proof.requestHash)} response ${short(proof.responseHash)} signed by ${short(who)}` };
      }
      last = `HTTP ${r.status} ${b?.message ?? ""}`.trim();
    } catch (e) { last = (e as Error).message; }
    await new Promise((res) => setTimeout(res, 700));
  }
  return { id: "signed", label, problem, status: "unavailable", details: last };
}
