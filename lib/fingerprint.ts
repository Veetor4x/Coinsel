// A short fingerprint of the payout list (ids, amounts, due days only: labels and notes are ignored on purpose).
import { createHash } from "node:crypto";
import type { UiObligation } from "./engine-inputs";

export function payoutFingerprint(obs: Pick<UiObligation, "id" | "amountNear" | "dueInDays">[]): string {
  const rows = obs.map((o) => [o.id, Math.round(o.amountNear * 1e6) / 1e6, o.dueInDays]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16);
}
