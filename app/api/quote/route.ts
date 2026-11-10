import { NextResponse } from "next/server";
import { getDryQuote, usdcToQuote } from "@/lib/intents";


/** Real NEAR Intents price quote (dry run). Optional ?usd= sets the gap to cover. */
export async function GET(req: Request) {
  const usd = Number(new URL(req.url).searchParams.get("usd") ?? 12);
  return NextResponse.json(await getDryQuote(usdcToQuote(Number.isFinite(usd) ? Math.min(usd, 100000) : 12)));
}
