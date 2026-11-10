"use client";
import { useEffect, useRef } from "react";
import { CountUp, Reveal, useReducedMotion } from "./motion";
import { sound } from "@/lib/sound";

export type Live = { payrollUsd: number; reserveUsd: number; daysToPayday: number | null; gapUsd: number };
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const mono = "font-[family-name:var(--font-mono-jb)]";
const SWEEP_MS = 6000;

type BlipDef = { id: string; x: number; y: number; side: "l" | "r"; angle: number };
// Positions are % of the radar; angle = where the sweep line is (clockwise from the top) when it passes the dot.
const BLIPS: BlipDef[] = ([
  { id: "payroll", x: 66, y: 20, side: "l", angle: 0 },
  { id: "payday", x: 70, y: 57, side: "l", angle: 0 },
  { id: "status", x: 28, y: 77, side: "r", angle: 0 },
  { id: "reserve", x: 20, y: 36, side: "r", angle: 0 },
] as BlipDef[]).map((b) => ({ ...b, angle: (Math.atan2(b.x - 50, 50 - b.y) * 180) / Math.PI + (b.x < 50 ? 360 : 0) }));

function Blip({ def, title, warn, children, setRef }: { def: BlipDef; title: string; warn?: boolean; children: React.ReactNode; setRef: (el: HTMLDivElement | null) => void }) {
  const c = warn ? "#FF9A82" : "#C6FF3D";
  return (
    <div ref={setRef} className={`blip absolute ${warn ? "warn" : ""}`} style={{ left: `${def.x}%`, top: `${def.y}%` }}>
      <span className="blip-ring absolute left-0 top-0 block h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border" style={{ borderColor: c }} />
      <span className="blip-dot absolute left-0 top-0 block h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: c }} />
      <div className={`blip-pill absolute top-0 -translate-y-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-[#121315]/90 px-2 py-1 backdrop-blur ${def.side === "l" ? "right-4 text-right" : "left-4"}`}>
        <div className={`${mono} text-[9px] uppercase tracking-widest text-[#8E928D]`}>{title}</div>
        <div className="text-[13px] font-semibold leading-tight" style={{ color: warn ? "#FF9A82" : "#F2F2EE" }}>{children}</div>
      </div>
    </div>
  );
}

function Radar({ live }: { live: Live | null }) {
  const reduce = useReducedMotion();
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  // Light each blip (and play a soft blip) the moment the sweep line passes it.
  useEffect(() => {
    if (reduce) return;
    const t0 = performance.now();
    let last = 0;
    const id = setInterval(() => {
      const cur = (((performance.now() - t0) % SWEEP_MS) / SWEEP_MS) * 360;
      for (const b of BLIPS) {
        const crossed = last <= cur ? b.angle > last && b.angle <= cur : b.angle > last || b.angle <= cur;
        const el = refs.current[b.id];
        if (crossed && el) {
          el.classList.add("ping");
          setTimeout(() => el.classList.remove("ping"), 900);
          sound.blip();
        }
      }
      last = cur;
    }, 80);
    return () => clearInterval(id);
  }, [reduce]);

  const dash = <span className="text-[#8E928D]">—</span>;
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[380px] sm:max-w-[440px]" role="img" aria-label="A radar showing live payroll, reserve and days to payday">
      <div className="absolute inset-0 overflow-hidden rounded-full border border-[#C6FF3D]/25 bg-[radial-gradient(circle,rgba(198,255,61,0.07),rgba(12,13,14,0)_70%)]">
        {[17, 34, 50].map((p) => <div key={p} className="absolute rounded-full border border-[#C6FF3D]/15" style={{ inset: `${p}%` }} />)}
        <div className="absolute left-1/2 top-0 h-full w-px bg-[#C6FF3D]/10" />
        <div className="absolute left-0 top-1/2 h-px w-full bg-[#C6FF3D]/10" />
        {!reduce && <div className="radar-sweep absolute inset-0 rounded-full" />}
      </div>
      {/* the logo again: broken ring, lime core, satellite */}
      <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#C6FF3D] shadow-[0_0_24px_6px_rgba(198,255,61,0.45)]" />
      <Blip def={BLIPS[0]} title="Payroll account" setRef={(el) => { refs.current.payroll = el; }}>{live ? <CountUp value={live.payrollUsd} format={usd} /> : dash}</Blip>
      <Blip def={BLIPS[1]} title="Next payday" setRef={(el) => { refs.current.payday = el; }}>{live ? (live.daysToPayday === null ? "No payouts" : <>in <CountUp value={live.daysToPayday} /> days</>) : dash}</Blip>
      <Blip def={BLIPS[2]} title={live && live.gapUsd > 0 ? "Payroll is short" : "Payroll"} warn={!!live && live.gapUsd > 0} setRef={(el) => { refs.current.status = el; }}>
        {live ? (live.gapUsd > 0 ? <CountUp value={live.gapUsd} format={usd} /> : "Covered ✓") : dash}
      </Blip>
      <Blip def={BLIPS[3]} title="Reserve can spare" setRef={(el) => { refs.current.reserve = el; }}>{live ? <CountUp value={live.reserveUsd} format={usd} /> : dash}</Blip>
    </div>
  );
}

