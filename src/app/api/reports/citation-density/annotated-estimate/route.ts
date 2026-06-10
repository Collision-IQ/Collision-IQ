import { NextResponse } from "next/server";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";
import { getAnalysisReport } from "@/lib/analysisReportStore";
import { getUploadedAttachments } from "@/lib/uploadedAttachmentStore";
import { buildAnnotatedEstimateReviewModel } from "@/lib/ai/builders/estimateScrubberPdfBuilder";
import {
  buildAnnotatedCitationDensityEstimatePdf,
  dataUrlToPdfBytes,
  getAnnotatedEstimateExport,
  type AnnotationMode,
} from "@/lib/reports/annotatedCitationDensityEstimate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  caseId?: unknown;
  sourceDocumentId?: unknown;
  targetEstimate?: unknown;
  findingIds?: unknown;
  annotationMode?: unknown;
  includeLegend?: unknown;
  includeSummaryPage?: unknown;
  redactSensitive?: unknown;
};

const VALID_TARGET_ESTIMATES = new Set(["carrier", "shop", "selected"]);
const VALID_ANNOTATION_MODES = new Set(["margin_callouts", "inline_highlight", "both"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const exportId = url.searchParams.get("exportId")?.trim();
  if (!exportId) {
    return NextResponse.json({ error: "exportId is required." }, { status: 400 });
  }

  const entry = getAnnotatedEstimateExport(exportId);
  if (!entry) {
    return NextResponse.json({ error: "Export not found or expired." }, { status: 404 });
  }

  return new Response(Buffer.from(entry.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${entry.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  try {
    const { user } = await requireCurrentUser();
    const body = (await request.json().catch(() => ({}))) as RequestBody;
    const caseId = coerceString(body.caseId);
    const sourceDocumentId = coerceString(body.sourceDocumentId);
    const targetEstimate = coerceString(body.targetEstimate);

    if (!caseId) {
      return NextResponse.json({ error: "caseId is required." }, { status: 400 });
    }

    if (!sourceDocumentId) {
      return NextResponse.json({ error: "sourceDocumentId is required." }, { status: 400 });
    }

    if (!VALID_TARGET_ESTIMATES.has(targetEstimate)) {
      return NextResponse.json(
        { error: "targetEstimate must be carrier, shop, or selected." },
        { status: 400 }
      );
    }

    const report = await getAnalysisReport(caseId, { ownerUserId: user.id });
    if (!report) {
      return NextResponse.json({ error: "Case was not found." }, { status: 404 });
    }

    const [sourceDocument] = await getUploadedAttachments([sourceDocumentId], {
      ownerUserId: user.id,
    });

    if (!sourceDocument) {
      return NextResponse.json({ error: "Source document was not found." }, { status: 404 });
    }

    if (!isPdfDocument(sourceDocument.type, sourceDocument.filename)) {
      return NextResponse.json(
        { error: "sourceDocumentId must reference a PDF upload." },
        { status: 415 }
      );
    }

    const sourcePdfBytes = sourceDocument.imageDataUrl
      ? dataUrlToPdfBytes(sourceDocument.imageDataUrl)
      : null;

    if (!sourcePdfBytes) {
      return NextResponse.json(
        {
          error: "Original PDF bytes are unavailable for this upload. Re-upload the estimate PDF before requesting an annotated export.",
        },
        { status: 422 }
      );
    }

    const model = buildAnnotatedEstimateReviewModel({
      report: report.report,
      analysis: report.report.analysis ?? null,
      panel: null,
      renderModel: undefined,
    });

    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      findings: model.citationDensityFindings,
      request: {
        findingIds: coerceStringArray(body.findingIds),
        annotationMode: coerceAnnotationMode(body.annotationMode),
        includeLegend: body.includeLegend !== false,
        includeSummaryPage: body.includeSummaryPage === true,
        redactSensitive: body.redactSensitive !== false,
      },
    });

    const downloadUrl = `/api/reports/citation-density/annotated-estimate?exportId=${encodeURIComponent(result.exportId)}`;

    return NextResponse.json({
      ok: true,
      exportId: result.exportId,
      downloadUrl,
      annotatedFindingCount: result.annotatedFindingCount,
      unresolvedAnchorCount: result.unresolvedAnchorCount,
      warnings: result.warnings,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[citation-density-annotated-estimate] failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}

function coerceString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function coerceStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function coerceAnnotationMode(value: unknown): AnnotationMode {
  return typeof value === "string" && VALID_ANNOTATION_MODES.has(value)
    ? value as AnnotationMode
    : "both";
}

function isPdfDocument(type: string, filename: string) {
  return type === "application/pdf" || /\.pdf$/i.test(filename);
}
