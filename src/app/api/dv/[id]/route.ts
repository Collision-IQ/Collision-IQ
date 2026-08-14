// Single DV request: read, and intake updates while still editable.

import { NextResponse } from "next/server";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import { getDvRequest, updateDvIntake } from "@/lib/dv/store";
import type { DvClaimPosture, DvIntake } from "@/lib/dv/types";

export const runtime = "nodejs";

const CLAIM_POSTURES: readonly DvClaimPosture[] = ["third_party", "first_party", "unsure"];

function parseIntake(body: unknown): { intake?: DvIntake; error?: string } {
  if (!body || typeof body !== "object") return { error: "Missing intake payload" };
  const raw = body as Record<string, unknown>;

  const lossDate = typeof raw.lossDate === "string" ? raw.lossDate.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lossDate) && !/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(lossDate)) {
    return { error: "A date of loss is required (the estimate did not state one)." };
  }

  const claimPosture = raw.claimPosture;
  if (typeof claimPosture !== "string" || !CLAIM_POSTURES.includes(claimPosture as DvClaimPosture)) {
    return { error: "Claim posture must be third_party, first_party, or unsure." };
  }

  const zip = typeof raw.zip === "string" ? raw.zip.trim() : "";
  if (!/^\d{5}$/.test(zip)) {
    return { error: "A 5-digit registered ZIP code is required for the comp search." };
  }

  const taxRatePct = Number(raw.taxRatePct);
  if (!Number.isFinite(taxRatePct) || taxRatePct < 0 || taxRatePct > 15) {
    return { error: "Sales tax rate must be between 0 and 15 percent." };
  }

  const appraisalFee = Number(raw.appraisalFee ?? 350);
  if (!Number.isFinite(appraisalFee) || appraisalFee < 0 || appraisalFee > 2000) {
    return { error: "Appraisal fee must be between 0 and 2000." };
  }

  const optionalNumber = (value: unknown): number | undefined => {
    if (value === null || value === undefined || value === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };
  const optionalString = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, 120) : undefined;
  };

  return {
    intake: {
      lossDate,
      claimPosture: claimPosture as DvClaimPosture,
      zip,
      state: optionalString(raw.state)?.toUpperCase().slice(0, 2),
      taxRatePct,
      appraisalFee,
      ownerName: optionalString(raw.ownerName),
      insurer: optionalString(raw.insurer),
      claimNumber: optionalString(raw.claimNumber),
      mileage: optionalNumber(raw.mileage),
      repairTotal: optionalNumber(raw.repairTotal),
      carfaxPostLossValue: optionalNumber(raw.carfaxPostLossValue),
    },
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let viewer: Awaited<ReturnType<typeof requireCurrentUser>>;
  try {
    viewer = await requireCurrentUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }
    throw error;
  }

  const { id } = await params;
  const request = await getDvRequest(id, {
    userId: viewer.user.id,
    isPlatformAdmin: viewer.isPlatformAdmin,
  });
  if (!request) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    request,
    viewer: { isPlatformAdmin: viewer.isPlatformAdmin },
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let viewer: Awaited<ReturnType<typeof requireCurrentUser>>;
  try {
    viewer = await requireCurrentUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }
    throw error;
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = parseIntake(body);
  if (!parsed.intake) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const updated = await updateDvIntake({
    id,
    userId: viewer.user.id,
    intake: parsed.intake,
  });
  if (!updated) {
    return NextResponse.json(
      { error: "Request not found or no longer editable." },
      { status: 409 }
    );
  }
  return NextResponse.json({ request: updated });
}
