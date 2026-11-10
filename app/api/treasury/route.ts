import { NextResponse } from "next/server";
import { NETWORK } from "@/lib/near";
import { loadTreasury } from "@/lib/treasury";


export async function GET() {
  try {
    return NextResponse.json(await loadTreasury());
  } catch (e) {
    const m = (e as Error).message;
    return NextResponse.json({ error: m.startsWith("DAO_ACCOUNT_ID") ? m : `Could not read the DAO from NEAR ${NETWORK}: ${m}` }, { status: m.startsWith("DAO_ACCOUNT_ID") ? 500 : 502 });
  }
}
