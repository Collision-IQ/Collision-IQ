// ACV + Diminished Value generator — request creation and listing.
//
// POST { attachmentId } — reads the uploaded estimate's stored text layer,
// extracts the intake facts, and opens a draft DV request. Nothing is charged
// here; payment happens through the existing Academy service checkout and is
// verified server-side before generation may run.

import { NextResponse } from "next/server";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import { getUploadedAttachments } from "@/lib/uploadedAttachmentStore";
import { buildDvExtraction, buildTotalLossExtraction } from "@/lib/dv/extract";
import { parseCarrierValuation } from "@/lib/dv/carrierValuation";
import { isDvReportMode, type DvReportMode } from "@/lib/dv/types";
import { createDvRequest, listDvRequests } from "@/lib/dv/store";
import { defaultTaxRatePctForState } from "@/lib/dv/salesTax";
import { getValueIqFee } from "@/lib/dv/valueIqPrice";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let viewer: Awaited<ReturnType<typeof requireCurrentUser>>;
  try {
    viewer = await requireCurrentUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }
    throw error;
  }

  const body = (await req.json().catch(() => null)) as {
    attachmentId?: string;
    mode?: string;
  } | null;
  const attachmentId = body?.attachmentId?.trim();
  const mode: DvReportMode = isDvReportMode(body?.mode) ? body.mode : "diminished_value";
  if (!attachmentId) {
    return NextResponse.json({ error: "Missing attachmentId" }, { status: 400 });
  }

  const [attachment] = await getUploadedAttachments([attachmentId], {
    ownerUserId: viewer.user.id,
  });
  if (!attachment) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }
  if (!attachment.text?.trim()) {
    return NextResponse.json(
      {
        error:
          "No readable text was extracted from this file. Upload the estimate PDF itself (not a photo of it) so the intake fields can be read.",
      },
      { status: 422 }
    );
  }

  // Total-loss mode prefers the carrier's Market Valuation Report (it is the
  // document being disputed, and it allows the line-by-line audit). A repair
  // estimate is still accepted: the ACV is built from live comps either way,
  // and the client warns the owner that the carrier audit will be absent.
  const carrierReadable =
    mode === "total_loss" &&
    (() => {
      const carrier = parseCarrierValuation(attachment.text);
      return carrier.vendor !== "unknown" && carrier.adjustedVehicleValue !== null;
    })();

  const extraction =
    mode !== "total_loss"
      ? buildDvExtraction({ text: attachment.text, filename: attachment.filename })
      : carrierReadable
        ? {
            ...buildTotalLossExtraction({ text: attachment.text, filename: attachment.filename }),
            sourceDocument: "carrier_valuation" as const,
          }
        : {
            ...buildDvExtraction({ text: attachment.text, filename: attachment.filename }),
            sourceDocument: "estimate" as const,
          };

  const request = await createDvRequest({
    userId: viewer.user.id,
    attachmentId,
    extraction,
  });

  return NextResponse.json({
    request,
    viewer: { isPlatformAdmin: viewer.isPlatformAdmin },
    intakeDefaults: {
      mode,
      lossDate: extraction.lossDate ?? "",
      zip: extraction.ownerZip ?? "",
      state: extraction.state ?? "",
      taxRatePct: defaultTaxRatePctForState(extraction.state),
      // The demanded appraisal fee tracks the live Value IQ price — it is
      // the indirect loss the owner actually paid for this report.
      appraisalFee: await getValueIqFee(),
    },
  });
}

export async function GET() {
  let viewer: Awaited<ReturnType<typeof requireCurrentUser>>;
  try {
    viewer = await requireCurrentUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }
    throw error;
  }

  const requests = await listDvRequests(viewer.user.id);
  return NextResponse.json({ requests });
}
