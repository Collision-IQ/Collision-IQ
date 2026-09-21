import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import { decodeVinViaVpic, decodedVinToProfileFields } from "@/lib/nhtsa/vinDecode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/vehicle/decode-vin  Body: { vin: string }
 *
 * Decodes a VIN with NHTSA vPIC so the My Vehicle form can fill year, make
 * and model automatically. A VIN that cannot be decoded still returns 200
 * with `decoded.isValid === false` and an `errorText` the form shows next to
 * the field, leaving manual entry as the fallback. Nothing is persisted here;
 * the user still saves the profile.
 */
export async function POST(request: NextRequest) {
  try {
    await requireCurrentUser();
    const body = (await request.json().catch(() => null)) as { vin?: unknown } | null;
    const vin = typeof body?.vin === "string" ? body.vin.trim() : "";
    if (!vin) {
      return NextResponse.json({ error: "vin is required" }, { status: 400 });
    }
    const decoded = await decodeVinViaVpic(vin, { retries: 1, timeoutMs: 8000 });
    return NextResponse.json(
      { decoded, fields: decodedVinToProfileFields(decoded) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[vehicle/decode-vin] decode failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      { error: "NHTSA could not be reached to decode the VIN. Enter the year, make, and model manually." },
      { status: 502 }
    );
  }
}
