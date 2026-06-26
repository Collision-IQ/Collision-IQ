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
  type ComparisonEstimateText,
  type OemCitationDensityAuthoritySource,
  type OemCitationDensityAuthorityTrace,
} from "@/lib/reports/annotatedCitationDensityEstimate";
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
import { retrieveDriveSupport } from "@/lib/ai/driveRetrievalService";
import { isDriveEnabled } from "@/lib/drive/download";
import type {
  DriveRetrievalRequest,
  DriveRetrievalResult,
} from "@/lib/ai/contracts/driveRetrievalContract";
import {
  buildVehicleLabel,
  extractVehicleIdentityFromText,
} from "@/lib/ai/vehicleContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  caseId?: unknown;
  activeCaseId?: unknown;
  artifactIds?: unknown;
  sourceDocumentId?: unknown;
  selectedSourceDocumentId?: unknown;
  selectedEstimateRole?: unknown;
  sourceFilename?: unknown;
  targetEstimate?: unknown;
  sameCaseFollowUp?: unknown;
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
    const caseId = coerceString(body.caseId) || coerceString(body.activeCaseId);
    const sourceDocumentId = coerceString(body.selectedSourceDocumentId) || coerceString(body.sourceDocumentId);
    const selectedEstimateRole = coerceString(body.selectedEstimateRole);
    const targetEstimate = coerceTargetEstimate(body.targetEstimate);
    const requestArtifactIds = coerceStringArray(body.artifactIds) ?? [];

    const report = caseId
      ? await getAnalysisReport(caseId, { ownerUserId: user.id })
      : await getLatestActiveAnalysisReport({ ownerUserId: user.id });
    if (!report) {
      return NextResponse.json(
        { error: caseId ? "Case was not found." : NO_ACTIVE_CASE_ERROR },
        { status: caseId ? 404 : 400 }
      );
    }

    const candidateAttachmentIds = uniqueStrings([
      ...report.artifactIds,
      ...requestArtifactIds,
      sourceDocumentId || undefined,
    ]);
    const sourceDocuments = await getUploadedAttachments(candidateAttachmentIds, { ownerUserId: user.id });
    const sourceDiagnostics = withFileReviewDiagnostics(sourceDocuments, buildCitationDensitySourcePdfDiagnostics(sourceDocuments));
    const sourceSelections = resolveOemSourceSelections({
      sourceDocuments,
      sourceDocumentId,
      selectedEstimateRole,
      targetEstimate,
      report: report.report,
      sourceDiagnostics,
    });
    const selectionDiagnostics = buildOemSelectionDiagnostics({
      requestedSourceDocumentId: sourceDocumentId,
      activeCaseId: report.id,
      sameCaseFollowUp: typeof body.sameCaseFollowUp === "boolean" ? body.sameCaseFollowUp : Boolean(caseId),
      ownerUserId: user.id,
      sourceDocuments,
      sourceSelections,
    });

    if (!sourceSelections.length) {
      if (sourceDocumentId) {
        const availableEstimateCandidates = sourceDiagnostics.acceptedEstimateCandidates.map((candidate) => candidate.filename);
        logOemAnnotatedEstimateRoute({
          ok: false,
          error: "The selected estimate could not be found.",
          selectionDiagnostics,
        });
        return NextResponse.json(
          {
            error: "The selected estimate could not be found.",
            userMessage: availableEstimateCandidates.length
              ? `The selected estimate could not be found. Available estimate candidates: ${availableEstimateCandidates.join(", ")}.`
              : "No estimate PDFs were found for Citation Density.",
            reportType: "oem-citation-density",
            routeName: "oem-citation-density",
            selectionDiagnostics,
            ...sourceDiagnostics,
          },
          { status: 400 }
        );
      }
      return missingSourcePdfResponse(sourceDiagnostics);
    }

    const outputs = [];
    const aggregateWarnings = new Set<string>();
    let annotatedFindingCount = 0;
    let unresolvedAnchorCount = 0;

    for (const selection of sourceSelections) {
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
      const comparisonEstimateTexts = sourceDocuments
        .filter((document) => document.id !== selection.selectedSourceDocumentId && isAnnotatableEstimatePdf(document))
        .map((document): ComparisonEstimateText => ({
          sourceDocumentId: document.id,
          fileName: document.filename || "Comparison estimate",
          text: document.text || "",
          estimateRole: inferComparisonEstimateRole(document.filename, estimateRole),
        }));
      const authorityTrace = await buildOemAuthorityTrace({
        selection,
        sourceDocument,
        sourceDocuments,
        comparisonEstimateTexts,
      });
      const wrongPrefixFinding = findWrongOemFindingIdentity([]);
      if (wrongPrefixFinding) {
        return NextResponse.json(
          {
            ok: false,
            error: "OEM Citation Density Report route received a Delta Citation Density Report finding.",
            userMessage: "OEM Citation Density Report route received a Delta Citation Density Report artifact. Regenerate the OEM Citation Density Report.",
            reportType: "oem-citation-density",
            routeName: "oem-citation-density",
            artifactReportType: getFindingReportType(wrongPrefixFinding),
            findingIdPrefixCheckPassed: false,
            findingId: wrongPrefixFinding.id,
          },
          { status: 422 }
        );
      }
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
        comparisonEstimateTexts,
        findings: [],
        authorityTrace,
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
      const findingsReportArtifactId = result.findingsReportExportId;
      const findingsReportUrl = findingsReportArtifactId
        ? `/api/reports/oem-citation-density/annotated-estimate?artifactId=${encodeURIComponent(findingsReportArtifactId)}`
        : undefined;
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
        findingsReportArtifactId,
        findingsReportUrl,
        findingsReportPdfBase64: result.findingsReportBytes
          ? Buffer.from(result.findingsReportBytes).toString("base64")
          : undefined,
        findingsReportPageCount: result.findingsReportPageCount,
        annotatedFindingCount: result.annotatedFindingCount,
        unresolvedAnchorCount: result.unresolvedAnchorCount,
        warnings: result.warnings,
        annotationMetadata: result.annotationMetadata,
        debugTrace: withOemSelectionDebug(result.debugTrace, selection, selectionDiagnostics),
        debugCounts: buildOemAnnotationDebugCounts(result.debugTrace),
        annotationMetadataUrl: `/api/reports/oem-citation-density/annotated-estimate?metadata=1&artifactId=${encodeURIComponent(artifactId)}`,
        selectedSourceLabel: selection.selectedSourceLabel,
        selectedEstimateTotal: selection.selectedEstimateTotal,
        comparisonEstimateTotal: selection.comparisonEstimateTotal,
        selectedEstimateForOemDensity: selection.selectedSourceLabel,
        selectedEstimateReason: selection.selectionReason,
        selectedEstimateDiagnostics: selectionDiagnostics,
        selectionReason: selection.selectionReason,
        selectedDocumentType: selection.selectedDocumentType,
        selectedDocumentConfidence: selection.selectedDocumentConfidence,
        ...selection.selectionDiagnostics,
      });
    }

    const primaryOutput = outputs[0];
    const responseDebugCounts = buildOemAnnotationDebugCounts(outputs[0]?.debugTrace);
    logOemAnnotatedEstimateRoute({
      ok: true,
      targetEstimate,
      selectedSourceDocumentId: primaryOutput?.sourceDocumentId,
      selectionDiagnostics,
      debugCounts: responseDebugCounts,
      outputCount: outputs.length,
    });

    return NextResponse.json({
      ok: true,
      reportType: "oem-citation-density",
      artifactVersion: OEM_CITATION_DENSITY_ARTIFACT_VERSION,
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
        ? describeReviewTarget(sourceSelections[0].attachment, targetEstimate === "all" ? "both" : targetEstimate, sourceDocuments)
        : undefined,
      selectedSourceDocumentId: primaryOutput?.sourceDocumentId,
      selectedSourceLabel: primaryOutput?.selectedSourceLabel,
      selectedEstimateRole: primaryOutput?.estimateRole,
      selectedEstimateTotal: primaryOutput?.selectedEstimateTotal,
      comparisonEstimateTotal: primaryOutput?.comparisonEstimateTotal,
      selectedEstimateForOemDensity: primaryOutput?.selectedEstimateForOemDensity,
      selectedEstimateReason: primaryOutput?.selectedEstimateReason,
      selectedEstimateDiagnostics: selectionDiagnostics,
      targetEstimate,
      selectionReason: outputs.map((output) => output.selectionReason).join(" "),
      routeName: "oem-citation-density",
      selectedEstimateFileName: primaryOutput?.selectedSourceLabel,
      actualSourcePdfName: outputs[0]?.debugTrace?.actualSourcePdfName,
      selectedDocumentType: sourceSelections[0]?.selectedDocumentType,
      selectedDocumentConfidence: sourceSelections[0]?.selectedDocumentConfidence,
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
        debugTrace: error.debugTrace,
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
  selectedEstimateRole: string;
  targetEstimate: OemCitationDensityTargetEstimate;
  report: Parameters<typeof resolveSourceEstimatePdfSelections>[0]["report"];
  sourceDiagnostics: ReturnType<typeof buildCitationDensitySourcePdfDiagnostics>;
}): SourceEstimatePdfSelection[] {
  const shouldAutoSelectLower =
    (params.targetEstimate === "auto" || params.targetEstimate === "selected") &&
    params.sourceDocuments.filter(isAnnotatableEstimatePdf).length >= 2;

  if (shouldAutoSelectLower) {
    const lowerSelections = resolveSourceEstimatePdfSelections({
      attachments: params.sourceDocuments,
      report: params.report,
      targetEstimate: "auto",
      findings: [],
    });
    if (lowerSelections.length > 0) {
      return lowerSelections.map((selection) => ({
        ...selection,
        selectionReason: params.sourceDocumentId
          ? `${selection.selectionReason} Ignored the supplied source document for OEM Citation Density because multiple estimate PDFs were present and OEM review defaults to the lower estimate.`
          : selection.selectionReason,
      }));
    }
  }

  if (params.sourceDocumentId) {
    const selected = params.sourceDocuments.find((document) => document.id === params.sourceDocumentId);
    return selected && isAnnotatableEstimatePdf(selected)
      ? [{
          attachment: selected,
          selectedSourceDocumentId: selected.id,
          selectedSourceLabel: selected.filename || "Selected estimate",
          selectedEstimateRole: normalizeRequestedEstimateRole(params.selectedEstimateRole, params.targetEstimate),
          selectedEstimateTotal: null,
          comparisonEstimateTotal: null,
          targetEstimate: params.targetEstimate === "all" ? "both" : params.targetEstimate,
          selectionReason: "The client supplied a source document ID.",
          selectedDocumentType: "estimate",
          selectedDocumentConfidence: 1,
          selectionDiagnostics: params.sourceDiagnostics,
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
        comparisonEstimateTotal: null,
        targetEstimate: "both" as const,
        selectionReason: "OEM Citation Density targetEstimate=all reviews every uploaded estimate PDF independently.",
        selectedDocumentType: "estimate" as const,
        selectedDocumentConfidence: 1,
        selectionDiagnostics: params.sourceDiagnostics,
      }));
  }

  return resolveSourceEstimatePdfSelections({
    attachments: params.sourceDocuments,
    report: params.report,
    targetEstimate: params.targetEstimate,
    findings: [],
  });
}

