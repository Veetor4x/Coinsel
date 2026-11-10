import { NextResponse } from "next/server";
import { verifyAttestation } from "@/lib/attestation";

export const maxDuration = 60;

/** Run the private-AI verification on its own (same checks /api/analyze performs). */
export async function GET() {
  return NextResponse.json(await verifyAttestation());
}
