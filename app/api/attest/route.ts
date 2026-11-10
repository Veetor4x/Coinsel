import { NextResponse, connection } from "next/server";
import { verifyModel } from "@/lib/attestation";
import { getModel } from "@/lib/ai";

// Standalone proof check (no API key, no data sent). Fresh nonce every call.
export async function GET() {
  await connection();
  try {
    const { result } = await verifyModel(getModel());
    return NextResponse.json({ attestation: result });
  } catch (e) {
    return NextResponse.json({ error: `Couldn't verify this time: ${(e as Error).message}` }, { status: 502 });
  }
}
