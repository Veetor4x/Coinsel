"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { sound } from "@/lib/sound";
import { useReducedMotion } from "./motion";

const mono = "font-[family-name:var(--font-mono-jb)]";

/** 🔊 toggle. OFF by default; the choice is remembered. */
export function SoundToggle() {
  const on = useSyncExternalStore(sound.subscribe, sound.isOn, () => false);
  useEffect(() => { sound.restore(); }, []);
  return (
    <button
      type="button" onClick={() => sound.toggle()} aria-pressed={on}
      aria-label={on ? "Turn sound off" : "Turn sound on"} title={on ? "Sound on" : "Sound off"}
      className={`fixed right-3 top-3 z-50 flex h-10 w-10 items-center justify-center rounded-full border text-lg backdrop-blur transition active:scale-95 ${on ? "border-[#C6FF3D]/60 bg-[#C6FF3D]/15" : "border-white/15 bg-[#121315]/80 opacity-80 hover:opacity-100"}`}
    >{on ? "🔊" : "🔇"}</button>
  );
}

/**
 * Self-typing "counsel log". The first three lines type while we wait; the last two type once the answer is in.
 * Reduced motion: lines simply appear.
 */
export function CounselLog({ readLines, done }: { readLines: string[]; done: boolean }) {
  const reduce = useReducedMotion();
  const lines = [...readLines, ...(done ? ["Proof checked ✓", "Suggestion ready"] : [])];
  const [pos, setPos] = useState({ line: 0, ch: 0 });
  useEffect(() => {
    if (reduce) return;
    const total = lines.length;
    if (pos.line >= total) return;
    const len = lines[pos.line].length;
    const t = setTimeout(() => {
      if (pos.ch >= len) setPos({ line: pos.line + 1, ch: 0 });
      else { if (pos.ch % 2 === 0) sound.tick(); setPos({ line: pos.line, ch: pos.ch + 1 }); }
    }, pos.ch >= len ? 420 : 24);
    return () => clearTimeout(t);
  }, [pos, lines.length, reduce]); // eslint-disable-line react-hooks/exhaustive-deps -- `lines` content only grows; its length is enough
  const shown = reduce ? lines : lines.map((l, i) => (i < pos.line ? l : i === pos.line ? l.slice(0, pos.ch) : null)).filter((l): l is string => l !== null);
  const finished = shown.length === lines.length && (reduce || pos.line >= lines.length);
  return (
    <div className="mt-4 rounded-xl border border-[#C6FF3D]/25 bg-black/40 p-4" role="status" aria-live="polite" aria-label="Coinsel is working">
      <div className={`${mono} mb-2 text-[10px] uppercase tracking-widest text-[#8E928D]`}>Counsel log</div>
      <pre className={`${mono} min-h-[7.5rem] whitespace-pre-wrap break-words text-[13px] leading-6 text-[#C6FF3D]`}>
        {shown.map((l, i) => <div key={i}><span className="text-[#8E928D]">› </span>{l}{i === shown.length - 1 && !finished && <span className="caret ml-0.5 inline-block h-3.5 w-1.5 bg-[#C6FF3D] align-middle" />}</div>)}
        {!done && shown.length >= readLines.length && pos.line >= readLines.length && <div className="text-[#8E928D]">› <span className="caret">▍</span></div>}
      </pre>
    </div>
  );
}

const SPARKS = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2, r = 70 + (i % 3) * 22;
  return { dx: Math.round(Math.cos(a) * r), dy: Math.round(Math.sin(a) * r) };
});
/** Lime rings + sparks + a faint glow over the page. Mount it with a new `key` to play again. */
export function Burst() {
  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-40 burst-flash bg-[radial-gradient(circle_at_50%_40%,rgba(198,255,61,0.16),transparent_60%)]" aria-hidden />
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center" aria-hidden>
        <span className="burst-ring absolute h-24 w-24 rounded-full border-2 border-[#C6FF3D]" />
        <span className="burst-ring absolute h-24 w-24 rounded-full border border-[#C6FF3D]" style={{ animationDelay: ".18s" }} />
        {SPARKS.map((s, i) => <span key={i} className="burst-spark absolute h-1.5 w-1.5 rounded-full bg-[#C6FF3D]" style={{ ["--dx" as string]: `${s.dx}px`, ["--dy" as string]: `${s.dy}px` }} />)}
      </div>
    </>
  );
}
