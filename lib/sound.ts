// Coinsel sound: everything is generated live with the Web Audio API. No audio files, nothing to license.
// OFF by default. The choice is remembered in localStorage (wrapped in try/catch: it can be blocked).
/* eslint-disable @typescript-eslint/no-explicit-any -- webkitAudioContext fallback */

const KEY = "coinsel-sound";
type Voice = { a: OscillatorNode; b: OscillatorNode; gain: GainNode };

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let padGain: GainNode | null = null;
let voices: Voice[] = [];
let lfo: OscillatorNode | null = null;
let padTimer: ReturnType<typeof setInterval> | null = null;
let chordIdx = 0;
let on = false;
let armed = false; // waiting for the first tap/click (browsers block audio until then)
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

// Calm, slow chord loop (A minor add9 -> F major 7 -> C add9 -> G sus). Four voices glide between them.
const CHORDS = [
  [110.0, 164.81, 246.94, 261.63],
  [87.31, 130.81, 220.0, 329.63],
  [130.81, 196.0, 293.66, 329.63],
  [98.0, 146.83, 220.0, 246.94],
];

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  return ctx;
}

function startPad() {
  const c = audio();
  if (!c || !master || padGain) return;
  padGain = c.createGain();
  padGain.gain.value = 0;
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 700;
  filter.Q.value = 0.4;
  filter.connect(padGain);
  padGain.connect(master);
  // Slow breathing in the filter so the pad never sounds static.
  lfo = c.createOscillator();
  lfo.frequency.value = 0.06;
  const depth = c.createGain();
  depth.gain.value = 260;
  lfo.connect(depth);
  depth.connect(filter.frequency);
  lfo.start();
  voices = CHORDS[0].map((f, i) => {
    const gain = c.createGain();
    gain.gain.value = 0.22;
    const a = c.createOscillator(), b = c.createOscillator();
    a.type = "sine"; b.type = "triangle";
    a.frequency.value = f; b.frequency.value = f * 1.004 + i * 0.03; // tiny detune = warmth
    a.connect(gain); b.connect(gain); gain.connect(filter);
    a.start(); b.start();
    return { a, b, gain };
  });
  padGain.gain.setTargetAtTime(0.1, c.currentTime, 1.4); // fade in
  chordIdx = 0;
  padTimer = setInterval(() => {
    if (!ctx) return;
    chordIdx = (chordIdx + 1) % CHORDS.length;
    voices.forEach((v, i) => {
      v.a.frequency.setTargetAtTime(CHORDS[chordIdx][i], ctx!.currentTime, 1.6);
      v.b.frequency.setTargetAtTime(CHORDS[chordIdx][i] * 1.004, ctx!.currentTime, 1.6);
    });
  }, 9000);
}

function stopPad() {
  const c = ctx;
  if (padTimer) clearInterval(padTimer);
  padTimer = null;
  if (!c || !padGain) return;
  const g = padGain, vs = voices, l = lfo;
  padGain = null; voices = []; lfo = null;
  g.gain.setTargetAtTime(0, c.currentTime, 0.25); // fade out, then free everything
  setTimeout(() => {
    vs.forEach((v) => { try { v.a.stop(); v.b.stop(); } catch { /* already stopped */ } });
    try { l?.stop(); } catch { /* already stopped */ }
    try { g.disconnect(); } catch { /* ignore */ }
  }, 1500);
}

async function start() {
  const c = audio();
  if (!c || !on) return;
  try { if (c.state !== "running") await c.resume(); } catch { return; }
  if (on && c.state === "running") startPad();
}

function arm() {
  if (armed || typeof window === "undefined") return;
  armed = true;
  const go = () => {
    armed = false;
    ["pointerdown", "keydown", "touchend"].forEach((e) => window.removeEventListener(e, go));
    start();
  };
  ["pointerdown", "keydown", "touchend"].forEach((e) => window.addEventListener(e, go, { once: true }));
}

function save() {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* storage blocked: that's fine */ }
}

export const sound = {
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  isOn: () => on,
  /** Call once on page load: restores the saved choice. Audio only starts after the first tap (browser rule). */
  restore() {
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch { /* ignore */ }
    if (saved === "on" && !on) { on = true; emit(); arm(); }
  },
  /** Must be called from a click/tap so the browser lets audio start. */
  set(next: boolean) {
    on = next; save(); emit();
    if (next) { start(); } else { stopPad(); }
  },
  toggle() { sound.set(!on); },

  // ---- small UI sounds (all silent unless sound is on and the browser has allowed audio) ----
  /** Soft radar blip. */
  blip() { tone(1175, 0.05, 0.28, "sine", 0.004); },
  /** Tiny typing tick. */
  tick() { tone(1500 + Math.random() * 900, 0.014, 0.03, "square", 0.001, 4200); },
  /** Soft two-note chime: a suggestion was filed. */
  chime() { tone(880, 0.07, 0.9, "sine", 0.01); tone(1318.5, 0.06, 1.2, "sine", 0.01, undefined, 0.12); },
  /** Warm major chord: payroll is covered. */
  success() { [261.63, 329.63, 392.0, 523.25, 587.33].forEach((f, i) => tone(f, 0.055, 2.4, "triangle", 0.03, 2400, i * 0.07)); },
};

function tone(freq: number, vol: number, dur: number, type: OscillatorType, attack: number, lowpass?: number, delay = 0) {
  const c = ctx;
  if (!on || !c || !master || c.state !== "running") return;
  const t = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let tail: AudioNode = g;
  if (lowpass) { const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lowpass; g.connect(f); tail = f; }
  o.connect(g); tail.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}
