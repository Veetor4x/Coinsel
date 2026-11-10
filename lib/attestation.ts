/* eslint-disable @typescript-eslint/no-explicit-any -- chain/attestation JSON is untyped; every field is checked before use */
// "Verified private": check NEAR AI Cloud's hardware attestation BEFORE we send any data.
// Follows https://docs.near.ai/cloud/verification (gateway-attestation, model-attestations, quote-nonce-signer).
// Fail-closed: if anything doesn't check out, the caller gets ok:false and must NOT show unverified advice.
import { createHash, randomBytes } from "node:crypto";
import { getCollateralAndVerify } from "@phala/dcap-qvl";

const BASE = (process.env.NEARAI_BASE_URL || "https://cloud-api.near.ai/v1").replace(/\/$/, "");
export const DEFAULT_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
export const modelId = () => process.env.NEARAI_MODEL || DEFAULT_MODEL;

export type Check = { id: "hardware" | "fresh" | "identity" | "software" | "gpu"; label: string; ok: boolean; detail: string };
export type Attestation = {
  ok: boolean;
  model: string;
  nonce: string;
  checks: Check[];
  attestationHash: string;
  verifiedAt: string;
  error?: string;
};

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest();
const sha384 = (b: Buffer) => createHash("sha384").update(b).digest();
const hex = (s: string) => Buffer.from(s.replace(/^0x/i, ""), "hex");
const OK_TCB = new Set(["UpToDate", "SWHardeningNeeded", "ConfigurationNeeded", "ConfigurationAndSWHardeningNeeded"]);

type Report = {
  signing_address: string; signing_algo: string; intel_quote: string; event_log: unknown;
  request_nonce: string; info?: { tcb_info?: unknown }; nvidia_payload?: unknown;
};

/** Pull the three fields we need out of a TDX v4 quote (offsets from the Intel TDX quote layout). */
export function parseTdxQuote(q: Buffer) {
  if (q.length < 632 || q.readUInt16LE(0) !== 4 || q.readUInt32LE(4) !== 0x81) throw new Error("not a TDX v4 quote");
  const body = 48; // header is 48 bytes
  return { mrConfigId: q.subarray(body + 184, body + 232), rtmr3: q.subarray(body + 472, body + 520), reportData: q.subarray(body + 520, body + 584) };
}

/** Replay the RTMR3 event log: SHA-384 chain over the events whose imr is 3. */
export function replayRtmr3(eventLog: unknown): Buffer {
  const events: any[] = typeof eventLog === "string" ? JSON.parse(eventLog) : (eventLog as any[]);
  let r = Buffer.alloc(48);
  for (const e of events) {
    if (e.imr !== 3) continue;
    const t = Buffer.alloc(4); t.writeUInt32LE(Number(e.event_type));
    const d = sha384(Buffer.concat([t, Buffer.from(":"), Buffer.from(String(e.event), "utf8"), Buffer.from(":"), hex(String(e.event_payload))]));
    if (e.digest && Buffer.from(hex(String(e.digest))).compare(d) !== 0) throw new Error("event log digest mismatch");
    r = sha384(Buffer.concat([r, d]));
  }
  return r;
}

function appCompose(rep: Report): string {
  let tcb: any = rep.info?.tcb_info;
  if (typeof tcb === "string") tcb = JSON.parse(tcb);
  if (!tcb || typeof tcb.app_compose !== "string") throw new Error("no app_compose in report");
  return tcb.app_compose;
}

