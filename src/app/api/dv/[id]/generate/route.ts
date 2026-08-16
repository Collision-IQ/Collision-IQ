// Runs the paid generation: live comp research, then the deterministic ACV/DV
// calculation, stored as the request's result. Requires a verified payment
// (platform admins may run without one, for QA). The route claims the request
// atomically so a double-click cannot run two generations.

import { NextResponse } from "next/server";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import { runDvCompResearch } from "@/lib/dv/compSearch";
import { computeDvCalculation } from "@/lib/dv/acvMath";
import { getUploadedAttachments } from "@/lib/uploadedAttachmentStore";
import { parseCarrierValuation } from "@/lib/dv/carrierValuation";
import {
  buildTotalLossGap,
  computeTotalLossAcv,
  renderTotalLossLetterParagraphs,
} from "@/lib/dv/totalLoss";
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

function buildTotalLossOpenItems(totalLoss: DvResult["totalLoss"]): string[] {
  const items = [
    "Save each comparable listing to PDF now (links and inventory die fast) — they are Exhibits A1–A3 to this appraisal.",
    "Enclose the carrier's own Market Valuation Report as an exhibit; the audit page cites it directly.",
    "Confirm the loss date on this letter matches the carrier's report — CCC prints the REPORTED date beside the loss date and the two are often different.",
  ];
  if (totalLoss && totalLoss.carrier.comps.length === 0) {
    items.push(
      "The carrier's comparables could not be read from its report, so the 'carrier's own comps re-run' exhibit is omitted. Attach the report's comparable pages and re-run if that argument is wanted."
    );
  }
  items.push(
    "Sales tax, title and registration are excluded from this demand by design — they are added by the carrier on its settlement worksheet exactly as on the original offer."
  );
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
  const mode = request.intake.mode ?? "diminished_value";
  if (typeof mileage !== "number") {
    return NextResponse.json(
      { error: "Mileage is required — confirm it on the intake step." },
      { status: 422 }
    );
  }
  // A total loss has no repair total to demand against: the ACV is the
  // product. Only the diminished-value packet needs one.
  if (mode === "diminished_value" && typeof repairTotal !== "number") {
    return NextResponse.json(
      { error: "Repair total is required — confirm it on the intake step." },
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
      cleanMinAsking: request.intake.carfaxPostLossValue,
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
      repairTotal: repairTotal ?? 0,
      severity: request.extraction?.severity ?? {
        structural: false,
        airbag: false,
        adasCalibration: false,
      },
      appraisalFee: request.intake.appraisalFee,
      carfaxPostLossValue: request.intake.carfaxPostLossValue,
    });

    // ── Total-loss (value dispute) mode ──────────────────────────────────
    let totalLoss: DvResult["totalLoss"];
    if (mode === "total_loss") {
      const [carrierAttachment] = await getUploadedAttachments(
        [request.intake.carrierAttachmentId ?? request.attachmentId ?? ""],
        { ownerUserId: request.userId }
      );
      const carrier = parseCarrierValuation(carrierAttachment?.text ?? "");
      if (carrier.adjustedVehicleValue === null) {
        const message =
          "The carrier's valuation report could not be read well enough to reconcile against. Re-upload the CCC ONE or Mitchell Market Valuation Report the offer was based on.";
        await markDvRequestFailed({ id, message });
        return NextResponse.json({ error: message }, { status: 422 });
      }

      const acv = computeTotalLossAcv({
        subjectOdometer: mileage,
        comps: compResearch.clean,
        taxRatePct: request.intake.taxRatePct,
        appraisalFee: request.intake.appraisalFee,
      });
      const gap = buildTotalLossGap({ acv, carrier, subjectOdometer: mileage });
      totalLoss = {
        acv,
        carrier,
        gap,
        letterParagraphs: renderTotalLossLetterParagraphs({
          acv,
          carrier,
          gap,
          vehicleLabel: vehicle.label ?? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" "),
          lossDate: request.intake.lossDate,
          carrierName:
            request.intake.insurer ?? carrier.carrier ?? request.extraction?.insurer ?? "the carrier",
        }),
      };
    }

    const result: DvResult = {
      mode,
      compResearch,
      calculation,
      totalLoss,
      openItems:
        mode === "total_loss"
          ? buildTotalLossOpenItems(totalLoss)
          : buildOpenItems({
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
