"use client";
import { useEffect, useRef, useState } from "react";

type Check = { id: string; label: string; problem: string; status: "pass" | "fail" | "unavailable"; details?: string };
export type AttestationView = Attestation;
type Attestation = { status: "verified" | "failed" | "unavailable"; headline: string; model: string; nonce: string; checkedAt: string; checks: Check[]; tcbStatus?: string; signer?: string };
type Result = {
  advice: string | null; attestation?: Attestation; blocked?: boolean; message?: string; error?: string;
  usage?: { promptTokens: number; completionTokens: number; costUsd: number };
  hashes?: { request: string; response: string };
};
type Payout = { id: string; label: string; amountNear: number; dueInDays: number };

const LOG = ["Reading your treasury…", "Thinking privately…", "Checking the proof…"];
const mono = "font-[family-name:var(--font-mono-jb)]";
const trunc = (h: string) => (h.length > 22 ? `${h.slice(0, 12)}…${h.slice(-6)}` : h);

/** Self-typing "counsel log" shown while we wait. Shows everything at once if the user prefers reduced motion. */
function CounselLog({ done }: { done: boolean }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let line = 0, ch = 0;
    const id = setInterval(() => {
      if (reduce) { setText(LOG.join("\n")); clearInterval(id); return; }
      if (line >= LOG.length) return;
      ch++;
      if (ch > LOG[line].length + 14) { line++; ch = 0; }
      setText(LOG.slice(0, line).join("\n") + (line < LOG.length ? (line ? "\n" : "") + LOG[line].slice(0, ch) : ""));
    }, 38);
    return () => clearInterval(id);
  }, []);
  return (
    <pre aria-live="polite" className={`${mono} min-h-[4.5rem] whitespace-pre-wrap text-sm text-[#C6FF3D]`}>
      {text}{!done && <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-[#C6FF3D] align-middle" />}
    </pre>
  );
}

const MARK = { pass: ["✓", "text-[#C6FF3D]"], fail: ["✗", "text-[#FF9A82]"], unavailable: ["?", "text-[#FFC56E]"] } as const;
const TONE = {
  verified: "border-[#C6FF3D]/40 bg-[#C6FF3D]/5", failed: "border-[#FF9A82]/50 bg-[#FF9A82]/10", unavailable: "border-[#FFC56E]/40 bg-[#FFC56E]/10",
} as const;
const HEAD = { verified: "text-[#C6FF3D]", failed: "text-[#FF9A82]", unavailable: "text-[#FFC56E]" } as const;

export function VerifiedPanel({ a, hashes }: { a: Attestation; hashes?: Result["hashes"] }) {
  return (
    <div className={`rounded-xl border p-4 ${TONE[a.status]}`}>
      <div className={`font-[family-name:var(--font-syne)] text-lg font-bold ${HEAD[a.status]}`}>{a.status === "verified" ? "Verified private" : a.status === "failed" ? "Proof failed" : "Couldn’t verify this time"}</div>
      <p className="mb-3 text-sm text-zinc-300">{a.status === "verified" ? "Your data stayed private — and you can check that." : a.headline}</p>
      <ul className="space-y-1.5 text-sm">
        {a.checks.map((c) => (
          <li key={c.id} className="flex gap-2">
            <span className={`${MARK[c.status][1]} w-4 shrink-0 font-bold`} aria-label={c.status}>{MARK[c.status][0]}</span>
            <span className={c.status === "pass" ? "text-zinc-100" : MARK[c.status][1]}>{c.status === "pass" ? c.label : c.problem}</span>
          </li>
        ))}
      </ul>
      <details className="mt-3 text-xs text-zinc-500">
        <summary className="cursor-pointer">Details</summary>
        <div className={`${mono} mt-2 space-y-1 break-words`}>
          <div>model: {a.model}</div>
          <div>fresh nonce (first 16 hex): {a.nonce}</div>
          <div>checked at: {a.checkedAt}</div>
          {a.tcbStatus && <div>Intel TDX status: {a.tcbStatus}</div>}
          {a.signer && <div>model signing key: {trunc(a.signer)}</div>}
          {hashes && <><div>request sha256: {trunc(hashes.request)}</div><div>response sha256: {trunc(hashes.response)}</div></>}
          {a.checks.map((c) => <div key={c.id}>• {c.id} [{c.status}]: {c.details}</div>)}
        </div>
      </details>
    </div>
  );
}

export default function AskCoinsel({ obligations }: { obligations: Payout[] }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const run = useRef(0);

  async function ask() {
    const id = ++run.current;
    setBusy(true); setRes(null);
    try {
      const r = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ obligations }) });
      const j: Result = await r.json();
      if (id === run.current) setRes(j);
    } catch {
      if (id === run.current) setRes({ advice: null, error: "Couldn’t reach Coinsel. Check your connection and try again." });
    } finally { if (id === run.current) setBusy(false); }
  }

  return (
    <div className="mt-5 border-t border-[#262A2E] pt-5">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={ask} disabled={busy} className="rounded-full bg-[#C6FF3D] px-5 py-2 text-sm font-bold text-[#0C0D0E] transition hover:brightness-110 disabled:opacity-60">
          {busy ? "Counsel at work…" : "Ask Coinsel"}
        </button>
        <span className="text-xs text-zinc-500">It can only suggest. It can’t send money.</span>
      </div>

      {busy && <div className="mt-4 rounded-xl border border-[#262A2E] bg-black/30 p-4"><CounselLog done={false} /></div>}

      {res && !busy && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-[#C6FF3D]/30 bg-[#121315] p-4">
            <div className={`${mono} mb-2 text-[11px] uppercase tracking-widest text-[#8E928D]`}>Coinsel’s advice</div>
            {res.advice ? <p className="text-base leading-relaxed text-[#F2F2EE]">{res.advice}</p>
              : <p className="text-sm text-[#FF9A82]">{res.error ?? res.message ?? "No advice this time."}</p>}
            {res.usage && <p className="mt-3 text-[11px] text-zinc-600">Used {res.usage.promptTokens + res.usage.completionTokens} tokens (about ${res.usage.costUsd.toFixed(4)}). Nothing is saved on our side.</p>}
          </div>
          {res.attestation && <VerifiedPanel a={res.attestation} hashes={res.hashes} />}
        </div>
      )}
    </div>
  );
}