type OemSelectionDiagnostics = {
  route: "oem-citation-density";
  requestedSourceDocumentId: string | null;
  activeCaseId: string | null;
  sameCaseFollowUp: boolean;
  ownerUserId: string | null;
  candidateAttachmentCount: number;
  candidateEstimateCount: number;
  candidateEstimates: Array<{
    attachmentId: string;
    filename: string;
    estimateRole: SourceEstimatePdfSelection["selectedEstimateRole"];
    parsedTotal: number | null;
    grossTotal: number | null;
    netTotal: number | null;
    insurerOrShopHint: "carrier" | "shop" | "selected";
    selectedCandidate: boolean;
  }>;
  selectedEstimateForOemDensity: string | null;
  selectedEstimateReason: string | null;
  selectedEstimateTotal: number | null;
  comparisonEstimateTotal: number | null;
  selectionBypassedReason: string | null;
};

function buildOemSelectionDiagnostics(params: {
  requestedSourceDocumentId: string;
  activeCaseId: string | null;
  sameCaseFollowUp: boolean;
  ownerUserId: string;
  sourceDocuments: Awaited<ReturnType<typeof getUploadedAttachments>>;
  sourceSelections: SourceEstimatePdfSelection[];
}): OemSelectionDiagnostics {
  const selectedIds = new Set(params.sourceSelections.map((selection) => selection.selectedSourceDocumentId));
  const estimateCandidates = params.sourceDocuments.filter(isAnnotatableEstimatePdf);
  const primarySelection = params.sourceSelections[0] ?? null;
  const requestedWasBypassed =
    Boolean(params.requestedSourceDocumentId) &&
    Boolean(primarySelection) &&
    primarySelection?.selectedSourceDocumentId !== params.requestedSourceDocumentId;

  return {
    route: "oem-citation-density",
    requestedSourceDocumentId: params.requestedSourceDocumentId || null,
    activeCaseId: params.activeCaseId,
    sameCaseFollowUp: params.sameCaseFollowUp,
    ownerUserId: redactLogIdentifier(params.ownerUserId),
    candidateAttachmentCount: params.sourceDocuments.length,
    candidateEstimateCount: estimateCandidates.length,
    candidateEstimates: estimateCandidates.map((document) => {
      const totals = extractSafeEstimateTotals(document);
      const role = inferEstimateRole(document.filename);
      return {
        attachmentId: document.id,
        filename: document.filename || "Uploaded estimate",
        estimateRole: role,
        parsedTotal: totals.parsedTotal,
        grossTotal: totals.grossTotal,
        netTotal: totals.netTotal,
        insurerOrShopHint: role === "shop" ? "shop" : role === "carrier" ? "carrier" : "selected",
        selectedCandidate: selectedIds.has(document.id),
      };
    }),
    selectedEstimateForOemDensity: primarySelection?.selectedSourceLabel ?? null,
    selectedEstimateReason: primarySelection?.selectionReason ?? null,
    selectedEstimateTotal: primarySelection?.selectedEstimateTotal ?? null,
    comparisonEstimateTotal: primarySelection?.comparisonEstimateTotal ?? null,
    selectionBypassedReason: requestedWasBypassed
      ? "requested sourceDocumentId ignored because OEM Citation Density auto/default selection uses the lower estimate when sibling estimates are available"
      : null,
  };
}