export function Hero({ live }: { live: Live | null }) {
  return (
    <section className="relative grid min-w-0 items-center gap-8 pb-10 pt-4 sm:pt-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-10 lg:pb-16">
      <div className="min-w-0">
        <div className={`${mono} mb-4 inline-flex items-center gap-2 rounded-full border border-[#C6FF3D]/30 bg-[#C6FF3D]/5 px-3 py-1 text-[11px] uppercase tracking-widest text-[#C6FF3D]`}>
          <span className="h-1.5 w-1.5 rounded-full bg-[#C6FF3D]" /> Live on the NEAR test network
        </div>
        <h2 className="font-[family-name:var(--font-syne)] text-[2.7rem] font-extrabold leading-[0.98] tracking-tight text-[#F2F2EE] sm:text-6xl lg:text-7xl">
          Counsel for<br />your <span className="flicker text-[#C6FF3D]">coins.</span>
        </h2>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-[#B7BBB6] sm:text-lg">
          It watches your DAO&apos;s treasury, spots trouble before payday, and writes the fix as a proposal. Your council decides. It never touches the money.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <a href="#health" className="rounded-full bg-[#C6FF3D] px-5 py-3 text-sm font-bold text-[#0C0D0E] transition hover:brightness-110 active:scale-[0.98]">See it counsel a DAO ↓</a>
          <a href="#safety" className="rounded-full border border-white/20 px-5 py-3 text-sm font-semibold text-[#F2F2EE] transition hover:border-[#C6FF3D]/60 hover:text-[#C6FF3D] active:scale-[0.98]">Why it can&apos;t steal</a>
        </div>
      </div>
      <Radar live={live} />
    </section>
  );
}

const MARQUEE = ["Proposes, never spends", "Your council decides", "Private by design", "Any chain via NEAR Intents"];
export function Marquee() {
  const row = MARQUEE.map((t) => <span key={t} className="flex items-center gap-6 pr-6 sm:gap-10 sm:pr-10">{t}<span aria-hidden>✦</span></span>);
  return (
    <div className="relative left-1/2 my-8 w-screen -translate-x-1/2 overflow-hidden py-6 sm:my-12 sm:py-8" aria-label="Proposes, never spends. Your council decides. Private by design. Any chain via NEAR Intents.">
      <div className="-rotate-2 bg-[#C6FF3D] py-2.5 text-[#0C0D0E] shadow-[0_0_40px_rgba(198,255,61,0.25)] sm:py-3.5">
        <div className="marquee-track flex font-[family-name:var(--font-syne)] text-base font-extrabold uppercase tracking-wide sm:text-xl" aria-hidden>
          {row}{row}{row}{row}
        </div>
      </div>
    </div>
  );
}

const SAFETY = [
  { big: "0", title: "keys to your money", body: "Coinsel can only suggest. It can't send money.", detail: "Its one permission is add_proposal, set by a function-call key." },
  { big: "2 of 3", title: "humans approve", body: "Nothing moves until the council votes.", detail: "Sputnik DAO policy: approval threshold 2 of 3 council members." },
  { big: "✓", title: "Private, with proof", body: "Your data stayed private — and you can check that.", detail: "NEAR AI Cloud runs in a TEE; we verify its attestation with a fresh nonce first." },
];
export function Safety() {
  return (
    <section id="safety" className="mt-12 min-w-0 sm:mt-16">
      <Reveal>
        <h2 className="font-[family-name:var(--font-syne)] text-3xl font-extrabold tracking-tight sm:text-5xl">Why it <span className="text-[#C6FF3D]">can&apos;t</span> steal</h2>
        <p className="mt-2 max-w-xl text-[#B7BBB6]">Three locks, and you can check each one.</p>
      </Reveal>
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        {SAFETY.map((s, i) => (
          <Reveal key={s.title} delay={i * 110}>
            <div className="h-full rounded-2xl border border-[#262A2E] bg-[#121315] p-5 transition hover:border-[#C6FF3D]/40">
              <div className="font-[family-name:var(--font-syne)] text-5xl font-extrabold text-[#C6FF3D]">{s.big}</div>
              <div className="mt-1 font-[family-name:var(--font-syne)] text-xl font-bold">{s.title}</div>
              <p className="mt-2 text-[#B7BBB6]">{s.body}</p>
              <details className="mt-3 text-xs text-[#8E928D]"><summary className="cursor-pointer">Details</summary><p className="mt-1">{s.detail}</p></details>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
