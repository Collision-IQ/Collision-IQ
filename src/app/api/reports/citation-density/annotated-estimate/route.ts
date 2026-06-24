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
  buildRequiredEstimatorDeltaFindings,
  CitationDensityAnnotationError,
  dataUrlToPdfBytes,
  getAnnotatedEstimateExport,
  type AnnotationMode,
} from "@/lib/reports/annotatedCitationDensityEstimate";
import type { CitationDensityTargetEstimate } from "@/lib/reports/citationDensityIntent";
import {
  NO_SOURCE_PDF_ERROR,
  NO_SOURCE_PDF_USER_MESSAGE,
  buildCitationDensitySourcePdfDiagnostics,
  describeReviewTarget,
  isAnnotatableEstimatePdf,
  isPdfDocument,
  resolveSourceEstimatePdfSelections,
  type SourceEstimatePdfSelection,
} from "@/lib/reports/citationDensitySourcePdf";
import type { CitationDensityFinding } from "@/lib/ai/types/estimateScrubber";
import {
  buildFileReviewLedger,
  resolveEvidenceCompletenessFromLedger,
} from "@/lib/fileReviewLedger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  caseId?: unknown;
  artifactIds?: unknown;
  sourceDocumentId?: unknown;
  selectedSourceDocumentId?: unknown;
  selectedEstimateRole?: unknown;
  sourceFilename?: unknown;
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
const DELTA_REPORT_ROUTE = "/api/reports/citation-density/annotated-estimate";
const DELTA_REPORT_BUILD_MARKER = process.env.VERCEL_GIT_COMMIT_SHA ?? "local";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const artifactId = url.searchParams.get("artifactId")?.trim() || url.searchParams.get("exportId")?.trim();
  if (!artifactId) {
    return NextResponse.json({ error: "artifactId is required." }, { status: 400 });
  }

  const entry = getAnnotatedEstimateExport(artifactId);
  if (!entry) {
    return NextResponse.json({
      error: "This export is no longer available. Regenerate Delta Citation Density Report.",
    }, { status: 404 });
  }

  if (url.searchParams.get("metadata") === "1") {
    return NextResponse.json({
      ok: true,
      artifactId,
      exportId: artifactId,
      filename: entry.filename,
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
  let serverLogContext: Record<string, unknown> = {
    route: DELTA_REPORT_ROUTE,
    build: DELTA_REPORT_BUILD_MARKER,
    deltaMode: "structured_from_artifacts",
    structuredComparisonReady: false,
  };
  try {
    const { user } = await requireCurrentUser();
    const body = (await request.json().catch(() => ({}))) as RequestBody;
    const caseId = coerceString(body.caseId);
    const requestArtifactIds = coerceStringArray(body.artifactIds) ?? [];
    const sourceDocumentId = coerceString(body.selectedSourceDocumentId) || coerceString(body.sourceDocumentId);
    const selectedEstimateRole = coerceString(body.selectedEstimateRole);
    const targetEstimate = coerceTargetEstimate(body.targetEstimate);
    serverLogContext = {
      ...serverLogContext,
      caseId: caseId || null,
      artifactIdsCount: requestArtifactIds.length,
      sourceFilename: coerceString(body.sourceFilename),
      comparisonFilename: "",
      targetEstimate,
      structuredComparisonReady: requestArtifactIds.length >= 2,
    };

    const report = caseId
      ? await getAnalysisReport(caseId, { ownerUserId: user.id })
      : await getLatestActiveAnalysisReport({ ownerUserId: user.id });
    if (!report && requestArtifactIds.length === 0) {
      return NextResponse.json(
        { error: caseId ? "Case was not found." : NO_ACTIVE_CASE_ERROR },
        { status: caseId ? 404 : 400 }
      );
    }

    const candidateIds = uniqueStrings([
      ...(report?.artifactIds ?? []),
      ...requestArtifactIds,
      sourceDocumentId || undefined,
    ]);
    const sourceDocuments = await getUploadedAttachments(candidateIds, {
      ownerUserId: user.id,
    });
    serverLogContext = {
      ...serverLogContext,
      artifactIdsCount: candidateIds.length,
      comparisonFilename: sourceDocuments.find((document) => document.id !== sourceDocumentId)?.filename ?? "",
      structuredComparisonReady: sourceDocuments.filter(isAnnotatableEstimatePdf).length >= 2,
    };
    logDeltaReportGenerationEvent("delta_report_generation_started", serverLogContext);
    if (sourceDocuments.length === 0) {
      return missingSourcePdfResponse();
    }
    const sourceDiagnostics = withFileReviewDiagnostics(sourceDocuments, buildCitationDensitySourcePdfDiagnostics(sourceDocuments));
    const explicitSourceDocument = sourceDocumentId
      ? sourceDocuments.find((document) => document.id === sourceDocumentId) ?? null
      : null;
    const model = buildAnnotatedEstimateReviewModel({
      report: report?.report ?? null,
      analysis: report?.report.analysis ?? null,
      panel: null,
      renderModel: undefined,
    });
    const sourceSelections: SourceEstimatePdfSelection[] = sourceDocumentId
      ? explicitSourceDocument && isAnnotatableEstimatePdf(explicitSourceDocument)
        ? [{
            attachment: explicitSourceDocument,
            selectedSourceDocumentId: explicitSourceDocument.id,
            selectedSourceLabel: explicitSourceDocument.filename || "Selected estimate",
            selectedEstimateRole: resolveExplicitSourceEstimateRole(explicitSourceDocument, selectedEstimateRole, targetEstimate),
            selectedEstimateTotal: null,
            targetEstimate,
            selectionReason: `The client supplied a source document ID${body.sourceFilename ? ` for ${coerceString(body.sourceFilename)}` : ""}.`,
            selectedDocumentType: "estimate",
            selectedDocumentConfidence: 1,
            selectionDiagnostics: sourceDiagnostics,
          }]
        : []
      : resolveSourceEstimatePdfSelections({
          attachments: sourceDocuments,
          report: report?.report ?? null,
          targetEstimate,
          findings: model.citationDensityFindings,
        });

    /*
     * Backward compatibility: if a caller still sends sourceDocumentId, honor it.
     * New chat/export flows should send it after the user selects an original estimate PDF.
     */
    const legacySourceDocument = sourceDocumentId
      ? explicitSourceDocument && isAnnotatableEstimatePdf(explicitSourceDocument) ? explicitSourceDocument : null
      : null;
    const resolvedSelections = sourceSelections.length
      ? sourceSelections
      : legacySourceDocument
        ? [{
            attachment: legacySourceDocument,
            selectedSourceDocumentId: legacySourceDocument.id,
            selectedSourceLabel: legacySourceDocument.filename || "Selected estimate",
            selectedEstimateRole: resolveExplicitSourceEstimateRole(legacySourceDocument, selectedEstimateRole, targetEstimate),
            selectedEstimateTotal: null,
            targetEstimate,
            selectionReason: "The client supplied a source document ID.",
            selectedDocumentType: "estimate",
            selectedDocumentConfidence: 1,
            selectionDiagnostics: sourceDiagnostics,
          }]
        : [];

    if (!resolvedSelections.length) {
      if (sourceDocumentId) {
        const availableEstimateCandidates = sourceDiagnostics.acceptedEstimateCandidates.map((candidate) => candidate.filename);
        return NextResponse.json(
          {
            error: "The selected estimate could not be found.",
            userMessage: availableEstimateCandidates.length
              ? `The selected estimate could not be found. Available estimate candidates: ${availableEstimateCandidates.join(", ")}.`
              : "No estimate PDFs were found for Citation Density.",
            reportType: "citation-density",
            routeName: "citation-density",
            ...sourceDiagnostics,
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
            userMessage: "Choose a carrier or shop estimate before generating Citation Density.",
            targetEstimate,
            reportType: "citation-density",
            routeName: "citation-density",
            ...sourceDiagnostics,
          },
          { status: 400 }
        );
      }
      return missingSourcePdfResponse(sourceDiagnostics);
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
        return missingSourcePdfResponse(sourceDiagnostics);
      }

      const sourcePdfBytes = sourceDocument.imageDataUrl
        ? dataUrlToPdfBytes(sourceDocument.imageDataUrl)
        : null;
      if (!sourcePdfBytes) {
        return missingSourcePdfResponse(sourceDiagnostics);
      }

      const estimateRole = normalizeOutputEstimateRole(selection.selectedEstimateRole);
      const roleFindings = filterFindingsForEstimateRole(model.citationDensityFindings, estimateRole)
        // The legacy fuzzy-text comparison detector is replaced by the structured
        // line-item delta detector (buildRequiredEstimatorDeltaFindings). Drop the
        // legacy comparison findings so the report shows accurate, row-anchored
        // deltas instead of boilerplate-matched ones.
        .filter((finding) => !isLegacyComparisonFinding(finding));
      const wrongPrefixFinding = roleFindings.find((finding) => hasWrongFindingIdentity("citation-density", finding));
      if (wrongPrefixFinding) {
        return NextResponse.json(
          {
            ok: false,
            error: "Delta Citation Density Report route received an OEM Citation Density Report finding.",
            userMessage: "Delta Citation Density Report route received an OEM Citation Density Report artifact. Regenerate the Delta Citation Density Report.",
            reportType: "citation-density",
            routeName: "citation-density",
            artifactReportType: getFindingReportType(wrongPrefixFinding),
            findingIdPrefixCheckPassed: false,
            findingId: wrongPrefixFinding.id,
          },
          { status: 422 }
        );
      }
      const comparisonEstimateTexts = sourceDocuments
        .filter((document) => document.id !== selection.selectedSourceDocumentId && isAnnotatableEstimatePdf(document))
        .map((document) => ({
          sourceDocumentId: document.id,
          fileName: document.filename || "Comparison estimate",
          text: document.text || "",
          estimateRole: inferComparisonEstimateRole(document.filename, estimateRole),
        }));
      const result = await buildAnnotatedCitationDensityEstimatePdf({
        sourcePdfBytes,
        sourceDocumentId: selection.selectedSourceDocumentId,
        sourcePdfName: selection.selectedSourceLabel,
        selectedEstimateTotal: selection.selectedEstimateTotal,
        uploadedFileNames: sourceDocuments.map((document) => document.filename).filter(Boolean),
        sourceText: sourceDocument.text,
        comparisonEstimateTexts,
        findings: roleFindings,
        deltaDiagnostics: model.citationDensityDiagnostics,
        findingGenerator: buildRequiredEstimatorDeltaFindings,
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
        pdfBase64: Buffer.from(result.bytes).toString("base64"),
        estimateRole,
        sourceDocumentId: selection.selectedSourceDocumentId,
        downloadUrl,
        annotatedFindingCount: result.annotatedFindingCount,
        unresolvedAnchorCount: result.unresolvedAnchorCount,
        warnings: result.warnings,
        annotationMetadata: result.annotationMetadata,
        debugTrace: result.debugTrace,
        debugCounts: buildAnnotationDebugCounts(result.debugTrace),
        annotationMetadataUrl: `/api/reports/citation-density/annotated-estimate?metadata=1&artifactId=${encodeURIComponent(artifactId)}`,
        selectedSourceLabel: selection.selectedSourceLabel,
        selectedEstimateTotal: selection.selectedEstimateTotal,
        selectionReason: selection.selectionReason,
        selectedDocumentType: selection.selectedDocumentType,
        selectedDocumentConfidence: selection.selectedDocumentConfidence,
        ...selection.selectionDiagnostics,
      });
    }

    const primaryOutput = outputs[0];
    const responseDebugCounts = buildAnnotationDebugCounts(outputs[0]?.debugTrace);
    logDeltaReportGenerationEvent("delta_report_generation_complete", {
      ...serverLogContext,
      sourceFilename: primaryOutput?.selectedSourceLabel ?? serverLogContext.sourceFilename,
      artifactId: primaryOutput?.artifactId,
      outputCount: outputs.length,
      annotatedFindingCount,
      unresolvedAnchorCount,
    });
    logAnnotatedEstimateRoute({
      ok: true,
      targetEstimate,
      selectedSourceDocumentId: primaryOutput?.sourceDocumentId,
      debugCounts: responseDebugCounts,
      outputCount: outputs.length,
    });

    return NextResponse.json({
      ok: true,
      artifactId: primaryOutput?.artifactId ?? "",
      exportId: primaryOutput?.artifactId ?? "",
      pdfBase64: primaryOutput?.pdfBase64,
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
        ? describeReviewTarget(resolvedSelections[0].attachment, targetEstimate, sourceDocuments)
        : undefined,
      selectedSourceDocumentId: primaryOutput?.sourceDocumentId,
      selectedSourceLabel: primaryOutput?.selectedSourceLabel,
      selectedEstimateRole: primaryOutput?.estimateRole,
      selectedEstimateTotal: primaryOutput?.selectedEstimateTotal,
      targetEstimate,
      selectionReason: outputs.map((output) => output.selectionReason).join(" "),
      reportType: "citation-density",
      routeName: "citation-density",
      selectedEstimateFileName: primaryOutput?.selectedSourceLabel,
      actualSourcePdfName: outputs[0]?.debugTrace?.actualSourcePdfName,
      selectedDocumentType: resolvedSelections[0]?.selectedDocumentType,
      selectedDocumentConfidence: resolvedSelections[0]?.selectedDocumentConfidence,
      sourceAnchorDocumentType: outputs[0]?.debugTrace?.sourceAnchorDocumentType,
      sourceAnchorRowType: outputs[0]?.debugTrace?.sourceAnchorRowType,
      badAnchorRejectedCount: outputs[0]?.debugTrace?.badAnchorRejectedCount,
      badAnchorRejectReasons: outputs[0]?.debugTrace?.badAnchorRejectReasons,
      artifactReportType: outputs[0]?.debugTrace?.artifactReportType,
      findingIdPrefixCheckPassed: outputs[0]?.debugTrace?.findingIdPrefixCheckPassed,
      ...sourceDiagnostics,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof CitationDensityAnnotationError) {
      const debugCounts = buildAnnotationDebugCounts(error.debugTrace);
      logDeltaReportGenerationEvent("delta_report_generation_failed", {
        ...serverLogContext,
        error: error.message,
        status: error.status,
      });
      logAnnotatedEstimateRoute({
        ok: false,
        error: error.message,
        debugCounts,
      });
      return NextResponse.json({
        ok: false,
        error: error.message,
        userMessage: error.userMessage,
        debugCounts,
        debugTrace: error.debugTrace,
      }, { status: error.status });
    }

    logDeltaReportGenerationEvent("delta_report_generation_failed", {
      ...serverLogContext,
      error: error instanceof Error ? error.message : String(error),
      status: 500,
    });
    logAnnotatedEstimateRoute({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}

function buildAnnotationDebugCounts(debugTrace: Awaited<ReturnType<typeof buildAnnotatedCitationDensityEstimatePdf>>["debugTrace"] | undefined) {
  if (!debugTrace) return undefined;
  return {
    buildCommit: debugTrace.buildCommit,
    reportType: debugTrace.reportType,
    routeName: debugTrace.routeName,
    citationDensityArtifactVersion: debugTrace.citationDensityArtifactVersion,
    uploadedFileNames: debugTrace.uploadedFileNames,
    selectedEstimateFileName: debugTrace.selectedEstimateFileName,
    selectedEstimateTotal: debugTrace.selectedEstimateTotal,
    selectedDocumentType: debugTrace.selectedDocumentType,
    selectedDocumentConfidence: debugTrace.selectedDocumentConfidence,
    actualSourcePdfName: debugTrace.actualSourcePdfName,
    actualSourcePdfByteLength: debugTrace.actualSourcePdfByteLength,
    actualSourcePdfPageCount: debugTrace.actualSourcePdfPageCount,
    sourcePdfStage: debugTrace.sourcePdfStage,
    sourcePdfHash: debugTrace.sourcePdfHash,
    textExtractionMethod: debugTrace.textExtractionMethod,
    textExtractionError: debugTrace.textExtractionError,
    textExtractionWarnings: debugTrace.textExtractionWarnings,
    pdfWorkerResolvedPath: debugTrace.pdfWorkerResolvedPath,
    pdfWorkerExists: debugTrace.pdfWorkerExists,
    pdfWorkerSrc: debugTrace.pdfWorkerSrc,
    pdfjsImportMode: debugTrace.pdfjsImportMode,
    workerResolutionAttempted: debugTrace.workerResolutionAttempted,
    workerResolutionSucceeded: debugTrace.workerResolutionSucceeded,
    workerResolutionError: debugTrace.workerResolutionError,
    parserFallbackUsed: debugTrace.parserFallbackUsed,
    textExtractionInfrastructureStage: debugTrace.textExtractionInfrastructureStage,
    extractedTextPageCount: debugTrace.extractedTextPageCount,
    firstPageTextSample: debugTrace.firstPageTextSample,
    firstNonEmptyTextPage: debugTrace.firstNonEmptyTextPage,
    firstNonEmptyTextSample: debugTrace.firstNonEmptyTextSample,
    perPageTextLengths: debugTrace.perPageTextLengths,
    perPageTextItemCounts: debugTrace.perPageTextItemCounts,
    extractedAnchorCount: debugTrace.extractedAnchorCount,
    findingCount: debugTrace.findingCount,
    anchoredFindingCount: debugTrace.anchoredFindingCount,
    unanchoredFindingCount: debugTrace.unanchoredFindingCount,
    renderedPdfAnnotationCount: debugTrace.renderedPdfAnnotationCount,
    viewerAnnotationCount: debugTrace.viewerAnnotationCount,
    artifactId: debugTrace.artifactId,
    renderedPdfArtifactId: debugTrace.renderedPdfArtifactId,
    metadataArtifactId: debugTrace.metadataArtifactId,
    firstExtractedAnchorIds: debugTrace.firstAnchorIds,
    firstFindingAnchorIds: debugTrace.firstFindingAnchorIds,
    partSourceRowCount: debugTrace.partSourceRowCount,
    nonOemPartRowCount: debugTrace.nonOemPartRowCount,
    oemPartRowCount: debugTrace.oemPartRowCount,
    partSourceComparisonCandidateCount: debugTrace.partSourceComparisonCandidateCount,
    partSourceCandidateCount: debugTrace.partSourceCandidateCount,
    partSourceAcceptedCandidateCount: debugTrace.partSourceAcceptedCandidateCount,
    partSourceRejectedCandidateCount: debugTrace.partSourceRejectedCandidateCount,
    partSourceFindingCount: debugTrace.partSourceFindingCount,
    partSourceAnchoredFindingCount: debugTrace.partSourceAnchoredFindingCount,
    partSourceUnanchoredFindingCount: debugTrace.partSourceUnanchoredFindingCount,
    partSourceRows: debugTrace.partSourceRows,
    partSourceAcceptedCandidates: debugTrace.partSourceAcceptedCandidates,
    partSourceRejectedCandidates: debugTrace.partSourceRejectedCandidates,
    rejectedLineNumberCandidates: debugTrace.rejectedLineNumberCandidates,
    partSourceComparisonMatches: debugTrace.partSourceComparisonMatches,
    partSourceDroppedReasons: debugTrace.partSourceDroppedReasons,
    rejectedAnchors: debugTrace.rejectedAnchors ?? [],
    rejectedBoilerplateCount: debugTrace.rejectedBoilerplateCount ?? 0,
    acceptedEstimateRowFindings: debugTrace.acceptedEstimateRowFindingCount ?? 0,
    missingRequiredDetectors: debugTrace.missingRequiredDetectors ?? [],
    requiredDetectorFindingCount: debugTrace.requiredDetectorFindingCount ?? 0,
    policyExtractionConfidence: debugTrace.policyExtractionConfidence ?? "not_run",
    policyVehicleMismatch: debugTrace.policyVehicleMismatch ?? null,
    googleDriveInternalAuthoritySearch: debugTrace.authoritySearchTrace ?? null,
    fallbackMatchedFindings: debugTrace.fallbackMatchedFindings,
    droppedFindings: debugTrace.droppedFindings,
    rendererDrops: debugTrace.rendererDrops,
    toolUsageTrace: debugTrace.toolUsageTrace,
    totalDeltaCandidates: debugTrace.totalDeltaCandidates,
    acceptedDeltaFindings: debugTrace.acceptedDeltaFindings,
    rejectedDeltaFindings: debugTrace.rejectedDeltaFindings,
    annotationLimitApplied: debugTrace.annotationLimitApplied,
    maxAnnotationLimit: debugTrace.maxAnnotationLimit,
    droppedDeltaReasons: debugTrace.droppedDeltaReasons,
    unannotatedMaterialDeltas: debugTrace.unannotatedMaterialDeltas,
    sourceAnchorDocumentType: debugTrace.sourceAnchorDocumentType,
    sourceAnchorRowType: debugTrace.sourceAnchorRowType,
    badAnchorRejectedCount: debugTrace.badAnchorRejectedCount,
    badAnchorRejectReasons: debugTrace.badAnchorRejectReasons,
    artifactReportType: debugTrace.artifactReportType,
    findingIdPrefixCheckPassed: debugTrace.findingIdPrefixCheckPassed,
  };
}

function logAnnotatedEstimateRoute(payload: Record<string, unknown>) {
  console.log(`[citation-density.annotated-estimate] ${JSON.stringify(payload)}`);
}

function logDeltaReportGenerationEvent(stage: "delta_report_generation_started" | "delta_report_generation_complete" | "delta_report_generation_failed", payload: Record<string, unknown>) {
  console.log(`[analysis-lifecycle] ${JSON.stringify({
    stage,
    route: DELTA_REPORT_ROUTE,
    build: DELTA_REPORT_BUILD_MARKER,
    deltaMode: "structured_from_artifacts",
    ...payload,
  })}`);
}

function coerceString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function coerceTargetEstimate(value: unknown): CitationDensityTargetEstimate {
  const target = coerceString(value);
  return VALID_TARGET_ESTIMATES.has(target) ? target as CitationDensityTargetEstimate : "auto";
}

function normalizeRequestedEstimateRole(
  selectedEstimateRole: string | undefined,
  targetEstimate: CitationDensityTargetEstimate
): SourceEstimatePdfSelection["selectedEstimateRole"] {
  if (selectedEstimateRole === "carrier" || selectedEstimateRole === "shop") return selectedEstimateRole;
  if (targetEstimate === "carrier" || targetEstimate === "shop") return targetEstimate;
  return "selected";
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))];
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

function inferComparisonEstimateRole(
  filename: string | undefined,
  selectedRole: "carrier" | "shop" | "selected"
): "carrier" | "shop" {
  const name = filename || "";
  if (/shop|repair facility|body shop|rta|appraisal|final|revised/i.test(name)) return "shop";
  if (/carrier|insurer estimate|insurance estimate|sor|geico|state farm|progressive|allstate/i.test(name)) return "carrier";
  return selectedRole === "shop" ? "carrier" : "shop";
}

function resolveExplicitSourceEstimateRole(
  document: { filename?: string | null; text?: string | null },
  requestedRole: string | undefined,
  targetEstimate: CitationDensityTargetEstimate
): SourceEstimatePdfSelection["selectedEstimateRole"] {
  const normalized = normalizeRequestedEstimateRole(requestedRole, targetEstimate);
  if (normalized === "carrier" || normalized === "shop") return normalized;

  const text = `${document.filename ?? ""}\n${document.text ?? ""}`.toLowerCase();
  if (/\b(?:shop|repair facility|body shop|repairer|conestoga|final estimate|revised estimate|approved repairs?)\b/i.test(text)) {
    return "shop";
  }
  if (/\b(?:carrier estimate|insurer estimate|insurance estimate|sor|staff estimate|adjuster|appraiser)\b/i.test(text)) {
    return "carrier";
  }
  return normalized;
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

function missingSourcePdfResponse(diagnostics: ReturnType<typeof buildCitationDensitySourcePdfDiagnostics> = {
  acceptedEstimateCandidates: [],
  rejectedSourceCandidates: [],
}) {
  return NextResponse.json(
    {
      error: NO_SOURCE_PDF_ERROR,
      userMessage: NO_SOURCE_PDF_USER_MESSAGE,
      reportType: "citation-density",
      routeName: "citation-density",
      ...diagnostics,
    },
    { status: 422 }
  );
}

function withFileReviewDiagnostics(
  sourceDocuments: Awaited<ReturnType<typeof getUploadedAttachments>>,
  diagnostics: ReturnType<typeof buildCitationDensitySourcePdfDiagnostics>
) {
  const fileReviewLedger = buildFileReviewLedger(sourceDocuments, {
    usedInCitationDensityIds: diagnostics.acceptedEstimateCandidates
      .map((candidate) => sourceDocuments.find((document) => document.filename === candidate.filename)?.id)
      .filter((id): id is string => Boolean(id)),
  });
  return {
    ...diagnostics,
    fileReviewLedger,
    evidenceCompletenessLedger: resolveEvidenceCompletenessFromLedger({
      ledger: fileReviewLedger,
      corpus: sourceDocuments.map((document) => `${document.filename}\n${document.text ?? ""}`).join("\n"),
    }),
    excludedSourceFiles: fileReviewLedger
      .filter((entry) => !entry.usedInCitationDensity || entry.exclusionReason || entry.usedAsSupportOnly)
      .map((entry) => ({
        filename: entry.filename,
        detectedType: entry.documentType,
        reason: entry.exclusionReason ?? (entry.usedAsSupportOnly ? "support-only document" : "not selected as source estimate"),
        stage: entry.exclusionStage ?? "source_selection",
        indexed: entry.indexedStatus === "indexed",
        parsed: entry.textExtractionStatus === "extracted" || entry.pdfExtractionStatus === "available",
        supportOnly: entry.usedAsSupportOnly,
        duplicate: entry.isDuplicate,
        duplicateOf: entry.duplicateOf,
        reviewabilityHint: entry.reviewabilityHint,
      })),
  };
}

function isLegacyComparisonFinding(finding: CitationDensityFinding): boolean {
  if (!/-comparison-/i.test(finding.id)) return false;
  const text = [
    finding.currentSupportSummary,
    finding.missingProofSummary,
    finding.recommendedNextAction,
    ...(finding.limitations ?? []),
  ].join(" ");
  return !/estimate comparison evidence|comparison rows support|structured estimate comparison|source\/lower estimate|comparison\/final estimate/i.test(text);
}

function getFindingReportType(finding: CitationDensityFinding): string | undefined {
  const record = finding as CitationDensityFinding & { reportType?: string };
  return record.reportType;
}

function hasWrongFindingIdentity(routeName: "citation-density", finding: CitationDensityFinding) {
  const reportType = getFindingReportType(finding);
  return reportType === "oem-citation-density" || /^oem-citation-density-/i.test(finding.id);
}
