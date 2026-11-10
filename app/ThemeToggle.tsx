"use client";
import { useSyncExternalStore } from "react";

const KEY = "coinsel-theme";
const listeners = new Set<() => void>();
const isLight = () => document.documentElement.classList.contains("light");

function subscribe(cb: () => void) {
  listeners.add(cb);
  // Follow the system setting only while the visitor has not chosen.
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const onSystem = () => {
    let chosen: string | null = null;
    try { chosen = localStorage.getItem(KEY); } catch { /* storage blocked */ }
    if (chosen === "light" || chosen === "dark") return;
    document.documentElement.classList.toggle("light", mq.matches);
    cb();
  };
  mq.addEventListener("change", onSystem);
  return () => { listeners.delete(cb); mq.removeEventListener("change", onSystem); };
}

/** Sun/moon switch. Dark is the default; the choice is remembered in this browser only. */
export function ThemeToggle() {
  const light = useSyncExternalStore(subscribe, isLight, () => false);
  const flip = () => {
    const next = !isLight();
    document.documentElement.classList.toggle("light", next);
    try { localStorage.setItem(KEY, next ? "light" : "dark"); } catch { /* storage blocked: still works for this visit */ }
    listeners.forEach((l) => l());
  };
  return (
    <button
      type="button" onClick={flip} aria-pressed={light}
      aria-label={light ? "Switch to dark theme" : "Switch to light theme"} title={light ? "Light theme" : "Dark theme"}
      className="glass flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-fg transition hover:border-accent/60 active:scale-95"
    >
      {light ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      )}
    </button>
  );
}
