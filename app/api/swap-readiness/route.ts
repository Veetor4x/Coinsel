// What the treasury holds and whether it is registered on the two Tidepool token contracts (read-only).
import { NextResponse } from "next/server";
import { swapReadiness, tidepoolEnabled } from "@/lib/tidepool";
import { env } from "@/lib/env";

export const maxDuration = 30;

export async function GET() {
  const dao = env("DAO_ACCOUNT_ID");
  if (!dao || !tidepoolEnabled()) return NextResponse.json({ error: "The real test swap is switched off on this server." }, { status: 403 });
  try { return NextResponse.json(await swapReadiness(dao)); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); }
}
