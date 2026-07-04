import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import { getVehicleProfile, saveVehicleProfile, listVehicleAttachments } from "@/lib/userVehicleStore";
import { computeVehicleMaintenance, type ServiceRecord, type VehicleProfile } from "@/lib/vehicleMaintenance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function coerceString(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function coerceInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(/[,\s]/g, ""));
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

function coerceServiceRecord(value: unknown): ServiceRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const date = coerceString(v.date, 40);
  const mileage = coerceInt(v.mileage);
  if (date === null && mileage === null) return { date: null, mileage: null };
  return { date, mileage };
}

/** Whitelist the fields a client may write; everything else (mileageLog, updatedAt) is server-managed. */
function sanitizeProfileInput(body: unknown): Partial<VehicleProfile> {
  if (!body || typeof body !== "object") return {};
  const b = body as Record<string, unknown>;
  const out: Partial<VehicleProfile> = {};
  if ("vin" in b) out.vin = coerceString(b.vin, 32);
  if ("year" in b) out.year = coerceInt(b.year);
  if ("make" in b) out.make = coerceString(b.make, 60);
  if ("model" in b) out.model = coerceString(b.model, 60);
  if ("mileage" in b) {
    const m = coerceInt(b.mileage);
    if (m !== null) out.mileage = m;
  }
  if ("oilChange" in b) out.oilChange = coerceServiceRecord(b.oilChange);
  if ("tireRotation" in b) out.tireRotation = coerceServiceRecord(b.tireRotation);
  if ("tireChange" in b) out.tireChange = coerceServiceRecord(b.tireChange);
  return out;
}

export async function GET() {
  try {
    const { user } = await requireCurrentUser();
    const [profile, attachments] = await Promise.all([
      getVehicleProfile(user.id),
      listVehicleAttachments(user.id),
    ]);
    const maintenance = computeVehicleMaintenance(profile);
    return NextResponse.json({ profile, attachments, maintenance }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error, "load");
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { user } = await requireCurrentUser();
    const body = await request.json().catch(() => null);
    const input = sanitizeProfileInput(body);
    const profile = await saveVehicleProfile(user.id, input);
    const maintenance = computeVehicleMaintenance(profile);
    return NextResponse.json({ profile, maintenance }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error, "save");
  }
}

function handleError(error: unknown, action: string) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(`[vehicle] ${action} failed`, {
    message: error instanceof Error ? error.message : "Unknown error",
  });
  return NextResponse.json({ error: `Could not ${action} your vehicle.` }, { status: 500 });
}
