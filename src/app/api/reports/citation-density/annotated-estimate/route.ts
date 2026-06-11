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
  isAnnotatableEstimatePdf,
  isPdfDocument,
  resolveSourceEstimatePdfSelections,
  type SourceEstimatePdfSelection,
} from "@/lib/reports/citationDensitySourcePdf";
import type { CitationDensityFinding } from "@/lib/ai/types/estimateScrubber";

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
  includeUnanchoredAppendix?: unknown;
  redactSensitive?: unknown;
};

const VALID_TARGET_ESTIMATES = new Set(["carrier", "shop", "selected", "both", "auto"]);
const VALID_ANNOTATION_MODES = new Set(["margin_callouts", "inline_highlight", "both"]);
const NO_ACTIVE_CASE_ERROR = "No active review was found. Open the case or run analysis before requesting an annotated estimate PDF.";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const artifactId = url.searchParams.get("artifactId")?.trim() || url.searchParams.get("exportId")?.trim();
  if (!artifactId) {
    return NextResponse.json({ error: "artifactId is required." }, { status: 400 });
  }

  const entry = getAnnotatedEstimateExport(artifactId);
  if (!entry) {
    return NextResponse.json({
      error: "This export is no longer available. Regenerate Citation Density PDF.",
    }, { status: 404 });
  }

  if (url.searchParams.get("metadata") === "1") {
    return NextResponse.json({
      ok: true,
      artifactId,
      exportId: artifactId,
      filename: entry.filename,
      annotationMetadata: entry.annotationMetadata,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
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
    const sourceSelections: SourceEstimatePdfSelection[] = sourceDocumentId
      ? sourceDocuments[0] && isAnnotatableEstimatePdf(sourceDocuments[0])
        ? [{
            attachment: sourceDocuments[0],
            selectedSourceDocumentId: sourceDocuments[0].id,
            selectedSourceLabel: sourceDocuments[0].filename || "Selected estimate",
            selectedEstimateRole: targetEstimate === "carrier" || targetEstimate === "shop" ? targetEstimate : "selected",
            selectedEstimateTotal: null,
            targetEstimate,
            selectionReason: "The client supplied a source document ID.",
          }]
        : []
      : resolveSourceEstimatePdfSelections({
          attachments: sourceDocuments,
          report: report.report,
          targetEstimate,
          findings: model.citationDensityFindings,
        });

    /*
     * Backward compatibility: if a caller still sends sourceDocumentId, honor it.
     * New chat/export flows should send it after the user selects an original estimate PDF.
     */
    const legacySourceDocument = sourceDocumentId
      ? sourceDocuments[0] && isAnnotatableEstimatePdf(sourceDocuments[0]) ? sourceDocuments[0] : null
      : null;
    const resolvedSelections = sourceSelections.length
      ? sourceSelections
      : legacySourceDocument
        ? [{
            attachment: legacySourceDocument,
            selectedSourceDocumentId: legacySourceDocument.id,
            selectedSourceLabel: legacySourceDocument.filename || "Selected estimate",
            selectedEstimateRole: targetEstimate === "carrier" || targetEstimate === "shop" ? targetEstimate : "selected" as const,
            selectedEstimateTotal: null,
            targetEstimate,
            selectionReason: "The client supplied a source document ID.",
          }]
        : [];

    if (!resolvedSelections.length) {
      if (sourceDocumentId) {
        return NextResponse.json(
          {
            error: "Selected source PDF is not an original estimate PDF.",
            userMessage: "Select the original carrier or shop estimate PDF. Citation Density annotated export will not annotate a report-only PDF.",
          },
          { status: 400 }
        );
      }
      if (!sourceDocumentId && sourceDocuments.filter((document) =>
        isAnnotatableEstimatePdf(document)
      ).length > 1) {
        return NextResponse.json(
          {
            error: "Estimate source selection is ambiguous.",
            userMessage: "Please choose the carrier or shop source PDF for the annotated Citation Density estimate.",
            targetEstimate,
          },
          { status: 400 }
        );
      }
      return missingSourcePdfResponse();
    }

    const availablePdfCount = sourceDocuments.filter(isAnnotatableEstimatePdf).length;
    if (
      targetEstimate === "both" &&
      availablePdfCount > 1 &&
      !(
        resolvedSelections.some((selection) => selection.selectedEstimateRole === "carrier") &&
        resolvedSelections.some((selection) => selection.selectedEstimateRole === "shop")
      )
    ) {
      return NextResponse.json(
        {
          error: "Could not identify both carrier and shop estimate PDFs for annotation.",
          userMessage: "Please select the carrier and shop estimate PDFs to annotate both estimates.",
        },
        { status: 400 }
      );
    }

    const outputs = [];
    const aggregateWarnings = new Set<string>();
    let annotatedFindingCount = 0;
    let unresolvedAnchorCount = 0;

    for (const selection of resolvedSelections) {
      const sourceDocument = selection.attachment;
      if (!isPdfDocument(sourceDocument.type, sourceDocument.filename)) {
        return missingSourcePdfResponse();
      }

      const sourcePdfBytes = sourceDocument.imageDataUrl
        ? dataUrlToPdfBytes(sourceDocument.imageDataUrl)
        : null;
      if (!sourcePdfBytes) {
        return missingSourcePdfResponse();
      }

      const estimateRole = normalizeOutputEstimateRole(selection.selectedEstimateRole);
      const roleFindings = filterFindingsForEstimateRole(model.citationDensityFindings, estimateRole);
      const result = await buildAnnotatedCitationDensityEstimatePdf({
        sourcePdfBytes,
        sourceText: sourceDocument.text,
        findings: roleFindings,
        request: {
          findingIds: coerceStringArray(body.findingIds),
          annotationMode: coerceAnnotationMode(body.annotationMode),
          estimateRole,
          includeLegend: body.includeLegend !== false,
          includeSummaryPage: body.includeSummaryPage === true,
          includeUnanchoredAppendix: body.includeUnanchoredAppendix !== false,
          redactSensitive: body.redactSensitive !== false,
        },
      });
      const artifactId = result.exportId;
      const downloadUrl = `/api/reports/citation-density/annotated-estimate?artifactId=${encodeURIComponent(artifactId)}`;
      result.warnings.forEach((warning) => aggregateWarnings.add(warning));
      annotatedFindingCount += result.annotatedFindingCount;
      unresolvedAnchorCount += result.unresolvedAnchorCount;
      outputs.push({
        artifactId,
        exportId: artifactId,
        estimateRole,
        sourceDocumentId: selection.selectedSourceDocumentId,
        downloadUrl,
        annotatedFindingCount: result.annotatedFindingCount,
        unresolvedAnchorCount: result.unresolvedAnchorCount,
        warnings: result.warnings,
        annotationMetadata: result.annotationMetadata,
        annotationMetadataUrl: `/api/reports/citation-density/annotated-estimate?metadata=1&artifactId=${encodeURIComponent(artifactId)}`,
        selectedSourceLabel: selection.selectedSourceLabel,
        selectedEstimateTotal: selection.selectedEstimateTotal,
        selectionReason: selection.selectionReason,
      });
    }

    const primaryOutput = outputs[0];

    return NextResponse.json({
      ok: true,
      artifactId: primaryOutput?.artifactId ?? "",
      exportId: primaryOutput?.artifactId ?? "",
      downloadUrl: primaryOutput?.downloadUrl,
      outputs,
      combinedPdfUrl: outputs.length > 1 ? undefined : primaryOutput?.downloadUrl,
      annotatedFindingCount,
      unresolvedAnchorCount,
      annotationMetadata: primaryOutput?.annotationMetadata ?? [],
      annotationMetadataUrl: primaryOutput?.annotationMetadataUrl,
      warnings: [...aggregateWarnings],
      reviewTarget: primaryOutput
        ? describeReviewTarget(resolvedSelections[0].attachment, targetEstimate, sourceDocuments)
        : undefined,
      selectedSourceDocumentId: primaryOutput?.sourceDocumentId,
      selectedSourceLabel: primaryOutput?.selectedSourceLabel,
      selectedEstimateRole: primaryOutput?.estimateRole,
      selectedEstimateTotal: primaryOutput?.selectedEstimateTotal,
      targetEstimate,
      selectionReason: outputs.map((output) => output.selectionReason).join(" "),
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
  return VALID_TARGET_ESTIMATES.has(target) ? target as CitationDensityTargetEstimate : "auto";
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

function normalizeOutputEstimateRole(
  role: SourceEstimatePdfSelection["selectedEstimateRole"]
): "carrier" | "shop" | "selected" {
  if (role === "carrier" || role === "shop") return role;
  return "selected";
}

function filterFindingsForEstimateRole(
  findings: CitationDensityFinding[],
  estimateRole: "carrier" | "shop" | "selected"
) {
  if (estimateRole === "selected") return findings;
  return findings.filter((finding) => {
    if (finding.primaryAnnotationRole === "both") return true;
    if (finding.primaryAnnotationRole === estimateRole) return true;
    if (finding.applicableEstimateRoles?.includes(estimateRole)) return true;
    if (estimateRole === "carrier") {
      return Boolean(finding.carrierEvidence) ||
        finding.estimateGapType === "missing_from_carrier" ||
        finding.estimateGapType === "reduced_by_carrier";
    }
    return Boolean(finding.shopEvidence) ||
      finding.estimateGapType === "missing_from_carrier" ||
      finding.estimateGapType === "reduced_by_carrier" ||
      finding.estimateGapType === "needs_proof" ||
      finding.estimateGapType === "referenced_not_produced";
  });
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