function extractSafeEstimateTotals(document: Awaited<ReturnType<typeof getUploadedAttachments>>[number]) {
  const text = `${document.filename}\n${document.text ?? ""}`;
  return {
    parsedTotal: extractSafeMoneyAfterLabel(text, /(?:(?:estimate|repair|grand)\s+total|total|gross|net)/gi, "last"),
    grossTotal: extractSafeMoneyAfterLabel(text, /gross(?:\s+total)?/gi, "last"),
    netTotal: extractSafeMoneyAfterLabel(text, /net(?:\s+total)?/gi, "last"),
  };
}

function extractSafeMoneyAfterLabel(text: string, labelPattern: RegExp, mode: "first" | "last") {
  const pattern = new RegExp(
    `${labelPattern.source}\\s*[:#=/-]?\\s*\\$?\\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\\.\\d{2})?|[0-9]+(?:\\.\\d{2})?)`,
    labelPattern.flags.includes("i") ? "gi" : "g"
  );
  const matches = [...text.matchAll(pattern)];
  const raw = (mode === "first" ? matches[0] : matches.at(-1))?.[1];
  if (!raw) return null;
  const value = Number(raw.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function redactLogIdentifier(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes("@")) {
    const [local, domain] = trimmed.split("@");
    return `${local.slice(0, 2)}***@${domain ? "***" : ""}`;
  }
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

async function buildOemAuthorityTrace(params: {
  selection: SourceEstimatePdfSelection;
  sourceDocument: Awaited<ReturnType<typeof getUploadedAttachments>>[number];
  sourceDocuments: Awaited<ReturnType<typeof getUploadedAttachments>>;
  comparisonEstimateTexts: ComparisonEstimateText[];
}): Promise<OemCitationDensityAuthorityTrace> {
  const driveSearchAvailable = isDriveEnabled();
  const estimateText = [
    params.sourceDocument.text ?? "",
    ...params.comparisonEstimateTexts.map((item) => item.text),
  ].join("\n\n");
  const vehicle = extractVehicleSummary([
    params.sourceDocument.filename ?? "",
    params.sourceDocument.text ?? "",
    ...params.sourceDocuments.map((document) => `${document.filename ?? ""}\n${document.text ?? ""}`),
  ].join("\n"));
  const base = buildBaseOemAuthorityTrace({
    driveSearchAvailable,
    vehicle,
    blockedReason: driveSearchAvailable
      ? null
      : "Google Drive/internal authority retrieval is disabled or not configured for this server.",
  });

  if (!driveSearchAvailable) {
    return base;
  }

  try {
    const response = await retrieveDriveSupport({
      taskType: "oem_procedure_insight",
      userQuery: [
        "OEM Citation Density authority retrieval for an estimate PDF.",
        vehicle ? `Vehicle: ${vehicle}.` : "",
        `Selected estimate: ${params.selection.selectedSourceLabel}.`,
        "Find OEM procedures, OEM position statements, ADAS procedures, MOTOR/P-page support, SCRS/DEG-style estimating support, policy, and legal support relevant to the estimate rows.",
      ].filter(Boolean).join(" "),
      estimateText,
      firstPassAnswer: "OEM Citation Density export must retrieve authority before labeling findings citation-ready.",
      maxResults: 8,
      maxExcerptChars: 700,
    });

    if (!response || response.results.length === 0) {
      return {
        ...base,
        authorityTraceCompleted: Boolean(response),
        authorityCoverageStatus: response ? "complete" : "incomplete",
        googleDriveOrInternalSearchRan: true,
        driveSearchAttempted: true,
        authorityTraceBlockedReason: response ? null : "Google Drive/internal authority retrieval did not return a response.",
        skippedReason: response ? undefined : "Google Drive/internal authority retrieval did not return a response.",
        driveSearchCompleted: Boolean(response),
        driveMatchedFoldersCount: 0,
        driveDocumentsReviewedCount: 0,
        driveSearchTerms: extractDriveSearchTerms(response?.request),
      };
    }

    const authoritySources = response.results.map(mapDriveResultToAuthoritySource);
    const reviewedDocuments = uniqueStrings(response.results.map((result) => result.filename).filter(Boolean));
    const folders = uniqueStrings(response.results.map((result) => result.metadata.source).filter(Boolean));
    const contextText = buildAuthorityContextText(response.results);

    return {
      ...base,
      authorityTraceCompleted: true,
      authorityTraceBlockedReason: null,
      authorityCoverageStatus: "partial",
      googleDriveOrInternalSearchRan: true,
      skippedReason: undefined,
      driveSearchAttempted: true,
      driveSearchAvailable: true,
      driveSearchCompleted: true,
      driveMatchedFoldersCount: folders.length,
      driveDocumentsReviewedCount: reviewedDocuments.length,
      driveSearchTerms: extractDriveSearchTerms(response.request),
      driveMakeModelFolderMatched: response.results.some((result) =>
        result.metadata.vehicleMatchLevel === "exact_vehicle_match" ||
        result.metadata.vehicleMatchLevel === "manufacturer_match"
      ),
      driveMatchedFolders: folders,
      driveDocumentsReviewed: reviewedDocuments,
      oemSourcesReviewed: uniqueStrings(response.results
        .filter((result) => result.sourceBucket === "oem_procedures" || result.sourceBucket === "oem_position_statements")
        .map((result) => result.filename)),
      adasSourcesReviewed: uniqueStrings(response.results
        .filter((result) => result.documentClass === "adas_document" || /adas|calibration|scan/i.test(`${result.filename} ${result.excerpt.excerpt}`))
        .map((result) => result.filename)),
      motorPPageSourcesReviewed: uniqueStrings(response.results
        .filter((result) => /motor|p-?page|database|estimating/i.test(`${result.filename} ${result.excerpt.excerpt}`))
        .map((result) => result.filename)),
      policyLegalSourcesReviewed: uniqueStrings(response.results
        .filter((result) => result.sourceBucket === "pa_law" || result.sourceBucket === "insurer_guidelines")
        .map((result) => result.filename)),
      jurisdictionSourcesReviewed: uniqueStrings(response.results
        .filter((result) => result.sourceBucket === "pa_law")
        .map((result) => result.filename)),
      authoritySources,
      authorityContextText: contextText,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...base,
      googleDriveOrInternalSearchRan: true,
      driveSearchAttempted: true,
      authorityTraceBlockedReason: `Google Drive/internal authority retrieval failed: ${message}`,
      skippedReason: `Google Drive/internal authority retrieval failed: ${message}`,
    };
  }
}

function buildBaseOemAuthorityTrace(params: {
  driveSearchAvailable: boolean;
  vehicle: string | null;
  blockedReason: string | null;
}): OemCitationDensityAuthorityTrace {
  return {
    authorityTraceStarted: true,
    authorityTraceCompleted: false,
    authorityTraceBlockedReason: params.blockedReason,
    authorityCoverageStatus: "incomplete",
    googleDriveOrInternalSearchRan: false,
    skippedReason: params.blockedReason ?? undefined,
    sandPolishSupportFound: false,
    driveSearchAttempted: params.driveSearchAvailable,
    driveSearchAvailable: params.driveSearchAvailable,
    driveSearchCompleted: false,
    driveMatchedFoldersCount: 0,
    driveDocumentsReviewedCount: 0,
    driveSearchTerms: [],
    driveMakeModelFolderMatched: false,
    driveMatchedFolders: [],
    driveDocumentsReviewed: [],
    onlineSearchAttempted: false,
    onlineSourcesReviewed: [],
    jurisdictionResolved: inferJurisdiction(params.vehicle),
    jurisdictionSourcesReviewed: [],
    oemSourcesReviewed: [],
    adasSourcesReviewed: [],
    motorPPageSourcesReviewed: [],
    scrsSourcesReviewed: [],
    policyLegalSourcesReviewed: [],
    authoritySources: [],
  };
}

function mapDriveResultToAuthoritySource(result: DriveRetrievalResult): OemCitationDensityAuthoritySource {
  const sourceType = (() => {
    if (result.documentClass === "oem_procedure" || result.sourceBucket === "oem_procedures") return "oem_procedure";
    if (result.documentClass === "oem_position_statement" || result.sourceBucket === "oem_position_statements") return "oem_position_statement";
    if (result.sourceBucket === "pa_law") return "jurisdictional_law";
    if (result.sourceBucket === "insurer_guidelines") return "policy";
    if (result.documentClass === "adas_document") return "oem_procedure";
    if (/motor|p-?page|database|estimating/i.test(`${result.filename} ${result.excerpt.excerpt}`)) return "motor_database";
    return "uploaded_support";
  })();
  const isOemAuthority = sourceType === "oem_procedure" || sourceType === "oem_position_statement";
  return {
    title: result.filename,
    sourceType,
    evidenceTier: sourceType === "oem_procedure" ? 1 : sourceType === "oem_position_statement" ? 2 : sourceType === "motor_database" ? 3 : 4,
    verified: false,
    note: [
      isOemAuthority ? "Retrieved authority source reviewed; exact row-level applicability still needs human or matcher verification." : "",
      result.matchReason,
      result.metadata.pageHint ? `Page: ${result.metadata.pageHint}.` : "",
      result.metadata.vehicleApplicabilityReason ?? "",
    ].filter(Boolean).join(" "),
  };
}

function buildAuthorityContextText(results: DriveRetrievalResult[]) {
  return results
    .map((result) => [
      `Authority document: ${result.filename}`,
      `Class: ${result.documentClass}`,
      `Bucket: ${result.sourceBucket}`,
      result.metadata.pageHint ? `Page: ${result.metadata.pageHint}` : "",
      result.excerpt.excerpt,
    ].filter(Boolean).join("\n"))
    .join("\n\n");
}

function extractVehicleSummary(text: string) {
  const identity = extractVehicleIdentityFromText(text, "attachment");
  const label = buildVehicleLabel(identity, { includeTrim: true });
  if (label) return label;
  return text.match(/\b((?:19|20)\d{2}\s+(?:Acura|Audi|BMW|Buick|Cadillac|Chevrolet|Chevy|Chrysler|Dodge|Ford|Genesis|GMC|Honda|Hyundai|Infiniti|Jeep|Kia|Lexus|Lincoln|Mazda|Mercedes|Mini|Nissan|Ram|Subaru|Tesla|TESL|Toyota|Volkswagen|Volvo)\s+[A-Z0-9][A-Za-z0-9-]*(?:\s+[A-Z0-9][A-Za-z0-9-]*){0,3})\b/i)?.[1]?.replace(/\bTESL\b/i, "Tesla").trim() ?? null;
}

function inferJurisdiction(vehicle: string | null) {
  return vehicle ? null : null;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function extractDriveSearchTerms(request: DriveRetrievalRequest | undefined) {
  if (!request) return [];
  return uniqueStrings([
    request.vehicle?.year ? String(request.vehicle.year) : undefined,
    request.vehicle?.make,
    request.vehicle?.model,
    request.vehicle?.trim,
    ...(request.topics ?? []).map((topic) => topic.topic.replace(/_/g, " ")),
  ]).slice(0, 12);
}

function buildOemAnnotationDebugCounts(debugTrace: Awaited<ReturnType<typeof buildAnnotatedCitationDensityEstimatePdf>>["debugTrace"] | undefined) {
  if (!debugTrace) return undefined;
  return {
    reportType: debugTrace.reportType ?? "oem-citation-density",
    routeName: debugTrace.routeName,
    buildCommit: debugTrace.buildCommit,
    artifactVersion: debugTrace.artifactVersion ?? debugTrace.citationDensityArtifactVersion,
    citationDensityArtifactVersion: debugTrace.citationDensityArtifactVersion,
    uploadedFileNames: debugTrace.uploadedFileNames,
    reviewedEstimateFileNames: debugTrace.reviewedEstimateFileNames ?? (debugTrace.selectedEstimateFileName ? [debugTrace.selectedEstimateFileName] : []),
    selectedEstimateForOemDensity: debugTrace.selectedEstimateForOemDensity,
    selectedEstimateReason: debugTrace.selectedEstimateReason,
    selectedEstimateFileName: debugTrace.selectedEstimateFileName,
    selectedEstimateTotal: debugTrace.selectedEstimateTotal,
    comparisonEstimateTotal: debugTrace.comparisonEstimateTotal,
    selectedEstimateDiagnostics: debugTrace.selectedEstimateDiagnostics,
    selectedDocumentType: debugTrace.selectedDocumentType,
    selectedDocumentConfidence: debugTrace.selectedDocumentConfidence,
    actualSourcePdfName: debugTrace.actualSourcePdfName,
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
    rejectedAnchors: debugTrace.rejectedAnchors ?? [],
    rejectedBoilerplateCount: debugTrace.rejectedBoilerplateCount ?? 0,
    acceptedEstimateRowFindings: debugTrace.acceptedEstimateRowFindingCount ?? 0,
    missingRequiredDetectors: debugTrace.missingRequiredDetectors ?? [],
    requiredDetectorFindingCount: debugTrace.requiredDetectorFindingCount ?? 0,
    policyExtractionConfidence: debugTrace.policyExtractionConfidence ?? "not_run",
    policyVehicleMismatch: debugTrace.policyVehicleMismatch ?? null,
    googleDriveInternalAuthoritySearch: debugTrace.authoritySearchTrace ?? null,
    artifactId: debugTrace.artifactId,
    metadataArtifactId: debugTrace.metadataArtifactId,
    renderedPdfArtifactId: debugTrace.renderedPdfArtifactId,
    sourceAnchorDocumentType: debugTrace.sourceAnchorDocumentType,
    sourceAnchorRowType: debugTrace.sourceAnchorRowType,
    badAnchorRejectedCount: debugTrace.badAnchorRejectedCount,
    badAnchorRejectReasons: debugTrace.badAnchorRejectReasons,
    artifactReportType: debugTrace.artifactReportType,
    findingIdPrefixCheckPassed: debugTrace.findingIdPrefixCheckPassed,
    toolUsageTrace: debugTrace.toolUsageTrace,
    totalDeltaCandidates: debugTrace.totalDeltaCandidates,
    acceptedDeltaFindings: debugTrace.acceptedDeltaFindings,
    rejectedDeltaFindings: debugTrace.rejectedDeltaFindings,
    annotationLimitApplied: debugTrace.annotationLimitApplied,
    maxAnnotationLimit: debugTrace.maxAnnotationLimit,
    droppedDeltaReasons: debugTrace.droppedDeltaReasons,
    unannotatedMaterialDeltas: debugTrace.unannotatedMaterialDeltas,
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
  return VALID_TARGET_ESTIMATES.has(target) ? target as OemCitationDensityTargetEstimate : "auto";
}

function normalizeRequestedEstimateRole(
  selectedEstimateRole: string,
  targetEstimate: OemCitationDensityTargetEstimate
): SourceEstimatePdfSelection["selectedEstimateRole"] {
  if (selectedEstimateRole === "carrier" || selectedEstimateRole === "shop") return selectedEstimateRole;
  if (targetEstimate === "carrier" || targetEstimate === "shop") return targetEstimate;
  return "selected";
}

function withOemSelectionDebug(
  debugTrace: Awaited<ReturnType<typeof buildAnnotatedCitationDensityEstimatePdf>>["debugTrace"] | undefined,
  selection: SourceEstimatePdfSelection,
  selectionDiagnostics?: OemSelectionDiagnostics
) {
  if (!debugTrace) return debugTrace;
  debugTrace.selectedEstimateForOemDensity = selection.selectedSourceLabel;
  debugTrace.selectedEstimateReason = selection.selectionReason;
  debugTrace.comparisonEstimateTotal = selection.comparisonEstimateTotal ?? null;
  debugTrace.selectedEstimateDiagnostics = selectionDiagnostics;
  return debugTrace;
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

function missingSourcePdfResponse(diagnostics: ReturnType<typeof buildCitationDensitySourcePdfDiagnostics> = {
  acceptedEstimateCandidates: [],
  rejectedSourceCandidates: [],
}) {
  return NextResponse.json(
    {
      error: NO_SOURCE_PDF_ERROR,
      userMessage: NO_SOURCE_PDF_USER_MESSAGE,
      reportType: "oem-citation-density",
      routeName: "oem-citation-density",
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
    usedInOemCitationDensityIds: sourceDocuments
      .filter((document) => /oem|procedure|position statement|repair manual/i.test(`${document.filename}\n${document.text ?? ""}`))
      .map((document) => document.id),
  });
  return {
    ...diagnostics,
    fileReviewLedger,
    evidenceCompletenessLedger: resolveEvidenceCompletenessFromLedger({
      ledger: fileReviewLedger,
      corpus: sourceDocuments.map((document) => `${document.filename}\n${document.text ?? ""}`).join("\n"),
    }),
    excludedSourceFiles: fileReviewLedger
      .filter((entry) => entry.exclusionReason || entry.usedAsSupportOnly)
      .map((entry) => ({
        filename: entry.filename,
        detectedType: entry.documentType,
        reason: entry.exclusionReason ?? (entry.usedAsSupportOnly ? "support-only document" : "not selected as estimate annotation base"),
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

function getFindingReportType(finding: CitationDensityFinding): string | undefined {
  const record = finding as CitationDensityFinding & { reportType?: string };
  return record.reportType;
}

function findWrongOemFindingIdentity(findings: CitationDensityFinding[]) {
  return findings.find((finding) => {
    const reportType = getFindingReportType(finding);
    return reportType === "citation-density" || /^citation-density-/i.test(finding.id);
  });
}
