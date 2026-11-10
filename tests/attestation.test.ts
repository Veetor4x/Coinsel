import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { recoverEthSigner, replayRtmr3, summarize, verifyAnswer, verifyModel, type Check, type Deps } from "../lib/attestation";

const c = (status: Check["status"], id = "x"): Check => ({ id, label: id, problem: id, status });

describe("summarize (pass / fail / unavailable)", () => {
  it("all pass => verified", () => expect(summarize([c("pass"), c("pass")]).status).toBe("verified"));
  it("any fail => failed, even with unavailable", () => expect(summarize([c("pass"), c("unavailable"), c("fail")]).status).toBe("failed"));
  it("any unavailable (no fail) => unavailable, never verified", () => {
    const s = summarize([c("pass"), c("unavailable")]);
    expect(s.status).toBe("unavailable");
    expect(s.headline).toMatch(/Couldn't verify/);
  });
  it("no checks => unavailable", () => expect(summarize([]).status).toBe("unavailable"));
});

describe("crypto helpers", () => {
  it("recovers the real signer from a real NEAR AI signature", () => {
    const text = "deepseek-ai/DeepSeek-V4.1-Flash-1017:cc97dd1897a9e986e292f064912dad9ca52b236b03a6132ecf6919a507d84449:20ae104e40c14d157f2da972647254472d3f56d59d46967556b6fa53b133ed03";
    const sig = "0x6e807660bf1ae9511aa8c1e3fcc3ce91c34974dcda2b5effb791f474a95cdabd344d2b2f36fe15ab9cdb27f6e6061e953828aeaed1fb684ca49b771112bc4f321b";
    expect(recoverEthSigner(text, sig)).toBe("0xfe0071895500a9755c18044948ab4f4e1a7f337e");
    expect(recoverEthSigner(text + "x", sig)).not.toBe("0xfe0071895500a9755c18044948ab4f4e1a7f337e");
  });
  it("replays an empty event log to 48 zero bytes", () => expect(replayRtmr3([]).equals(Buffer.alloc(48))).toBe(true));
});

// ---- a fake but self-consistent report so we can test the mapping without the network ----
const MODEL = "test/model";
const SIGNER = "0x" + "ab".repeat(20);
const compose = '{"fake":"compose"}';
function makeDeps(opts: { nonceInQuote?: "match" | "wrong"; collateralFails?: boolean; fetchFails?: boolean; debug?: boolean; wrongModel?: boolean; tcb?: string; gpu?: "ok" | "down" } = {}) {
  let nonce = "";
  const deps: Deps = {
    fetchJson: async (url) => {
      if (url.startsWith("https://nras")) return opts.gpu === "down" ? { status: 503, body: null } : { status: 200, body: [["JWT", "a." + Buffer.from(JSON.stringify({ "x-nvidia-overall-att-result": true })).toString("base64url") + ".c"]] };
      if (opts.fetchFails) throw new Error("network down");
      nonce = new URL(url).searchParams.get("nonce")!;
      const report = {
        model_name: opts.wrongModel ? "other/model" : MODEL, intel_quote: "00", signing_address: SIGNER, signing_algo: "ecdsa",
        request_nonce: nonce, event_log: "[]", info: { tcb_info: JSON.stringify({ app_compose: compose }) }, nvidia_payload: JSON.stringify({ nonce }),
      };
      return { status: 200, body: { gateway_attestation: { ...report }, model_attestations: [report] } };
    },
    getCollateral: async () => { if (opts.collateralFails) throw new Error("PCCS unreachable"); return {}; },
    verifyQuote: () => ({
      status: opts.tcb ?? "UpToDate", advisory_ids: [],
      report: { type: "td10", data: {
        tdAttributes: Buffer.from([opts.debug ? 1 : 0, 0, 0, 0, 0, 0, 0, 0]),
        reportData: Buffer.concat([Buffer.from(SIGNER.slice(2), "hex"), Buffer.alloc(12), Buffer.from(opts.nonceInQuote === "wrong" ? "00".repeat(32) : nonce, "hex")]),
        mrConfigId: Buffer.concat([Buffer.from([1]), createHash("sha256").update(compose).digest(), Buffer.alloc(15)]),
        rtMr3: Buffer.alloc(48), mrTd: Buffer.alloc(48),
      } },
    }),
    now: () => 0,
  };
  return deps;
}

describe("verifyModel result mapping", () => {
  it("PASS when every check is real", async () => {
    const { result, signer } = await verifyModel(MODEL, makeDeps());
    expect(result.status).toBe("verified");
    expect(result.checks.every((x) => x.status === "pass")).toBe(true);
    expect(signer?.address).toBe(SIGNER);
    expect(result.nonce).toHaveLength(16);
  });
  it("uses a different nonce every time", async () => {
    const a = await verifyModel(MODEL, makeDeps());
    const b = await verifyModel(MODEL, makeDeps());
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.nonce).toMatch(/^[0-9a-f]{64}$/);
  });
  it("FAIL when the quote doesn't contain our nonce (replay)", async () => {
    const { result } = await verifyModel(MODEL, makeDeps({ nonceInQuote: "wrong" }));
    expect(result.status).toBe("failed");
    expect(result.checks.find((x) => x.id === "fresh")?.status).toBe("fail");
  });
  it("FAIL when debug mode is on", async () => {
    const { result } = await verifyModel(MODEL, makeDeps({ debug: true }));
    expect(result.status).toBe("failed");
    expect(result.checks.find((x) => x.id === "hardware")?.status).toBe("fail");
  });
  it("FAIL when the TCB status isn't accepted", async () => {
    expect((await verifyModel(MODEL, makeDeps({ tcb: "OutOfDate" }))).result.status).toBe("failed");
  });
  it("FAIL when the report is for a different model", async () => {
    const { result } = await verifyModel(MODEL, makeDeps({ wrongModel: true }));
    expect(result.status).toBe("failed");
    expect(result.checks.find((x) => x.id === "model")?.status).toBe("fail");
  });
  it("UNAVAILABLE (not pass) when the provider can't be reached", async () => {
    const { result, signer } = await verifyModel(MODEL, makeDeps({ fetchFails: true }));
    expect(result.status).toBe("unavailable");
    expect(signer).toBeUndefined();
  });
  it("UNAVAILABLE when Intel collateral can't be fetched", async () => {
    expect((await verifyModel(MODEL, makeDeps({ collateralFails: true }))).result.status).toBe("unavailable");
  });
  it("UNAVAILABLE when the GPU verifier is down", async () => {
    const { result } = await verifyModel(MODEL, makeDeps({ gpu: "down" }));
    expect(result.status).toBe("unavailable");
    expect(result.checks.find((x) => x.id === "gpu")?.status).toBe("unavailable");
  });
});

describe("verifyAnswer", () => {
  const proof = { chatId: "chatcmpl-1", requestHash: "a".repeat(64), responseHash: "b".repeat(64) };
  it("unavailable without a verified signer", async () => {
    expect((await verifyAnswer(MODEL, proof, undefined, "k", makeDeps())).status).toBe("unavailable");
  });
  it("unavailable when no signature is recorded", async () => {
    const deps = makeDeps();
    deps.fetchJson = async () => ({ status: 404, body: { message: "not found" } });
    const r = await verifyAnswer(MODEL, proof, { address: SIGNER, algo: "ecdsa" }, "k", deps);
    expect(r.status).toBe("unavailable");
  }, 10000);
  it("fails when the signed text isn't our request/response", async () => {
    const deps = makeDeps();
    deps.fetchJson = async () => ({ status: 200, body: { text: "other", signature: "0x00", signature_kind: "provider_tee" } });
    expect((await verifyAnswer(MODEL, proof, { address: SIGNER, algo: "ecdsa" }, "k", deps)).status).toBe("fail");
  });
});
