import { NextResponse } from "next/server";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";
import {
  getAnalysisReport,
  getLatestActiveAnalysisReport,
} from "@/lib/analysisReportStore";
import { getUploadedAttachments } from "@/lib/uploadedAttachmentStore";
import { buildAnnotatedEstimateReviewModel } from "@/lib/ai/builders/estimateScrubberPdfBuilder";
import {
  buildAnnotatedCitationDensityEstimatePdf,
  dataUrlToPdfBytes,
  getAnnotatedEstimateExport,
  type AnnotationMode,
} from "@/lib/reports/annotatedCitationDensityEstimate";
import type { CitationDensityTargetEstimate } from "@/lib/reports/citationDensityIntent";
import {
  NO_SOURCE_PDF_ERROR,
  NO_SOURCE_PDF_USER_MESSAGE,
  describeReviewTarget,
  isPdfDocument,
  resolveSourceEstimatePdf,
} from "@/lib/reports/citationDensitySourcePdf";

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
const NO_ACTIVE_CASE_ERROR = "No active review was found. Open the case or run analysis before requesting an annotated estimate PDF.";

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
    const targetEstimate = coerceTargetEstimate(body.targetEstimate);

    const report = caseId
      ? await getAnalysisReport(caseId, { ownerUserId: user.id })
      : await getLatestActiveAnalysisReport({ ownerUserId: user.id });
    if (!report) {
      return NextResponse.json(
        { error: caseId ? "Case was not found." : NO_ACTIVE_CASE_ERROR },
        { status: caseId ? 404 : 400 }
      );
    }

    const candidateIds = sourceDocumentId ? [sourceDocumentId] : report.artifactIds;
    const sourceDocuments = await getUploadedAttachments(candidateIds, {
      ownerUserId: user.id,
    });
    const model = buildAnnotatedEstimateReviewModel({
      report: report.report,
      analysis: report.report.analysis ?? null,
      panel: null,
      renderModel: undefined,
    });
    const sourceDocument = sourceDocumentId
      ? sourceDocuments[0] ?? null
      : resolveSourceEstimatePdf({
          attachments: sourceDocuments,
          report: report.report,
          targetEstimate,
          findings: model.citationDensityFindings,
        });

    if (!sourceDocument) {
      return missingSourcePdfResponse();
    }

    if (!isPdfDocument(sourceDocument.type, sourceDocument.filename)) {
      return missingSourcePdfResponse();
    }

    const sourcePdfBytes = sourceDocument.imageDataUrl
      ? dataUrlToPdfBytes(sourceDocument.imageDataUrl)
      : null;

    if (!sourcePdfBytes) {
      return missingSourcePdfResponse();
    }

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
      reviewTarget: describeReviewTarget(sourceDocument, targetEstimate, sourceDocuments),
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

function coerceTargetEstimate(value: unknown): CitationDensityTargetEstimate {
  const target = coerceString(value);
  return VALID_TARGET_ESTIMATES.has(target) ? target as CitationDensityTargetEstimate : "selected";
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

function missingSourcePdfResponse() {
  return NextResponse.json(
    {
      error: NO_SOURCE_PDF_ERROR,
      userMessage: NO_SOURCE_PDF_USER_MESSAGE,
    },
    { status: 400 }
  );
}
