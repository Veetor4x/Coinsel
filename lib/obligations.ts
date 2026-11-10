// Validation for payout lists coming from the browser. Treat everything as untrusted.
import type { UiObligation } from "./engine-inputs";
import demo from "@/config/demo-treasury.json";

export function parseObligations(raw: unknown): UiObligation[] | null {
  const L = demo.limits;
  if (!Array.isArray(raw) || raw.length > L.maxPayouts) return null;
  const out: UiObligation[] = [];
  for (const o of raw) {
    if (!o || typeof o !== "object") return null;
    const r = o as Record<string, unknown>;
    if (typeof r.amountNear === "boolean" || Array.isArray(r.amountNear) || Array.isArray(r.dueInDays)) return null; // Number(true) / Number([5]) would sneak through
    const amountNear = Number(r.amountNear), dueInDays = Number(r.dueInDays);
    if (!Number.isFinite(amountNear) || amountNear < 0 || amountNear > L.maxPayoutNear || !Number.isFinite(dueInDays) || dueInDays < 0 || dueInDays > L.maxDueDays) return null;
    out.push({
      id: String(r.id ?? "").slice(0, 60), label: String(r.label ?? "").slice(0, 80),
      amountNear, dueInDays: Math.round(dueInDays), kind: String(r.kind ?? "payroll").slice(0, 20), note: String(r.note ?? "").slice(0, 200),
    });
  }
  return out;
}
