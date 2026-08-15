// Runs the paid generation: live comp research, then the deterministic ACV/DV
// calculation, stored as the request's result. Requires a verified payment
// (platform admins may run without one, for QA). The route claims the request
// atomically so a double-click cannot run two generations.

import { NextResponse } from "next/server";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import { runDvCompResearch } from "@/lib/dv/compSearch";
import { computeDvCalculation } from "@/lib/dv/acvMath";
import {
  claimDvRequestForProcessing,
  getDvRequest,
  markDvRequestFailed,
  markDvRequestReady,
} from "@/lib/dv/store";
import type { DvResult } from "@/lib/dv/types";

export const runtime = "nodejs";
export const maxDuration = 300;

function buildOpenItems(params: {
  result: Pick<DvResult, "compResearch" | "calculation">;
  lossDateProvided: boolean;
  claimPosture: string;
}): string[] {
  const items: string[] = [];
  const { compResearch, calculation } = params.result;

  if (calculation.postLoss.projected) {
    items.push(
      "Pull the CarFax History-Based Value for this VIN once the loss posts (typically post-repair), then regenerate — the projected post-loss value is replaced by the CarFax figure."
    );
  }
  items.push(
    "Save each comparable listing and its history report to PDF now (links and inventory die fast) to enclose as Comp Ad 1–3."
  );
  items.push(
    "If this estimate is preliminary, re-run after the final invoice and supplements post — DV demands are strongest with final repair documentation attached."
  );
  if (!params.lossDateProvided) {
    items.push("Confirm the date of loss before the letter goes out.");
  }
  if (params.claimPosture !== "third_party") {
    items.push(
      "Confirm this is a third-party claim against the at-fault carrier. First-party DV under the owner's own collision coverage is generally not recoverable under standard policy language in most states."
    );
  }
  if (compResearch.tier === 3) {
    items.push(
      "The 1-loss comp sweep came back dry; the documented sweep is enclosed as scarcity evidence supporting the stigma discount."
    );
  }
  items.push("Enclose the CARFAX report, repair photos, and final invoice per the house packet format.");
  return items;
}

export async function POST(
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
  if (request.status === "ready" && request.result) {
    return NextResponse.json({ request });
  }
  if (!request.intake) {
    return NextResponse.json(
      { error: "Complete the intake step before generating." },
      { status: 409 }
    );
  }
  if (!request.paidAt && !viewer.isPlatformAdmin) {
    return NextResponse.json(
      { error: "Payment is required before the report generates." },
      { status: 402 }
    );
  }

  const mileage = request.intake.mileage ?? request.extraction?.mileage;
  const repairTotal = request.intake.repairTotal ?? request.extraction?.repairTotal;
  const vehicle = request.extraction?.vehicle;
  if (!vehicle?.year || !vehicle.make || !vehicle.model) {
    return NextResponse.json(
      { error: "Vehicle year, make, and model could not be read from the estimate; they are required for the comp search." },
      { status: 422 }
    );
  }
  if (typeof mileage !== "number" || typeof repairTotal !== "number") {
    return NextResponse.json(
      { error: "Mileage and repair total are required — confirm them on the intake step." },
      { status: 422 }
    );
  }

  const claimed = viewer.isPlatformAdmin && !request.paidAt
    ? request
    : await claimDvRequestForProcessing(id);
  if (!claimed) {
    return NextResponse.json(
      { error: "This request is already generating or not in a runnable state." },
      { status: 409 }
    );
  }

  try {
    const dateAccessed = new Date().toISOString().slice(0, 10);
    const compResearch = await runDvCompResearch({
      vehicle,
      zip: request.intake.zip,
      dateAccessed,
      subjectMileage: mileage,
    });

    if (compResearch.status !== "completed") {
      const message =
        compResearch.failureReason ?? "Comparable research did not complete.";
      await markDvRequestFailed({ id, message });
      return NextResponse.json({ error: message, compResearch }, { status: 502 });
    }

    const calculation = computeDvCalculation({
      cleanComps: compResearch.clean,
      oneLossComps: compResearch.oneLoss,
      subjectMileage: mileage,
      taxRatePct: request.intake.taxRatePct,
      repairTotal,
      severity: request.extraction?.severity ?? {
        structural: false,
        airbag: false,
        adasCalibration: false,
      },
      appraisalFee: request.intake.appraisalFee,
      carfaxPostLossValue: request.intake.carfaxPostLossValue,
    });

    const result: DvResult = {
      compResearch,
      calculation,
      openItems: buildOpenItems({
        result: { compResearch, calculation },
        lossDateProvided: Boolean(request.intake.lossDate),
        claimPosture: request.intake.claimPosture,
      }),
      generatedAt: new Date().toISOString(),
    };

    const updated = await markDvRequestReady({ id, result });
    return NextResponse.json({ request: updated });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Generation failed unexpectedly.";
    await markDvRequestFailed({ id, message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
