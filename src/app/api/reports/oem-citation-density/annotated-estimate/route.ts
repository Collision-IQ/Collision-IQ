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
import {
  buildAnnotatedCitationDensityEstimatePdf,
  buildOemCitationDensityFindings,
  CitationDensityAnnotationError,
  dataUrlToPdfBytes,
  getAnnotatedEstimateExport,
  OEM_CITATION_DENSITY_ARTIFACT_VERSION,
  OEM_CITATION_DENSITY_REPORT_IDENTITY,
  type AnnotationMode,
} from "@/lib/reports/annotatedCitationDensityEstimate";
import {
  NO_SOURCE_PDF_ERROR,
  NO_SOURCE_PDF_USER_MESSAGE,
  describeReviewTarget,
  isAnnotatableEstimatePdf,
  isPdfDocument,
  resolveSourceEstimatePdfSelections,
  type SourceEstimatePdfSelection,
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
  includeUnanchoredAppendix?: unknown;
  redactSensitive?: unknown;
};

type OemCitationDensityTargetEstimate = "carrier" | "shop" | "selected" | "both" | "auto" | "all";

const VALID_TARGET_ESTIMATES = new Set(["carrier", "shop", "selected", "both", "auto", "all"]);
const VALID_ANNOTATION_MODES = new Set(["margin_callouts", "inline_highlight", "both"]);
const NO_ACTIVE_CASE_ERROR = "No active review was found. Open the case or run analysis before requesting an OEM Citation Density Report.";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const artifactId = url.searchParams.get("artifactId")?.trim() || url.searchParams.get("exportId")?.trim();
  if (!artifactId) {
    return NextResponse.json({ error: "artifactId is required." }, { status: 400 });
  }

  const entry = getAnnotatedEstimateExport(artifactId, OEM_CITATION_DENSITY_ARTIFACT_VERSION);
  if (!entry) {
    return NextResponse.json({
      error: "This export is no longer available. Regenerate OEM Citation Density Report.",
    }, { status: 404 });
  }

  if (url.searchParams.get("metadata") === "1") {
    return NextResponse.json({
      ok: true,
      artifactId,
      exportId: artifactId,
      filename: entry.filename,
      reportType: entry.reportType ?? "oem-citation-density",
      artifactVersion: entry.citationDensityArtifactVersion,
      citationDensityArtifactVersion: entry.citationDensityArtifactVersion,
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

    const sourceDocuments = await getUploadedAttachments(
      sourceDocumentId ? [sourceDocumentId] : report.artifactIds,
      { ownerUserId: user.id }
    );
    const sourceSelections = resolveOemSourceSelections({
      sourceDocuments,
      sourceDocumentId,
      targetEstimate,
      report: report.report,
    });

    if (!sourceSelections.length) {
      if (sourceDocumentId) {
        return NextResponse.json(
          {
            error: "Selected source PDF is not an original estimate PDF.",
            userMessage: "Select the original carrier or shop estimate PDF. OEM Citation Density Report annotates estimate source PDFs only.",
          },
          { status: 400 }
        );
      }
      return missingSourcePdfResponse();
    }

    const outputs = [];
    const aggregateWarnings = new Set<string>();
    let annotatedFindingCount = 0;
    let unresolvedAnchorCount = 0;

    for (const selection of sourceSelections) {
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
      const result = await buildAnnotatedCitationDensityEstimatePdf({
        sourcePdfBytes,
        sourceDocumentId: selection.selectedSourceDocumentId,
        sourcePdfName: selection.selectedSourceLabel,
        selectedEstimateTotal: selection.selectedEstimateTotal,
        uploadedFileNames: sourceDocuments.map((document) => document.filename).filter(Boolean),
        sourceText: [
          sourceDocument.text,
          ...sourceDocuments
            .filter((document) => document.id !== selection.selectedSourceDocumentId)
            .map((document) => document.text),
        ].filter(Boolean).join("\n"),
        comparisonEstimateTexts: sourceDocuments
          .filter((document) => document.id !== selection.selectedSourceDocumentId && isAnnotatableEstimatePdf(document))
          .map((document) => ({
            sourceDocumentId: document.id,
            fileName: document.filename || "Comparison estimate",
            text: document.text || "",
            estimateRole: inferComparisonEstimateRole(document.filename, estimateRole),
          })),
        findings: [],
        reportIdentity: OEM_CITATION_DENSITY_REPORT_IDENTITY,
        findingGenerator: buildOemCitationDensityFindings,
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
      const downloadUrl = `/api/reports/oem-citation-density/annotated-estimate?artifactId=${encodeURIComponent(artifactId)}`;
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
        debugTrace: result.debugTrace,
        debugCounts: buildOemAnnotationDebugCounts(result.debugTrace),
        annotationMetadataUrl: `/api/reports/oem-citation-density/annotated-estimate?metadata=1&artifactId=${encodeURIComponent(artifactId)}`,
        selectedSourceLabel: selection.selectedSourceLabel,
        selectedEstimateTotal: selection.selectedEstimateTotal,
        selectionReason: selection.selectionReason,
      });
    }

    const primaryOutput = outputs[0];
    const responseDebugCounts = buildOemAnnotationDebugCounts(outputs[0]?.debugTrace);
    logOemAnnotatedEstimateRoute({
      ok: true,
      targetEstimate,
      selectedSourceDocumentId: primaryOutput?.sourceDocumentId,
      debugCounts: responseDebugCounts,
      outputCount: outputs.length,
    });

    return NextResponse.json({
      ok: true,
      reportType: "oem-citation-density",
      artifactVersion: OEM_CITATION_DENSITY_ARTIFACT_VERSION,
      artifactId: primaryOutput?.artifactId ?? "",
      exportId: primaryOutput?.artifactId ?? "",
      downloadUrl: primaryOutput?.downloadUrl,
      outputs,
      combinedPdfUrl: outputs.length > 1 ? undefined : primaryOutput?.downloadUrl,
      annotatedFindingCount,
      unresolvedAnchorCount,
      annotationMetadata: primaryOutput?.annotationMetadata ?? [],
      debugTrace: outputs[0]?.debugTrace,
      debugCounts: responseDebugCounts,
      annotationMetadataUrl: primaryOutput?.annotationMetadataUrl,
      warnings: [...aggregateWarnings],
      reviewTarget: primaryOutput
        ? describeReviewTarget(sourceSelections[0].attachment, targetEstimate === "all" ? "both" : targetEstimate, sourceDocuments)
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

    if (error instanceof CitationDensityAnnotationError) {
      const debugCounts = buildOemAnnotationDebugCounts(error.debugTrace);
      logOemAnnotatedEstimateRoute({
        ok: false,
        error: error.message,
        debugCounts,
      });
      return NextResponse.json({
        ok: false,
        error: error.message,
        userMessage: error.userMessage,
        debugCounts,
      }, { status: error.status });
    }

    logOemAnnotatedEstimateRoute({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}

function resolveOemSourceSelections(params: {
  sourceDocuments: Awaited<ReturnType<typeof getUploadedAttachments>>;
  sourceDocumentId: string;
  targetEstimate: OemCitationDensityTargetEstimate;
  report: Parameters<typeof resolveSourceEstimatePdfSelections>[0]["report"];
}): SourceEstimatePdfSelection[] {
  if (params.sourceDocumentId) {
    const selected = params.sourceDocuments[0];
    return selected && isAnnotatableEstimatePdf(selected)
      ? [{
          attachment: selected,
          selectedSourceDocumentId: selected.id,
          selectedSourceLabel: selected.filename || "Selected estimate",
          selectedEstimateRole: params.targetEstimate === "carrier" || params.targetEstimate === "shop" ? params.targetEstimate : "selected",
          selectedEstimateTotal: null,
          targetEstimate: params.targetEstimate === "all" ? "both" : params.targetEstimate,
          selectionReason: "The client supplied a source document ID.",
        }]
      : [];
  }

  if (params.targetEstimate === "all") {
    return params.sourceDocuments
      .filter(isAnnotatableEstimatePdf)
      .map((document) => ({
        attachment: document,
        selectedSourceDocumentId: document.id,
        selectedSourceLabel: document.filename || "Uploaded estimate",
        selectedEstimateRole: inferEstimateRole(document.filename),
        selectedEstimateTotal: null,
        targetEstimate: "both" as const,
        selectionReason: "OEM Citation Density targetEstimate=all reviews every uploaded estimate PDF independently.",
      }));
  }

  return resolveSourceEstimatePdfSelections({
    attachments: params.sourceDocuments,
    report: params.report,
    targetEstimate: params.targetEstimate,
    findings: [],
  });
}

function buildOemAnnotationDebugCounts(debugTrace: Awaited<ReturnType<typeof buildAnnotatedCitationDensityEstimatePdf>>["debugTrace"] | undefined) {
  if (!debugTrace) return undefined;
  return {
    reportType: debugTrace.reportType ?? "oem-citation-density",
    buildCommit: debugTrace.buildCommit,
    artifactVersion: debugTrace.artifactVersion ?? debugTrace.citationDensityArtifactVersion,
    citationDensityArtifactVersion: debugTrace.citationDensityArtifactVersion,
    uploadedFileNames: debugTrace.uploadedFileNames,
    reviewedEstimateFileNames: debugTrace.reviewedEstimateFileNames ?? (debugTrace.selectedEstimateFileName ? [debugTrace.selectedEstimateFileName] : []),
    selectedEstimateFileName: debugTrace.selectedEstimateFileName,
    workerResolutionAttempted: debugTrace.workerResolutionAttempted,
    workerResolutionSucceeded: debugTrace.workerResolutionSucceeded,
    workerResolutionError: debugTrace.workerResolutionError,
    parserFallbackUsed: debugTrace.parserFallbackUsed,
    extractedTextPageCount: debugTrace.extractedTextPageCount,
    extractedAnchorCount: debugTrace.extractedAnchorCount,
    findingCount: debugTrace.findingCount,
    anchoredFindingCount: debugTrace.anchoredFindingCount,
    unanchoredFindingCount: debugTrace.unanchoredFindingCount,
    renderedPdfAnnotationCount: debugTrace.renderedPdfAnnotationCount,
    viewerAnnotationCount: debugTrace.viewerAnnotationCount,
    authoritySourceCount: debugTrace.authoritySourceCount ?? 0,
    oemProcedureSourceCount: debugTrace.oemProcedureSourceCount ?? 0,
    oemPositionStatementSourceCount: debugTrace.oemPositionStatementSourceCount ?? 0,
    motorDatabaseSourceCount: debugTrace.motorDatabaseSourceCount ?? 0,
    uploadedSupportDocumentCount: debugTrace.uploadedSupportDocumentCount ?? 0,
    cccSecureShareSourceCount: debugTrace.cccSecureShareSourceCount ?? 0,
    policySourceCount: debugTrace.policySourceCount ?? 0,
    jurisdictionalLawSourceCount: debugTrace.jurisdictionalLawSourceCount ?? 0,
    internetFallbackSourceCount: debugTrace.internetFallbackSourceCount ?? 0,
    authorityBackedFindingCount: debugTrace.authorityBackedFindingCount ?? 0,
    estimateOnlyFindingCount: debugTrace.estimateOnlyFindingCount ?? 0,
    researchNeededFindingCount: debugTrace.researchNeededFindingCount ?? 0,
    findingsWithNextActionCount: debugTrace.findingsWithNextActionCount ?? 0,
    findingsWithoutNextActionCount: debugTrace.findingsWithoutNextActionCount ?? 0,
    findingsRejectedDueWeakEvidence: debugTrace.findingsRejectedDueWeakEvidence ?? 0,
    findingsRejectedDueNoAnchor: debugTrace.findingsRejectedDueNoAnchor ?? 0,
    firstAuthoritySources: debugTrace.firstAuthoritySources ?? [],
    firstFindings: debugTrace.firstOemCitationDensityFindings ?? [],
    droppedReasons: debugTrace.partSourceDroppedReasons,
    artifactId: debugTrace.artifactId,
    metadataArtifactId: debugTrace.metadataArtifactId,
    renderedPdfArtifactId: debugTrace.renderedPdfArtifactId,
  };
}

function logOemAnnotatedEstimateRoute(payload: Record<string, unknown>) {
  console.log(`[oem-citation-density.annotated-estimate] ${JSON.stringify(payload)}`);
}

function coerceString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function coerceTargetEstimate(value: unknown): OemCitationDensityTargetEstimate {
  const target = coerceString(value);
  return VALID_TARGET_ESTIMATES.has(target) ? target as OemCitationDensityTargetEstimate : "all";
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

function inferEstimateRole(filename: string | undefined): SourceEstimatePdfSelection["selectedEstimateRole"] {
  const name = filename || "";
  if (/shop|repair facility|rta|appraisal/i.test(name)) return "shop";
  if (/carrier|insur|sor|geico|state farm|progressive|allstate/i.test(name)) return "carrier";
  return "selected";
}

function inferComparisonEstimateRole(
  filename: string | undefined,
  selectedRole: "carrier" | "shop" | "selected"
): "carrier" | "shop" {
  const name = filename || "";
  if (/shop|repair facility|rta|appraisal/i.test(name)) return "shop";
  if (/carrier|insur|sor|geico|state farm|progressive|allstate|estimate/i.test(name)) return "carrier";
  return selectedRole === "shop" ? "carrier" : "shop";
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