/** Verify one report (gateway or one model candidate). Returns one Check per property. */
async function verifyReport(name: string, rep: Report, nonce: string): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (id: Check["id"], label: string, ok: boolean, detail: string) => checks.push({ id, label, ok, detail: `${name}: ${detail}` });
  let quote: Buffer;
  try { quote = hex(rep.intel_quote); } catch { quote = Buffer.alloc(0); }

  // 1. Genuine Intel hardware signature (full DCAP verification with Intel collateral).
  let parsed: ReturnType<typeof parseTdxQuote> | null = null;
  try {
    const v = await getCollateralAndVerify(quote);
    if (!OK_TCB.has(String(v.status))) throw new Error(`hardware status ${v.status}`);
    parsed = parseTdxQuote(quote);
    add("hardware", "Genuine secure hardware", true, `Intel TDX quote signature valid (status ${v.status})`);
  } catch (e) {
    add("hardware", "Genuine secure hardware", false, (e as Error).message);
  }

  // 2 + 3. Fresh (our random nonce is inside the signed quote) and bound to the signer identity.
  if (parsed) {
    const nonceOk = (rep.request_nonce ?? "").toLowerCase() === nonce && parsed.reportData.subarray(32, 64).equals(hex(nonce));
    add("fresh", "Fresh, not replayed", nonceOk, nonceOk ? "our one-time random number is inside the signed quote" : "nonce mismatch");
    const addr = hex(rep.signing_address);
    const expected = Buffer.concat([addr, Buffer.alloc(Math.max(0, 32 - addr.length))]);
    const idOk = parsed.reportData.subarray(0, 32).equals(expected);
    add("identity", "Server identity matches", idOk, idOk ? `signing key ${rep.signing_address} is bound by the quote` : "signer not bound by quote");
  } else {
    add("fresh", "Fresh, not replayed", false, "skipped: quote not verified");
    add("identity", "Server identity matches", false, "skipped: quote not verified");
  }

  // 4. Software measured: event log replays to RTMR3, and the config hash matches MRCONFIGID.
  try {
    if (!parsed) throw new Error("quote not verified");
    const rtmrOk = replayRtmr3(rep.event_log).equals(parsed.rtmr3);
    const want = Buffer.concat([Buffer.from([1]), sha256(Buffer.from(appCompose(rep), "utf8")), Buffer.alloc(15)]);
    const cfgOk = parsed.mrConfigId.equals(want);
    add("software", "Known software only", rtmrOk && cfgOk, rtmrOk && cfgOk ? "event log replays to RTMR3; app config hash matches MRCONFIGID" : `rtmr3 ${rtmrOk ? "ok" : "BAD"}, config ${cfgOk ? "ok" : "BAD"}`);
  } catch (e) {
    add("software", "Known software only", false, (e as Error).message);
  }

  // 5. GPU evidence (model reports only): verified by NVIDIA's attestation service.
  if (rep.nvidia_payload) {
    try {
      const payload = typeof rep.nvidia_payload === "string" ? JSON.parse(rep.nvidia_payload) : rep.nvidia_payload;
      if (String(payload.nonce ?? "").toLowerCase() !== nonce) throw new Error("GPU nonce mismatch");
      const r = await fetch("https://nras.attestation.nvidia.com/v3/attest/gpu", {
        method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) throw new Error(`NVIDIA service answered ${r.status}`);
      const arr = await r.json();
      const jwt = arr?.[0]?.[1];
      const claims = JSON.parse(Buffer.from(String(jwt).split(".")[1], "base64url").toString("utf8"));
      if (claims["x-nvidia-overall-att-result"] !== true) throw new Error("NVIDIA did not approve the GPU evidence");
      add("gpu", "Secure graphics chip", true, "NVIDIA attestation service approved the GPU evidence");
    } catch (e) {
      add("gpu", "Secure graphics chip", false, (e as Error).message);
    }
  }
  return checks;
}

/** One full attempt: fresh nonce -> fetch report -> verify gateway AND every model candidate. */
export async function verifyAttestationOnce(model = modelId()): Promise<Attestation> {
  const nonce = randomBytes(32).toString("hex");
  const base = { model, nonce, verifiedAt: new Date().toISOString(), attestationHash: "" };
  try {
    const url = new URL(`${BASE}/attestation/report`);
    url.search = new URLSearchParams({ model, provider: "near", include_tls_fingerprint: "false", signing_algo: "ecdsa", nonce }).toString();
    const res = await fetch(url, { headers: { accept: "application/json", "x-no-aliasing": "true" }, cache: "no-store", signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`attestation service answered ${res.status}`);
    const j = await res.json();
    const candidates: Report[] = j.model_attestations ?? [];
    if (!j.gateway_attestation) throw new Error("no gateway evidence returned");
    if (!candidates.length) throw new Error("no model evidence returned");

    const groups = await Promise.all([
      verifyReport("gateway", j.gateway_attestation, nonce),
      ...candidates.map((c, i) => verifyReport(candidates.length > 1 ? `model #${i + 1}` : "model", c, nonce)),
    ]);
    const all = groups.flat();
    // Collapse to one row per property: ok only if EVERY report passed it.
    const ids = [...new Set(all.map((c) => c.id))] as Check["id"][];
    const checks = ids.map((id) => {
      const mine = all.filter((c) => c.id === id);
      return { id, label: mine[0].label, ok: mine.every((c) => c.ok), detail: mine.map((c) => c.detail).join(" · ") };
    });
    const ok = checks.length >= 4 && checks.every((c) => c.ok);
    const attestationHash = "sha256:" + sha256(JSON.stringify({ nonce, model, gateway: j.gateway_attestation.intel_quote, models: candidates.map((c) => c.intel_quote) })).toString("hex");
    return { ...base, ok, checks, attestationHash, error: ok ? undefined : "Some checks did not pass." };
  } catch (e) {
    return { ...base, ok: false, checks: [], error: (e as Error).message };
  }
}

/** Auto-retry once (demo resilience). Still fail-closed: returns ok:false if both attempts fail. */
export async function verifyAttestation(model = modelId()): Promise<Attestation & { attempts: number }> {
  const first = await verifyAttestationOnce(model);
  if (first.ok) return { ...first, attempts: 1 };
  const second = await verifyAttestationOnce(model);
  return { ...second, attempts: 2 };
}
