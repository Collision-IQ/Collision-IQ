import { createHash, randomUUID } from "node:crypto";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFPage,
  type PDFFont,
} from "pdf-lib";
import {
  PDFHexString,
  PDFName,
  type PDFRef,
} from "pdf-lib/cjs/core";
import { redactDownloadContent } from "@/lib/privacy/redactDownloadContent";
import type { CitationDensityFinding, CitationSupportStatus } from "@/lib/ai/types/estimateScrubber";
import {
  buildPdfRectFromTopLeftAnchor,
  normalizePdfRect,
  normalizeRotation,
  topLeftRectToPdfLibRect,
} from "./citationDensityCoordinates";
import {
  buildEstimateRowAnchorsFromLines,
  buildPdfTextLines,
  ensurePdfJsNodePolyfills,
  extractPdfWordsWithDiagnostics,
  findBestEstimateRowAnchorForFinding,
  type PdfTextExtractionMethod,
  type PdfTextLine,
  type EstimateRowAnchor,
  type EstimateRowAnchorType,
} from "./citationDensityRowAnchors";
import {
  classifyCitationDensityAnchorRow,
  classifyCitationDensityDocument,
  isBadCitationDensityAnchorText,
} from "./citationDensityDocumentClassifier";
import {
  deltaRowFromRawText,
  matchEstimateLineItems,
  parseCccEstimateRows,
  parseEstimateNetTotal,
  type EstimateDeltaRow,
  type EstimateLineItemDelta,
} from "./estimateDeltaMatcher";

export type AnnotationMode = "margin_callouts" | "inline_highlight" | "both";

export type AnnotatedEstimateRequest = {
  findingIds?: string[];
  annotationMode?: AnnotationMode;
  estimateRole?: "carrier" | "shop" | "selected";
  includeLegend?: boolean;
  includeSummaryPage?: boolean;
  includeUnanchoredAppendix?: boolean;
  redactSensitive?: boolean;
};

export type AnnotatedEstimateReportIdentity = {
  reportType: "citation-density" | "oem-citation-density";
  artifactVersion: string;
  reportTitle: string;
  reportShortTitle: string;
  artifactFilename: string;
  sourcePdfFallbackName: string;
  pdfAnnotationTitle: string;
  legendTitle: string;
  detailTitle: string;
  unanchoredTitle: string;
  scoreLabel: string;
  scoreCommentLabel: string;
  noAnchorError: string;
  noSelectableTextError: string;
  textExtractionInfrastructureError: string;
  pdfWorkerUnavailableError: string;
};

export type ComparisonEstimateText = {
  sourceDocumentId?: string;
  fileName: string;
  text: string;
  estimateRole?: "carrier" | "shop";
};

export type AnnotatedEstimateGeneratedFindings = {
  findings: CitationDensityFinding[];
  debug?: Partial<CitationDensityDebugTrace>;
};

export type CitationDensityToolUsageTraceEntry = {
  tool: string;
  ran: boolean;
  skipReason?: string;
  candidatesFound: number;
  candidatesAccepted: number;
  candidatesRejected: number;
  droppedReasons: string[];
  latencyMs?: number;
  provider?: string;
  model?: string;
};

export type CitationDensityDeltaDiagnostics = {
  toolUsageTrace: CitationDensityToolUsageTraceEntry[];
  totalDeltaCandidates: number;
  acceptedDeltaFindings: number;
  rejectedDeltaFindings: number;
  annotationLimitApplied: boolean;
  maxAnnotationLimit: number | null;
  droppedDeltaReasons: string[];
  unannotatedMaterialDeltas: Array<{
    rowId?: string;
    reason: string;
    summary: string;
  }>;
};

export type AnnotatedEstimateFindingGeneratorContext = {
  anchors: EstimateRowAnchor[];
  visualLines: PdfTextLine[];
  sourcePdfName: string;
  sourceDocumentId?: string;
  sourceDocumentRole: "carrier" | "shop";
  sourcePdfHash: string;
  uploadedFileNames: string[];
  sourceText?: string | null;
  comparisonEstimateTexts: ComparisonEstimateText[];
  authorityTrace?: OemCitationDensityAuthorityTrace;
};

export type AnnotatedEstimateResult = {
  exportId: string;
  bytes: Uint8Array;
  annotatedFindingCount: number;
  unresolvedAnchorCount: number;
  originalPageCount: number;
  finalPageCount: number;
  warnings: string[];
  annotationMetadata: CitationDensityAnnotationMetadata[];
  debugMetadata?: CitationDensityAnnotationDebugMetadata;
  debugTrace?: CitationDensityDebugTrace;
};

export type CitationDensityDebugTrace = {
  buildCommit?: string;
  citationDensityArtifactVersion: string;
  artifactId?: string;
  sourcePdfName?: string;
  selectedEstimateFileName?: string;
  selectedEstimateForOemDensity?: string;
  selectedEstimateReason?: string;
  selectedEstimateDiagnostics?: Record<string, unknown>;
  selectedEstimateTotal?: number | null;
  comparisonEstimateTotal?: number | null;
  uploadedFileNames?: string[];
  actualSourcePdfName?: string;
  actualSourcePdfByteLength: number;
  actualSourcePdfPageCount: number;
  sourcePdfStage: "original" | "redacted" | "converted" | "cached";
  sourcePdfHash: string;
  textExtractionMethod: PdfTextExtractionMethod | "not_run";
  textExtractionError?: string;
  textExtractionWarnings: string[];
  pdfWorkerResolvedPath?: string;
  pdfWorkerExists?: boolean;
  pdfWorkerSrc?: string;
  pdfjsImportMode?: "externalized-node-module" | "next-bundled-chunk";
  workerResolutionAttempted: boolean;
  workerResolutionSucceeded: boolean;
  workerResolutionError?: string;
  parserFallbackUsed: boolean;
  textExtractionInfrastructureStage?: "polyfills" | "pdfjs-import" | "worker-resolution" | "get-document" | "get-text-content";
  extractedTextPageCount: number;
  firstPageTextSample: string;
  firstNonEmptyTextPage: number | null;
  firstNonEmptyTextSample: string;
  perPageTextLengths: number[];
  perPageTextItemCounts: number[];
  extractedAnchorCount: number;
  findingCount: number;
  anchoredFindingCount: number;
  unanchoredFindingCount: number;
  renderedPdfAnnotationCount: number;
  viewerAnnotationCount?: number;
  firstAnchorIds: string[];
  firstFindingAnchorIds: Array<string | null>;
  partSourceRowCount: number;
  nonOemPartRowCount: number;
  oemPartRowCount: number;
  partSourceComparisonCandidateCount: number;
  partSourceCandidateCount: number;
  partSourceAcceptedCandidateCount: number;
  partSourceRejectedCandidateCount: number;
  partSourceFindingCount: number;
  partSourceAnchoredFindingCount: number;
  partSourceUnanchoredFindingCount: number;
  partSourceRows: PartSourceDebugRow[];
  partSourceAcceptedCandidates: PartSourceFindingCandidate[];
  partSourceRejectedCandidates: PartSourceFindingCandidate[];
  rejectedLineNumberCandidates: Array<{
    rowText: string;
    lineNumber?: string | number | null;
    reason: string;
  }>;
  partSourceComparisonMatches: PartSourceComparisonMatchDebug[];
  partSourceDroppedReasons: Array<{
    anchorId?: string | null;
    rowText?: string;
    reason: string;
  }>;
  rejectedAnchors?: Array<{
    anchorId?: string | null;
    pageNumber?: number | null;
    anchorType?: string | null;
    rowText?: string;
    reason: string;
  }>;
  rejectedBoilerplateCount?: number;
  acceptedEstimateRowFindingCount?: number;
  requiredDetectorFindingCount?: number;
  missingRequiredDetectors?: string[];
  policyExtractionConfidence?: "high" | "medium" | "low" | "failed" | "not_run";
  policyVehicleMismatch?: {
    policyVehicle?: string | null;
    activeEstimateVehicle?: string | null;
    warning: string;
  } | null;
  authoritySearchTrace?: OemCitationDensityAuthorityTrace;
  reportType?: "citation-density" | "oem-citation-density";
  artifactVersion?: string;
  reviewedEstimateFileNames?: string[];
  authoritySourceCount?: number;
  oemProcedureSourceCount?: number;
  oemPositionStatementSourceCount?: number;
  motorDatabaseSourceCount?: number;
  uploadedSupportDocumentCount?: number;
  cccSecureShareSourceCount?: number;
  cccSecureShareConfigured?: boolean;
  cccSecureShareSearched?: boolean;
  cccSecureShareMatched?: boolean;
  cccSecureShareRetrieved?: boolean;
  cccSecureShareRowCount?: number;
  cccSecureShareEstimateTotal?: number | null;
  cccSecureShareSupplementVersion?: string | null;
  cccSecureShareRetrievalFailed?: boolean;
  cccSecureShareUnavailableReason?: string | null;
  policySourceCount?: number;
  jurisdictionalLawSourceCount?: number;
  internetFallbackSourceCount?: number;
  authorityBackedFindingCount?: number;
  estimateOnlyFindingCount?: number;
  researchNeededFindingCount?: number;
  findingsWithNextActionCount?: number;
  findingsWithoutNextActionCount?: number;
  findingsRejectedDueWeakEvidence?: number;
  findingsRejectedDueNoAnchor?: number;
  firstAuthoritySources?: OemCitationDensityAuthoritySource[];
  firstOemCitationDensityFindings?: OemCitationDensityFindingDebug[];
  fallbackMatchedFindings: Array<{
    findingId: string;
    reason: string;
    anchorId?: string | null;
  }>;
  droppedFindings: Array<{
    findingId: string;
    reason: string;
    anchorId?: string | null;
  }>;
  rendererDrops: Array<{
    findingId: string;
    anchorId?: string | null;
    reason: string;
  }>;
  toolUsageTrace: CitationDensityToolUsageTraceEntry[];
  totalDeltaCandidates: number;
  acceptedDeltaFindings: number;
  rejectedDeltaFindings: number;
  annotationLimitApplied: boolean;
  maxAnnotationLimit: number | null;
  droppedDeltaReasons: string[];
  unannotatedMaterialDeltas: CitationDensityDeltaDiagnostics["unannotatedMaterialDeltas"];
  lineItemDeltaFindingCount?: number;
  lineItemDeltaMatchedPairCount?: number;
  lineItemDeltaMissingCount?: number;
  detailLayoutBlocks?: Array<{
    findingNumber: number;
    pageIndex: number;
    blockType: string;
    topY: number;
    bottomY: number;
  }>;
  metadataArtifactId?: string;
  renderedPdfArtifactId?: string;
  routeName?: "citation-density" | "oem-citation-density";
  selectedDocumentType?: string;
  selectedDocumentConfidence?: number;
  rejectedSourceCandidates?: Array<{
    filename: string;
    detectedDocumentType: string;
    reason: string;
  }>;
  acceptedEstimateCandidates?: Array<{
    filename: string;
    detectedDocumentType: string;
    estimateScore: number;
    evidenceSignals: string[];
  }>;
  sourceAnchorDocumentType?: string;
  sourceAnchorRowType?: string;
  badAnchorRejectedCount?: number;
  badAnchorRejectReasons?: string[];
  artifactReportType?: string;
  findingIdPrefixCheckPassed?: boolean;
};

export type PartSourceKind =
  | "OEM"
  | "OE"
  | "AM"
  | "LKQ"
  | "CAPA"
  | "USED"
  | "RECYCLED"
  | "RECONDITIONED"
  | "REMAN"
  | "ALT_OEM"
  | "OPT_OEM"
  | "NON_OEM"
  | "ECONOMY"
  | "UNKNOWN";

type PartSourceDebugRow = {
  page: number;
  line: string | null;
  sourceKind: PartSourceKind[];
  anchorId: string;
  sourcePdfName?: string;
  rowText: string;
};

export type PartSourceFindingCandidate = {
  anchorId: string;
  rowText: string;
  pageNumber: number;
  lineNumber?: string | number | null;
  rowType?: string;
  operation?: string | null;
  description?: string | null;
  partNumber?: string | null;
  partSourceKinds: PartSourceKind[];
  comparisonRowText?: string;
  comparisonPartSourceKinds?: PartSourceKind[];
  score: number;
  reasons: string[];
  rejectionReasons: string[];
};

type PartSourceComparisonMatchDebug = {
  selectedAnchorId: string;
  selectedRowText: string;
  comparisonRowText?: string;
  matchScore: number;
  matchReasons: string[];
  rejectedComparisonReasons: string[];
};

export class CitationDensityAnnotationError extends Error {
  status = 422;
  userMessage: string;
  debugTrace: CitationDensityDebugTrace;

  constructor(message: string, debugTrace: CitationDensityDebugTrace) {
    super(message);
    this.name = "CitationDensityAnnotationError";
    this.userMessage = message;
    this.debugTrace = debugTrace;
  }
}

function appendToolUsageTrace(trace: CitationDensityDebugTrace, entry: CitationDensityToolUsageTraceEntry) {
  trace.toolUsageTrace.push({
    ...entry,
    droppedReasons: entry.droppedReasons.filter(Boolean).slice(0, 20),
  });
}

export type CitationDensityAnnotationMetadata = {
  findingId: string;
  anchorId: string;
  sourceAnchorId: string;
  sourceDocumentId: string;
  sourceDocumentRole: "carrier" | "shop";
  sourcePdfPageNumber: number;
  sourcePageNumber: number;
  sourceLineNumber?: string;
  sourceAnchorType: EstimateRowAnchorType;
  sourceAnchorText: string;
  sourceAnchorNormalizedText: string;
  sourceAnchorOperation?: string | null;
  sourceAnchorDescription?: string | null;
  sourceAnchorPartNumber?: string | null;
  sourceAnchorQty?: number | null;
  sourceAnchorPrice?: number | null;
  sourceAnchorLabor?: number | null;
  sourceAnchorPaint?: number | null;
  sourceAnchorPdfBoundingBox?: EstimateRowAnchor["pdfBoundingBox"];
  sourceAnchorPdfQuad?: EstimateRowAnchor["pdfQuad"];
  sourceAnchorNormalizedUiRect?: EstimateRowAnchor["normalizedUiRect"];
  markerNumber: number;
  pageNumber: number;
  pdfPageWidth: number;
  pdfPageHeight: number;
  rotation: number;
  x: number;
  y: number;
  width: number;
  height: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  coordinateSpace: "pdf-points" | "normalized";
  targetLineNumber?: string;
  targetSection?: string;
  targetRawText: string;
  targetNormalizedText: string;
  matchConfidence: "high" | "medium" | "low";
  anchorType: EstimateRowAnchorType;
  label: string;
  shortTitle: string;
  estimateLine: string;
  bestAuthority: string;
  authorityStatus: string;
  missingProof: string;
  whyItMatters: string;
  nextAction: string;
  authorityNeeded?: boolean;
  authorityType?: string;
  retrievalAttempted?: boolean;
  retrievalSourcesSearched?: string[];
  retrievalStatus?: string;
  matchedDocumentTitle?: string | null;
  matchedDocumentUrl?: string | null;
  sourceExcerpt?: string | null;
  sourcePageLine?: string | null;
  appliesToShopEstimate?: "yes" | "no" | "unknown";
  appliesToCarrierEstimate?: "yes" | "no" | "unknown";
  lineTieStatus?: string;
  nextActionOwner?: string;
  sourceRefs: string[];
  comment: string;
};

export type CitationDensityAnnotationDebugMetadata = {
  extractedRowAnchorCount: number;
  visibleAnnotationCount: number;
  appendixOnlyCount: number;
  suppressedGenericCount: number;
  suppressedPageMismatchCount: number;
  anchorsByPage: Record<string, string[]>;
  findingsWithoutAnchorId: string[];
};

export type AnchoredCitationCandidate = {
  candidateId: string;
  anchorId: string;
  sourceDocumentRole: "carrier" | "shop";
  sourcePdfPageNumber: number;
  sourcePdfPageIndex: number;
  sourceLineNumber?: string;
  sourceAnchorType: EstimateRowAnchorType;
  sourceAnchorText: string;
  sourceAnchorNormalizedText: string;
  label: string;
  estimateLineDisplay: string;
  bestAuthority: string;
  missingProof: string;
  whyItMatters: string;
  nextAction: string;
  supportRefs: string[];
  confidence: "low" | "medium" | "high";
  finding: CitationDensityFinding;
  anchor: EstimateRowAnchor;
  derivedFromFindingId?: string;
};

type TextAnchor = {
  pageIndex: number;
  text: string;
  normalizedText: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
  synthetic?: boolean;
  groupedLine?: boolean;
};

type MatchedFinding = {
  finding: CitationDensityFinding;
  anchor: EstimateRowAnchor;
};

type FindingDetail = {
  finding: CitationDensityFinding;
  metadata: CitationDensityAnnotationMetadata;
};

const SOURCE_BOUNDARY_TEXT =
  "Estimate evidence supports the existence of a difference. It does not automatically prove OEM, P-page, DEG, legal, policy, or carrier-violation authority.";
const CCC_SOURCE_BOUNDARY_TEXT =
  "CCC Secure Share source confirms this estimate line was present in the structured estimate data.";
const CCC_LIMITATION_TEXT =
  "The CCC estimate data supports the existence of this line-item difference. OEM/P-page/DEG/legal support has not yet been verified.";

const LABELS = [
  "VERIFIED DOCUMENTATION",
  "VERIFIED OEM",
  "VERIFIED ADAS",
  "VERIFIED LEGAL",
  "NEEDS OEM",
  "NEEDS ADAS",
  "NEEDS P-PAGE",
  "NEEDS INVOICE",
  "REFERENCED / NOT PRODUCED",
  "ESTIMATE GAP ONLY",
  "ONLINE FALLBACK",
  "WEAK — DO NOT LEAD",
] as const;

const NO_ROWS_EXTRACTED_WARNING = "No estimate rows could be extracted from the source PDF.";
const NO_SAFE_ROW_FINDINGS_WARNING =
  "Estimate rows were extracted, but no generated finding could be safely tied to a row. Findings are appendix-only.";
export const CITATION_DENSITY_ARTIFACT_VERSION = "citation-density-part-source-relevance-v1";
export const OEM_CITATION_DENSITY_ARTIFACT_VERSION = "oem-citation-density-v1";
export const OEM_CITATION_DENSITY_REPORT_TYPE = "oem-citation-density";
export const NO_ANCHOR_EXTRACTION_ERROR =
  "Delta Citation Density Report could not extract estimate row anchors from the selected estimate PDF. No annotation PDF was produced.";
export const NO_SELECTABLE_TEXT_ERROR =
  "Delta Citation Density Report could not extract selectable text from the selected estimate PDF. Upload the original CCC estimate PDF or enable OCR/CCC structured estimate extraction.";
export const PDF_TEXT_EXTRACTION_INFRASTRUCTURE_ERROR =
  "Delta Citation Density Report text extraction failed in production because the PDF parser polyfill is unavailable. No annotation PDF was produced.";
export const PDF_JS_WORKER_UNAVAILABLE_ERROR =
  "Delta Citation Density Report text extraction failed because the PDF.js worker asset is unavailable in production. No annotation PDF was produced.";

const CITATION_DENSITY_REPORT_IDENTITY: AnnotatedEstimateReportIdentity = {
  reportType: "citation-density",
  artifactVersion: CITATION_DENSITY_ARTIFACT_VERSION,
  reportTitle: "Delta Citation Density Report",
  reportShortTitle: "Delta Citation Density",
  artifactFilename: "delta-citation-density-report.pdf",
  sourcePdfFallbackName: "delta-citation-density-source.pdf",
  pdfAnnotationTitle: "Collision IQ Delta Citation Density",
  legendTitle: "Delta Citation Density Annotation Legend",
  detailTitle: "Delta Citation Density Finding Details",
  unanchoredTitle: "Unanchored Delta Citation Density Findings",
  scoreLabel: "Delta Citation Density score",
  scoreCommentLabel: "Delta Citation Density",
  noAnchorError: NO_ANCHOR_EXTRACTION_ERROR,
  noSelectableTextError: NO_SELECTABLE_TEXT_ERROR,
  textExtractionInfrastructureError: PDF_TEXT_EXTRACTION_INFRASTRUCTURE_ERROR,
  pdfWorkerUnavailableError: PDF_JS_WORKER_UNAVAILABLE_ERROR,
};

export const OEM_CITATION_DENSITY_REPORT_IDENTITY: AnnotatedEstimateReportIdentity = {
  reportType: "oem-citation-density",
  artifactVersion: OEM_CITATION_DENSITY_ARTIFACT_VERSION,
  reportTitle: "OEM Citation Density Report",
  reportShortTitle: "OEM Citation Density",
  artifactFilename: "oem-citation-density-report.pdf",
  sourcePdfFallbackName: "oem-citation-density-source.pdf",
  pdfAnnotationTitle: "Collision IQ OEM Citation Density",
  legendTitle: "OEM Citation Density Annotation Legend",
  detailTitle: "OEM Citation Density Finding Details",
  unanchoredTitle: "Unanchored OEM Citation Density Findings",
  scoreLabel: "OEM Density score",
  scoreCommentLabel: "OEM Citation Density",
  noAnchorError: "OEM Citation Density could not extract estimate row anchors from the selected estimate PDF. No annotation PDF was produced.",
  noSelectableTextError: "OEM Citation Density could not extract selectable text from the selected estimate PDF. Upload the original CCC estimate PDF or enable OCR/CCC structured estimate extraction.",
  textExtractionInfrastructureError: "OEM Citation Density Report text extraction failed in production because the PDF parser polyfill is unavailable. No annotation PDF was produced.",
  pdfWorkerUnavailableError: "OEM Citation Density Report text extraction failed because the PDF.js worker asset is unavailable in production. No annotation PDF was produced.",
};

const exportCache = new Map<string, {
  bytes: Uint8Array;
  filename: string;
  createdAt: number;
  annotationMetadata: CitationDensityAnnotationMetadata[];
  citationDensityArtifactVersion: string;
  reportType?: string;
}>();
const EXPORT_TTL_MS = 30 * 60 * 1000;

export function putAnnotatedEstimateExport(
  bytes: Uint8Array,
  filename: string,
  annotationMetadata: CitationDensityAnnotationMetadata[] = [],
  options: {
    artifactVersion?: string;
    reportType?: string;
  } = {}
) {
  pruneExportCache();
  const exportId = randomUUID();
  exportCache.set(exportId, {
    bytes,
    filename,
    createdAt: Date.now(),
    annotationMetadata,
    citationDensityArtifactVersion: options.artifactVersion ?? CITATION_DENSITY_ARTIFACT_VERSION,
    reportType: options.reportType,
  });
  return exportId;
}

export function getAnnotatedEstimateExport(exportId: string, expectedArtifactVersion = CITATION_DENSITY_ARTIFACT_VERSION) {
  pruneExportCache();
  const entry = exportCache.get(exportId) ?? null;
  if (!entry || entry.citationDensityArtifactVersion !== expectedArtifactVersion) {
    return null;
  }
  return entry;
}

export function dataUrlToPdfBytes(dataUrl: string): Uint8Array | null {
  const match = dataUrl.match(/^data:application\/pdf(?:;[^,]*)?;base64,(.+)$/i);
  if (!match) return null;
  return Uint8Array.from(Buffer.from(match[1], "base64"));
}

export async function extractCitationDensityRowAnchors(
  bytes: Uint8Array,
  options: {
    sourceDocumentRole: "carrier" | "shop";
    sourceDocumentId?: string;
    actualSourcePdfName?: string;
    actualSourcePdfPageCount?: number;
  }
) {
  const { words, diagnostics } = await extractPdfWordsWithDiagnostics(bytes);
  const lines = buildPdfTextLines(words);
  return {
    visualLines: lines,
    anchors: buildEstimateRowAnchorsFromLines(lines, {
      sourceDocumentRole: options.sourceDocumentRole,
      sourceDocumentId: options.sourceDocumentId,
    }),
    actualSourcePdfName: options.actualSourcePdfName,
    actualSourcePdfByteLength: bytes.byteLength,
    actualSourcePdfPageCount: options.actualSourcePdfPageCount,
    sourcePdfStage: "original" as const,
    sourcePdfHash: hashPdfBytes(bytes),
    textExtractionMethod: diagnostics.method,
    textExtractionError: diagnostics.error,
    textExtractionWarnings: diagnostics.warnings,
    pdfWorkerResolvedPath: diagnostics.pdfWorkerResolvedPath,
    pdfWorkerExists: diagnostics.pdfWorkerExists,
    pdfWorkerSrc: diagnostics.pdfWorkerSrc,
    pdfjsImportMode: diagnostics.pdfjsImportMode,
    workerResolutionAttempted: diagnostics.workerResolutionAttempted,
    workerResolutionSucceeded: diagnostics.workerResolutionSucceeded,
    workerResolutionError: diagnostics.workerResolutionError,
    parserFallbackUsed: diagnostics.parserFallbackUsed,
    textExtractionInfrastructureStage: diagnostics.textExtractionInfrastructureStage,
    extractedTextPageCount: diagnostics.perPageTextLengths.filter((length) => length > 0).length,
    firstPageTextSample: truncateDebugText(
      lines
        .filter((line) => line.pageNumber === 1)
        .map((line) => line.text)
        .join(" ")
    ),
    firstNonEmptyTextPage: diagnostics.firstNonEmptyTextPage,
    firstNonEmptyTextSample: diagnostics.firstNonEmptyTextSample,
    perPageTextLengths: diagnostics.perPageTextLengths,
    perPageTextItemCounts: diagnostics.perPageTextItemCounts,
  };
}

export async function buildAnnotatedCitationDensityEstimatePdf(params: {
  sourcePdfBytes: Uint8Array;
  sourceDocumentId?: string;
  sourcePdfName?: string;
  selectedEstimateTotal?: number | null;
  uploadedFileNames?: string[];
  sourceText?: string | null;
  comparisonEstimateTexts?: ComparisonEstimateText[];
  findings: CitationDensityFinding[];
  request?: AnnotatedEstimateRequest;
  reportIdentity?: AnnotatedEstimateReportIdentity;
  deltaDiagnostics?: CitationDensityDeltaDiagnostics;
  authorityTrace?: OemCitationDensityAuthorityTrace;
  findingGenerator?: (context: AnnotatedEstimateFindingGeneratorContext) => AnnotatedEstimateGeneratedFindings;
}): Promise<AnnotatedEstimateResult> {
  const request = params.request ?? {};
  const reportIdentity = params.reportIdentity ?? CITATION_DENSITY_REPORT_IDENTITY;
  const mode = request.annotationMode ?? "both";
  const estimateRole = request.estimateRole ?? "selected";
  const selectedIds = new Set(request.findingIds?.filter(Boolean) ?? []);
  let selectedFindings = params.findings.filter((finding) => !selectedIds.size || selectedIds.has(finding.id));
  let { findings, suppressed } = sanitizeCitationDensityFindingsForVisibleLayer(selectedFindings);
  const warnings: string[] = [];
  const sourcePdfBytes = params.sourcePdfBytes.slice();
  const pdfDoc = await PDFDocument.load(sourcePdfBytes);
  const originalPageCount = pdfDoc.getPageCount();
  if (originalPageCount === 0) {
    throw new Error(`Annotated ${reportIdentity.reportShortTitle} export requires an original estimate PDF with source pages.`);
  }
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const sourceDocumentRole = estimateRole === "shop" ? "shop" : "carrier";
  const sourcePdfName = params.sourcePdfName ?? params.sourceDocumentId ?? reportIdentity.sourcePdfFallbackName;
  const selectedDocumentClassification = classifyCitationDensityDocument({
    filename: sourcePdfName,
    text: params.sourceText,
  });
  const extraction = await extractCitationDensityRowAnchors(sourcePdfBytes, {
    sourceDocumentRole,
    sourceDocumentId: params.sourceDocumentId,
    actualSourcePdfName: sourcePdfName,
    actualSourcePdfPageCount: originalPageCount,
  }).catch((error) => {
    warnings.push(
      `Text-coordinate extraction failed; no annotation PDF can be produced when findings require estimate row anchors. ${error instanceof Error ? error.message : "Unknown PDF text extraction error."}`
    );
    return {
      anchors: [] as EstimateRowAnchor[],
      actualSourcePdfName: sourcePdfName,
      actualSourcePdfByteLength: sourcePdfBytes.byteLength,
      actualSourcePdfPageCount: originalPageCount,
      sourcePdfStage: "original" as const,
      sourcePdfHash: hashPdfBytes(sourcePdfBytes),
      textExtractionMethod: "not_run" as const,
      textExtractionError: error instanceof Error ? error.message : String(error),
      textExtractionWarnings: [],
      pdfWorkerResolvedPath: undefined,
      pdfWorkerExists: undefined,
      pdfWorkerSrc: undefined,
      pdfjsImportMode: undefined,
      workerResolutionAttempted: false,
      workerResolutionSucceeded: false,
      workerResolutionError: undefined,
      parserFallbackUsed: false,
      textExtractionInfrastructureStage: "pdfjs-import" as const,
      visualLines: [],
      extractedTextPageCount: 0,
      firstPageTextSample: "",
      firstNonEmptyTextPage: null,
      firstNonEmptyTextSample: "",
      perPageTextLengths: [],
      perPageTextItemCounts: [],
    };
  });
  const anchors = extraction.anchors;
  const anchorIndex = new Map(anchors.map((anchor) => [anchor.anchorId, anchor]));
  const trace: CitationDensityDebugTrace = {
    buildCommit: getBuildCommit(),
    citationDensityArtifactVersion: reportIdentity.artifactVersion,
    reportType: reportIdentity.reportType,
    routeName: reportIdentity.reportType,
    artifactVersion: reportIdentity.artifactVersion,
    artifactId: undefined,
    sourcePdfName,
    selectedEstimateFileName: sourcePdfName,
    selectedEstimateTotal: params.selectedEstimateTotal ?? null,
    selectedDocumentType: selectedDocumentClassification.detectedDocumentType,
    selectedDocumentConfidence: selectedDocumentClassification.confidence,
    uploadedFileNames: params.uploadedFileNames ?? [],
    actualSourcePdfName: extraction.actualSourcePdfName,
    actualSourcePdfByteLength: extraction.actualSourcePdfByteLength,
    actualSourcePdfPageCount: extraction.actualSourcePdfPageCount ?? originalPageCount,
    sourcePdfStage: extraction.sourcePdfStage,
    sourcePdfHash: extraction.sourcePdfHash,
    textExtractionMethod: extraction.textExtractionMethod,
    textExtractionError: extraction.textExtractionError,
    textExtractionWarnings: extraction.textExtractionWarnings,
    pdfWorkerResolvedPath: extraction.pdfWorkerResolvedPath,
    pdfWorkerExists: extraction.pdfWorkerExists,
    pdfWorkerSrc: extraction.pdfWorkerSrc,
    pdfjsImportMode: extraction.pdfjsImportMode,
    workerResolutionAttempted: extraction.workerResolutionAttempted,
    workerResolutionSucceeded: extraction.workerResolutionSucceeded,
    workerResolutionError: extraction.workerResolutionError,
    parserFallbackUsed: extraction.parserFallbackUsed,
    textExtractionInfrastructureStage: extraction.textExtractionInfrastructureStage,
    extractedTextPageCount: extraction.extractedTextPageCount,
    firstPageTextSample: extraction.firstPageTextSample,
    firstNonEmptyTextPage: extraction.firstNonEmptyTextPage,
    firstNonEmptyTextSample: extraction.firstNonEmptyTextSample,
    perPageTextLengths: extraction.perPageTextLengths,
    perPageTextItemCounts: extraction.perPageTextItemCounts,
    extractedAnchorCount: anchors.length,
    findingCount: findings.length,
    anchoredFindingCount: 0,
    unanchoredFindingCount: 0,
    renderedPdfAnnotationCount: 0,
    viewerAnnotationCount: undefined,
    firstAnchorIds: anchors.slice(0, 10).map((anchor) => anchor.anchorId),
    firstFindingAnchorIds: findings.slice(0, 10).map((finding) => getFindingAnchorId(finding)),
    partSourceRowCount: 0,
    nonOemPartRowCount: 0,
    oemPartRowCount: 0,
    partSourceComparisonCandidateCount: 0,
    partSourceCandidateCount: 0,
    partSourceAcceptedCandidateCount: 0,
    partSourceRejectedCandidateCount: 0,
    partSourceFindingCount: 0,
    partSourceAnchoredFindingCount: 0,
    partSourceUnanchoredFindingCount: 0,
    partSourceRows: [],
    partSourceAcceptedCandidates: [],
    partSourceRejectedCandidates: [],
    rejectedLineNumberCandidates: [],
    partSourceComparisonMatches: [],
    partSourceDroppedReasons: [],
    rejectedAnchors: [],
    rejectedBoilerplateCount: 0,
    acceptedEstimateRowFindingCount: 0,
    requiredDetectorFindingCount: 0,
    missingRequiredDetectors: [],
    policyExtractionConfidence: "not_run",
    policyVehicleMismatch: null,
    authoritySearchTrace: params.authorityTrace ?? buildDefaultOemAuthorityTrace(),
    fallbackMatchedFindings: [],
    droppedFindings: [],
    rendererDrops: [],
    toolUsageTrace: params.deltaDiagnostics?.toolUsageTrace ? [...params.deltaDiagnostics.toolUsageTrace] : [],
    totalDeltaCandidates: params.deltaDiagnostics?.totalDeltaCandidates ?? 0,
    acceptedDeltaFindings: params.deltaDiagnostics?.acceptedDeltaFindings ?? 0,
    rejectedDeltaFindings: params.deltaDiagnostics?.rejectedDeltaFindings ?? 0,
    annotationLimitApplied: params.deltaDiagnostics?.annotationLimitApplied ?? false,
    maxAnnotationLimit: params.deltaDiagnostics?.maxAnnotationLimit ?? null,
    droppedDeltaReasons: params.deltaDiagnostics?.droppedDeltaReasons ?? [],
    unannotatedMaterialDeltas: params.deltaDiagnostics?.unannotatedMaterialDeltas ?? [],
    detailLayoutBlocks: [],
    metadataArtifactId: undefined,
    renderedPdfArtifactId: undefined,
    sourceAnchorDocumentType: selectedDocumentClassification.detectedDocumentType,
    sourceAnchorRowType: undefined,
    badAnchorRejectedCount: 0,
    badAnchorRejectReasons: [],
    cccSecureShareConfigured: false,
    cccSecureShareSearched: false,
    cccSecureShareMatched: false,
    cccSecureShareRetrieved: false,
    cccSecureShareRowCount: 0,
    cccSecureShareEstimateTotal: null,
    cccSecureShareSupplementVersion: null,
    cccSecureShareRetrievalFailed: false,
    cccSecureShareUnavailableReason: "not configured",
    artifactReportType: reportIdentity.reportType,
    findingIdPrefixCheckPassed: true,
  };
  appendToolUsageTrace(trace, {
    tool: "document_classifier",
    ran: true,
    candidatesFound: 1,
    candidatesAccepted: selectedDocumentClassification.isEstimateLike ? 1 : 0,
    candidatesRejected: selectedDocumentClassification.isEstimateLike ? 0 : 1,
    droppedReasons: selectedDocumentClassification.isEstimateLike
      ? []
      : [`selected document classified as ${selectedDocumentClassification.detectedDocumentType}`],
  });
  appendToolUsageTrace(trace, {
    tool: "pdf_text_extraction",
    ran: extraction.textExtractionMethod !== "not_run",
    skipReason: extraction.textExtractionMethod === "not_run" ? extraction.textExtractionError ?? "pdf text extraction did not complete" : undefined,
    candidatesFound: extraction.perPageTextItemCounts.reduce((sum, count) => sum + count, 0),
    candidatesAccepted: extraction.extractedTextPageCount,
    candidatesRejected: extraction.textExtractionError ? 1 : 0,
    droppedReasons: extraction.textExtractionError ? [extraction.textExtractionError] : extraction.textExtractionWarnings,
  });
  appendToolUsageTrace(trace, {
    tool: "estimate_row_parser",
    ran: extraction.textExtractionMethod !== "not_run",
    skipReason: extraction.textExtractionMethod === "not_run" ? "pdf text extraction unavailable" : undefined,
    candidatesFound: extraction.visualLines.length,
    candidatesAccepted: anchors.length,
    candidatesRejected: Math.max(0, extraction.visualLines.length - anchors.length),
    droppedReasons: anchors.length ? [] : ["no estimate row anchors extracted"],
  });

  if (params.findingGenerator) {
    const generated = params.findingGenerator({
      anchors,
      visualLines: extraction.visualLines,
      sourcePdfName,
      sourceDocumentId: params.sourceDocumentId,
      sourceDocumentRole,
      sourcePdfHash: extraction.sourcePdfHash,
      uploadedFileNames: params.uploadedFileNames ?? [],
      sourceText: params.sourceText,
      comparisonEstimateTexts: params.comparisonEstimateTexts ?? [],
      authorityTrace: params.authorityTrace,
    });
    const generatedFindings = generated.findings
      .filter((finding) => !isGeneratedFindingCoveredByExisting(finding, selectedFindings));
    selectedFindings = [
      ...selectedFindings,
      ...generatedFindings.filter((finding) => !selectedIds.size || selectedIds.has(finding.id)),
    ];
    const sanitizedGenerated = sanitizeCitationDensityFindingsForVisibleLayer(selectedFindings);
    findings = sanitizedGenerated.findings;
    suppressed = sanitizedGenerated.suppressed;
    Object.assign(trace, generated.debug ?? {});
    appendToolUsageTrace(trace, {
      tool: "oem_procedure_position_support",
      ran: reportIdentity.reportType === "oem-citation-density",
      skipReason: reportIdentity.reportType === "oem-citation-density" ? undefined : "not an OEM Citation Density report",
      candidatesFound: trace.authoritySourceCount ?? 0,
      candidatesAccepted: trace.authorityBackedFindingCount ?? 0,
      candidatesRejected: trace.researchNeededFindingCount ?? 0,
      droppedReasons: trace.findingsRejectedDueWeakEvidence ? ["weak OEM/support evidence rejected"] : [],
    });
    appendToolUsageTrace(trace, {
      tool: "uploaded_support_docs",
      ran: reportIdentity.reportType === "oem-citation-density",
      skipReason: reportIdentity.reportType === "oem-citation-density" ? undefined : "handled by Citation Density support/evidence ledger",
      candidatesFound: trace.uploadedSupportDocumentCount ?? 0,
      candidatesAccepted: trace.uploadedSupportDocumentCount ?? 0,
      candidatesRejected: 0,
      droppedReasons: [],
    });
    appendToolUsageTrace(trace, {
      tool: "google_drive_internal_docs",
      ran: reportIdentity.reportType === "oem-citation-density",
      skipReason: reportIdentity.reportType === "oem-citation-density" ? undefined : "not an OEM Citation Density authority lookup",
      candidatesFound: (trace.oemProcedureSourceCount ?? 0) + (trace.oemPositionStatementSourceCount ?? 0),
      candidatesAccepted: trace.authorityBackedFindingCount ?? 0,
      candidatesRejected: 0,
      droppedReasons: [],
    });
    appendToolUsageTrace(trace, {
      tool: "validation_overclaim_guard",
      ran: reportIdentity.reportType === "oem-citation-density",
      skipReason: reportIdentity.reportType === "oem-citation-density" ? undefined : "not an OEM Citation Density report",
      candidatesFound: (trace.authorityBackedFindingCount ?? 0) + (trace.estimateOnlyFindingCount ?? 0) + (trace.researchNeededFindingCount ?? 0),
      candidatesAccepted: findings.length,
      candidatesRejected: (trace.findingsRejectedDueWeakEvidence ?? 0) + (trace.findingsRejectedDueNoAnchor ?? 0),
      droppedReasons: [
        trace.findingsRejectedDueWeakEvidence ? "weak evidence or overclaim risk" : "",
        trace.findingsRejectedDueNoAnchor ? "no safe estimate row anchor" : "",
      ],
    });
  }

  appendToolUsageTrace(trace, {
    tool: "image_photo_ocr_evidence",
    ran: false,
    skipReason: "no image/photo/OCR evidence was supplied to this annotated estimate export",
    candidatesFound: 0,
    candidatesAccepted: 0,
    candidatesRejected: 0,
    droppedReasons: [],
  });
  appendToolUsageTrace(trace, {
    tool: "finding_validator",
    ran: true,
    candidatesFound: selectedFindings.length,
    candidatesAccepted: findings.length,
    candidatesRejected: suppressed.length,
    droppedReasons: suppressed.length ? ["generic or malformed findings suppressed from visible estimate layer"] : [],
  });

  const identityError = findReportIdentityMismatch(findings, reportIdentity.reportType);
  if (identityError) {
    trace.findingIdPrefixCheckPassed = false;
    trace.artifactReportType = identityError.artifactReportType;
    trace.droppedFindings.push({
      findingId: identityError.findingId,
      reason: identityError.reason,
      anchorId: null,
    });
    throw new CitationDensityAnnotationError(identityError.message, trace);
  }

  const debugMetadata: CitationDensityAnnotationDebugMetadata = {
    extractedRowAnchorCount: anchors.length,
    visibleAnnotationCount: 0,
    appendixOnlyCount: 0,
    suppressedGenericCount: suppressed.length,
    suppressedPageMismatchCount: 0,
    anchorsByPage: buildAnchorsByPage(anchors),
    findingsWithoutAnchorId: [],
  };

  if (!anchors.length) {
    warnings.push(NO_ROWS_EXTRACTED_WARNING);
  }

  if (trace.findingCount > 0 && isPdfJsWorkerError(trace.textExtractionError)) {
    trace.unanchoredFindingCount = trace.findingCount;
    trace.droppedFindings.push({
      findingId: "*",
      reason: "pdfjs worker asset unavailable",
      anchorId: null,
    });
    throw new CitationDensityAnnotationError(reportIdentity.pdfWorkerUnavailableError, trace);
  }

  if (trace.findingCount > 0 && trace.textExtractionError) {
    trace.unanchoredFindingCount = trace.findingCount;
    trace.droppedFindings.push({
      findingId: "*",
      reason: "pdf text extraction parser infrastructure error",
      anchorId: null,
    });
    throw new CitationDensityAnnotationError(reportIdentity.textExtractionInfrastructureError, trace);
  }

  if (trace.findingCount > 0 && trace.extractedTextPageCount === 0) {
    trace.unanchoredFindingCount = trace.findingCount;
    trace.droppedFindings.push({
      findingId: "*",
      reason: "no selectable text extracted from selected source PDF",
      anchorId: null,
    });
    throw new CitationDensityAnnotationError(reportIdentity.noSelectableTextError, trace);
  }

  if (trace.findingCount > 0 && trace.extractedAnchorCount === 0) {
    trace.unanchoredFindingCount = trace.findingCount;
    trace.droppedFindings.push({
      findingId: "*",
      reason: "no estimate row anchors extracted from selected source PDF",
      anchorId: null,
    });
    throw new CitationDensityAnnotationError(reportIdentity.noAnchorError, trace);
  }

  const partSourceResult = reportIdentity.reportType === "citation-density"
    ? buildPartSourceFindings({
        selectedAnchors: anchors,
        selectedVisualLines: extraction.visualLines,
        sourcePdfName,
        sourceDocumentId: params.sourceDocumentId,
        sourceDocumentRole,
        comparisonEstimateTexts: params.comparisonEstimateTexts ?? [],
        existingFindings: findings,
      })
    : emptyPartSourceFindingResult();
  trace.partSourceRowCount = partSourceResult.partSourceRows.length;
  trace.nonOemPartRowCount = partSourceResult.nonOemPartRowCount;
  trace.oemPartRowCount = partSourceResult.oemPartRowCount;
  trace.partSourceComparisonCandidateCount = partSourceResult.comparisonCandidateCount;
  trace.partSourceCandidateCount = partSourceResult.candidateCount;
  trace.partSourceAcceptedCandidateCount = partSourceResult.acceptedCandidates.length;
  trace.partSourceRejectedCandidateCount = partSourceResult.rejectedCandidates.length;
  trace.partSourceFindingCount = partSourceResult.findings.length;
  trace.partSourceRows = partSourceResult.partSourceRows.slice(0, 20);
  trace.partSourceAcceptedCandidates = partSourceResult.acceptedCandidates.slice(0, 20);
  trace.partSourceRejectedCandidates = partSourceResult.rejectedCandidates.slice(0, 20);
  trace.rejectedLineNumberCandidates = partSourceResult.rejectedLineNumberCandidates.slice(0, 20);
  trace.partSourceComparisonMatches = partSourceResult.comparisonMatches.slice(0, 20);
  trace.partSourceDroppedReasons = partSourceResult.droppedReasons;
  appendToolUsageTrace(trace, {
    tool: "support_evidence_ledger",
    ran: true,
    candidatesFound: reportIdentity.reportType === "citation-density"
      ? partSourceResult.candidateCount
      : (trace.authoritySourceCount ?? 0),
    candidatesAccepted: reportIdentity.reportType === "citation-density"
      ? partSourceResult.acceptedCandidates.length
      : (trace.authorityBackedFindingCount ?? 0),
    candidatesRejected: reportIdentity.reportType === "citation-density"
      ? partSourceResult.rejectedCandidates.length
      : (trace.researchNeededFindingCount ?? 0),
    droppedReasons: reportIdentity.reportType === "citation-density"
      ? partSourceResult.droppedReasons.map((item) => item.reason)
      : [],
  });
  const findingsWithPartSource = [...findings, ...partSourceResult.findings];
  trace.findingCount = findingsWithPartSource.length;
  trace.firstFindingAnchorIds = findingsWithPartSource.slice(0, 10).map((finding) => getFindingAnchorId(finding));

  const candidateResult = buildAnchoredCitationCandidates({
    anchors,
    findings: findingsWithPartSource,
    topicFindings: findingsWithPartSource,
    estimateRole,
    sourceDocumentRole,
    anchorIndex,
    trace,
  });
  debugMetadata.suppressedPageMismatchCount = candidateResult.suppressedPageMismatchCount;
  debugMetadata.findingsWithoutAnchorId = [
    ...suppressed.map((finding) => finding.id),
    ...candidateResult.findingsWithoutAnchorId,
  ];
  trace.anchoredFindingCount = candidateResult.candidates.length;
  trace.unanchoredFindingCount = Math.max(0, findingsWithPartSource.length - candidateResult.candidates.length);
  trace.acceptedEstimateRowFindingCount = candidateResult.candidates.filter((candidate) =>
    candidate.anchor.anchorType === "estimate_line" ||
    candidate.anchor.anchorType === "line_note" ||
    candidate.anchor.anchorType === "totals_row"
  ).length;
  trace.partSourceAnchoredFindingCount = candidateResult.candidates.filter((candidate) => isPartSourceFinding(candidate.finding)).length;
  trace.partSourceUnanchoredFindingCount = Math.max(0, trace.partSourceFindingCount - trace.partSourceAnchoredFindingCount);
  appendToolUsageTrace(trace, {
    tool: "row_anchor_matcher",
    ran: true,
    candidatesFound: findingsWithPartSource.length,
    candidatesAccepted: candidateResult.candidates.length,
    candidatesRejected: Math.max(0, findingsWithPartSource.length - candidateResult.candidates.length),
    droppedReasons: trace.droppedFindings.map((item) => item.reason),
  });

  if (trace.extractedAnchorCount > 0 && trace.findingCount > 0 && trace.anchoredFindingCount === 0) {
    throw new CitationDensityAnnotationError("Findings generated but no findings matched extracted anchors.", trace);
  }

  const matches: MatchedFinding[] = candidateResult.candidates.map((candidate) => ({
    finding: candidate.finding,
    anchor: candidate.anchor,
  }));
  const matchedFindingIds = new Set(candidateResult.candidates.map((candidate) => candidate.derivedFromFindingId).filter(Boolean));
  const unmatched: CitationDensityFinding[] = findingsWithPartSource.filter((finding) => !matchedFindingIds.has(finding.id));
  const unmatchedDeltaFindings = unmatched.filter((finding) =>
    /^citation-density-/i.test(finding.id) &&
    (/-comparison-/i.test(finding.id) || finding.crossEstimateIssue === true)
  );
  if (unmatchedDeltaFindings.length > 0) {
    const unmatchedDeltaDrops = unmatchedDeltaFindings.map((finding) => ({
        rowId: finding.id,
        reason: "no safe estimate-row annotation rendered for this material delta",
        summary: finding.operationLabel,
      }));
    trace.unannotatedMaterialDeltas = [
      ...trace.unannotatedMaterialDeltas,
      ...unmatchedDeltaDrops,
    ];
    trace.droppedDeltaReasons = [
      ...trace.droppedDeltaReasons,
      ...unmatchedDeltaDrops.map((item) => item.reason),
    ];
  }

  const lineMatchCount = matches.length;
  if (findingsWithPartSource.length > 0 && lineMatchCount === 0) {
    warnings.push(anchors.length ? NO_SAFE_ROW_FINDINGS_WARNING : NO_ROWS_EXTRACTED_WARNING);
    warnings.push("all_findings_unanchored");
  }
  if (suppressed.length > 0) {
    warnings.push(`${suppressed.length} generic or malformed ${reportIdentity.reportShortTitle} finding(s) were suppressed from the visible estimate layer.`);
  }

  const annotationMetadata: CitationDensityAnnotationMetadata[] = [];
  const findingDetails: FindingDetail[] = [];
  let renderedPdfAnnotationCount = 0;
  matches.forEach((match, index) => {
    const sourcePdfPageNumber = match.anchor.pageNumber;
    const page = pdfDoc.getPage(toSourcePdfPageIndex(sourcePdfPageNumber));
    const renderResult = drawFindingAnnotation(pdfDoc, page, match, index + 1, {
      mode,
      font,
      boldFont,
      estimateRole,
      redactSensitive: request.redactSensitive !== false,
      trace,
      reportIdentity,
    });
    if (renderResult.written) {
      renderedPdfAnnotationCount += 1;
      annotationMetadata.push(renderResult.metadata);
      findingDetails.push({ finding: match.finding, metadata: renderResult.metadata });
    }
  });

  trace.renderedPdfAnnotationCount = renderedPdfAnnotationCount;
  appendToolUsageTrace(trace, {
    tool: "annotation_qa",
    ran: true,
    candidatesFound: matches.length,
    candidatesAccepted: renderedPdfAnnotationCount,
    candidatesRejected: Math.max(0, matches.length - renderedPdfAnnotationCount),
    droppedReasons: trace.rendererDrops.map((item) => item.reason),
  });

  if (trace.extractedAnchorCount > 0 && trace.findingCount > 0 && trace.renderedPdfAnnotationCount === 0) {
    throw new CitationDensityAnnotationError("Anchors extracted but no annotations rendered.", trace);
  }

  if (findingDetails.length > 0) {
    trace.detailLayoutBlocks = addCitationDensityFindingDetailPages(pdfDoc, findingDetails, {
      font,
      boldFont,
      sourcePdfName,
      sourcePdfHash: trace.sourcePdfHash,
      buildCommit: trace.buildCommit,
      reportIdentity,
    });
  }

  if (findingsWithPartSource.length > 0 && lineMatchCount === 0) {
    addNoLineAnchorWarningPage(pdfDoc, {
      font,
      boldFont,
      message: anchors.length ? NO_SAFE_ROW_FINDINGS_WARNING : NO_ROWS_EXTRACTED_WARNING,
      pageCalloutCount: matches.length,
      appendixCount: unmatched.length,
    });
  }

  if (request.includeLegend !== false) {
    addLegendPage(pdfDoc, { font, boldFont, reportIdentity });
  }

  if (request.includeSummaryPage) {
    addSummaryPage(pdfDoc, {
      font,
      boldFont,
      annotatedCount: matches.length,
      unresolvedCount: unmatched.length,
      warnings,
    });
  }

  if (unmatched.length > 0 && request.includeUnanchoredAppendix !== false) {
    addUnanchoredAppendix(pdfDoc, unmatched, {
      font,
      boldFont,
      estimateRole,
      redactSensitive: request.redactSensitive !== false,
      reportIdentity,
    });
  }

  const bytes = await pdfDoc.save();
  debugMetadata.visibleAnnotationCount = annotationMetadata.length;
  debugMetadata.appendixOnlyCount = unmatched.length;
  trace.viewerAnnotationCount = annotationMetadata.length;
  const exportId = putAnnotatedEstimateExport(
    bytes,
    reportIdentity.artifactFilename,
    annotationMetadata,
    {
      artifactVersion: reportIdentity.artifactVersion,
      reportType: reportIdentity.reportType,
    }
  );
  trace.artifactId = exportId;
  trace.metadataArtifactId = exportId;
  trace.renderedPdfArtifactId = exportId;
  if (trace.metadataArtifactId !== trace.renderedPdfArtifactId) {
    throw new CitationDensityAnnotationError("Rendered PDF and annotation metadata artifact mismatch.", trace);
  }
  return {
    exportId,
    bytes,
    annotatedFindingCount: matches.length,
    unresolvedAnchorCount: unmatched.length,
    originalPageCount,
    finalPageCount: pdfDoc.getPageCount(),
    warnings,
    annotationMetadata,
    debugMetadata,
    debugTrace: trace,
  };
}

function toSourcePdfPageIndex(sourcePdfPageNumber: number) {
  return Math.max(0, sourcePdfPageNumber - 1);
}

type PartSourceRow = {
  anchorId?: string;
  sourceDocumentId?: string;
  sourceDocumentRole: "carrier" | "shop";
  sourcePdfName: string;
  pageNumber: number | null;
  lineNumber: string | null;
  rowText: string;
  normalizedRowText: string;
  sourceKinds: PartSourceKind[];
  anchor?: EstimateRowAnchor;
  anchorType?: EstimateRowAnchorType;
  description?: string | null;
  operation?: string | null;
  partNumber?: string | null;
};

type PartSourceFindingResult = {
  findings: CitationDensityFinding[];
  partSourceRows: PartSourceDebugRow[];
  nonOemPartRowCount: number;
  oemPartRowCount: number;
  comparisonCandidateCount: number;
  candidateCount: number;
  acceptedCandidates: PartSourceFindingCandidate[];
  rejectedCandidates: PartSourceFindingCandidate[];
  rejectedLineNumberCandidates: Array<{
    rowText: string;
    lineNumber?: string | number | null;
    reason: string;
  }>;
  comparisonMatches: PartSourceComparisonMatchDebug[];
  droppedReasons: CitationDensityDebugTrace["partSourceDroppedReasons"];
};

export type OemCitationDensityAuthoritySource = {
  title: string;
  sourceType:
    | "oem_procedure"
    | "oem_position_statement"
    | "motor_database"
    | "uploaded_support"
    | "ccc_secure_share"
    | "policy"
    | "jurisdictional_law"
    | "internet_fallback"
    | "estimate_evidence";
  evidenceTier: number;
  verified: boolean;
  note?: string;
};

export type OemCitationDensityAuthorityTrace = {
  authorityTraceStarted: boolean;
  authorityTraceCompleted: boolean;
  authorityTraceBlockedReason?: string | null;
  authorityCoverageStatus: "complete" | "partial" | "incomplete";
  googleDriveOrInternalSearchRan: boolean;
  skippedReason?: string;
  sandPolishSupportFound?: boolean;
  driveSearchAttempted: boolean;
  driveSearchAvailable: boolean;
  driveSearchCompleted?: boolean;
  driveMatchedFoldersCount?: number;
  driveDocumentsReviewedCount?: number;
  driveSearchTerms?: string[];
  driveMakeModelFolderMatched: boolean;
  driveMatchedFolders: string[];
  driveDocumentsReviewed: string[];
  onlineSearchAttempted: boolean;
  onlineSourcesReviewed: string[];
  jurisdictionResolved: string | null;
  jurisdictionSourcesReviewed: string[];
  oemSourcesReviewed: string[];
  adasSourcesReviewed: string[];
  motorPPageSourcesReviewed: string[];
  scrsSourcesReviewed: string[];
  policyLegalSourcesReviewed: string[];
  authoritySources: OemCitationDensityAuthoritySource[];
  authorityContextText?: string;
};

export type OemCitationDensityFindingDebug = {
  findingId: string;
  title: string;
  label: string;
  anchorId?: string | null;
  evidenceTier: string;
  authoritySourceTypes: string[];
  nextAction: string;
  confidence: "low" | "medium" | "high";
};

function buildDefaultOemAuthorityTrace(): OemCitationDensityAuthorityTrace {
  const skippedReason = "No connected internal authority-search context was provided to annotated PDF generation.";
  return {
    authorityTraceStarted: false,
    authorityTraceCompleted: false,
    authorityTraceBlockedReason: skippedReason,
    authorityCoverageStatus: "incomplete",
    googleDriveOrInternalSearchRan: false,
    skippedReason,
    sandPolishSupportFound: false,
    driveSearchAttempted: false,
    driveSearchAvailable: false,
    driveMakeModelFolderMatched: false,
    driveMatchedFolders: [],
    driveDocumentsReviewed: [],
    onlineSearchAttempted: false,
    onlineSourcesReviewed: [],
    jurisdictionResolved: null,
    jurisdictionSourcesReviewed: [],
    oemSourcesReviewed: [],
    adasSourcesReviewed: [],
    motorPPageSourcesReviewed: [],
    scrsSourcesReviewed: [],
    policyLegalSourcesReviewed: [],
    authoritySources: [],
  };
}

function emptyPartSourceFindingResult(): PartSourceFindingResult {
  return {
    findings: [],
    partSourceRows: [],
    nonOemPartRowCount: 0,
    oemPartRowCount: 0,
    comparisonCandidateCount: 0,
    candidateCount: 0,
    acceptedCandidates: [],
    rejectedCandidates: [],
    rejectedLineNumberCandidates: [],
    comparisonMatches: [],
    droppedReasons: [],
  };
}

export function buildRequiredEstimatorDeltaFindings(
  context: AnnotatedEstimateFindingGeneratorContext
): AnnotatedEstimateGeneratedFindings {
  const findings: CitationDensityFinding[] = [];
  const rejectedAnchors: NonNullable<CitationDensityDebugTrace["rejectedAnchors"]> = [];
  const usedAnchorIds = new Set<string>();
  const comparisonText = context.comparisonEstimateTexts.map((item) => item.text).join("\n");
  const allText = [context.sourceText ?? "", comparisonText, context.sourcePdfName, ...context.uploadedFileNames].join("\n");
  const isTeslaOrEv = /\b(?:tesla|model\s+[3sxy]|electric vehicle|bev|ev\b|high[-\s]?voltage|hv battery)\b/i.test(allText);
  let sandPolishSeen = false;
  let batteryResetSeen = false;
  let wheelDetectorSeen = false;
  let wheelAccessDetectorSeen = false;
  let wheelAlignmentDetectorSeen = false;
  let hubDetectorSeen = false;

  for (const anchor of context.anchors) {
    const rowText = getAnchorSourceText(anchor);
    const normalized = normalizeMatchText(rowText);
    if (!rowText.trim()) continue;

    if (!isPrimaryEstimateAnchor(anchor)) {
      if (isRejectedPrimaryAnchorText(rowText, anchor)) {
        rejectedAnchors.push({
          anchorId: anchor.anchorId,
          pageNumber: anchor.pageNumber,
          anchorType: anchor.anchorType,
          rowText: truncateText(rowText, 220),
          reason: "boilerplate, guide, supplier-only, policy, or legal text rejected as primary finding anchor",
        });
      }
      continue;
    }

    const sourceKinds = classifyPartSource(rowText);
    const hasWheel = isWheelLaborAnchorText(normalized);
    const hasAccessLabor = /\b(?:r\s*&\s*i|r&i|remove|install|disassembly|reassembly|access)\b/i.test(rowText);

    if (!usedAnchorIds.has(anchor.anchorId) && hasWheel && /\b(?:repair|sublet|mount|balance|alignment|replacement|repl|replace|r&i|r\s*&\s*i|access)\b/.test(normalized)) {
      const comparisonWheelAccess = /\b(?:wheel|rim|tire|alignment|liner|flare)\b[\s\S]{0,80}\b(?:r&i|r\s*&\s*i|remove|install|access|disassembly|reassembly|replacement|repl)\b/i.test(comparisonText) ||
        /\b(?:r&i|r\s*&\s*i|remove|install|access|disassembly|reassembly|replacement|repl)\b[\s\S]{0,80}\b(?:wheel|rim|tire|alignment|liner|flare)\b/i.test(comparisonText);
      const zeroOrMissingLabor = anchor.labor === 0 || anchor.labor === null || /\b0\.0\b/.test(rowText);
      const alignmentGroup = /\balignment\b/.test(normalized);
      const groupAlreadySeen = alignmentGroup ? wheelAlignmentDetectorSeen : wheelAccessDetectorSeen;
      if (!groupAlreadySeen && (zeroOrMissingLabor || comparisonWheelAccess || hasAccessLabor)) {
        if (alignmentGroup) {
          wheelAlignmentDetectorSeen = true;
        } else {
          wheelAccessDetectorSeen = true;
        }
        wheelDetectorSeen = true;
        findings.push(buildRequiredDetectorFinding({
          context,
          anchor,
          findingType: "wheel_labor_delta",
          title: "Wheel repair / R&I access labor review",
          category: "r_and_i",
          label: "ESTIMATE GAP ONLY",
          score: isTeslaOrEv ? 66 : 60,
          safetyImpact: isTeslaOrEv ? "high" : "medium",
          priority: "high",
          currentSupportSummary: `Carrier/source rows affected: ${summarizeWheelCarrierEvidence(context.anchors)}. Anchored row: ${rowText}. Carrier allowed labor: ${anchor.labor ?? "missing/0.0"}. Shop/comparison wheel access evidence: ${summarizeComparisonEvidence(comparisonText, /wheel|rim|tire|alignment|access|r&i|remove|install|replacement|repl/i)}.`,
          missingProofSummary: "Carrier may be missing or inadequately documenting wheel R&I/access labor. Wheel repair, wheel cover, mount/balance, wheel replacement, tire replacement, or wheel-opening access may require line-item R&I/access labor when removal is needed for liner, flare, bumper hardware, or wheel-end access.",
          recommendedNextAction: "Request line-item wheel R&I/access labor or a written included-operation basis explaining where the wheel removal/access labor is included.",
          missingAuthorityTypes: ["line-item R&I/access labor basis", "included-operation basis", "shop comparison estimate"],
          laborHoursImpact: typeof anchor.labor === "number" ? Math.max(0.1, 0.1 - anchor.labor) : 0.1,
          amountImpact: anchor.price ?? null,
        }));
        usedAnchorIds.add(anchor.anchorId);
      }
    }

    const wheelEndPart = /\b(?:hub|bearing|knuckle|control arm|tie rod|steering|strut|spindle|suspension)\b/.test(normalized);
    if (!usedAnchorIds.has(anchor.anchorId) && wheelEndPart && hasNonOemPartSource(sourceKinds)) {
      hubDetectorSeen = true;
      findings.push(buildRequiredDetectorFinding({
        context,
        anchor,
        findingType: "am_wheel_end_safety",
        title: "A/M wheel-end part-source safety review",
        category: "parts_downgrade",
        label: "NEEDS OEM",
        score: isTeslaOrEv ? 72 : 62,
        safetyImpact: "high",
        priority: "high",
        currentSupportSummary: `Estimate row uses ${formatPartSourceKinds(sourceKinds)} sourcing for a wheel-end, steering, bearing, hub, or suspension component: ${rowText}.`,
        missingProofSummary: `${isTeslaOrEv ? "EV weight and ADAS sensitivity increase the need for OEM procedure verification. " : ""}The hub is a safety-critical wheel-end component, and wheel-end/suspension geometry can affect steering, stability, sensor calibration, ADAS confidence, and roadworthiness. Carrier aftermarket warranty language may address fit, corrosion, or part replacement, but it does not prove OEM-equivalent system performance, ADAS compatibility, crash-test equivalency, or related manufacturer warranty preservation. This supports OEM review; it does not prove an OEM-only requirement without authority.`,
        recommendedNextAction: "Request OEM position/procedure support, supplier/manufacturer fit/function documentation, and the carrier's written basis for A/M/LKQ/non-OEM wheel-end use on this vehicle platform.",
        missingAuthorityTypes: ["OEM procedure or position support", "supplier/manufacturer fit-function documentation", "written carrier part-source basis"],
        amountImpact: anchor.price ?? null,
        laborHoursImpact: anchor.labor ?? null,
      }));
      usedAnchorIds.add(anchor.anchorId);
    }

    if (!usedAnchorIds.has(anchor.anchorId) && /\b(?:finish sand|denib|de nib|color sand|sand and polish|sand polish|buff|refinish correction|post refinish correction)\b/.test(normalized)) {
      sandPolishSeen = true;
      findings.push(buildRequiredDetectorFinding({
        context,
        anchor,
        findingType: "sand_polish_p_page_support",
        title: "Sand/polish refinish database support review",
        category: "refinish",
        label: "NEEDS P-PAGE",
        score: 58,
        safetyImpact: "low",
        priority: "medium",
        currentSupportSummary: `Refinish correction row found: ${rowText}. Internal/Google Drive authority search was not available in this export path.`,
        missingProofSummary: "Finish sand and polish, denib and polish, color sand and buff, sand and polish, or post-refinish correction is a refinish-related operation that needs CCC/MOTOR/P-page/database support when capped, limited, or disputed.",
        recommendedNextAction: "Attach CCC/MOTOR/P-page/database support or label the item NEEDS P-PAGE / NEEDS DATABASE SUPPORT before treating it as supplement-ready.",
        missingAuthorityTypes: ["CCC/MOTOR/P-page support", "database support"],
        amountImpact: anchor.price ?? null,
        laborHoursImpact: anchor.labor ?? null,
      }));
      usedAnchorIds.add(anchor.anchorId);
    }

    if (!usedAnchorIds.has(anchor.anchorId) && /\b(?:d\s*&\s*r battery|d&r battery|disconnect.*battery|reconnect.*battery|reset electronics|battery reset|isolate 12v|hv state of charge|state of charge)\b/i.test(rowText)) {
      batteryResetSeen = true;
      findings.push(buildRequiredDetectorFinding({
        context,
        anchor,
        findingType: "battery_reset_electrical_rate",
        title: "Battery D&R / reset electronics labor-category review",
        category: "scan_diagnostic",
        label: "NEEDS OEM",
        score: isTeslaOrEv ? 68 : 56,
        safetyImpact: isTeslaOrEv ? "high" : "medium",
        priority: "high",
        currentSupportSummary: `Electrical/mechanical procedure row found: ${rowText}. Labor/category shown: ${anchor.labor ?? "not parsed"} hours.`,
        missingProofSummary: "Battery disconnect/reconnect, reset electronics, 12V isolation, HV state-of-charge, or battery reset should be reviewed as mechanical/electrical procedure context, not a generic miscellaneous charge.",
        recommendedNextAction: "Request MOTOR/CCC category basis, OEM battery disconnect/reconnect/reset procedure support, and reconcile the labor category/rate if allowed at body or non-mechanical context.",
        missingAuthorityTypes: ["MOTOR/CCC labor-category basis", "OEM battery/reset procedure", "mechanical/electrical rate support"],
        amountImpact: anchor.price ?? null,
        laborHoursImpact: anchor.labor ?? null,
      }));
      usedAnchorIds.add(anchor.anchorId);
    }
  }

  const missingRequiredDetectors = [
    wheelDetectorSeen ? null : "wheel_labor_delta",
    hubDetectorSeen ? null : "am_wheel_end_safety",
    sandPolishSeen ? null : "sand_polish_p_page_support",
    batteryResetSeen ? null : "battery_reset_electrical_rate",
  ].filter((item): item is string => Boolean(item));

  // Structured line-item delta detector: pair rows across the lower (source)
  // and higher (comparison) estimates and surface what the lower estimate is
  // missing or under-documenting relative to the higher one. Wrapped so a parse
  // failure can never break PDF generation.
  let lineItemDeltaFindingCount = 0;
  let lineItemDeltaMatchedPairCount = 0;
  let lineItemDeltaMissingCount = 0;
  try {
    const deltaFindings = buildStructuredLineItemDeltaFindings(context, usedAnchorIds);
    lineItemDeltaFindingCount = deltaFindings.findings.length;
    lineItemDeltaMatchedPairCount = deltaFindings.matchedPairCount;
    lineItemDeltaMissingCount = deltaFindings.missingOperationCount;
    findings.push(...deltaFindings.findings);
  } catch (error) {
    console.error("[citation-density] structured line-item delta detector failed (non-fatal)", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    findings,
    debug: {
      requiredDetectorFindingCount: findings.length,
      missingRequiredDetectors,
      lineItemDeltaFindingCount,
      lineItemDeltaMatchedPairCount,
      lineItemDeltaMissingCount,
      rejectedAnchors: rejectedAnchors.slice(0, 40),
      rejectedBoilerplateCount: rejectedAnchors.length,
      authoritySearchTrace: {
        ...buildDefaultOemAuthorityTrace(),
        authorityTraceBlockedReason: "No Google Drive/internal repair-procedure connector is available to this server-side PDF export path.",
        skippedReason: "No Google Drive/internal repair-procedure connector is available to this server-side PDF export path.",
        sandPolishSupportFound: false,
      },
    },
  };
}

function normalizeSectionKey(section: string | null | undefined): string {
  return (section ?? "").replace(/[^a-z0-9]+/gi, " ").trim().toUpperCase();
}

function describeLineItemDelta(delta: EstimateLineItemDelta): {
  findingType: string;
  title: string;
  label: string;
  category: CitationDensityFinding["category"];
  estimateGapType: CitationDensityFinding["estimateGapType"];
  missingProof: string;
  nextAction: string;
  missingAuthorityTypes: string[];
  score: number;
  safetyImpact: "low" | "medium" | "high";
  priority: "low" | "medium" | "high";
} {
  const label = delta.higherRow.description;
  if (delta.kind === "missing_operation") {
    return {
      findingType: "delta-missing-operation",
      title: `Operation present in higher estimate, missing here: ${label}`,
      label: "ESTIMATE GAP ONLY",
      category: "not_included_operation",
      estimateGapType: "missing_from_carrier",
      missingProof:
        "Estimate-to-estimate comparison shows this operation is documented in the higher estimate but is not present on this estimate. This is estimate-difference evidence; it does not by itself prove the operation is required.",
      nextAction:
        "Add the operation as a supplement line if it was or should be performed, or document why it is not required on this estimate.",
      missingAuthorityTypes: ["supplement line", "invoice or completion proof"],
      score: 50,
      safetyImpact: "medium",
      priority: "medium",
    };
  }
  if (delta.kind === "reduced_paint") {
    return {
      findingType: "delta-reduced-paint",
      title: `Reduced paint/refinish vs higher estimate: ${label}`,
      label: "ESTIMATE GAP ONLY",
      category: "refinish",
      estimateGapType: "reduced_by_carrier",
      missingProof:
        "The higher estimate allows more paint/refinish time for this operation. Reconcile the difference against CCC/MOTOR/P-page refinish basis or document the lower allowance.",
      nextAction:
        "Reconcile the paint/refinish hours with the higher estimate, or document the included-operation basis for the lower allowance.",
      missingAuthorityTypes: ["CCC/MOTOR/P-page refinish basis", "included-operation basis"],
      score: 48,
      safetyImpact: "low",
      priority: "medium",
    };
  }
  if (delta.kind === "part_or_price_difference") {
    return {
      findingType: "delta-part-price",
      title: `Part/price difference vs higher estimate: ${label}`,
      label: "NEEDS INVOICE",
      category: "other",
      estimateGapType: "present_but_under_documented",
      missingProof:
        "The two estimates price this part differently. Document the part-type, supplier invoice, and fit/finish basis before relying on either price.",
      nextAction:
        "Obtain the supplier invoice and part-type authorization, and reconcile the price difference between the estimates.",
      missingAuthorityTypes: ["supplier invoice", "part-type authorization"],
      score: 46,
      safetyImpact: "low",
      priority: "medium",
    };
  }
  // reduced_labor
  return {
    findingType: "delta-reduced-labor",
    title: `Reduced body labor vs higher estimate: ${label}`,
    label: "ESTIMATE GAP ONLY",
    category: "labor_difference",
    estimateGapType: "reduced_by_carrier",
    missingProof:
      "The higher estimate allows more body labor for this operation. Reconcile the labor difference against MOTOR/CCC time basis or document the lower allowance.",
    nextAction:
      "Reconcile the body labor hours with the higher estimate, or document the included-operation basis for the lower allowance.",
    missingAuthorityTypes: ["MOTOR/CCC labor-time basis", "included-operation basis"],
    score: 52,
    safetyImpact: "low",
    priority: "medium",
  };
}

function buildStructuredLineItemDeltaFindings(
  context: AnnotatedEstimateFindingGeneratorContext,
  usedAnchorIds: Set<string>
): {
  findings: CitationDensityFinding[];
  matchedPairCount: number;
  missingOperationCount: number;
} {
  const comparison = (context.comparisonEstimateTexts ?? []).filter(
    (item) => item.text && item.text.trim().length > 0
  );
  if (comparison.length === 0) {
    return { findings: [], matchedPairCount: 0, missingOperationCount: 0 };
  }

  const primaryAnchors = context.anchors.filter(
    (anchor) => anchor.anchorType === "estimate_line" || anchor.anchorType === "embedded_link_row"
  );
  const anchorById = new Map(primaryAnchors.map((anchor) => [anchor.anchorId, anchor]));
  const lowerRows: EstimateDeltaRow[] = [];
  for (const anchor of primaryAnchors) {
    const row = deltaRowFromRawText({
      rawText: anchor.rowText,
      section: anchor.section ?? null,
      anchorId: anchor.anchorId,
      pageNumber: anchor.pageNumber,
    });
    if (row) lowerRows.push(row);
  }

  const higherRows = comparison.flatMap((item) => parseCccEstimateRows(item.text));
  if (lowerRows.length === 0 || higherRows.length === 0) {
    return { findings: [], matchedPairCount: 0, missingOperationCount: 0 };
  }

  // Only annotate in the intended direction (lower estimate vs a higher one).
  // If totals are known and the comparison is actually the lower-cost estimate,
  // skip so we never claim this estimate is "missing" scope it actually has.
  const lowerTotal = parseEstimateNetTotal(context.sourceText ?? "");
  const higherTotal = comparison
    .map((item) => parseEstimateNetTotal(item.text))
    .find((value): value is number => value !== null) ?? null;
  if (lowerTotal !== null && higherTotal !== null && higherTotal < lowerTotal) {
    return { findings: [], matchedPairCount: 0, missingOperationCount: 0 };
  }

  const match = matchEstimateLineItems({ lowerRows, higherRows });
  const comparisonName = comparison[0]?.fileName || "the higher estimate";

  // Map each section to the last lower-estimate row anchor in that section, for
  // anchoring "missing operation" callouts to the relevant section.
  const sectionToLastAnchor = new Map<string, EstimateRowAnchor>();
  for (const anchor of primaryAnchors) {
    const key = normalizeSectionKey(anchor.section);
    if (key) sectionToLastAnchor.set(key, anchor);
  }

  const findings: CitationDensityFinding[] = [];
  const emittedSlugs = new Set<string>();
  const missingPerSection = new Map<string, number>();
  const MAX_DELTA_FINDINGS = 60;
  const MAX_MISSING_PER_SECTION = 4;

  for (const delta of match.deltas) {
    if (findings.length >= MAX_DELTA_FINDINGS) break;

    let anchor: EstimateRowAnchor | undefined;
    let consumeAnchor = false;
    if (delta.lowerRow?.anchorId) {
      anchor = anchorById.get(delta.lowerRow.anchorId);
      consumeAnchor = true; // matched-row callouts own their row
    } else if (delta.kind === "missing_operation") {
      const sectionKey = normalizeSectionKey(delta.higherRow.section);
      anchor = sectionKey ? sectionToLastAnchor.get(sectionKey) : undefined;
      if (anchor) {
        const count = missingPerSection.get(sectionKey) ?? 0;
        if (count >= MAX_MISSING_PER_SECTION) continue;
        missingPerSection.set(sectionKey, count + 1);
      }
    }
    if (!anchor) continue; // never emit an unanchored delta finding
    if (consumeAnchor && (usedAnchorIds.has(anchor.anchorId) || emittedSlugs.has(`anchor:${anchor.anchorId}`))) {
      continue;
    }

    const meta = describeLineItemDelta(delta);
    const slug =
      delta.higherRow.description
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "operation";
    const slugKey = `${meta.findingType}:${slug}`;
    if (emittedSlugs.has(slugKey)) continue;
    emittedSlugs.add(slugKey);
    if (consumeAnchor) {
      usedAnchorIds.add(anchor.anchorId);
      emittedSlugs.add(`anchor:${anchor.anchorId}`);
    }

    findings.push(
      buildRequiredDetectorFinding({
        context,
        anchor,
        findingType: `${meta.findingType}-${slug}`,
        title: meta.title,
        category: meta.category,
        label: meta.label,
        estimateGapType: meta.estimateGapType,
        score: meta.score,
        safetyImpact: meta.safetyImpact,
        priority: meta.priority,
        currentSupportSummary: `${delta.summary} (Comparison estimate: ${comparisonName}.)`,
        missingProofSummary: meta.missingProof,
        recommendedNextAction: meta.nextAction,
        missingAuthorityTypes: meta.missingAuthorityTypes,
        amountImpact: delta.priceDelta ?? null,
        laborHoursImpact: delta.laborDelta ?? null,
      })
    );
  }

  return {
    findings,
    matchedPairCount: match.matchedPairCount,
    missingOperationCount: match.missingOperationCount,
  };
}

export type PolicyApplicabilityDiagnostics = {
  policyNumber: string | null;
  effectiveDates: string | null;
  namedInsuredRedacted: string | null;
  insuredVehicle: string | null;
  insuredVin: string | null;
  collisionDeductible: string | null;
  comprehensiveDeductible: string | null;
  policyForms: string[];
  appraisalSectionsFound: string[];
  actionAgainstInsurerFound: boolean;
  governingLawOrJurisdiction: string | null;
  endorsements: string[];
  extractionConfidence: "high" | "medium" | "low" | "failed";
  ocrFallbackRecommended: boolean;
  vehicleMismatch: CitationDensityDebugTrace["policyVehicleMismatch"];
};

export function extractPolicyApplicabilityDiagnostics(params: {
  policyText: string | null | undefined;
  activeEstimateVehicle?: string | null;
}): PolicyApplicabilityDiagnostics {
  const text = params.policyText?.replace(/\r\n/g, "\n").replace(/\r/g, "\n") ?? "";
  const normalized = text.replace(/\s+/g, " ").trim();
  const garbled = isGarbledPolicyText(normalized);
  const policyVehicle = extractPolicyVehicle(normalized);
  const activeVehicle = params.activeEstimateVehicle?.trim() || null;
  const vehicleMismatch = policyVehicle && activeVehicle && !vehiclesAppearToMatch(policyVehicle, activeVehicle)
    ? {
        policyVehicle,
        activeEstimateVehicle: activeVehicle,
        warning: `Policy uploaded, but insured vehicle appears to be ${policyVehicle}. Active estimate vehicle appears to be ${activeVehicle}. Confirm policy applicability before relying on this language.`,
      }
    : null;
  const confidence: PolicyApplicabilityDiagnostics["extractionConfidence"] = !normalized
    ? "failed"
    : garbled
      ? "failed"
      : [/\bpolicy\b/i, /\bVIN\b/i, /\bdeductible\b/i, /\bappraisal|if we cannot agree\b/i].filter((pattern) => pattern.test(normalized)).length >= 3
        ? "high"
        : "medium";

  return {
    policyNumber: normalized.match(/\bpolicy\s*(?:number|no\.?|#)\s*[:#]?\s*([A-Z0-9-]{4,})/i)?.[1] ?? null,
    effectiveDates: normalized.match(/\b(?:effective|policy period)\b[^.:\n]{0,40}[: ]\s*([A-Za-z0-9 ,/-]{8,60})/i)?.[1]?.trim() ?? null,
    namedInsuredRedacted: normalized.match(/\bnamed insured\b\s*[:#]?\s*([A-Z][A-Za-z .'-]{1,60})/i)?.[1]?.replace(/\S/g, "X") ?? null,
    insuredVehicle: policyVehicle,
    insuredVin: normalized.match(/\bVIN\b\s*[:#]?\s*([A-HJ-NPR-Z0-9*]{11,17})/i)?.[1] ?? null,
    collisionDeductible: normalized.match(/\bcollision\b[^$]{0,80}(\$[\d,]+)/i)?.[1] ?? null,
    comprehensiveDeductible: normalized.match(/\bcomprehensive\b[^$]{0,80}(\$[\d,]+)/i)?.[1] ?? null,
    policyForms: [...normalized.matchAll(/\b(form|endorsement)\s+([A-Z0-9-]{3,})/gi)].map((match) => match[2]).slice(0, 20),
    appraisalSectionsFound: ["appraisal", "right to appraisal", "if we cannot agree", "payment of loss"].filter((label) =>
      new RegExp(label.replace(/\s+/g, "\\s+"), "i").test(normalized)
    ),
    actionAgainstInsurerFound: /\baction against (?:us|insurer|company)\b/i.test(normalized),
    governingLawOrJurisdiction: normalized.match(/\b(?:governing law|jurisdiction|laws of)\b[^.]{0,80}/i)?.[0] ?? null,
    endorsements: [...normalized.matchAll(/\bendorsement\s+([A-Z0-9-]{3,})/gi)].map((match) => match[1]).slice(0, 20),
    extractionConfidence: confidence,
    ocrFallbackRecommended: garbled || confidence === "failed",
    vehicleMismatch,
  };
}

export function buildOemCitationDensityFindings(
  context: AnnotatedEstimateFindingGeneratorContext
): AnnotatedEstimateGeneratedFindings {
  const authoritySources = detectOemCitationDensityAuthoritySources(context);
  const authorityTrace = context.authorityTrace ?? buildDefaultOemAuthorityTrace();
  const acceptedFindings: CitationDensityFinding[] = [];
  const droppedReasons: CitationDensityDebugTrace["partSourceDroppedReasons"] = [];
  const seenAnchorIds = new Set<string>();

  for (const anchor of context.anchors) {
    const rowText = getAnchorSourceText(anchor);
    const normalized = normalizeMatchText(rowText);
    if (!rowText.trim()) continue;
    if (anchor.anchorType !== "estimate_line" && anchor.anchorType !== "line_note" && anchor.anchorType !== "embedded_link_row") {
      continue;
    }
    if (isRejectedPrimaryAnchorText(rowText, anchor)) {
      droppedReasons.push({ anchorId: anchor.anchorId, rowText, reason: "legend, abbreviation, disclaimer, guide, or legal boilerplate rejected as primary row anchor" });
      continue;
    }
    if (isVehicleYearLineNumber(anchor.lineNumber) || containsVehicleYearIdentityText(rowText)) {
      droppedReasons.push({ anchorId: anchor.anchorId, rowText, reason: "source line parsed as vehicle year" });
      continue;
    }
    if (isBoilerplatePartSourceText(normalized)) {
      droppedReasons.push({ anchorId: anchor.anchorId, rowText, reason: "generic boilerplate as primary row anchor" });
      continue;
    }
    const family = classifyOemCitationDensityRow(rowText, anchor);
    if (!family) continue;
    if (seenAnchorIds.has(anchor.anchorId)) continue;
    const finding = buildOemCitationDensityFinding({
      context,
      anchor,
      rowText,
      family,
      authoritySources,
    });
    if (!finding.recommendedNextAction.trim()) {
      droppedReasons.push({ anchorId: anchor.anchorId, rowText, reason: "findings without nextAction" });
      continue;
    }
    if (isOemVerifiedLabel(finding.citationLabel) && !finding.verifiedAuthorityCount) {
      finding.citationLabel = family.fallbackLabel;
      finding.bestAvailableAuthority = buildEstimateEvidenceAuthority(family);
      finding.verifiedAuthorityCount = 0;
      finding.limitations.push("Verified label downgraded because no supporting authority source was attached.");
    }
    acceptedFindings.push(finding);
    seenAnchorIds.add(anchor.anchorId);
  }

  const authorityBackedFindingCount = acceptedFindings.filter((finding) => finding.verifiedAuthorityCount > 0).length;
  const estimateOnlyFindingCount = acceptedFindings.filter((finding) => finding.verifiedAuthorityCount === 0).length;
  const researchNeededFindingCount = acceptedFindings.filter((finding) =>
    finding.missingAuthorityTypes.some((item) => /OEM|MOTOR|procedure|position/i.test(item))
  ).length;
  const debugFindings = acceptedFindings.slice(0, 20).map((finding): OemCitationDensityFindingDebug => {
    const evidenceTier = getOemEvidenceTier(finding);
    return {
      findingId: finding.id,
      title: finding.operationLabel,
      label: getProofBucketLabel(finding),
      anchorId: getFindingAnchorId(finding),
      evidenceTier,
      authoritySourceTypes: (finding.bestAvailableAuthority?.type ? [finding.bestAvailableAuthority.type] : ["estimate_evidence"]),
      nextAction: finding.recommendedNextAction,
      confidence: finding.confidence,
    };
  });

  return {
    findings: acceptedFindings,
    debug: {
      reportType: "oem-citation-density",
      artifactVersion: OEM_CITATION_DENSITY_ARTIFACT_VERSION,
      reviewedEstimateFileNames: [context.sourcePdfName],
      authoritySearchTrace: authorityTrace,
      authoritySourceCount: authoritySources.filter((source) => source.sourceType !== "estimate_evidence").length,
      oemProcedureSourceCount: authoritySources.filter((source) => source.sourceType === "oem_procedure").length,
      oemPositionStatementSourceCount: authoritySources.filter((source) => source.sourceType === "oem_position_statement").length,
      motorDatabaseSourceCount: authoritySources.filter((source) => source.sourceType === "motor_database").length,
      uploadedSupportDocumentCount: authoritySources.filter((source) => source.sourceType === "uploaded_support").length,
      cccSecureShareSourceCount: authoritySources.filter((source) => source.sourceType === "ccc_secure_share").length,
      policySourceCount: authoritySources.filter((source) => source.sourceType === "policy").length,
      jurisdictionalLawSourceCount: authoritySources.filter((source) => source.sourceType === "jurisdictional_law").length,
      internetFallbackSourceCount: authoritySources.filter((source) => source.sourceType === "internet_fallback").length,
      authorityBackedFindingCount,
      estimateOnlyFindingCount,
      researchNeededFindingCount,
      findingsWithNextActionCount: acceptedFindings.filter((finding) => finding.recommendedNextAction.trim().length > 0).length,
      findingsWithoutNextActionCount: acceptedFindings.filter((finding) => !finding.recommendedNextAction.trim()).length,
      findingsRejectedDueWeakEvidence: 0,
      findingsRejectedDueNoAnchor: droppedReasons.filter((item) => /anchor/i.test(item.reason)).length,
      firstAuthoritySources: authoritySources.slice(0, 20),
      firstOemCitationDensityFindings: debugFindings,
      partSourceDroppedReasons: droppedReasons,
    },
  };
}

function buildRequiredDetectorFinding(params: {
  context: AnnotatedEstimateFindingGeneratorContext;
  anchor: EstimateRowAnchor;
  findingType: string;
  title: string;
  category: CitationDensityFinding["category"];
  label: string;
  score: number;
  safetyImpact: "low" | "medium" | "high";
  priority: "low" | "medium" | "high";
  currentSupportSummary: string;
  missingProofSummary: string;
  recommendedNextAction: string;
  missingAuthorityTypes: string[];
  amountImpact?: number | null;
  laborHoursImpact?: number | null;
  estimateGapType?: CitationDensityFinding["estimateGapType"];
}): CitationDensityFinding {
  const evidence = {
    lineNumber: params.anchor.lineNumber,
    description: getAnchorSourceText(params.anchor),
    amount: params.anchor.price ?? null,
    laborHours: params.anchor.labor ?? null,
    sourceLabel: params.context.sourcePdfName,
  };
  const needsOem = /OEM|procedure|position/i.test(params.missingAuthorityTypes.join(" "));
  const needsPPage = /p-?page|database|CCC|MOTOR/i.test(params.missingAuthorityTypes.join(" "));
  const needsAdas = /ADAS|sensor|calibration|reset|electrical|battery|scan|Tesla|EV/i.test(`${params.title} ${params.missingProofSummary}`);
  return {
    id: `required-detector-${params.findingType}-${params.anchor.anchorId.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`,
    operationLabel: params.title,
    category: params.category,
    estimateGapType:
      params.estimateGapType ??
      (params.findingType === "wheel_labor_delta" ? "reduced_by_carrier" : "needs_proof"),
    carrierEvidence: params.anchor.sourceDocumentRole === "carrier" ? evidence : undefined,
    shopEvidence: params.anchor.sourceDocumentRole === "shop" ? evidence : undefined,
    applicableEstimateRoles: [params.anchor.sourceDocumentRole],
    primaryAnnotationRole: params.anchor.sourceDocumentRole,
    carrierAnchor: params.anchor.sourceDocumentRole === "carrier" ? buildFindingLineAnchor(params.anchor) : undefined,
    shopAnchor: params.anchor.sourceDocumentRole === "shop" ? buildFindingLineAnchor(params.anchor) : undefined,
    impact: {
      dollarImpact: params.amountImpact ?? null,
      laborHoursImpact: params.laborHoursImpact ?? null,
      safetyImpact: params.safetyImpact,
      supplementPriority: params.priority,
    },
    citationStatus: {
      oem: needsOem ? "needed" : "not_applicable",
      oemPositionStatement: needsOem ? "needed" : "not_applicable",
      adas: needsAdas ? "needed" : "not_applicable",
      pPages: needsPPage ? "needed" : "not_applicable",
      scrs: needsPPage && params.category === "refinish" ? "needed" : "not_applicable",
      deg: needsPPage ? "needed" : "not_applicable",
      nhtsa: "not_applicable",
      stateRegulation: "not_applicable",
      policy: "not_applicable",
      invoiceOrCompletionProof: "needed",
      photoOrTeardownProof: "not_found",
    },
    citationDensityScore: params.score,
    verifiedAuthorityCount: 0,
    missingAuthorityTypes: params.missingAuthorityTypes,
    missingAuthority: params.missingAuthorityTypes,
    bestAvailableAuthority: {
      type: needsPPage ? "p_page" : "estimate_evidence",
      status: "needed",
      title: needsPPage ? "CCC/MOTOR/P-page support needed" : "Estimate evidence only",
      confidence: "medium",
      note: "Required estimator detector generated this finding from a concrete estimate row; authority still needs to be attached.",
    },
    citationLabel: params.label,
    currentSupportSummary: params.currentSupportSummary,
    missingProofSummary: params.missingProofSummary,
    recommendedNextAction: params.recommendedNextAction,
    confidence: params.anchor.confidence >= 0.9 ? "high" : "medium",
    limitations: [
      "Required estimator detector generated from an extracted estimate row.",
      "Do not assert OEM requires, NHTSA crash-test equivalency, or warranty voiding unless verified authority is attached.",
      `sourcePdfHash:${params.context.sourcePdfHash}`,
      `artifactVersion:${CITATION_DENSITY_ARTIFACT_VERSION}`,
    ],
  };
}

function isGeneratedFindingCoveredByExisting(generated: CitationDensityFinding, existing: CitationDensityFinding[]) {
  const generatedLine = generated.carrierEvidence?.lineNumber ?? generated.shopEvidence?.lineNumber ?? null;
  const generatedText = normalizeMatchText([
    generated.operationLabel,
    generated.carrierEvidence?.description,
    generated.shopEvidence?.description,
    generated.currentSupportSummary,
  ].filter(Boolean).join(" "));
  return existing.some((finding) => {
    const existingLine = finding.carrierEvidence?.lineNumber ?? finding.shopEvidence?.lineNumber ?? null;
    if (generatedLine && existingLine && String(generatedLine) === String(existingLine)) return true;
    const existingText = normalizeMatchText([
      finding.operationLabel,
      finding.carrierEvidence?.description,
      finding.shopEvidence?.description,
      finding.currentSupportSummary,
    ].filter(Boolean).join(" "));
    return keyTokenScore(generatedText, existingText, 20) >= 12 || sharedTermScore(generatedText, existingText, 20) >= 12;
  });
}


function isPrimaryEstimateAnchor(anchor: EstimateRowAnchor) {
  return anchor.anchorType === "estimate_line" || anchor.anchorType === "line_note" || anchor.anchorType === "totals_row";
}

function isRejectedPrimaryAnchorText(rowText: string, anchor: EstimateRowAnchor) {
  const normalized = normalizeMatchText(rowText);
  if (anchor.anchorType === "supplier_row" || anchor.anchorType === "guide_row" || anchor.anchorType === "section_row" || anchor.anchorType === "totals_row") return true;
  return isJunkCitationFindingText(normalized) ||
    /\b(?:abbreviations?|legend|disclaimer|fraud notice|legal notice|work authorization|policy|declarations?|allstate parts policy|alternate parts policy|quality replacement parts|vehicle equipment|vin decoding|footer|page \d+ of \d+|ccc\/motor|motor guide|estimating guide|included operations?|not included|a\/m\s*=\s*aftermarket|lkq\s*\/?\s*rcy\s*\/?\s*used|capa\s*(?:certified|definition|definitions?)|estimate totals?|parts total|subtotal|grand total|sales tax|body labor totals?|paint labor totals?|paint supplies totals?|labor\s+[a-z]\s*=\s*diagnostic|qr\s*code|sunbit|payment plan|pay(?:ment)?\s+(?:link|portal|text|option))\b/i.test(rowText) ||
    /\b(?:abbreviation|legend|disclaimer|fraud|legal notice|work authorization|policy|declarations|alternate parts policy|quality replacement|vehicle equipment|footer|ccc motor|motor guide|estimating guide|included operations|not included|aftermarket definition|lkq rcy used|capa definition|estimate totals|parts total|subtotal|grand total|sales tax|body labor total|paint labor total|paint supplies total|labor d diagnostic|qr code|sunbit|payment plan|payment link|payment portal)\b/.test(normalized);
}

function isRejectedBoilerplateSupplierText(normalized: string) {
  return isJunkCitationFindingText(normalized) ||
    /\b(?:aftermarket crash part|quality replacement parts?|alternate parts policy|a\/m aftermarket|a m aftermarket|capa definitions?|lkq rcy used definitions?|abbreviations?|legend|disclaimer|fraud|ccc motor|motor guide|included operations?|not included|vehicle equipment|recond|refn)\b/.test(normalized);
}

function isWheelLaborAnchorText(normalized: string) {
  if (!/\b(?:wheel|rim|tire|alignment)\b/.test(normalized)) return false;
  if (/\b(?:wheel opening|opening molding|molding|flare|liner|vehicle equipment|tilt wheel|fm radio|skyview roof)\b/.test(normalized)) return false;
  return /\b(?:(?:rf|lf|rt|lt|front|rear)\s+(?:wheel|rim)|(?:wheel|rim)\s+(?:repair|replacement|replace|repl|r&i|r\s*&\s*i|access)|tire\s+(?:mount|balance|mount\/balance)|(?:four[-\s]?wheel|4[-\s]?wheel)?\s*alignment|transport\s+alignment)\b/.test(normalized);
}

function isWheelComparisonBoilerplate(text: string) {
  const normalized = normalizeMatchText(text);
  return /\b(?:vehicle equipment|4 wheel drive|tilt wheel|fm radio|skyview roof|wheel opening|opening molding)\b/.test(normalized);
}

function isJunkCitationFindingText(normalized: string) {
  return /\b(?:aftermarket crash part|quality replacement parts?|alternate parts policy|a\/m aftermarket|a m aftermarket|capa definitions?|capa certified|lkq rcy used definitions?|lkq\/rcy\/used|abbreviations?|legend|disclaimer|fraud|legal notice|ccc motor|ccc\/motor|motor guide|estimating guide|included operations?|not included|vehicle equipment|vin decoding|footer|page \d+ of \d+|recond|refn|estimate totals|parts total|subtotal|grand total|sales tax|body labor total|paint labor total|paint supplies total|labor d diagnostic|qr code|sunbit|payment plan|payment link|payment portal)\b/.test(normalized) ||
    /\b(?:4 wheel drive|tilt wheel|fm radio|skyview roof)\b/.test(normalized) ||
    (/\b(?:total|subtotal|net cost|deductible|betterment|tax)\b/.test(normalized) && /\b(?:footer|page|claim|insured|owner|license|vin)\b/.test(normalized));
}

function summarizeWheelCarrierEvidence(anchors: EstimateRowAnchor[]) {
  const rows = anchors
    .filter((anchor) => isPrimaryEstimateAnchor(anchor))
    .map((anchor) => ({ anchor, rowText: getAnchorSourceText(anchor) }))
    .filter((item) => isWheelLaborAnchorText(normalizeMatchText(item.rowText)))
    .map((item) => `${item.anchor.lineNumber ? `line ${item.anchor.lineNumber} ` : ""}${item.rowText}`)
    .slice(0, 5);
  return rows.length ? rows.join("; ") : "wheel/tire/alignment row located in source estimate";
}

function summarizeComparisonEvidence(text: string, pattern: RegExp) {
  const lines = text
    .split(/\r?\n/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => pattern.test(item) && isRelevantWheelComparisonEvidence(item))
    .sort((a, b) => scoreWheelComparisonEvidenceLine(b) - scoreWheelComparisonEvidenceLine(a));
  const summary = lines.slice(0, 2).join("; ");
  return summary ? truncateText(summary, 180) : "not located in comparison text";
}

function isRelevantWheelComparisonEvidence(line: string) {
  if (isWheelComparisonBoilerplate(line)) return false;
  const normalized = normalizeMatchText(line);
  if (/\bline\s+210\b/i.test(line)) return false;
  return /\bline\s+(?:50|51)\b/i.test(line) ||
    /\b(?:rf|lf)\s+(?:wheel|rim)\b/.test(normalized) && /\b(?:replacement|replace|repl|r&i|r\s*&\s*i|access)\b/.test(normalized) ||
    /\baccess\b/.test(normalized) && /\b(?:wheel|liner|flare|bumper hardware)\b/.test(normalized);
}

function scoreWheelComparisonEvidenceLine(line: string) {
  let score = 0;
  if (/\bline\s+(?:50|51)\b/i.test(line)) score += 20;
  if (/\b(?:rf|lf)\s+wheel\b/i.test(line)) score += 12;
  if (/\br&i|r\s*&\s*i|access\b/i.test(line)) score += 10;
  if (/\bline\s+210\b/i.test(line)) score -= 8;
  return score;
}

function isGarbledPolicyText(text: string) {
  if (!text.trim()) return true;
  const replacementCount = (text.match(/\uFFFD|�/g) ?? []).length;
  const mojibakeCount = (text.match(/(?:Ã|Â|â€|â€™|â€œ|â€|ï¿½)/g) ?? []).length;
  return replacementCount + mojibakeCount >= 3 || (text.length > 80 && /[A-Za-z]/.test(text) && text.replace(/[A-Za-z0-9\s.,;:$#/-]/g, "").length / text.length > 0.18);
}

function extractPolicyVehicle(text: string) {
  const explicit = text.match(/\b(?:insured|covered|described)\s+vehicle\b[^.:\n]{0,40}[: ]\s*((?:19|20)\d{2}\s+[A-Z][A-Za-z-]+(?:\s+[A-Za-z0-9-]+){0,4})/i)?.[1];
  if (explicit) return explicit.trim();
  return text.match(/\b((?:19|20)\d{2}\s+(?:Tesla|Ford|Chevrolet|Chevy|GMC|Honda|Toyota|Nissan|Hyundai|Kia|BMW|Mercedes|Audi|Volkswagen|Jeep|Ram|Dodge|Subaru|Mazda|Lexus|Acura|Rivian|Lucid)\s+[A-Za-z0-9-]+(?:\s+[A-Za-z0-9-]+){0,3})\b/i)?.[1]?.trim() ?? null;
}

function vehiclesAppearToMatch(a: string, b: string) {
  const normalize = (value: string) => normalizeMatchText(value)
    .split(" ")
    .filter((token) => token.length > 1)
    .slice(0, 5);
  const left = normalize(a);
  const right = new Set(normalize(b));
  if (!left.length || !right.size) return false;
  const matches = left.filter((token) => right.has(token)).length;
  return matches >= Math.min(3, left.length);
}

type OemCitationDensityFamily = {
  findingType: string;
  title: string;
  category: CitationDensityFinding["category"];
  label: string;
  fallbackLabel: string;
  evidenceTier: string;
  score: number;
  safetyImpact: "low" | "medium" | "high";
  priority: "low" | "medium" | "high";
  missingAuthorityTypes: string[];
  issueSummary: string;
  whyItMatters: string;
  oemComplianceConcern: string;
  nextAction: string;
  requiredDocumentation: string[];
};

function classifyOemCitationDensityRow(rowText: string, anchor: EstimateRowAnchor): OemCitationDensityFamily | null {
  const normalized = normalizeMatchText(rowText);
  const sourceKinds = classifyPartSource(rowText);
  const isTeslaOrEv = /\b(?:tesla|model\s+[3sxy]|ev\b|electric|high voltage|hv battery)\b/.test(normalized);
  if (/\b(?:d\s*&\s*r battery|d&r battery|disconnect.*battery|reconnect.*battery|battery reset|reset electronics|isolate 12v|hv state of charge|state of charge)\b/i.test(rowText)) {
    return {
      findingType: "battery_reset_electrical_rate",
      title: "Battery D&R / reset electronics procedure review",
      category: "scan_diagnostic",
      label: "NEEDS OEM",
      fallbackLabel: "NEEDS OEM",
      evidenceTier: "estimate_evidence",
      score: isTeslaOrEv ? 68 : 56,
      safetyImpact: isTeslaOrEv ? "high" : "medium",
      priority: "high",
      missingAuthorityTypes: ["MOTOR/CCC labor-category basis", "OEM battery disconnect/reconnect/reset procedure", "mechanical/electrical labor-rate support"],
      issueSummary: `Estimate row references battery disconnect/reconnect or reset electronics work: ${rowText}`,
      whyItMatters: "Battery D&R, reset electronics, 12V isolation, and HV state-of-charge work are mechanical/electrical procedure context, not generic miscellaneous charges.",
      oemComplianceConcern: "The row needs OEM procedure support and labor-category/rate reconciliation before it is treated as correctly classified.",
      nextAction: "Request MOTOR/CCC category basis, OEM battery disconnect/reconnect/reset procedure support, and reconcile mechanical/electrical labor category and rate.",
      requiredDocumentation: ["MOTOR/CCC category basis", "OEM battery/reset procedure", "mechanical/electrical rate support"],
    };
  }
  if (/\b(?:finish sand|denib|de nib|color sand|sand and polish|sand polish|buff|refinish correction|post refinish correction)\b/.test(normalized)) {
    return {
      findingType: "sand_polish_p_page_support",
      title: "Sand/polish refinish database support review",
      category: "refinish",
      label: "NEEDS P-PAGE",
      fallbackLabel: "NEEDS P-PAGE",
      evidenceTier: "estimate_evidence",
      score: 58,
      safetyImpact: "low",
      priority: "medium",
      missingAuthorityTypes: ["CCC/MOTOR/P-page support", "database support", "refinish correction basis"],
      issueSummary: `Estimate row contains finish sand/polish or refinish correction work: ${rowText}`,
      whyItMatters: "Finish sand and polish, denib and polish, color sand and buff, and post-refinish correction are refinish-related operations that may be capped or limited by estimating guidance.",
      oemComplianceConcern: "Treat as NEEDS P-PAGE / NEEDS DATABASE SUPPORT unless CCC/MOTOR/P-page guidance is attached.",
      nextAction: "Attach CCC/MOTOR/P-page/database guidance for the sand/polish operation or keep it labeled NEEDS P-PAGE / NEEDS DATABASE SUPPORT.",
      requiredDocumentation: ["CCC/MOTOR/P-page guidance", "database support", "refinish correction documentation"],
    };
  }
  if (/\b(?:pre[- ]?scan|post[- ]?scan|in[- ]?process scan|diagnostic|scan report|srs|health check)\b/.test(normalized)) {
    return {
      findingType: "diagnostics_scan",
      title: "Diagnostics / scan documentation review",
      category: "scan_diagnostic",
      label: "NEEDS ADAS",
      fallbackLabel: "NEEDS ADAS",
      evidenceTier: "estimate_evidence",
      score: 42,
      safetyImpact: "high",
      priority: "high",
      missingAuthorityTypes: ["OEM/MOTOR scan procedure", "scan invoice/completion proof"],
      issueSummary: `Estimate row references diagnostics or scan activity: ${rowText}`,
      whyItMatters: "Scan and diagnostic rows affect safety-system readiness and need procedure support plus completion proof before they are treated as substantiated.",
      oemComplianceConcern: "Estimate evidence suggests scan-related repair-standard work, but OEM/MOTOR support and completion documentation must be attached or researched.",
      nextAction: "Attach OEM/MOTOR scan procedure support and completion proof. Confirm whether pre-repair scan, in-process scan, post-repair scan, calibration readiness, or ADAS calibration is required for this vehicle and operation.",
      requiredDocumentation: ["OEM/MOTOR scan procedure", "scan report", "invoice or completion proof"],
    };
  }
  if (/\b(?:adas|calibration|recalibration|aim(?:ing)?|initialize|initialization|reset|relearn|programming|radar|camera|sensor|dynamic function test|road test)\b/.test(normalized)) {
    return {
      findingType: "adas_calibration",
      title: "ADAS / calibration repair-path review",
      category: "adas_calibration",
      label: "NEEDS ADAS",
      fallbackLabel: "NEEDS ADAS",
      evidenceTier: "estimate_evidence",
      score: 40,
      safetyImpact: "high",
      priority: "high",
      missingAuthorityTypes: ["OEM/MOTOR ADAS procedure", "calibration or completion proof"],
      issueSummary: `Estimate row affects ADAS/calibration workflow: ${rowText}`,
      whyItMatters: "Calibration, aiming, reset, and initialization rows can affect vehicle safety systems and must be tied to the correct procedure and completion output.",
      oemComplianceConcern: "The row should be verified against OEM/MOTOR calibration, aiming, reset, or initialization requirements before relying on the estimate line.",
      nextAction: "Attach OEM/MOTOR calibration, aiming, reset, or initialization procedure and completion documentation. Verify affected sensors/cameras/radar systems and document final calibration results.",
      requiredDocumentation: ["OEM/MOTOR calibration procedure", "calibration result", "sensor/camera/radar verification"],
    };
  }
  if ((/\b(?:hub|bearing|knuckle|control arm|tie rod|steering|strut|spindle|suspension|wheel end|wheel)\b/.test(normalized) && hasNonOemPartSource(sourceKinds))) {
    return {
      findingType: "am_wheel_end_safety",
      title: "A/M wheel-end part-source safety review",
      category: "parts_downgrade",
      label: "NEEDS OEM",
      fallbackLabel: "NEEDS OEM",
      evidenceTier: "estimate_evidence",
      score: isTeslaOrEv ? 72 : 62,
      safetyImpact: "high",
      priority: "high",
      missingAuthorityTypes: ["OEM procedure or position support", "supplier/manufacturer fit-function documentation", "written carrier part-source basis"],
      issueSummary: `Estimate row uses non-OEM wheel-end, steering, bearing, hub, or suspension sourcing: ${rowText}`,
      whyItMatters: `${isTeslaOrEv ? "EV weight and ADAS sensitivity increase the need for OEM procedure verification. " : ""}Wheel hub, bearing, steering, and suspension components are safety-critical wheel-end components and can affect steering, stability, sensor calibration, ADAS confidence, and roadworthiness.`,
      oemComplianceConcern: "This supports OEM review / requires OEM procedure or position support; do not state OEM requires unless authority exists.",
      nextAction: "Request OEM position/procedure support, supplier/manufacturer fit/function documentation, and the carrier's written basis for A/M/LKQ/non-OEM wheel-end use on this platform.",
      requiredDocumentation: ["OEM procedure or position support", "supplier/manufacturer fit-function documentation", "carrier written basis"],
    };
  }
  if (hasNonOemPartSource(sourceKinds) || /\b(?:incorrect style|not correct style|fit|finish|quality replacement|aftermarket)\b/.test(normalized)) {
    return {
      findingType: "part_source_oem_review",
      title: "Part-source / OEM repair-path review",
      category: "parts_downgrade",
      label: "NEEDS OEM",
      fallbackLabel: "NEEDS OEM",
      evidenceTier: "estimate_evidence",
      score: isTeslaOrEv ? 58 : 45,
      safetyImpact: /sensor|radar|camera|lamp|bumper|grille|support|hub|bearing|suspension|steering|wheel/.test(normalized) ? "high" : "medium",
      priority: "high",
      missingAuthorityTypes: ["OEM procedure or position statement", "part-type authorization", "supplier/invoice proof"],
      issueSummary: `Estimate row uses or questions non-OEM part sourcing: ${rowText}`,
      whyItMatters: `${isTeslaOrEv ? "EV weight and ADAS sensitivity increase the need for OEM procedure verification. " : ""}Carrier aftermarket warranty language may guarantee fit, corrosion, or replacement of the part, but it does not prove OEM-equivalent system performance, ADAS compatibility, sensor alignment, crash-test equivalency, or related manufacturer warranty preservation.`,
      oemComplianceConcern: "Estimate evidence supports a part-source review, but it does not by itself prove an OEM requirement, NHTSA crash-test equivalency, or an absolute warranty voiding claim.",
      nextAction: "Review OEM repair procedure and position statements for part-type requirements. Document authorization for LKQ/non-OEM part use, supplier fit/function support, and the written carrier basis before making legal or OEM-required claims.",
      requiredDocumentation: ["OEM procedure or position statement", "part-type authorization", "supplier invoice", "fit/finish validation"],
    };
  }
  if (/\b(?:section(?:ing)?|weld|bond|structural|measure|pull|setup|frame|aluminum|high strength|hss|uhss|one[- ]time|corrosion|seam sealer|foam|adhesive|nvh|panel)\b/.test(normalized)) {
    return {
      findingType: "repair_procedure_structural",
      title: "Repair procedure / structural operation review",
      category: "structural_or_fit_verification",
      label: "NEEDS OEM",
      fallbackLabel: "NEEDS OEM",
      evidenceTier: "estimate_evidence",
      score: 44,
      safetyImpact: "high",
      priority: "high",
      missingAuthorityTypes: ["OEM repair procedure", "measurement or completion proof"],
      issueSummary: `Estimate row indicates structural or procedure-sensitive work: ${rowText}`,
      whyItMatters: "Structural, welding, bonding, one-time-use, corrosion protection, and special-material operations require repair-path verification and documentation.",
      oemComplianceConcern: "The repair path should be checked against OEM procedure before work is accepted as complete or supplement-ready.",
      nextAction: "Attach OEM repair procedure support and completion documentation. Verify sectioning, welded/bonded panels, structural measurements, one-time-use components, corrosion protection, seam sealer, foam, adhesive, NVH, and material-specific requirements as applicable.",
      requiredDocumentation: ["OEM repair procedure", "measurement proof", "photo/teardown or completion proof"],
    };
  }
  if (/\b(?:blend|refinish|spray[- ]?out|tint|clear coat|paint|material|color)\b/.test(normalized)) {
    return {
      findingType: "refinish_blend_materials",
      title: "Refinish / blend / materials support review",
      category: "refinish",
      label: "NEEDS P-PAGE",
      fallbackLabel: "NEEDS P-PAGE",
      evidenceTier: "estimate_evidence",
      score: 52,
      safetyImpact: "medium",
      priority: "medium",
      missingAuthorityTypes: ["MOTOR/database guidance", "SCRS/refinish support", "material allowance proof"],
      issueSummary: `Estimate row contains refinish, blend, color, or material allowance work: ${rowText}`,
      whyItMatters: "Refinish and material rows need database, procedure, SCRS, policy, or jurisdictional support where available before the amount is treated as fully documented.",
      oemComplianceConcern: "The estimate line should be connected to refinish and material guidance without overclaiming an OEM requirement.",
      nextAction: "Attach procedure, estimating database, SCRS blend study, policy, or jurisdictional support as available. Document why the refinish/blend/material allowance is required and supplement missing labor/material support.",
      requiredDocumentation: ["MOTOR/database guidance", "SCRS blend study or refinish support", "material allowance proof"],
    };
  }
  if (anchor.anchorType === "totals_row" || /\b(?:labor rate|rate|subtotal|total|net cost|deductible|adjustment|paint supplies|materials)\b/.test(normalized)) {
    return {
      findingType: "labor_rates_totals",
      title: "Labor / rates / totals support review",
      category: "labor_difference",
      label: "ESTIMATE GAP ONLY",
      fallbackLabel: "ESTIMATE GAP ONLY",
      evidenceTier: "estimate_evidence",
      score: 58,
      safetyImpact: "low",
      priority: "medium",
      missingAuthorityTypes: ["rate/material support", "subtotal/totals consistency support"],
      issueSummary: `Estimate row contains labor, rate, material, deductible, adjustment, or totals information: ${rowText}`,
      whyItMatters: "Rate, material, and total rows need documentation and consistency checks before they are used to support a supplement or dispute.",
      oemComplianceConcern: "This is primarily estimate evidence; tie it to rate/material or estimating guidance before elevating it.",
      nextAction: "Review labor-rate reasonableness, paint/material rate support, missing not-included operations, subtotal/totals consistency, and deductible/adjustment clarity. Attach rate, invoice, database, or agreed-estimate support as available.",
      requiredDocumentation: ["rate support", "material support", "totals reconciliation"],
    };
  }
  if (/\b(?:invoice|receipt|proof|completion|photo|teardown|documentation|attached|referenced|link|report)\b/.test(normalized)) {
    return {
      findingType: "documentation_invoice_proof",
      title: "Documentation / invoice / proof review",
      category: "other",
      label: /referenced|link|attached/.test(normalized) ? "REFERENCED / NOT PRODUCED" : "NEEDS INVOICE",
      fallbackLabel: /referenced|link|attached/.test(normalized) ? "REFERENCED / NOT PRODUCED" : "NEEDS INVOICE",
      evidenceTier: "estimate_evidence",
      score: 48,
      safetyImpact: "medium",
      priority: "medium",
      missingAuthorityTypes: ["referenced support document", "invoice/completion proof"],
      issueSummary: `Estimate row references documentation, invoice, report, or proof: ${rowText}`,
      whyItMatters: "Referenced support must be produced before the estimate line can be treated as verified documentation.",
      oemComplianceConcern: "The row needs the actual support document, not just an estimate reference.",
      nextAction: "Attach the referenced OEM procedure, position statement, invoice, scan report, calibration result, photo proof, teardown proof, or completion record needed to substantiate the line item.",
      requiredDocumentation: ["referenced support", "invoice or completion proof", "photo/teardown proof when applicable"],
    };
  }
  return null;
}

function buildOemCitationDensityFinding(params: {
  context: AnnotatedEstimateFindingGeneratorContext;
  anchor: EstimateRowAnchor;
  rowText: string;
  family: OemCitationDensityFamily;
  authoritySources: OemCitationDensityAuthoritySource[];
}): CitationDensityFinding {
  const { context, anchor, rowText, family } = params;
  const authorityTrace = context.authorityTrace ?? buildDefaultOemAuthorityTrace();
  const authorityTraceIncomplete = isAuthorityTraceIncomplete(authorityTrace);
  const completedWithoutLineAuthority = isCompletedAuthoritySearchWithoutLineMatch(authorityTrace, params.authoritySources);
  const bestAuthoritySource = authorityTraceIncomplete
    ? undefined
    : pickBestOemAuthoritySource(params.authoritySources, family);
  const authority = authorityTraceIncomplete
    ? buildAuthorityTraceIncompleteAuthority(family, authorityTrace)
    : bestAuthoritySource && bestAuthoritySource.sourceType !== "estimate_evidence"
    ? mapOemAuthoritySourceToCitationAuthority(bestAuthoritySource, family)
    : buildEstimateEvidenceAuthority(family);
  const verifiedAuthorityCount = !authorityTraceIncomplete && authority.type !== "estimate_evidence" && authority.status === "verified" ? 1 : 0;
  const retrievalStatus = mapOemRetrievalStatus(authorityTrace, authorityTraceIncomplete, completedWithoutLineAuthority, verifiedAuthorityCount);
  const lineTieStatus = completedWithoutLineAuthority
    ? "document_level_only"
    : verifiedAuthorityCount
      ? "line_tied"
      : "not_line_tied";
  const label = authorityTraceIncomplete
    ? "AUTHORITY TRACE INCOMPLETE"
    : completedWithoutLineAuthority
      ? "AUTHORITY SEARCH COMPLETED - NO LINE AUTHORITY MATCH"
      : resolveOemFindingLabel(family, authority, verifiedAuthorityCount);
  const evidence = {
    lineNumber: anchor.lineNumber,
    description: rowText,
    amount: anchor.price ?? null,
    laborHours: anchor.labor ?? null,
    sourceLabel: context.sourcePdfName,
  };
  const finding = {
    id: `oem-citation-density-${family.findingType}-${anchor.anchorId.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`,
    operationLabel: family.title,
    category: family.category,
    estimateGapType: label === "REFERENCED / NOT PRODUCED" ? "referenced_not_produced" : "needs_proof",
    carrierEvidence: anchor.sourceDocumentRole === "carrier" ? evidence : undefined,
    shopEvidence: anchor.sourceDocumentRole === "shop" ? evidence : undefined,
    applicableEstimateRoles: [anchor.sourceDocumentRole],
    primaryAnnotationRole: anchor.sourceDocumentRole,
    carrierAnchor: anchor.sourceDocumentRole === "carrier" ? buildFindingLineAnchor(anchor) : undefined,
    shopAnchor: anchor.sourceDocumentRole === "shop" ? buildFindingLineAnchor(anchor) : undefined,
    impact: {
      dollarImpact: anchor.price ?? null,
      laborHoursImpact: anchor.labor ?? null,
      safetyImpact: family.safetyImpact,
      supplementPriority: family.priority,
    },
    citationStatus: buildOemCitationStatus(family, label, verifiedAuthorityCount),
    citationDensityScore: family.score,
    verifiedAuthorityCount,
    missingAuthorityTypes: verifiedAuthorityCount ? family.requiredDocumentation : family.missingAuthorityTypes,
    missingAuthority: verifiedAuthorityCount ? family.requiredDocumentation : family.missingAuthorityTypes,
    bestAvailableAuthority: authority,
    authorityNeeded: authority.type !== "estimate_evidence" || family.missingAuthorityTypes.length > 0,
    authorityType: mapOemAuthorityType(family, authority),
    retrievalAttempted: authorityTrace.authorityTraceStarted === true || authorityTrace.driveSearchAttempted === true || authorityTrace.googleDriveOrInternalSearchRan === true,
    retrievalSourcesSearched: buildOemRetrievalSourcesSearched(authorityTrace),
    retrievalStatus,
    matchedDocumentTitle: bestAuthoritySource?.title ?? authority.title ?? null,
    matchedDocumentUrl: null,
    sourceExcerpt: bestAuthoritySource?.note ?? null,
    sourcePageLine: null,
    appliesToShopEstimate: anchor.sourceDocumentRole === "shop" ? "unknown" : "no",
    appliesToCarrierEstimate: anchor.sourceDocumentRole === "carrier" ? "unknown" : "no",
    lineTieStatus,
    nextActionOwner: inferOemNextActionOwner(retrievalStatus, lineTieStatus, family),
    citationLabel: label,
    currentSupportSummary: [
      `Report type: ${OEM_CITATION_DENSITY_REPORT_TYPE}.`,
      `Finding type: ${family.findingType}.`,
      `Estimate file: ${context.sourcePdfName}.`,
      `Source page: ${anchor.pageNumber}.`,
      `Source line: ${anchor.lineNumber ?? "section"}.`,
      `Source row text: ${rowText}.`,
      `Issue summary: ${family.issueSummary}`,
      `OEM compliance concern: ${family.oemComplianceConcern}`,
      `Evidence tier: ${getOemAuthorityEvidenceTierLabel(authority)}.`,
      authorityTraceIncomplete
        ? `Authority trace incomplete: ${authorityTrace.authorityTraceBlockedReason ?? authorityTrace.skippedReason ?? "required OEM authority retrieval did not complete"}.`
        : completedWithoutLineAuthority
          ? "Authority search completed: no line-specific authority match was found."
        : "",
    ].join(" "),
    missingProofSummary: [
      `Required documentation: ${family.requiredDocumentation.join(", ")}.`,
      authorityTraceIncomplete
        ? "Authority retrieval did not complete, so this finding is not citation-ready and no OEM support was verified."
        : completedWithoutLineAuthority
          ? "Authority retrieval completed, but no line-specific OEM, ADAS, estimating, policy, or legal authority was matched to this row."
        : "",
      verifiedAuthorityCount
        ? "Authority support is present, but completion/estimate proof still needs to be tied to the exact row."
        : "Authority source not attached; use this as research/documentation needed, not verified OEM support.",
    ].join(" "),
    recommendedNextAction: family.nextAction,
    confidence: anchor.confidence >= 0.92 ? "high" : "medium",
    limitations: [
      "OEM Citation Density finding generated from an extracted estimate row.",
      "Do not say OEM requires unless an OEM procedure or position statement is attached.",
      authorityTraceIncomplete
        ? `Authority trace incomplete: ${authorityTrace.authorityTraceBlockedReason ?? authorityTrace.skippedReason ?? "retrieval not completed"}`
        : completedWithoutLineAuthority
          ? "Authority search completed without a line-specific authority match."
        : "",
      `sourcePdfHash:${context.sourcePdfHash}`,
      `artifactVersion:${OEM_CITATION_DENSITY_ARTIFACT_VERSION}`,
    ].filter(Boolean),
    anchorId: anchor.anchorId,
    reportType: OEM_CITATION_DENSITY_REPORT_TYPE,
    findingType: family.findingType,
    evidenceTier: getOemAuthorityEvidenceTierLabel(authority),
    authoritySources: params.authoritySources,
    requiredDocumentation: family.requiredDocumentation,
  } satisfies CitationDensityFinding & {
    anchorId: string;
    reportType: string;
    findingType: string;
    evidenceTier: string;
    authoritySources: OemCitationDensityAuthoritySource[];
    requiredDocumentation: string[];
  };
  return finding;
}

function mapOemRetrievalStatus(
  trace: OemCitationDensityAuthorityTrace,
  traceIncomplete: boolean,
  completedWithoutLineAuthority: boolean,
  verifiedAuthorityCount: number
): NonNullable<CitationDensityFinding["retrievalStatus"]> {
  if (verifiedAuthorityCount > 0) return "retrieved";
  if (completedWithoutLineAuthority) return "matched";
  if (!trace.authorityTraceStarted && !trace.driveSearchAttempted && !trace.googleDriveOrInternalSearchRan) return "not_configured";
  if (traceIncomplete && /access|denied|forbidden|permission/i.test(`${trace.authorityTraceBlockedReason ?? ""} ${trace.skippedReason ?? ""}`)) return "access_denied";
  if (traceIncomplete) return "error";
  return "no_match";
}

function mapOemAuthorityType(
  family: OemCitationDensityFamily,
  authority: NonNullable<CitationDensityFinding["bestAvailableAuthority"]>
): NonNullable<CitationDensityFinding["authorityType"]> | undefined {
  const value = `${family.findingType} ${family.title} ${family.requiredDocumentation.join(" ")} ${authority.type}`;
  if (/invoice|completion/i.test(value)) return "INVOICE";
  if (/photo|teardown/i.test(value)) return "PHOTO";
  if (/scan|diagnostic|dtc/i.test(value)) return "SCAN";
  if (/adas|calibration|aim|radar|camera/i.test(value)) return "CALIBRATION";
  if (/p_page|p-?page|motor/i.test(value)) return "P_PAGE";
  if (/\bdeg\b/i.test(value)) return "DEG";
  if (/\bscrs\b/i.test(value)) return "SCRS";
  if (/legal|state|doi|statute|regulation/i.test(value)) return "DOI_LEGAL";
  if (/policy/i.test(value)) return "POLICY";
  if (/oem|procedure|position/i.test(value)) return "OEM";
  return undefined;
}

function buildOemRetrievalSourcesSearched(trace: OemCitationDensityAuthorityTrace) {
  const sources = new Set<string>();
  if (trace.driveSearchAttempted || trace.googleDriveOrInternalSearchRan) sources.add("Google Drive");
  if ((trace.authoritySources ?? []).some((source) => /egnyte/i.test(`${source.title} ${source.note ?? ""}`))) sources.add("Egnyte");
  if ((trace.authoritySources ?? []).some((source) => source.sourceType === "ccc_secure_share")) sources.add("CCC Secure Share");
  if ((trace.onlineSearchAttempted ?? false) || (trace.onlineSourcesReviewed ?? []).length > 0) sources.add("web");
  return Array.from(sources);
}

function inferOemNextActionOwner(
  retrievalStatus: NonNullable<CitationDensityFinding["retrievalStatus"]>,
  lineTieStatus: NonNullable<CitationDensityFinding["lineTieStatus"]>,
  family: OemCitationDensityFamily
): NonNullable<CitationDensityFinding["nextActionOwner"]> {
  if (retrievalStatus === "retrieved" && lineTieStatus === "line_tied") return "Collision IQ";
  if (retrievalStatus === "matched" || (retrievalStatus === "retrieved" && lineTieStatus !== "line_tied")) return "Collision IQ";
  if (family.requiredDocumentation.some((item) => /invoice|completion|photo|scan|calibration|measurement/i.test(item))) return "shop";
  if (retrievalStatus === "access_denied") return "carrier";
  return "Collision IQ";
}

function detectOemCitationDensityAuthoritySources(context: AnnotatedEstimateFindingGeneratorContext): OemCitationDensityAuthoritySource[] {
  const textBlocks = [
    context.sourceText ?? "",
    ...context.comparisonEstimateTexts.map((item) => item.text),
  ].join("\n");
  const sources: OemCitationDensityAuthoritySource[] = [];
  const add = (source: OemCitationDensityAuthoritySource) => {
    if (!sources.some((item) => item.sourceType === source.sourceType && item.title === source.title)) sources.push(source);
  };
  for (const source of context.authorityTrace?.authoritySources ?? []) {
    add(source);
  }
  if (
    /\b(?:OEM procedure|repair manual|body repair manual|service procedure)\b/i.test(textBlocks) &&
    !/\b(?:no|without|missing|not attached|not produced|not provided|needs|need|attach|verify|review)\s+(?:an?\s+)?(?:OEM procedure|repair manual|body repair manual|service procedure)\b/i.test(textBlocks) &&
    !/\b(?:OEM procedure|repair manual|body repair manual|service procedure)\s+(?:not attached|not produced|not provided|missing|needed|required)\b/i.test(textBlocks)
  ) {
    add({ title: "Uploaded or extracted OEM procedure reference", sourceType: "oem_procedure", evidenceTier: 1, verified: true });
  }
  if (/\b(?:position statement|OEM position)\b/i.test(textBlocks)) {
    add({ title: "OEM position statement reference", sourceType: "oem_position_statement", evidenceTier: 2, verified: true });
  }
  if (/\b(?:MOTOR|P-page|database|estimating guide|included|not included)\b/i.test(textBlocks)) {
    add({ title: "MOTOR/database guidance reference", sourceType: "motor_database", evidenceTier: 3, verified: true });
  }
  if (/\b(?:CCC Secure Share|secure share)\b/i.test(textBlocks)) {
    add({ title: "CCC Secure Share support", sourceType: "ccc_secure_share", evidenceTier: 4, verified: true });
  }
  if (/\b(?:policy|declarations|coverage|endorsement)\b/i.test(textBlocks)) {
    add({ title: "Uploaded policy language", sourceType: "policy", evidenceTier: 5, verified: true });
  }
  if (/\b(?:statute|regulation|administrative code|DOI)\b/i.test(textBlocks)) {
    add({ title: "Jurisdictional law/regulation reference", sourceType: "jurisdictional_law", evidenceTier: 6, verified: true });
  }
  if (/\b(?:http|internet|web fallback|verified web)\b/i.test(textBlocks)) {
    add({ title: "Verified web fallback reference", sourceType: "internet_fallback", evidenceTier: 7, verified: false });
  }
  add({ title: "Estimate evidence row", sourceType: "estimate_evidence", evidenceTier: 8, verified: false });
  return sources;
}

function pickBestOemAuthoritySource(
  sources: OemCitationDensityAuthoritySource[],
  family: OemCitationDensityFamily
) {
  const relevant = sources.filter((source) => {
    if (source.sourceType === "estimate_evidence") return true;
    if (family.findingType.includes("adas") || family.findingType.includes("diagnostics")) {
      return source.sourceType === "oem_procedure" || source.sourceType === "motor_database" || source.sourceType === "uploaded_support" || source.sourceType === "ccc_secure_share";
    }
    if (family.findingType.includes("part_source")) {
      return source.sourceType === "oem_procedure" || source.sourceType === "oem_position_statement" || source.sourceType === "uploaded_support" || source.sourceType === "ccc_secure_share";
    }
    if (family.findingType.includes("refinish") || family.findingType.includes("labor")) {
      return source.sourceType === "motor_database" || source.sourceType === "policy" || source.sourceType === "jurisdictional_law" || source.sourceType === "uploaded_support";
    }
    return source.sourceType !== "internet_fallback";
  });
  return relevant.sort((a, b) => a.evidenceTier - b.evidenceTier)[0] ?? sources[sources.length - 1];
}

function mapOemAuthoritySourceToCitationAuthority(
  source: OemCitationDensityAuthoritySource,
  family: OemCitationDensityFamily
): NonNullable<CitationDensityFinding["bestAvailableAuthority"]> {
  const typeMap: Record<OemCitationDensityAuthoritySource["sourceType"], NonNullable<CitationDensityFinding["bestAvailableAuthority"]>["type"]> = {
    oem_procedure: family.findingType.includes("adas") ? "adas_procedure" : "oem_procedure",
    oem_position_statement: "oem_position_statement",
    motor_database: "p_page",
    uploaded_support: "invoice_completion",
    ccc_secure_share: "estimate_evidence",
    policy: "estimate_evidence",
    jurisdictional_law: "legal",
    internet_fallback: "online_fallback",
    estimate_evidence: "estimate_evidence",
  };
  return {
    type: typeMap[source.sourceType],
    status: source.verified ? "verified" : "needed",
    title: source.title,
    confidence: source.verified ? "high" : "low",
    note: source.note ?? `Evidence tier ${source.evidenceTier}: ${source.sourceType}`,
  };
}

function buildEstimateEvidenceAuthority(
  family: OemCitationDensityFamily
): NonNullable<CitationDensityFinding["bestAvailableAuthority"]> {
  return {
    type: "estimate_evidence",
    status: "needed",
    title: "Estimate evidence only",
    confidence: "medium",
    note: `${family.title}: research/documentation needed. Estimate evidence alone is not verified OEM support.`,
  };
}

function buildAuthorityTraceIncompleteAuthority(
  family: OemCitationDensityFamily,
  authorityTrace: OemCitationDensityAuthorityTrace
): NonNullable<CitationDensityFinding["bestAvailableAuthority"]> {
  return {
    type: "estimate_evidence",
    status: "needed",
    title: "Authority trace incomplete",
    confidence: "low",
    note: [
      `${family.title}: OEM/internal authority retrieval did not complete.`,
      authorityTrace.authorityTraceBlockedReason ?? authorityTrace.skippedReason ?? "",
      "Treat as not citation-ready until the relevant OEM, ADAS, estimating, policy, or legal sources are retrieved and attached.",
    ].filter(Boolean).join(" "),
  };
}

function isAuthorityTraceIncomplete(authorityTrace: OemCitationDensityAuthorityTrace) {
  return (
    authorityTrace.authorityCoverageStatus === "incomplete" ||
    !authorityTrace.authorityTraceCompleted ||
    Boolean(authorityTrace.authorityTraceBlockedReason)
  );
}

function isCompletedAuthoritySearchWithoutLineMatch(
  authorityTrace: OemCitationDensityAuthorityTrace,
  authoritySources: OemCitationDensityAuthoritySource[]
) {
  if (isAuthorityTraceIncomplete(authorityTrace)) return false;
  const nonEstimateSources = authoritySources.filter((source) => source.sourceType !== "estimate_evidence");
  return nonEstimateSources.length === 0 && authorityTrace.googleDriveOrInternalSearchRan;
}

function resolveOemFindingLabel(
  family: OemCitationDensityFamily,
  authority: NonNullable<CitationDensityFinding["bestAvailableAuthority"]>,
  verifiedAuthorityCount: number
) {
  if (verifiedAuthorityCount > 0 && (authority.type === "oem_procedure" || authority.type === "adas_procedure")) return "VERIFIED OEM";
  if (verifiedAuthorityCount > 0 && authority.type === "oem_position_statement") return "OEM POSITION REFERENCED";
  if (verifiedAuthorityCount > 0 && authority.type === "invoice_completion") return "VERIFIED DOCUMENTATION";
  if (verifiedAuthorityCount > 0 && authority.type === "legal") return "VERIFIED LEGAL";
  if (authority.type === "oem_position_statement") return "OEM POSITION REFERENCED";
  if (authority.type === "oem_procedure" || authority.type === "adas_procedure") return "NEEDS OEM PROCEDURE";
  return family.fallbackLabel;
}

function isOemVerifiedLabel(label: string | undefined) {
  return label === "VERIFIED OEM" || label === "VERIFIED DOCUMENTATION" || label === "VERIFIED LEGAL";
}

function buildOemCitationStatus(
  family: OemCitationDensityFamily,
  label: string,
  verifiedAuthorityCount: number
): CitationDensityFinding["citationStatus"] {
  const needsOem = family.label === "NEEDS OEM" || family.missingAuthorityTypes.some((item) => /OEM/i.test(item));
  const needsAdas = family.label === "NEEDS ADAS" || family.category === "adas_calibration" || family.category === "scan_diagnostic";
  const needsInvoice = family.label === "NEEDS INVOICE" || family.missingAuthorityTypes.some((item) => /invoice|proof|completion/i.test(item));
  return {
    oem: needsOem ? (verifiedAuthorityCount ? "verified" : "needed") : "not_applicable",
    oemPositionStatement: needsOem ? (verifiedAuthorityCount && label === "VERIFIED OEM" ? "verified" : "needed") : "not_applicable",
    adas: needsAdas ? (verifiedAuthorityCount ? "verified" : "needed") : "not_applicable",
    pPages: family.label === "NEEDS P-PAGE" ? (verifiedAuthorityCount ? "verified" : "needed") : "not_applicable",
    scrs: family.findingType.includes("refinish") ? "needed" : "not_applicable",
    deg: family.findingType.includes("labor") || family.findingType.includes("refinish") ? "needed" : "not_applicable",
    nhtsa: "not_applicable",
    stateRegulation: label === "VERIFIED LEGAL" ? "verified" : "not_applicable",
    policy: "not_applicable",
    invoiceOrCompletionProof: needsInvoice || needsAdas ? "needed" : "not_found",
    photoOrTeardownProof: family.findingType.includes("structural") ? "needed" : "not_found",
  };
}

function getOemEvidenceTier(finding: CitationDensityFinding) {
  return getOemAuthorityEvidenceTierLabel(finding.bestAvailableAuthority ?? buildEstimateEvidenceAuthority({
    findingType: "unknown",
    title: finding.operationLabel,
    category: finding.category,
    label: getProofBucketLabel(finding),
    fallbackLabel: getProofBucketLabel(finding),
    evidenceTier: "estimate_evidence",
    score: finding.citationDensityScore,
    safetyImpact: finding.impact.safetyImpact,
    priority: finding.impact.supplementPriority,
    missingAuthorityTypes: finding.missingAuthorityTypes,
    issueSummary: finding.currentSupportSummary,
    whyItMatters: finding.currentSupportSummary,
    oemComplianceConcern: finding.missingProofSummary,
    nextAction: finding.recommendedNextAction,
    requiredDocumentation: finding.missingAuthorityTypes,
  }));
}

function getOemAuthorityEvidenceTierLabel(authority: NonNullable<CitationDensityFinding["bestAvailableAuthority"]>) {
  if (authority.type === "oem_procedure" || authority.type === "adas_procedure") return "tier_1_oem_procedure";
  if (authority.type === "oem_position_statement") return "tier_2_oem_position_statement";
  if (authority.type === "p_page" || authority.type === "deg" || authority.type === "scrs") return "tier_3_motor_database";
  if (authority.type === "invoice_completion") return "tier_4_uploaded_support";
  if (authority.type === "legal") return "tier_6_jurisdictional_law";
  if (authority.type === "online_fallback") return "tier_7_verified_web_fallback";
  return "tier_8_estimate_evidence";
}

export function classifyPartSource(rowText: string): PartSourceKind[] {
  const text = ` ${rowText.replace(/\s+/g, " ")} `;
  const normalized = normalizeMatchText(rowText);
  const kinds: PartSourceKind[] = [];
  const add = (kind: PartSourceKind) => {
    if (!kinds.includes(kind)) kinds.push(kind);
  };

  if (/\bopt(?:ional)?\s+oem\b/i.test(text)) add("OPT_OEM");
  if (/\balt(?:ernate)?\s+oem\b/i.test(text)) add("ALT_OEM");
  if (/\boriginal\s+equipment\b/i.test(text)) add("OEM");
  if (/\boem\b/i.test(text)) add("OEM");
  if (/\boe\b/i.test(text)) add("OE");
  if (/\ba\s*\/\s*m\b/i.test(text)) add("AM");
  if (/\bam\b/i.test(text) || /\baftermarket\b/i.test(text)) add("AM");
  if (/\bcapa\b/i.test(text)) add("CAPA");
  if (/\blkq\b/i.test(text)) add("LKQ");
  if (/\bused\b/i.test(text)) add("USED");
  if (/\brecycled\b/i.test(text)) add("RECYCLED");
  if (/\brecond(?:itioned)?\b/i.test(text)) add("RECONDITIONED");
  if (/\breman(?:ufactured)?\b/i.test(text)) add("REMAN");
  if (/\bnon[-\s]?oem\b/i.test(text) || /\bnon oem\b/i.test(normalized)) add("NON_OEM");
  if (/\beconomy\b/i.test(text)) add("ECONOMY");

  return kinds;
}

function buildPartSourceFindings(params: {
  selectedAnchors: EstimateRowAnchor[];
  selectedVisualLines?: PdfTextLine[];
  sourcePdfName: string;
  sourceDocumentId?: string;
  sourceDocumentRole: "carrier" | "shop";
  comparisonEstimateTexts: ComparisonEstimateText[];
  existingFindings: CitationDensityFinding[];
}): PartSourceFindingResult {
  if (!shouldGeneratePartSourceFindings(params.existingFindings)) {
    return {
      findings: [],
      partSourceRows: [],
      nonOemPartRowCount: 0,
      oemPartRowCount: 0,
      comparisonCandidateCount: 0,
      candidateCount: 0,
      acceptedCandidates: [],
      rejectedCandidates: [],
      rejectedLineNumberCandidates: [],
      comparisonMatches: [],
      droppedReasons: [],
    };
  }
  const selectedRows = params.selectedAnchors
    .map((anchor) => buildPartSourceRowFromAnchor(anchor, params.sourcePdfName))
    .filter((row): row is PartSourceRow => row.sourceKinds.length > 0);
  const comparisonRows = params.comparisonEstimateTexts.flatMap((source) => buildPartSourceRowsFromText(source));
  const droppedReasons: PartSourceFindingResult["droppedReasons"] = [];
  const allSelectedNonOemRows = selectedRows.filter((row) => hasNonOemPartSource(row.sourceKinds));
  const { preferredRows, rejectedRows: supplierSupersededRows } = filterPreferredSelectedPartSourceRows(allSelectedNonOemRows);
  const selectedNonOemRows = preferredRows
    .filter((row) => !isPartSourceRowCoveredByExistingFinding(row, params.existingFindings));
  const selectedOemRows = selectedRows.filter((row) => hasOemPartSource(row.sourceKinds));
  const comparisonOemRows = comparisonRows.filter((row) => hasOemPartSource(row.sourceKinds));
  const hasComparisonEstimate = params.comparisonEstimateTexts.some((item) => item.text.trim().length > 0);
  const findings: CitationDensityFinding[] = [];
  const acceptedCandidates: PartSourceFindingCandidate[] = [];
  const rejectedCandidates: PartSourceFindingCandidate[] = [];
  const rejectedLineNumberCandidates: PartSourceFindingResult["rejectedLineNumberCandidates"] = [];
  const comparisonMatches: PartSourceComparisonMatchDebug[] = [];

  for (const candidate of buildRejectedPartSourceVisualLineCandidates({
    visualLines: params.selectedVisualLines ?? [],
    selectedRows,
    sourcePdfName: params.sourcePdfName,
    sourceDocumentId: params.sourceDocumentId,
    sourceDocumentRole: params.sourceDocumentRole,
  })) {
    rejectedCandidates.push(candidate);
    if (isVehicleYearLineNumber(candidate.lineNumber)) {
      rejectedLineNumberCandidates.push({
        rowText: candidate.rowText,
        lineNumber: candidate.lineNumber,
        reason: "vehicle year parsed as line number",
      });
    }
    droppedReasons.push({
      anchorId: candidate.anchorId || null,
      rowText: candidate.rowText,
      reason: candidate.rejectionReasons.join("; "),
    });
  }

  for (const row of supplierSupersededRows) {
    const candidate = scorePartSourceCandidate(buildPartSourceCandidate(row, null, null));
    candidate.rejectionReasons.push("supplier row superseded by line-item row");
    rejectedCandidates.push(candidate);
    droppedReasons.push({
      anchorId: row.anchorId ?? null,
      rowText: row.rowText,
      reason: "supplier row superseded by line-item row",
    });
  }

  for (const selectedRow of selectedNonOemRows) {
    const comparisonResult = findBestPartSourceComparisonRow(selectedRow, comparisonOemRows);
    comparisonMatches.push(comparisonResult.debug);
    const comparisonMatch = comparisonResult.match;
    const candidate = scorePartSourceCandidate(buildPartSourceCandidate(selectedRow, comparisonMatch, comparisonResult.debug));
    if (candidate.rejectionReasons.length > 0 || candidate.score < PART_SOURCE_CANDIDATE_MIN_SCORE) {
      const reason = candidate.rejectionReasons.length
        ? candidate.rejectionReasons.join("; ")
        : `candidate score ${candidate.score} below threshold ${PART_SOURCE_CANDIDATE_MIN_SCORE}`;
      rejectedCandidates.push(candidate);
      if (isVehicleYearLineNumber(candidate.lineNumber)) {
        rejectedLineNumberCandidates.push({
          rowText: candidate.rowText,
          lineNumber: candidate.lineNumber,
          reason: "vehicle year parsed as line number",
        });
      }
      droppedReasons.push({
        anchorId: selectedRow.anchorId ?? null,
        rowText: selectedRow.rowText,
        reason,
      });
      continue;
    }
    if (hasComparisonEstimate && comparisonRows.length > 0 && !comparisonMatch) {
      candidate.reasons.push("no OEM/OE comparison row matched strongly enough; using one-estimate documentation review");
    }
    acceptedCandidates.push(candidate);
    findings.push(buildPartSourceFinding({
      selectedRow,
      comparisonRow: comparisonMatch,
      candidate,
      sourceDocumentRole: params.sourceDocumentRole,
      selectedFileName: params.sourcePdfName,
    }));
  }

  return {
    findings,
    partSourceRows: selectedRows.map((row) => ({
      page: row.pageNumber ?? 0,
      line: row.lineNumber,
      sourceKind: row.sourceKinds,
      anchorId: row.anchorId ?? "",
      sourcePdfName: row.sourcePdfName,
      rowText: row.rowText,
    })),
    nonOemPartRowCount: allSelectedNonOemRows.length,
    oemPartRowCount: selectedOemRows.length,
    comparisonCandidateCount: comparisonOemRows.length,
    candidateCount: acceptedCandidates.length + rejectedCandidates.length,
    acceptedCandidates,
    rejectedCandidates,
    rejectedLineNumberCandidates,
    comparisonMatches,
    droppedReasons,
  };
}

function buildRejectedPartSourceVisualLineCandidates(params: {
  visualLines: PdfTextLine[];
  selectedRows: PartSourceRow[];
  sourcePdfName: string;
  sourceDocumentId?: string;
  sourceDocumentRole: "carrier" | "shop";
}): PartSourceFindingCandidate[] {
  const anchoredLineText = new Set(params.selectedRows.map((row) => normalizeMatchText(row.rowText)));
  const candidates: PartSourceFindingCandidate[] = [];
  for (const line of params.visualLines) {
    const rowText = line.text.replace(/\s+/g, " ").trim();
    if (!rowText) continue;
    const normalized = normalizeMatchText(rowText);
    if (anchoredLineText.has(normalized)) continue;
    const sourceKinds = classifyPartSource(rowText);
    if (!hasNonOemPartSource(sourceKinds)) continue;
    const lineNumber = rowText.match(/^\s*(?:line\s*)?(\d{1,4})\b/i)?.[1] ?? null;
    if (
      !isVehicleYearLineNumber(lineNumber) &&
      !containsVehicleYearIdentityText(rowText) &&
      !isBoilerplatePartSourceText(normalized)
    ) {
      continue;
    }
    const candidate = scorePartSourceCandidate(buildPartSourceCandidate({
      sourceDocumentId: params.sourceDocumentId,
      sourceDocumentRole: params.sourceDocumentRole,
      sourcePdfName: params.sourcePdfName,
      pageNumber: line.pageNumber,
      lineNumber,
      rowText,
      normalizedRowText: normalized,
      sourceKinds,
      description: rowText,
      operation: null,
      partNumber: null,
    }, null, null));
    if (!candidate.rejectionReasons.length) {
      candidate.rejectionReasons.push(`candidate score ${candidate.score} below threshold ${PART_SOURCE_CANDIDATE_MIN_SCORE}`);
    }
    candidates.push(candidate);
  }
  return candidates;
}

function filterPreferredSelectedPartSourceRows(rows: PartSourceRow[]) {
  const lineItemRows = rows.filter((row) => row.anchorType === "estimate_line");
  const preferredRows: PartSourceRow[] = [];
  const rejectedRows: PartSourceRow[] = [];
  for (const row of rows) {
    const superseded = row.anchorType === "supplier_row" && lineItemRows.some((lineItem) =>
      (row.lineNumber && lineItem.lineNumber === row.lineNumber) ||
      scorePartSourceRowMatch(row, lineItem) >= 22
    );
    if (superseded) rejectedRows.push(row);
    else preferredRows.push(row);
  }
  return { preferredRows, rejectedRows };
}

function isPartSourceRowCoveredByExistingFinding(row: PartSourceRow, findings: CitationDensityFinding[]) {
  return findings.some((finding) => {
    const evidence = row.sourceDocumentRole === "shop"
      ? finding.shopEvidence ?? finding.shopAnchor
      : finding.carrierEvidence ?? finding.carrierAnchor;
    if (!evidence?.lineNumber || !row.lineNumber || String(evidence.lineNumber).trim() !== row.lineNumber) return false;
    const text = normalizeMatchText([
      finding.operationLabel,
      "description" in evidence ? evidence.description : undefined,
      finding.currentSupportSummary,
      finding.missingProofSummary,
    ].filter(Boolean).join(" "));
    const rowText = normalizeMatchText(row.rowText);
    return keyTokenScore(text, rowText, 10) >= 2 || sharedTermScore(text, rowText, 10) >= 3;
  });
}

function shouldGeneratePartSourceFindings(findings: CitationDensityFinding[]) {
  if (findings.length === 0) return true;
  return findings.some((finding) => {
    const text = [
      finding.id,
      finding.operationLabel,
      finding.category,
      finding.carrierEvidence?.description,
      finding.shopEvidence?.description,
      finding.currentSupportSummary,
      finding.missingProofSummary,
      finding.recommendedNextAction,
      ...finding.missingAuthorityTypes,
    ].join(" ");
    return /\b(?:a\/m|am|aftermarket|lkq|capa|used|recycled|reconditioned|reman|remanufactured|non[-\s]?oem|oem\s+part|oe\s+part|part[-\s]?source)\b/i.test(text);
  });
}

function buildPartSourceRowFromAnchor(anchor: EstimateRowAnchor, sourcePdfName: string): PartSourceRow {
  const rowText = getAnchorSourceText(anchor);
  return {
    anchorId: anchor.anchorId,
    sourceDocumentId: anchor.sourceDocumentId,
    sourceDocumentRole: anchor.sourceDocumentRole,
    sourcePdfName,
    pageNumber: anchor.pageNumber,
    lineNumber: anchor.lineNumber,
    rowText,
    normalizedRowText: normalizeMatchText(rowText),
    sourceKinds: classifyPartSource(rowText),
    anchor,
    anchorType: anchor.anchorType,
    description: anchor.description,
    operation: anchor.operation,
    partNumber: anchor.partNumber,
  };
}

function buildPartSourceRowsFromText(source: ComparisonEstimateText): PartSourceRow[] {
  const estimateRole = source.estimateRole ?? "shop";
  return source.text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+(?=(?:line\s*)?\d{1,4}\s+(?:[#*<>A-Z0-9]+\s+)?(?:repl|rpr|r&i|subl|oem|oe|lkq|a\/m|am)\b)/gi, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((rowText) => {
      const sourceKinds = classifyPartSource(rowText);
      if (!sourceKinds.length) return null;
      const lineNumber = rowText.match(/^\s*(?:line\s*)?(\d{1,4})\b/i)?.[1] ?? null;
      const row: PartSourceRow = {
        sourceDocumentId: source.sourceDocumentId,
        sourceDocumentRole: estimateRole,
        sourcePdfName: source.fileName,
        pageNumber: null,
        lineNumber,
        rowText,
        normalizedRowText: normalizeMatchText(rowText),
        sourceKinds,
        description: rowText,
        operation: rowText.split(/\s+/).slice(0, 5).join(" "),
        partNumber: null,
      };
      return row;
    })
    .filter((row): row is PartSourceRow => Boolean(row));
}

function buildPartSourceCandidate(
  selectedRow: PartSourceRow,
  comparisonRow: PartSourceRow | null,
  comparisonDebug: PartSourceComparisonMatchDebug | null
): PartSourceFindingCandidate {
  return {
    anchorId: selectedRow.anchorId ?? "",
    rowText: selectedRow.rowText,
    pageNumber: selectedRow.pageNumber ?? 0,
    lineNumber: selectedRow.lineNumber,
    rowType: selectedRow.anchorType,
    operation: selectedRow.operation,
    description: selectedRow.description,
    partNumber: selectedRow.partNumber,
    partSourceKinds: selectedRow.sourceKinds,
    comparisonRowText: comparisonRow?.rowText,
    comparisonPartSourceKinds: comparisonRow?.sourceKinds,
    score: comparisonDebug?.matchScore ?? 0,
    reasons: [...(comparisonDebug?.matchReasons ?? [])],
    rejectionReasons: [],
  };
}

export function scorePartSourceCandidate(candidate: PartSourceFindingCandidate): PartSourceFindingCandidate {
  const scored: PartSourceFindingCandidate = {
    ...candidate,
    reasons: [...candidate.reasons],
    rejectionReasons: [...candidate.rejectionReasons],
  };
  const normalized = normalizeMatchText(scored.rowText);
  const hasOperation = hasPartSourceRepairOperation(scored.rowText);
  const hasPartNoun = hasPartSourcePartNoun(scored.rowText);
  const hasAmountContext = Boolean(
    scored.partNumber ||
    /\$[\d,]+(?:\.\d{2})?/.test(scored.rowText) ||
    /\b\d+(?:\.\d+)?\s*(?:hrs?|hours?)\b/i.test(scored.rowText) ||
    /\b(?:qty|quantity)\b/i.test(scored.rowText)
  );

  if (hasNonOemPartSource(scored.partSourceKinds)) {
    scored.score += 35;
    scored.reasons.push("selected row has non-OEM part-source token");
  }
  if (isPreferredPartSourceAnchorType(scored.rowType)) {
    scored.score += 18;
    scored.reasons.push("selected row is an estimate line-item or attached line note");
  }
  if (hasOperation) {
    scored.score += 14;
    scored.reasons.push("row has repair operation context");
  }
  if (hasPartNoun) {
    scored.score += 16;
    scored.reasons.push("row has specific part noun");
  }
  if (hasAmountContext) {
    scored.score += 10;
    scored.reasons.push("row has part number, quantity, price, labor, or paint context");
  }
  if (scored.comparisonRowText && hasOemPartSource(scored.comparisonPartSourceKinds ?? [])) {
    scored.score += 18;
    scored.reasons.push("comparison estimate has OEM/OE comparable row");
  }
  if (/\b(?:not correct style|incorrect style|wrong style|fit|finish)\b/i.test(scored.rowText)) {
    scored.score += 12;
    scored.reasons.push("row has fit/style correctness note");
  }
  if (scored.anchorId && scored.pageNumber > 0) {
    scored.score += 8;
    scored.reasons.push("row has extracted selected-estimate anchor");
  }

  if (isVehicleYearLineNumber(scored.lineNumber) || containsVehicleYearIdentityText(scored.rowText)) {
    scored.score -= 80;
    scored.rejectionReasons.push("vehicle year parsed as line number");
  }
  if (isBoilerplatePartSourceText(normalized)) {
    scored.score -= 55;
    scored.rejectionReasons.push("boilerplate/disclaimer row");
  }
  if (/\b(?:wheel opening|opening molding|wheel opening molding)\b/.test(normalized)) {
    scored.score -= 70;
    scored.rejectionReasons.push("wheel-opening trim/molding row is not wheel-end source support");
  }
  if (!hasPartNoun) {
    scored.score -= 24;
    scored.rejectionReasons.push("no part noun");
  }
  if (!hasOperation && !hasAmountContext) {
    scored.score -= 24;
    scored.rejectionReasons.push("no repair operation context");
  }
  if (!scored.anchorId || scored.pageNumber <= 0) {
    scored.score -= 30;
    scored.rejectionReasons.push("no selected estimate anchor rects");
  }
  if (scored.rowType === "guide_row" || scored.rowType === "section_row" || scored.rowType === "totals_row") {
    scored.score -= 45;
    scored.rejectionReasons.push("row source is guide/header/footer");
  }
  if (scored.rowText.length > 220 && !hasOperation) {
    scored.score -= 35;
    scored.rejectionReasons.push("extremely long boilerplate text with no operation/part columns");
  }

  scored.reasons = [...new Set(scored.reasons)];
  scored.rejectionReasons = [...new Set(scored.rejectionReasons)];
  return scored;
}

function findBestPartSourceComparisonRow(
  selectedRow: PartSourceRow,
  comparisonRows: PartSourceRow[]
): { match: PartSourceRow | null; debug: PartSourceComparisonMatchDebug } {
  let best: { row: PartSourceRow; score: number; reasons: string[] } | null = null;
  const rejectedComparisonReasons: string[] = [];
  for (const row of comparisonRows) {
    const result = scorePartSourceComparisonRow(selectedRow, row);
    if (result.score > (best?.score ?? 0)) best = { row, score: result.score, reasons: result.reasons };
    if (result.score < PART_SOURCE_COMPARISON_MIN_SCORE) {
      rejectedComparisonReasons.push(`${truncateText(row.rowText, 72)}: ${result.reasons.length ? result.reasons.join(", ") : "comparison match too weak"}`);
    }
  }
  const match = best && best.score >= PART_SOURCE_COMPARISON_MIN_SCORE ? best.row : null;
  return {
    match,
    debug: {
      selectedAnchorId: selectedRow.anchorId ?? "",
      selectedRowText: selectedRow.rowText,
      comparisonRowText: match?.rowText,
      matchScore: best?.score ?? 0,
      matchReasons: best?.reasons ?? [],
      rejectedComparisonReasons: match ? [] : rejectedComparisonReasons.slice(0, 5),
    },
  };
}

function scorePartSourceRowMatch(selectedRow: PartSourceRow, comparisonRow: PartSourceRow) {
  return scorePartSourceComparisonRow(selectedRow, comparisonRow).score;
}

function scorePartSourceComparisonRow(selectedRow: PartSourceRow, comparisonRow: PartSourceRow) {
  let score = 0;
  const reasons: string[] = [];
  if (selectedRow.partNumber && comparisonRow.partNumber && selectedRow.partNumber === comparisonRow.partNumber) {
    score += 32;
    reasons.push("part number match");
  }
  const selectedComparable = normalizePartComparableText(selectedRow.rowText);
  const comparisonComparable = normalizePartComparableText(comparisonRow.rowText);
  const partNouns = getSharedPartNouns(selectedRow.rowText, comparisonRow.rowText);
  if (partNouns.length > 0) {
    score += Math.min(28, partNouns.length * 10);
    reasons.push(`shared part noun: ${partNouns.join(", ")}`);
  }
  const keyScore = keyTokenScore(selectedComparable, comparisonComparable, 26);
  if (keyScore > 0) {
    score += keyScore;
    reasons.push("part description overlap");
  }
  const termScore = sharedTermScore(selectedComparable, comparisonComparable, 18);
  if (termScore > 0) {
    score += termScore;
    reasons.push("normalized row-text similarity");
  }
  if (hasPartSourceRepairOperation(selectedRow.rowText) && hasPartSourceRepairOperation(comparisonRow.rowText)) {
    score += 8;
    reasons.push("operation similarity");
  }
  if (selectedRow.lineNumber && comparisonRow.lineNumber && selectedRow.lineNumber === comparisonRow.lineNumber) {
    score += 6;
    reasons.push("line number weak match");
  }
  if (isBoilerplatePartSourceText(comparisonRow.normalizedRowText)) {
    score -= 35;
    reasons.push("comparison row is boilerplate");
  }
  if (!hasPartSourcePartNoun(comparisonRow.rowText)) {
    score -= 18;
    reasons.push("comparison row lacks part noun");
  }
  return { score, reasons: [...new Set(reasons)] };
}

function normalizePartComparableText(value: string) {
  return normalizeMatchText(value)
    .split(" ")
    .filter((term) => term.length > 1 && !PART_SOURCE_MATCH_STOP_TERMS.has(term))
    .join(" ");
}

function buildPartSourceFinding(params: {
  selectedRow: PartSourceRow;
  comparisonRow?: PartSourceRow | null;
  candidate: PartSourceFindingCandidate;
  sourceDocumentRole: "carrier" | "shop";
  selectedFileName: string;
}): CitationDensityFinding {
  const { selectedRow, comparisonRow } = params;
  const selectedClass = formatPartSourceKinds(selectedRow.sourceKinds);
  const comparisonClass = comparisonRow ? formatPartSourceKinds(comparisonRow.sourceKinds) : "not available";
  const selectedLine = selectedRow.lineNumber ?? "section";
  const hasComparison = Boolean(comparisonRow);
  const title = hasComparison ? "AM/LKQ part usage vs OEM part usage" : "Non-OEM part-source documentation review";
  const rowIssueSummary = buildPartSourceRowIssueSummary(selectedRow, comparisonRow);
  const authorityStatus: CitationSupportStatus = hasComparison ? "needed" : "not_found";
  const evidence = {
    lineNumber: selectedRow.lineNumber,
    description: selectedRow.rowText,
    amount: selectedRow.anchor?.price ?? null,
    laborHours: selectedRow.anchor?.labor ?? null,
    sourceLabel: selectedRow.sourcePdfName,
  };

  return {
    id: `part-source-oem-variance-${selectedRow.anchorId?.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") ?? createHash("sha1").update(selectedRow.rowText).digest("hex").slice(0, 10)}`,
    operationLabel: title,
    category: "parts_downgrade",
    estimateGapType: hasComparison ? "needs_proof" : "present_but_under_documented",
    carrierEvidence: params.sourceDocumentRole === "carrier" ? evidence : undefined,
    shopEvidence: params.sourceDocumentRole === "shop" ? evidence : undefined,
    applicableEstimateRoles: [params.sourceDocumentRole],
    primaryAnnotationRole: params.sourceDocumentRole,
    carrierAnchor: params.sourceDocumentRole === "carrier" && selectedRow.anchor ? buildFindingLineAnchor(selectedRow.anchor) : undefined,
    shopAnchor: params.sourceDocumentRole === "shop" && selectedRow.anchor ? buildFindingLineAnchor(selectedRow.anchor) : undefined,
    crossEstimateIssue: hasComparison,
    counterpartSummary: comparisonRow
      ? `Comparison estimate ${comparisonRow.sourcePdfName} row: ${comparisonRow.rowText}. Comparison classification: ${comparisonClass}.`
      : "No comparison estimate row was available; one-estimate part-source documentation review applies.",
    impact: {
      dollarImpact: null,
      laborHoursImpact: null,
      safetyImpact: "medium",
      supplementPriority: "high",
    },
    citationStatus: {
      oem: authorityStatus,
      oemPositionStatement: "needed",
      adas: "not_applicable",
      pPages: "not_applicable",
      scrs: "not_applicable",
      deg: "not_applicable",
      nhtsa: "not_applicable",
      stateRegulation: "not_applicable",
      policy: "needed",
      invoiceOrCompletionProof: "needed",
      photoOrTeardownProof: "needed",
    },
    citationDensityScore: hasComparison ? 32 : 40,
    verifiedAuthorityCount: 0,
    missingAuthorityTypes: [
      "documented part-type authorization",
      "fit/finish/style validation",
      "warranty/quality review",
      "supplier/invoice support",
      "OEM/insurer basis review",
    ],
    missingAuthority: [
      "part-type authorization",
      "fit/finish validation",
      "warranty/quality review",
      "supplier invoice",
      "OEM/insurer documentation basis",
    ],
    citationLabel: "NEEDS OEM",
    bestAvailableAuthority: {
      type: "estimate_evidence",
      status: "needed",
      title: hasComparison ? "Comparison estimate OEM/OE part-source evidence" : "Selected estimate non-OEM part-source evidence",
      sourceType: "EstimateParser",
      confidence: "medium",
      note: SOURCE_BOUNDARY_TEXT,
    },
    currentSupportSummary: hasComparison
      ? `Selected estimate file: ${params.selectedFileName}. Selected estimate page: ${selectedRow.pageNumber ?? "unknown"}. Selected estimate line: ${selectedLine}. Exact selected row text: ${selectedRow.rowText}. Selected part source classification: ${selectedClass}. Comparison estimate file: ${comparisonRow?.sourcePdfName}. Comparison row text: ${comparisonRow?.rowText}. Comparison part source classification: ${comparisonClass}. ${rowIssueSummary} Carrier aftermarket warranty language may guarantee fit, corrosion, or part replacement, but it does not prove OEM-equivalent system performance, ADAS compatibility, crash-test equivalency, or related manufacturer warranty preservation. Candidate score: ${params.candidate.score}. Candidate reasons: ${params.candidate.reasons.join("; ")}.`
      : `Selected estimate file: ${params.selectedFileName}. Selected estimate page: ${selectedRow.pageNumber ?? "unknown"}. Selected estimate line: ${selectedLine}. Exact selected row text: ${selectedRow.rowText}. Selected part source classification: ${selectedClass}. ${rowIssueSummary} This one-estimate review found AM/LKQ/CAPA/non-OEM part sourcing that requires documentation, authorization, fit/finish validation, supplier/invoice support, and OEM/insurer basis review. Carrier aftermarket warranty language may guarantee fit, corrosion, or part replacement, but it does not prove OEM-equivalent system performance, ADAS compatibility, crash-test equivalency, or related manufacturer warranty preservation. Candidate score: ${params.candidate.score}. Candidate reasons: ${params.candidate.reasons.join("; ")}.`,
    missingProofSummary: hasComparison
      ? "Support refs / required documentation basis: part-type authorization, fit/finish and style validation, supplier/invoice support, OEM/insurer documentation basis, and manufacturer-warranty/system-performance support are still needed before claiming the substitution is authorized. A fit/corrosion guarantee is not ADAS compatibility, sensor alignment, crash-tested equivalency, or OEM warranty preservation proof."
      : "Support refs / required documentation basis: document part-type authorization, fit/finish/style correctness, OEM procedure or position-statement requirements where applicable, invoice/supplier documentation, OEM/insurer basis, and whether the part may affect related manufacturer warranty or OEM repair-path confidence unless supported.",
    recommendedNextAction: hasComparison
      ? "Next action: reconcile the selected non-OEM part row against the comparison OEM/OE row and obtain authorization, supplier invoice, fit/finish validation, warranty/quality review, and OEM/insurer basis documentation."
      : "Next action: obtain part-type authorization, supplier invoice, fit/finish validation, warranty/quality review, and OEM/insurer basis documentation before relying on the non-OEM part row.",
    confidence: "high",
    limitations: [
      hasComparison
        ? "Generated from selected estimate row text and comparison estimate row text; this does not independently prove an OEM requirement."
        : "Generated from selected estimate row text only; comparison estimate evidence was not available.",
      "Do not say the part voids all warranty or proves/violates crash-test equivalency unless a reviewed authority source supports that statement.",
    ],
    groupId: "part-source-oem-variance",
    anchorId: selectedRow.anchorId,
  } as CitationDensityFinding & { groupId: string; anchorId?: string };
}

function hasNonOemPartSource(kinds: PartSourceKind[]) {
  return kinds.some((kind) => NON_OEM_PART_SOURCE_KINDS.has(kind));
}

function hasOemPartSource(kinds: PartSourceKind[]) {
  return kinds.some((kind) => OEM_PART_SOURCE_KINDS.has(kind));
}

function formatPartSourceKinds(kinds: PartSourceKind[]) {
  return kinds.length ? kinds.join(", ") : "UNKNOWN";
}

function isPartSourceFinding(finding: CitationDensityFinding) {
  return /^part-source-oem-variance-/i.test(finding.id) ||
    finding.operationLabel === "AM/LKQ part usage vs OEM part usage" ||
    finding.operationLabel === "Non-OEM part-source documentation review";
}

function buildPartSourceRowIssueSummary(selectedRow: PartSourceRow, comparisonRow?: PartSourceRow | null) {
  const lineLabel = selectedRow.lineNumber ? `line ${selectedRow.lineNumber}` : "the selected row";
  const sourceText = selectedRow.rowText;
  if (comparisonRow) {
    return `Selected estimate ${lineLabel} uses ${formatPartSourceKinds(selectedRow.sourceKinds)} sourcing for ${summarizePartDescription(sourceText)}. The comparison estimate appears to use ${formatPartSourceKinds(comparisonRow.sourceKinds)} or OEM-style sourcing for the comparable part. Verify part-type authorization, fit/finish, warranty, and applicable OEM/insurer documentation.`;
  }
  return `Selected estimate ${lineLabel} uses ${formatPartSourceKinds(selectedRow.sourceKinds)} sourcing for ${summarizePartDescription(sourceText)}. Review authorization, fit/finish, warranty/quality, supplier invoice support, and OEM/insurer basis before relying on the part row.`;
}

function summarizePartDescription(rowText: string) {
  const tokens = normalizePartComparableText(rowText).split(" ").filter(Boolean);
  return tokens.length ? tokens.slice(0, 8).join(" ") : "the extracted part row";
}

function isPreferredPartSourceAnchorType(rowType: string | undefined) {
  return rowType === "estimate_line" || rowType === "line_note";
}

function hasPartSourceRepairOperation(rowText: string) {
  return /\b(?:repl|replace|rpr|repair|r&i|r\s*&\s*i|subl|sublet|add|supp|remove|install|overhaul)\b/i.test(rowText);
}

function hasPartSourcePartNoun(rowText: string) {
  return PART_SOURCE_PART_NOUNS.some((noun) => new RegExp(`\\b${escapeRegex(noun)}s?\\b`, "i").test(rowText));
}

function getSharedPartNouns(a: string, b: string) {
  return PART_SOURCE_PART_NOUNS.filter((noun) =>
    new RegExp(`\\b${escapeRegex(noun)}s?\\b`, "i").test(a) &&
    new RegExp(`\\b${escapeRegex(noun)}s?\\b`, "i").test(b)
  );
}

function isVehicleYearLineNumber(value: string | number | null | undefined) {
  const numeric = typeof value === "number" ? value : value ? Number(String(value).trim()) : NaN;
  return Number.isInteger(numeric) && numeric >= 1980 && numeric <= 2035;
}

function containsVehicleYearIdentityText(value: string) {
  return /\b(?:19[8-9]\d|20[0-3]\d)\b/.test(value) &&
    /\b(?:vehicle|vin|honda|toyota|ford|chevrolet|chevy|gmc|ram|dodge|jeep|bmw|audi|kia|hyundai|civic|accord|camry|f-?150|silverado)\b/i.test(value);
}

function isBoilerplatePartSourceText(normalized: string) {
  return /\b(?:claim|claimant|insured|owner|vin|vehicle|license|loss|policy|deductible|appraiser|estimator|estimate id|preliminary estimate|quality replacement|warranty|disclaimer|notice|betterment|alternate parts suppliers?|motor guide|ccc motor guide|database|included|not included|footer|page|abbreviation|legend|fraud|aftermarket definition|capa definition|lkq rcy used)\b/.test(normalized) &&
    !/\b(?:repl|replace|rpr|repair|r&i|subl|add|supp)\b/.test(normalized);
}

const PART_SOURCE_CANDIDATE_MIN_SCORE = 55;
const PART_SOURCE_COMPARISON_MIN_SCORE = 28;

const NON_OEM_PART_SOURCE_KINDS = new Set<PartSourceKind>([
  "AM",
  "LKQ",
  "CAPA",
  "USED",
  "RECYCLED",
  "RECONDITIONED",
  "REMAN",
  "NON_OEM",
  "ECONOMY",
]);

const PART_SOURCE_PART_NOUNS = [
  "bumper",
  "grille",
  "grill",
  "bracket",
  "retainer",
  "lamp",
  "fender",
  "sensor",
  "panel",
  "cover",
  "deflector",
  "support",
  "molding",
  "reflector",
  "bezel",
  "radiator",
  "headlamp",
  "headlight",
];

const OEM_PART_SOURCE_KINDS = new Set<PartSourceKind>([
  "OEM",
  "OE",
  "ALT_OEM",
  "OPT_OEM",
]);

const PART_SOURCE_MATCH_STOP_TERMS = new Set([
  "line",
  "repl",
  "rpr",
  "supp",
  "oem",
  "oe",
  "am",
  "aftermarket",
  "capa",
  "lkq",
  "used",
  "recycled",
  "reconditioned",
  "reman",
  "remanufactured",
  "non",
  "economy",
  "qty",
  "part",
  "parts",
]);

function buildAnchoredCitationCandidates(params: {
  anchors: EstimateRowAnchor[];
  findings: CitationDensityFinding[];
  topicFindings: CitationDensityFinding[];
  estimateRole: "carrier" | "shop" | "selected";
  sourceDocumentRole: "carrier" | "shop";
  anchorIndex: Map<string, EstimateRowAnchor>;
  trace: CitationDensityDebugTrace;
}): {
  candidates: AnchoredCitationCandidate[];
  suppressedPageMismatchCount: number;
  findingsWithoutAnchorId: string[];
} {
  const candidates: AnchoredCitationCandidate[] = [];
  const usedAnchorIds = new Set<string>();
  const matchedFindingIds = new Set<string>();
  let suppressedPageMismatchCount = 0;
  const orderedFindings = orderFindingsForAnchoring(params.findings);

  for (const finding of orderedFindings) {
    const anchorId = getFindingAnchorId(finding);
    const exactAnchor = anchorId ? params.anchorIndex.get(anchorId) : null;
    if (anchorId && !exactAnchor) {
      const reason = "finding anchorId not found in active source PDF; visual anchor suppressed to avoid stale artifact reanchoring";
      addAnchorRejectLimitation(finding, reason);
      params.trace.badAnchorRejectedCount = (params.trace.badAnchorRejectedCount ?? 0) + 1;
      params.trace.badAnchorRejectReasons = [...(params.trace.badAnchorRejectReasons ?? []), reason].slice(0, 20);
      params.trace.droppedFindings.push({
        findingId: finding.id,
        reason,
        anchorId,
      });
      continue;
    }
    const anchor = exactAnchor ?? findBestEstimateRowAnchorForFinding(finding, params.anchors, usedAnchorIds, params.estimateRole);
    if (!anchor) {
      params.trace.droppedFindings.push({
        findingId: finding.id,
        reason: anchorId ? "finding anchorId not found and fallback did not match" : "missing finding anchorId and fallback did not match",
        anchorId,
      });
      continue;
    }
    const resolvedAnchorId = anchor.anchorId;
    if (!anchor.pdfBoundingBox?.width || !anchor.pdfBoundingBox?.height) {
      params.trace.droppedFindings.push({ findingId: finding.id, reason: "matched anchor has no rects", anchorId: resolvedAnchorId });
      continue;
    }
    if (usedAnchorIds.has(anchor.anchorId)) {
      params.trace.droppedFindings.push({ findingId: finding.id, reason: "anchor already used", anchorId: resolvedAnchorId });
      continue;
    }
    const badAnchorReason = getBadAnchorRejectReason(finding, anchor);
    if (badAnchorReason) {
      addAnchorRejectLimitation(finding, badAnchorReason);
      params.trace.badAnchorRejectedCount = (params.trace.badAnchorRejectedCount ?? 0) + 1;
      params.trace.sourceAnchorRowType = classifyCitationDensityAnchorRow(anchor.rowText);
      params.trace.badAnchorRejectReasons = [...(params.trace.badAnchorRejectReasons ?? []), badAnchorReason].slice(0, 20);
      params.trace.droppedFindings.push({ findingId: finding.id, reason: badAnchorReason, anchorId: resolvedAnchorId });
      continue;
    }
    const candidate = buildCandidateFromFinding(finding, anchor, params.estimateRole);
    const gate = gateAnchoredCitationCandidate(candidate, params.anchorIndex);
    if (gate === "allowed") {
      candidates.push(candidate);
      usedAnchorIds.add(anchor.anchorId);
      matchedFindingIds.add(finding.id);
      if (!exactAnchor) {
        params.trace.fallbackMatchedFindings.push({
          findingId: finding.id,
          reason: "deterministic fallback matched",
          anchorId: resolvedAnchorId,
        });
      }
    } else if (gate === "page_mismatch") {
      suppressedPageMismatchCount += 1;
      params.trace.droppedFindings.push({ findingId: finding.id, reason: "page mismatch", anchorId: resolvedAnchorId });
    } else {
      params.trace.droppedFindings.push({ findingId: finding.id, reason: "anchor gate blocked finding", anchorId: resolvedAnchorId });
    }
  }

  const hasExplicitFindingAnchorId = params.findings.some((finding) => Boolean(getFindingAnchorId(finding)));
  const rowBackedTopics = buildRowBackedCandidateTopics(params.topicFindings);
  if (!hasExplicitFindingAnchorId && rowBackedTopics.size > 0) {
    for (const anchor of params.anchors) {
      if (usedAnchorIds.has(anchor.anchorId)) continue;
      const candidate = buildCandidateFromAnchor(anchor, params.sourceDocumentRole, rowBackedTopics);
      if (!candidate) continue;
      const badAnchorReason = getBadAnchorRejectReason(candidate.finding, anchor);
      if (badAnchorReason) {
        addAnchorRejectLimitation(candidate.finding, badAnchorReason);
        params.trace.badAnchorRejectedCount = (params.trace.badAnchorRejectedCount ?? 0) + 1;
        params.trace.sourceAnchorRowType = classifyCitationDensityAnchorRow(anchor.rowText);
        params.trace.badAnchorRejectReasons = [...(params.trace.badAnchorRejectReasons ?? []), badAnchorReason].slice(0, 20);
        params.trace.droppedFindings.push({ findingId: candidate.finding.id, reason: badAnchorReason, anchorId: anchor.anchorId });
        continue;
      }
      const gate = gateAnchoredCitationCandidate(candidate, params.anchorIndex);
      if (gate === "allowed") {
        candidates.push(candidate);
        usedAnchorIds.add(anchor.anchorId);
      } else if (gate === "page_mismatch") {
        suppressedPageMismatchCount += 1;
      }
    }
  }

  return {
    candidates,
    suppressedPageMismatchCount,
    findingsWithoutAnchorId: params.findings.filter((finding) => !matchedFindingIds.has(finding.id)).map((finding) => finding.id),
  };
}

function findReportIdentityMismatch(
  findings: CitationDensityFinding[],
  routeReportType: "citation-density" | "oem-citation-density"
) {
  for (const finding of findings) {
    const reportType = (finding as CitationDensityFinding & { reportType?: string }).reportType;
    if (routeReportType === "citation-density" && (reportType === "oem-citation-density" || /^oem-citation-density-/i.test(finding.id))) {
      return {
        findingId: finding.id,
        artifactReportType: reportType ?? "oem-citation-density",
        reason: "citation-density route received oem-citation-density finding",
        message: "Delta Citation Density Report route received an OEM Citation Density Report finding.",
      };
    }
    if (routeReportType === "oem-citation-density" && (reportType === "citation-density" || /^citation-density-/i.test(finding.id))) {
      return {
        findingId: finding.id,
        artifactReportType: reportType ?? "citation-density",
        reason: "oem-citation-density route received citation-density finding",
        message: "OEM Citation Density Report route received a Delta Citation Density Report finding.",
      };
    }
  }
  return null;
}

function getBadAnchorRejectReason(finding: CitationDensityFinding, anchor: EstimateRowAnchor) {
  const rowType = classifyCitationDensityAnchorRow(anchor.rowText);
  const claimedEstimateAnchor = anchor.anchorType === "estimate_line" || anchor.anchorType === "totals_row";
  const explicitSupportContext = (finding as CitationDensityFinding & { rowType?: string; contextType?: string }).rowType === "support_document_context" ||
    (finding as CitationDensityFinding & { rowType?: string; contextType?: string }).contextType === "support_document_context";
  const structuredRowSuffix = hasStructuredEstimateRowEvidence(finding)
    ? "; leave unanchored but structured row verified"
    : "";
  const productionClass = classifyProductionCitationAnchor(anchor);
  if (
    isDeltaEstimateLineFinding(finding) &&
    isHardRejectedProductionAnchorClass(productionClass) &&
    !isAllowedDeltaEstimateAnchor(finding, anchor, productionClass) &&
    !explicitSupportContext
  ) {
    return `anchor rejected: ${formatProductionAnchorClass(productionClass)} page/text is not a safe estimate row${structuredRowSuffix}`;
  }
  if (isDeltaEstimateLineFinding(finding) && anchor.anchorType === "guide_row" && !explicitSupportContext) {
    return `anchor rejected: guide row page/text is not a safe estimate row${structuredRowSuffix}`;
  }
  if (claimedEstimateAnchor && isImpossibleEstimateLineNumber(anchor.lineNumber)) {
    return `bad anchor rejected: impossible estimate line number ${anchor.lineNumber}${structuredRowSuffix}`;
  }
  if (claimedEstimateAnchor && isBoilerplateOrLegalEstimatePageAnchor(anchor, rowType) && !explicitSupportContext) {
    return `bad anchor rejected: ${rowType} boilerplate/header/legal text cannot be rendered as an estimate annotation${structuredRowSuffix}`;
  }
  if (isBadCitationDensityAnchorText(anchor.rowText) && !explicitSupportContext) {
    return `bad anchor rejected: ${rowType} text cannot be rendered as an estimate annotation${structuredRowSuffix}`;
  }
  if (
    claimedEstimateAnchor &&
    ["support_contract", "legal_notice", "insurer_boilerplate", "vehicle_identity_header_footer", "generic_section_text", "guide_row", "supplier_address"].includes(rowType)
  ) {
    return `bad anchor rejected: ${rowType} cannot be labeled as ${anchor.anchorType}${structuredRowSuffix}`;
  }
  return null;
}

type ProductionCitationAnchorClass =
  | "estimate_line"
  | "supplement_summary_row"
  | "totals_row"
  | "supplier_row"
  | "header_block"
  | "vehicle_options_block"
  | "legal_disclaimer"
  | "motor_ccc_boilerplate"
  | "insurer_policy_language"
  | "footer"
  | "unknown";

function classifyProductionCitationAnchor(anchor: EstimateRowAnchor): ProductionCitationAnchorClass {
  const text = normalizeMatchText(anchor.rowText);
  if (isImpossibleEstimateLineNumber(anchor.lineNumber)) return "header_block";
  if (isVehicleOptionsBlock(text)) return "vehicle_options_block";
  if (isHeaderOrContactBlock(text, anchor.pageNumber)) return "header_block";
  if (isMotorCccBoilerplate(text, anchor.pageNumber)) return "motor_ccc_boilerplate";
  if (isInsurerPolicyLanguage(text, anchor.pageNumber)) return "insurer_policy_language";
  if (isLegalDisclaimerText(text, anchor.pageNumber)) return "legal_disclaimer";
  if (isFooterText(text)) return "footer";
  if (anchor.anchorType === "estimate_line" || anchor.anchorType === "line_note" || anchor.anchorType === "embedded_link_row") {
    if (!isProductionBoilerplateText(text, anchor.pageNumber)) return "estimate_line";
  }
  if (anchor.anchorType === "totals_row") return "totals_row";
  if (anchor.anchorType === "supplier_row") return "supplier_row";
  if (/\bsupplement summary\b/.test(text)) return "supplement_summary_row";
  if (isVehicleOptionsBlock(text)) return "vehicle_options_block";
  if (isHeaderOrContactBlock(text, anchor.pageNumber)) return "header_block";
  if (isMotorCccBoilerplate(text, anchor.pageNumber)) return "motor_ccc_boilerplate";
  if (isInsurerPolicyLanguage(text, anchor.pageNumber)) return "insurer_policy_language";
  if (isLegalDisclaimerText(text, anchor.pageNumber)) return "legal_disclaimer";
  if (isFooterText(text)) return "footer";
  if (anchor.anchorType === "guide_row") return "motor_ccc_boilerplate";
  if (anchor.anchorType === "section_row") return "unknown";
  return "unknown";
}

function isHardRejectedProductionAnchorClass(anchorClass: ProductionCitationAnchorClass) {
  return anchorClass === "header_block" ||
    anchorClass === "vehicle_options_block" ||
    anchorClass === "legal_disclaimer" ||
    anchorClass === "motor_ccc_boilerplate" ||
    anchorClass === "insurer_policy_language" ||
    anchorClass === "footer";
}

function isAllowedDeltaEstimateAnchor(
  finding: CitationDensityFinding,
  anchor: EstimateRowAnchor,
  anchorClass: ProductionCitationAnchorClass
) {
  if (anchorClass === "estimate_line" || anchorClass === "supplement_summary_row") return true;
  if (anchorClass === "totals_row") return isTotalOrRateFinding(finding);
  if (anchorClass === "supplier_row") return isSupplierSupportFinding(finding) && !isProductionBoilerplateText(normalizeMatchText(anchor.rowText), anchor.pageNumber);
  return false;
}

function isDeltaEstimateLineFinding(finding: CitationDensityFinding) {
  const reportType = (finding as CitationDensityFinding & { reportType?: string }).reportType;
  if (reportType === "oem-citation-density" || /^oem-citation-density-/i.test(finding.id)) return false;
  if (finding.category === "policy_coverage" || finding.category === "state_regulation") return false;
  return /^citation-density-/i.test(finding.id) || finding.crossEstimateIssue === true || finding.estimateGapType !== "weak_do_not_lead";
}

function isTotalOrRateFinding(finding: CitationDensityFinding) {
  return /\b(?:total|subtotal|net cost|rate|labor rate|grand total|estimate total)\b/i.test(
    `${finding.operationLabel} ${finding.counterpartSummary ?? ""} ${finding.currentSupportSummary}`
  );
}

function isSupplierSupportFinding(finding: CitationDensityFinding) {
  return /\b(?:supplier|invoice|part-source|part source|lkq|capa|aftermarket|a\/m|recycled|used)\b/i.test(
    `${finding.operationLabel} ${finding.category} ${finding.missingProofSummary} ${finding.recommendedNextAction}`
  );
}

function isProductionBoilerplateText(text: string, pageNumber: number) {
  return isMotorCccBoilerplate(text, pageNumber) ||
    isInsurerPolicyLanguage(text, pageNumber) ||
    isLegalDisclaimerText(text, pageNumber) ||
    isHeaderOrContactBlock(text, pageNumber) ||
    isVehicleOptionsBlock(text) ||
    isFooterText(text);
}

function isMotorCccBoilerplate(text: string, pageNumber: number) {
  return /\bestimate based on motor crash estimating guide\b/.test(text) ||
    /\bsymbols following\b/.test(text) ||
    /\bvin\s*=\s*vehicle identification number\b/.test(text) ||
    ((pageNumber === 9 || pageNumber === 10 || pageNumber === 11) && /\b(?:motor|ccc|crash estimating guide|guide pages?|included|not included|database|symbols following)\b/.test(text));
}

function isInsurerPolicyLanguage(text: string, pageNumber: number) {
  return /\bimportant information about the named insurance company'?s parts policy\b/.test(text) ||
    /\b(?:aftermarket|alternate|quality replacement|lkq|used|recycled|capa)\b.{0,90}\b(?:parts policy|policy language|parts used|replacement parts)\b/.test(text) ||
    ((pageNumber === 9 || pageNumber === 10 || pageNumber === 11) && /\b(?:parts policy|quality replacement|alternate parts|named insurance company)\b/.test(text));
}

function isLegalDisclaimerText(text: string, pageNumber: number) {
  return /\bany person who knowingly\b/.test(text) ||
    /\b(?:fraud|legal notice|disclaimer|not an authorization|terms and conditions|subject to review)\b/.test(text) ||
    ((pageNumber === 9 || pageNumber === 10 || pageNumber === 11) && /\b(?:fraud|legal|disclaimer|authorization)\b/.test(text));
}

function isHeaderOrContactBlock(text: string, pageNumber: number) {
  return (pageNumber === 1 && /\b(?:claim|owner|insured|address|phone|email|vehicle|vin|license|loss date|estimate id|workfile|appraiser|estimator|preliminary estimate)\b/.test(text) &&
    !/\b(?:repl|replace|rpr|repair|r&i|subl|add|refn|calibration|scan|align)\b/.test(text)) ||
    /^\s*(?:claim|vehicle|owner|insured|vin|license|estimate|page)\b/.test(text);
}

function isVehicleOptionsBlock(text: string) {
  const optionHits = (text.match(/\b(?:air conditioning|navigation|heated|seat|bluetooth|cruise|traction|telescopic|steering wheel|paint code|trim|options?|equipment|vin)\b/g) ?? []).length;
  return optionHits >= 3 && !/\b(?:repl|replace|rpr|repair|r&i|subl|add|refn|calibration|scan|align)\b/.test(text);
}

function isFooterText(text: string) {
  return /\bpage\s+\d+\s+of\s+\d+\b/.test(text) ||
    /\b(?:footer|estimate totals?|subtotal|grand total|deductible|tax)\b/.test(text) &&
      /\b(?:claim|insured|owner|vin|license|page)\b/.test(text);
}

function formatProductionAnchorClass(value: ProductionCitationAnchorClass) {
  return value.replace(/_/g, " ");
}

function addAnchorRejectLimitation(finding: CitationDensityFinding, reason: string) {
  const text = `Structured delta finding verified, visual anchor suppressed. Anchor reject reason: ${reason}`;
  if (!finding.limitations.includes(text)) {
    finding.limitations = [text, ...finding.limitations].slice(0, 12);
  }
}

function isImpossibleEstimateLineNumber(value: string | number | null | undefined) {
  const numeric = typeof value === "number" ? value : value ? Number(String(value).trim()) : NaN;
  return numeric === 4717 || isVehicleYearLineNumber(numeric);
}

function isBoilerplateOrLegalEstimatePageAnchor(anchor: EstimateRowAnchor, rowType: string) {
  const text = normalizeMatchText(anchor.rowText);
  const boilerplateRowTypes = new Set([
    "support_contract",
    "legal_notice",
    "insurer_boilerplate",
    "vehicle_identity_header_footer",
    "generic_section_text",
    "guide_row",
    "supplier_address",
  ]);
  if (boilerplateRowTypes.has(rowType)) return true;
  if (
    anchor.pageNumber === 1 &&
    /\b(?:vehicle|vin|claim|owner|insured|license|loss date|estimate id|workfile|options|equipment)\b/.test(text) &&
    !/\b(?:repl|replace|rpr|repair|r&i|subl|add|supp)\b/.test(text)
  ) {
    return true;
  }
  if (
    (anchor.pageNumber === 10 || anchor.pageNumber === 11) &&
    /\b(?:disclaimer|abbreviations?|motor|ccc|guide pages?|included|not included|quality replacement|alternate parts|allstate parts policy|fraud|legal notice|supplier address)\b/.test(text)
  ) {
    return true;
  }
  return /\b(?:disclaimer|abbreviations?|motor guide|ccc motor guide|guide pages?|legal notice|fraud warning|quality replacement parts|alternate parts policy|supplier address)\b/.test(text);
}

function hasStructuredEstimateRowEvidence(finding: CitationDensityFinding) {
  const record = finding as CitationDensityFinding & {
    structuredRowVerified?: boolean;
    cccSecureShareRowId?: string | null;
    cccSecureShareLineId?: string | null;
    sourceProvider?: string | null;
    source?: { provider?: string | null; cccSecureShareRowId?: string | null };
  };
  return (
    record.structuredRowVerified === true ||
    Boolean(record.cccSecureShareRowId || record.cccSecureShareLineId || record.source?.cccSecureShareRowId) ||
    record.sourceProvider === "ccc_secure_share" ||
    record.source?.provider === "ccc_secure_share"
  );
}

function orderFindingsForAnchoring(findings: CitationDensityFinding[]) {
  const ordered: CitationDensityFinding[] = [];
  const seen = new Set<string>();
  const add = (finding: CitationDensityFinding) => {
    if (seen.has(finding.id)) return;
    ordered.push(finding);
    seen.add(finding.id);
  };
  findings.filter((finding) => Boolean(getFindingAnchorId(finding))).forEach(add);
  findings.filter((finding) => !getFindingAnchorId(finding) && isReferencedNotProducedFinding(finding)).forEach(add);
  findings.filter((finding) => !getFindingAnchorId(finding) && hasConcreteFindingAnchor(finding)).forEach(add);
  findings.filter((finding) => !getFindingAnchorId(finding) && !isReferencedNotProducedFinding(finding) && !hasConcreteFindingAnchor(finding)).forEach(add);
  return ordered;
}

function getFindingAnchorId(finding: CitationDensityFinding) {
  const record = finding as CitationDensityFinding & {
    anchorId?: string | null;
    sourceAnchorId?: string | null;
    estimateAnchorId?: string | null;
    source?: { anchorId?: string | null };
  };
  return (
    record.anchorId ??
    record.sourceAnchorId ??
    record.estimateAnchorId ??
    record.source?.anchorId ??
    null
  );
}

function isReferencedNotProducedFinding(finding: CitationDensityFinding) {
  return (
    finding.estimateGapType === "referenced_not_produced" ||
    finding.citationLabel === "REFERENCED / NOT PRODUCED" ||
    Object.values(finding.citationStatus).some((value) => value === "referenced_not_produced")
  );
}

function buildCandidateFromFinding(
  finding: CitationDensityFinding,
  anchor: EstimateRowAnchor,
  estimateRole: "carrier" | "shop" | "selected"
): AnchoredCitationCandidate {
  const rowText = getAnchorSourceText(anchor);
  return {
    candidateId: `finding:${finding.id}:${anchor.anchorId}`,
    anchorId: anchor.anchorId,
    sourceDocumentRole: anchor.sourceDocumentRole,
    sourcePdfPageNumber: anchor.pageNumber,
    sourcePdfPageIndex: toSourcePdfPageIndex(anchor.pageNumber),
    sourceLineNumber: anchor.lineNumber ?? undefined,
    sourceAnchorType: anchor.anchorType,
    sourceAnchorText: rowText,
    sourceAnchorNormalizedText: normalizeMatchText(rowText),
    label: getProofBucketLabel(finding),
    estimateLineDisplay: formatEstimateLineForCallout(finding, estimateRole),
    bestAuthority: formatBestAuthority(finding),
    missingProof: formatMissingAuthority(finding),
    whyItMatters: finding.currentSupportSummary || buildRoleCalloutNote(finding, estimateRole),
    nextAction: finding.recommendedNextAction,
    supportRefs: formatAnnotationSourceRefs(finding),
    confidence: getMatchConfidence(anchor),
    finding,
    anchor,
    derivedFromFindingId: finding.id,
  };
}

function buildCandidateFromAnchor(
  anchor: EstimateRowAnchor,
  sourceDocumentRole: "carrier" | "shop",
  topics: Set<RowBackedCandidateTopic>
): AnchoredCitationCandidate | null {
  if (anchor.synthetic || anchor.confidence < 0.82) return null;
  const sourceText = getAnchorSourceText(anchor);
  const normalized = normalizeMatchText(sourceText);
  if (!normalized || isGenericOrMalformedAnchorText(sourceText)) return null;

  const kind = classifyRowBackedCandidate(anchor, normalized);
  if (!kind) return null;
  if (!topics.has(kind.topic)) return null;

  const label = kind.label;
  const finding = buildRowBackedFinding(anchor, kind);
  return {
    candidateId: `row:${anchor.anchorId}:${kind.type}`,
    anchorId: anchor.anchorId,
    sourceDocumentRole,
    sourcePdfPageNumber: anchor.pageNumber,
    sourcePdfPageIndex: toSourcePdfPageIndex(anchor.pageNumber),
    sourceLineNumber: anchor.lineNumber ?? undefined,
    sourceAnchorType: anchor.anchorType,
    sourceAnchorText: sourceText,
    sourceAnchorNormalizedText: normalized,
    label,
    estimateLineDisplay: formatEstimateLineForCallout(finding, sourceDocumentRole),
    bestAuthority: formatBestAuthority(finding),
    missingProof: formatMissingAuthority(finding),
    whyItMatters: finding.currentSupportSummary,
    nextAction: finding.recommendedNextAction,
    supportRefs: formatAnnotationSourceRefs(finding),
    confidence: getMatchConfidence(anchor),
    finding,
    anchor,
  };
}

type RowBackedCandidateTopic = "parts" | "diagnostic" | "totals" | "supplier";

function classifyRowBackedCandidate(
  anchor: EstimateRowAnchor,
  normalized: string
): {
  type: "parts_correctness" | "diagnostic_support" | "adas_report_reference" | "process_verification" | "totals_delta" | "supplier_parts";
  topic: RowBackedCandidateTopic;
  label: string;
  category: CitationDensityFinding["category"];
  estimateGapType: CitationDensityFinding["estimateGapType"];
  adasStatus?: "needed" | "referenced_not_produced" | "not_applicable";
  missingAuthorityTypes: string[];
} | null {
  if (anchor.anchorType === "totals_row") {
    return {
      type: "totals_delta",
      topic: "totals",
      label: "ESTIMATE GAP ONLY",
      category: "labor_difference",
      estimateGapType: "present_but_under_documented",
      adasStatus: "not_applicable",
      missingAuthorityTypes: ["P-page/DEG or rate/material support"],
    };
  }
  if (anchor.anchorType === "supplier_row") {
    if (!anchor.lineNumber || isRejectedBoilerplateSupplierText(normalized)) return null;
    return {
      type: "supplier_parts",
      topic: "supplier",
      label: "ESTIMATE GAP ONLY",
      category: "parts_downgrade",
      estimateGapType: "present_but_under_documented",
      adasStatus: "not_applicable",
      missingAuthorityTypes: ["parts correctness support"],
    };
  }
  if (anchor.anchorType === "embedded_link_row") {
    return {
      type: "adas_report_reference",
      topic: "diagnostic",
      label: "REFERENCED / NOT PRODUCED",
      category: "adas_calibration",
      estimateGapType: "referenced_not_produced",
      adasStatus: "referenced_not_produced",
      missingAuthorityTypes: ["referenced link or report"],
    };
  }
  if (anchor.anchorType === "guide_row") {
    return null;
  }
  if (/\bnot correct style\b/.test(normalized)) {
    return {
      type: "parts_correctness",
      topic: "parts",
      label: "ESTIMATE GAP ONLY",
      category: "parts_downgrade",
      estimateGapType: "present_but_under_documented",
      adasStatus: "not_applicable",
      missingAuthorityTypes: ["parts correctness support"],
    };
  }
  if (/\bfinal road test\b/.test(normalized)) {
    return {
      type: "process_verification",
      topic: "diagnostic",
      label: "ESTIMATE GAP ONLY",
      category: "other",
      estimateGapType: "needs_proof",
      adasStatus: "not_applicable",
      missingAuthorityTypes: ["verification or completion proof"],
    };
  }
  if (/\brevv\s*adas\b|\brevvadas\b|\badas report\b|\begnyte\b|\bvia this link\b/.test(normalized)) {
    return {
      type: "adas_report_reference",
      topic: "diagnostic",
      label: "REFERENCED / NOT PRODUCED",
      category: "adas_calibration",
      estimateGapType: "referenced_not_produced",
      adasStatus: "referenced_not_produced",
      missingAuthorityTypes: ["linked ADAS report"],
    };
  }
  if (/\b(?:pre repair scan|pre scan|in proc repair scan|in process scan|post repair scan|calibration|adas|srs|seat belt dynamic function test|aiming|initialization|programming|radar|camera|sensor|diagnostic|scan)\b/.test(normalized)) {
    return {
      type: "diagnostic_support",
      topic: "diagnostic",
      label: "NEEDS ADAS",
      category: "scan_diagnostic",
      estimateGapType: "needs_proof",
      adasStatus: "needed",
      missingAuthorityTypes: ["ADAS/diagnostic report or completion proof"],
    };
  }
  return null;
}

function buildRowBackedCandidateTopics(findings: CitationDensityFinding[]) {
  const topics = new Set<RowBackedCandidateTopic>();
  for (const finding of findings) {
    if (hasConcreteFindingAnchor(finding)) continue;
    const text = normalizeMatchText([
      finding.operationLabel,
      finding.category,
      finding.carrierEvidence?.description,
      finding.shopEvidence?.description,
      finding.currentSupportSummary,
      finding.missingProofSummary,
      finding.recommendedNextAction,
      ...finding.missingAuthorityTypes,
    ].join(" "));
    if (/\b(?:not correct style|grille|lkq|part|parts|style|oem style)\b/.test(text)) topics.add("parts");
    if (/\b(?:supplier|alternate|aftermarket|used part|lkq)\b/.test(text)) topics.add("supplier");
    if (/\b(?:labor rate|rate|paint material|paint supplies|materials|total|net cost|body labor|paint labor|deg|p page|ccc|motor|guide|included|not included|database)\b/.test(text)) topics.add("totals");
    if (/\b(?:adas|scan|diagnostic|calibration|srs|seat belt|road test|revvadas|report|radar|camera|sensor|programming|initialization|aiming)\b/.test(text)) topics.add("diagnostic");
  }
  return topics;
}

function buildRowBackedFinding(
  anchor: EstimateRowAnchor,
  kind: NonNullable<ReturnType<typeof classifyRowBackedCandidate>>
): CitationDensityFinding {
  const sourceText = getAnchorSourceText(anchor);
  const evidence = {
    lineNumber: anchor.lineNumber,
    description: sourceText,
    amount: null,
    laborHours: null,
    sourceLabel: `${anchor.sourceDocumentRole === "shop" ? "Shop" : "Carrier"} estimate`,
  };
  const isReferenced = kind.estimateGapType === "referenced_not_produced";
  return {
    id: `row-backed-${anchor.anchorId.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`,
    operationLabel: sourceText,
    category: kind.category,
    estimateGapType: kind.estimateGapType,
    carrierEvidence: anchor.sourceDocumentRole === "carrier" ? evidence : undefined,
    shopEvidence: anchor.sourceDocumentRole === "shop" ? evidence : undefined,
    applicableEstimateRoles: [anchor.sourceDocumentRole],
    primaryAnnotationRole: anchor.sourceDocumentRole,
    carrierAnchor: anchor.sourceDocumentRole === "carrier" ? buildFindingLineAnchor(anchor) : undefined,
    shopAnchor: anchor.sourceDocumentRole === "shop" ? buildFindingLineAnchor(anchor) : undefined,
    impact: {
      dollarImpact: null,
      laborHoursImpact: null,
      safetyImpact: kind.adasStatus === "needed" ? "high" : "medium",
      supplementPriority: kind.adasStatus === "needed" ? "high" : "medium",
    },
    citationStatus: {
      oem: "not_applicable",
      adas: kind.adasStatus ?? "not_applicable",
      pPages: kind.type === "totals_delta" ? "needed" : "not_applicable",
      scrs: "not_applicable",
      deg: kind.type === "totals_delta" ? "needed" : "not_applicable",
      nhtsa: "not_applicable",
      stateRegulation: "not_applicable",
      policy: "not_applicable",
      invoiceOrCompletionProof: kind.adasStatus === "needed" || isReferenced ? "needed" : "not_found",
      photoOrTeardownProof: "not_found",
    },
    citationDensityScore: kind.adasStatus === "needed" ? 38 : 52,
    verifiedAuthorityCount: 0,
    missingAuthorityTypes: kind.missingAuthorityTypes,
    missingAuthority: kind.missingAuthorityTypes,
    citationLabel: kind.label,
    currentSupportSummary: buildRowBackedSupportSummary(kind.type, sourceText),
    missingProofSummary: buildRowBackedMissingProof(kind.type),
    recommendedNextAction: buildRowBackedNextAction(kind.type),
    confidence: "high",
    limitations: ["Generated only from an exact extracted estimate row anchor."],
  };
}

function buildFindingLineAnchor(anchor: EstimateRowAnchor) {
  return {
    sourceDocumentId: anchor.sourceDocumentId,
    estimateRole: anchor.sourceDocumentRole,
    lineNumber: anchor.lineNumber,
    pageNumber: anchor.pageNumber,
    section: anchor.section,
    operation: anchor.rowText,
    description: getAnchorSourceText(anchor),
  };
}

function buildRowBackedSupportSummary(type: string, sourceText: string) {
  if (type === "adas_report_reference") return "The estimate references an ADAS report/link, but the report content has not been retrieved or reviewed.";
  if (type === "diagnostic_support") return "The estimate contains an exact diagnostic/ADAS-related row that needs supporting report or completion proof.";
  if (type === "process_verification") return "The estimate contains a verification/process row; treat it as process evidence, not an automatic ADAS deficiency.";
  if (type === "totals_delta") return "The estimate contains exact totals/rate/material rows that can support a rate or material delta review.";
  if (type === "supplier_parts") return "The supplier evidence is tied to an exact supplier/parts row.";
  return `The estimate row itself contains the parts correctness issue: ${sourceText}`;
}

function buildRowBackedMissingProof(type: string) {
  if (type === "adas_report_reference") return "Referenced report/link was not produced in the reviewed evidence.";
  if (type === "diagnostic_support") return "Diagnostic/ADAS report, calibration output, or completion proof was not produced in the reviewed evidence.";
  if (type === "totals_delta") return "Rate/material support, P-page, DEG, or agreed-rate proof is still needed before leading.";
  if (type === "supplier_parts") return "Supplier invoice, parts evidence, or style-correctness support is still needed.";
  if (type === "process_verification") return "Completion or verification proof is still needed if this row is being used as a claim support item.";
  return "Parts correctness support is still needed.";
}

function buildRowBackedNextAction(type: string) {
  if (type === "adas_report_reference") return "Retrieve and review the referenced ADAS report before presenting it as verified support.";
  if (type === "diagnostic_support") return "Attach the scan/report output or completion proof before leading with this item.";
  if (type === "totals_delta") return "Tie the totals/rate/material difference to P-page, DEG, rate, or invoice support.";
  if (type === "supplier_parts") return "Attach supplier evidence and reconcile it with the estimate parts row.";
  if (type === "process_verification") return "Attach completion proof if this verification row is material to the supplement request.";
  return "Attach parts correctness evidence before leading.";
}

function gateAnchoredCitationCandidate(
  candidate: AnchoredCitationCandidate,
  anchorIndex: Map<string, EstimateRowAnchor>
): "allowed" | "blocked" | "page_mismatch" {
  if (!candidate.anchorId) return "blocked";
  const anchor = anchorIndex.get(candidate.anchorId);
  if (!anchor) return "blocked";
  if (candidate.sourcePdfPageNumber !== anchor.pageNumber) return "page_mismatch";
  if (candidate.sourceLineNumber && anchor.lineNumber !== candidate.sourceLineNumber) return "blocked";
  if (candidate.sourceAnchorText !== getAnchorSourceText(anchor)) return "blocked";
  if (!isClassificationAllowedForRow(candidate.label, anchor)) return "blocked";
  if (anchor.anchorType === "guide_row") return "blocked";
  if (anchor.anchorType === "supplier_row" && isRejectedBoilerplateSupplierText(normalizeMatchText(getAnchorSourceText(anchor)))) return "blocked";
  if (isRestrictedSourcePageForCandidate(candidate, anchor)) return "blocked";
  return "allowed";
}

function isClassificationAllowedForRow(label: string, anchor: EstimateRowAnchor) {
  if (/NEEDS ADAS/i.test(label)) {
    return anchor.anchorType !== "totals_row" &&
      anchor.anchorType !== "supplier_row" &&
      anchor.anchorType !== "guide_row" &&
      !/\b(?:final road test|not correct style|total|paint supplies|paint materials|body labor|paint labor|net cost|supplier|lkq)\b/i.test(getAnchorSourceText(anchor));
  }
  return true;
}

function isRestrictedSourcePageForCandidate(candidate: AnchoredCitationCandidate, anchor: EstimateRowAnchor) {
  const text = getAnchorSourceText(anchor);
  if (/\b(?:disclaimer|abbreviations?|motor guide|ccc motor guide|guide pages|asTech diagnostic terms)\b/i.test(text)) {
    return !/\b(?:disclaimer|abbreviations?|motor guide|astech)\b/i.test(candidate.estimateLineDisplay);
  }
  if (anchor.anchorType === "totals_row") return !/total|rate|paint|material|labor|net cost/i.test(candidate.estimateLineDisplay);
  if (anchor.anchorType === "supplier_row") return !/supplier|alternate|aftermarket|lkq|part|grille/i.test(candidate.estimateLineDisplay);
  if (anchor.anchorType === "embedded_link_row") return !/link|url|report|available|referenced|egnyte|revv|adas|oem/i.test(candidate.estimateLineDisplay);
  if (anchor.anchorType === "guide_row") return !/ccc|motor|guide|p page|included|not included|database|deg|rate|material|labor/i.test(candidate.estimateLineDisplay);
  return false;
}

function getAnchorSourceText(anchor: EstimateRowAnchor) {
  return [...new Set([anchor.rowText, anchor.noteText, anchor.supplierText]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => value.replace(/\s+/g, " ").trim()))]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPdfJsWorkerError(error: string | undefined) {
  return Boolean(error && /pdf\.worker\.mjs|Setting up fake worker failed/i.test(error));
}

function buildAnchorsByPage(anchors: EstimateRowAnchor[]) {
  const byPage: Record<string, string[]> = {};
  for (const anchor of anchors) {
    const key = String(anchor.pageNumber);
    byPage[key] = byPage[key] ?? [];
    byPage[key].push(anchor.lineNumber ? `line ${anchor.lineNumber}` : anchor.anchorType);
  }
  return byPage;
}

async function extractPdfTextAnchors(bytes: Uint8Array): Promise<TextAnchor[]> {
  const polyfillError = await ensurePdfJsNodePolyfills([]);
  if (polyfillError) {
    throw new Error(polyfillError);
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: bytes.slice(),
    disableWorker: true,
    useSystemFonts: true,
  } as unknown as Parameters<typeof pdfjs.getDocument>[0]);
  const pdf = await loadingTask.promise;
  const anchors: TextAnchor[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!("str" in item) || typeof item.str !== "string") continue;
      const text = item.str.replace(/\s+/g, " ").trim();
      if (!text) continue;
      const transform = item.transform;
      const x = Number(transform[4] ?? 0);
      const pdfJsY = Number(transform[5] ?? 0);
      const height = Math.max(Number((item as { height?: number }).height ?? 8), 6);
      const width = Math.max(Number((item as { width?: number }).width ?? 40), text.length * 4);
      anchors.push({
        pageIndex: pageNumber - 1,
        text,
        normalizedText: normalizeMatchText(text),
        x,
        y: viewport.height - pdfJsY - height * 0.4,
        width,
        height,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
      });
    }
  }

  return [...anchors, ...buildGroupedLineAnchors(anchors)];
}

function buildGroupedLineAnchors(anchors: TextAnchor[]): TextAnchor[] {
  const byPage = new Map<number, TextAnchor[]>();
  for (const anchor of anchors) {
    const pageAnchors = byPage.get(anchor.pageIndex) ?? [];
    pageAnchors.push(anchor);
    byPage.set(anchor.pageIndex, pageAnchors);
  }

  const grouped: TextAnchor[] = [];
  for (const [, pageAnchors] of byPage.entries()) {
    const rows: TextAnchor[][] = [];
    for (const anchor of [...pageAnchors].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const row = rows.find((candidate) =>
        Math.abs(average(candidate.map((item) => item.y)) - anchor.y) <= Math.max(3.5, anchor.height * 0.55)
      );
      if (row) {
        row.push(anchor);
      } else {
        rows.push([anchor]);
      }
    }

    for (const row of rows) {
      if (row.length < 2) continue;
      const ordered = [...row].sort((a, b) => a.x - b.x);
      const text = ordered.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
      if (text.length < 8) continue;
      const minX = Math.min(...ordered.map((item) => item.x));
      const minY = Math.min(...ordered.map((item) => item.y));
      const maxX = Math.max(...ordered.map((item) => item.x + item.width));
      const maxY = Math.max(...ordered.map((item) => item.y + item.height));
      grouped.push({
        pageIndex: ordered[0].pageIndex,
        text,
        normalizedText: normalizeMatchText(text),
        x: minX,
        y: minY,
        width: Math.max(40, maxX - minX),
        height: Math.max(8, maxY - minY),
        pageWidth: ordered[0].pageWidth,
        pageHeight: ordered[0].pageHeight,
        groupedLine: true,
      });
    }
  }
  return grouped;
}

function buildStoredTextAnchors(sourceText: string | null | undefined, pdfDoc: PDFDocument): TextAnchor[] {
  const text = sourceText?.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) return [];

  const pageCount = Math.max(1, pdfDoc.getPageCount());
  const pages = splitStoredTextIntoPages(text, pageCount);
  const anchors: TextAnchor[] = [];

  pages.forEach((pageText, pageIndex) => {
    const page = pdfDoc.getPage(Math.min(pageIndex, pageCount - 1));
    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();
    const rawLines = pageText
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const lines = mergeContinuationLines(rawLines);
    const usableLines = lines.length ? lines : rawLines;
    const topY = pageHeight - 72;
    const rowHeight = Math.max(8, Math.min(13, (pageHeight - 120) / Math.max(1, usableLines.length)));

    usableLines.forEach((line, index) => {
      const lineY = clamp(topY - index * rowHeight, 42, pageHeight - 42);
      anchors.push({
        pageIndex: Math.min(pageIndex, pageCount - 1),
        text: line,
        normalizedText: normalizeMatchText(line),
        x: 42,
        y: pageHeight - lineY - 9,
        width: Math.min(pageWidth - 84, Math.max(180, line.length * 4.8)),
        height: 9,
        pageWidth,
        pageHeight,
        synthetic: true,
        groupedLine: true,
      });
    });
  });

  return anchors;
}

function splitStoredTextIntoPages(text: string, pageCount: number) {
  const formFeedPages = text.split(/\f+/).map((page) => page.trim()).filter(Boolean);
  if (formFeedPages.length > 1) return padPages(formFeedPages, pageCount);

  const markerPages = text
    .split(/\n\s*(?:-{2,}\s*)?(?:page|pg)\s+\d+(?:\s+of\s+\d+)?\s*(?:-{2,})?\s*\n/gi)
    .map((page) => page.trim())
    .filter(Boolean);
  if (markerPages.length > 1) return padPages(markerPages, pageCount);

  return distributeLinesAcrossPages(text, pageCount);
}

function padPages(pages: string[], pageCount: number) {
  if (pages.length >= pageCount) return pages.slice(0, pageCount);
  return [...pages, ...Array.from({ length: pageCount - pages.length }, () => "")];
}

function distributeLinesAcrossPages(text: string, pageCount: number) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (pageCount <= 1 || lines.length <= 1) return [text];
  const perPage = Math.ceil(lines.length / pageCount);
  return Array.from({ length: pageCount }, (_, index) =>
    lines.slice(index * perPage, (index + 1) * perPage).join("\n")
  );
}

function mergeContinuationLines(lines: string[]) {
  const merged: string[] = [];
  for (const line of lines) {
    const startsEstimateRow = /^\s*(?:line\s*)?\d{1,4}\b/i.test(line);
    const startsSection = /^(?:parts|body|paint|refinish|electrical|diagnostic|calibration|totals?|summary|alternate parts supplier|ccc|motor|p-?pages?|included|not included)\b/i.test(line);
    if (!merged.length || startsEstimateRow || startsSection) {
      merged.push(line);
      continue;
    }

    const previous = merged[merged.length - 1];
    if (
      /(?:note|available|via this link|not correct|supplier|guide|database|included|not included|paint materials?|labor|total)/i.test(line) ||
      /^\$?\d+(?:\.\d+)?\b/.test(line)
    ) {
      merged[merged.length - 1] = `${previous} ${line}`;
    } else {
      merged.push(line);
    }
  }
  return merged;
}

function findBestAnchorForFinding(
  finding: CitationDensityFinding,
  anchors: TextAnchor[],
  usedAnchors: Set<TextAnchor>,
  estimateRole: "carrier" | "shop" | "selected"
): TextAnchor | null {
  let best: { anchor: TextAnchor; score: number } | null = null;
  for (const anchor of anchors) {
    if (usedAnchors.has(anchor)) continue;
    const score = scoreAnchor(finding, anchor, estimateRole);
    if (score > (best?.score ?? 0)) {
      best = { anchor, score };
    }
  }

  return best && best.score >= 24 && isConcreteAnchorMatch(finding, best.anchor, estimateRole)
    ? best.anchor
    : null;
}

function sanitizeCitationDensityFindingsForVisibleLayer(findings: CitationDensityFinding[]) {
  const kept: CitationDensityFinding[] = [];
  const suppressed: CitationDensityFinding[] = [];
  const seen = new Set<string>();

  for (const finding of findings) {
    const displayText = [
      finding.operationLabel,
      finding.carrierEvidence?.description,
      finding.shopEvidence?.description,
      finding.carrierAnchor?.description,
      finding.shopAnchor?.description,
    ].join(" ");
    const key = normalizeMatchText(displayText);

    if (!isVisibleCitationDensityFinding(finding) || (key && seen.has(key))) {
      suppressed.push(finding);
      continue;
    }

    if (key) seen.add(key);
    kept.push(finding);
  }

  return { findings: kept, suppressed };
}

function isVisibleCitationDensityFinding(finding: CitationDensityFinding): boolean {
  const text = [
    finding.operationLabel,
    finding.category,
    finding.carrierEvidence?.description,
    finding.shopEvidence?.description,
    finding.currentSupportSummary,
    finding.missingProofSummary,
    finding.recommendedNextAction,
  ].join(" ");
  const normalized = normalizeMatchText(text);
  const primaryText = [
    finding.operationLabel,
    finding.carrierEvidence?.description,
    finding.shopEvidence?.description,
    finding.carrierAnchor?.description,
    finding.shopAnchor?.description,
    hasConcreteFindingAnchor(finding) ? "" : finding.currentSupportSummary,
    hasConcreteFindingAnchor(finding) ? "" : finding.missingProofSummary,
  ].join(" ");
  const primaryNormalized = normalizeMatchText(primaryText);

  if (!normalized.trim()) return false;
  if (isJunkCitationFindingText(primaryNormalized)) return false;
  if (/\brepair operation\b|\bproc report\b|\bcomparison or screenshot cues\b/i.test(text)) return false;
  if (/\bgeneric visible damage photo observations\b|\bgeneric key visible estimate facts\b/i.test(text)) return false;
  if (/\bproc\s+(?:pre|post)[-\s]?repair scanm\b/i.test(text) || /\bproc\s+(?:pre|post)\s+repair\s+scanm\b/.test(normalized)) return false;
  if (/\bstructural frame and measurement verification\b/i.test(text) && !hasConcreteFindingAnchor(finding)) return false;
  if (/\bside structure aperture door[-\s]?shell fit verification\b/i.test(text) && !hasConcreteFindingAnchor(finding)) return false;
  if (/^note required prior to final refinish/i.test(text) && !/test\s*fit/i.test(text)) return false;

  return true;
}

function hasConcreteFindingAnchor(finding: CitationDensityFinding): boolean {
  return Boolean(
    finding.carrierEvidence?.lineNumber ||
    finding.shopEvidence?.lineNumber ||
    finding.carrierEvidence?.description ||
    finding.shopEvidence?.description ||
    typeof finding.carrierEvidence?.amount === "number" ||
    typeof finding.shopEvidence?.amount === "number" ||
    typeof finding.carrierEvidence?.laborHours === "number" ||
    typeof finding.shopEvidence?.laborHours === "number" ||
    finding.carrierAnchor?.lineNumber ||
    finding.shopAnchor?.lineNumber ||
    finding.carrierAnchor?.section ||
    finding.shopAnchor?.section
  );
}

function isConcreteAnchorMatch(
  finding: CitationDensityFinding,
  anchor: TextAnchor,
  estimateRole: "carrier" | "shop" | "selected"
): boolean {
  if (anchor.synthetic && /^page-level citation density callout/i.test(anchor.text)) return false;
  if (isGenericOrMalformedAnchorText(anchor.text)) return false;

  const lineNumber = getTargetLineNumber(finding, estimateRole);
  if (lineNumber) return matchesLineNumber(anchor.text, lineNumber);

  const anchorType = getAnchorType(finding, anchor, "line", estimateRole);
  if (anchorType === "page_fallback") return false;
  if (anchorType === "totals") return /total|labor rate|paint supplies|paint materials|body labor|paint labor/i.test(anchor.text);
  if (anchorType === "supplier") return /supplier|alternate|a\/m|aftermarket|capa|lkq|oem/i.test(anchor.text);
  if (anchorType === "note") return /note|required|not correct|available upon request|via this link|report/i.test(anchor.text);
  if (anchorType === "section") return Boolean(getTargetSection(finding, estimateRole));
  if (
    (finding.carrierEvidence?.amount && anchor.normalizedText.includes(normalizeMoney(finding.carrierEvidence.amount))) ||
    (finding.shopEvidence?.amount && anchor.normalizedText.includes(normalizeMoney(finding.shopEvidence.amount)))
  ) {
    return sharedTermScore(normalizeMatchText(finding.operationLabel), anchor.normalizedText, 10) >= 3;
  }

  return sharedTermScore(normalizeMatchText(finding.operationLabel), anchor.normalizedText, 10) >= 8;
}

function isGenericOrMalformedAnchorText(value: string): boolean {
  return (
    /^\s*(?:repair operation|proc report|comparison or screenshot cues)\s*$/i.test(value) ||
    /\bproc\s+(?:pre|post)[-\s]?repair scanm\b/i.test(value) ||
    /\b(?:citation density gap report|annotation legend|unanchored citation density|disclosure|privacy|estimate summary only|disclaimer|abbreviations?|motor guide|guide pages)\b/i.test(value) ||
    /\bmotor\b.*\b(?:database|guide|included|not included)\b/i.test(value)
  );
}

function scoreAnchor(
  finding: CitationDensityFinding,
  anchor: TextAnchor,
  estimateRole: "carrier" | "shop" | "selected"
): number {
  const roleAnchor =
    estimateRole === "shop"
      ? finding.shopAnchor
      : estimateRole === "carrier"
        ? finding.carrierAnchor
        : finding.carrierAnchor ?? finding.shopAnchor;
  const roleEvidence =
    estimateRole === "shop"
      ? finding.shopEvidence
      : estimateRole === "carrier"
        ? finding.carrierEvidence
        : finding.carrierEvidence ?? finding.shopEvidence;
  const primaryEvidence = roleEvidence ?? roleAnchor;
  const secondaryEvidence = roleAnchor
    ? null
    : estimateRole === "shop"
      ? finding.carrierEvidence
      : estimateRole === "carrier"
        ? finding.shopEvidence
        : finding.shopEvidence ?? finding.carrierEvidence;
  const evidence = [primaryEvidence, secondaryEvidence].filter(Boolean);
  const anchorText = anchor.normalizedText;
  let score = 0;

  for (const item of evidence) {
    if (item?.lineNumber && matchesLineNumber(anchor.text, item.lineNumber)) {
      score += item === primaryEvidence ? 125 : 82;
    }
    if (item?.description) {
      const description = normalizeMatchText(item.description);
      if (description && (anchorText.includes(description) || description.includes(anchorText))) {
        score += item === primaryEvidence ? 95 : 55;
      }
      score += sharedTermScore(description, anchorText, 42);
      score += keyTokenScore(description, anchorText, 34);
    }
    if (typeof item?.amount === "number" && anchorText.includes(normalizeMoney(item.amount))) {
      score += 18;
    }
    if (typeof item?.laborHours === "number" && anchorText.includes(String(item.laborHours))) {
      score += 14;
    }
  }

  const operation = normalizeMatchText(finding.operationLabel);
  score += sharedTermScore(operation, anchorText, 34);
  score += keyTokenScore(operation, anchorText, 38);
  if (anchorText.includes(operation) || operation.includes(anchorText)) score += 50;
  score += scoreSectionAffinity(finding, anchor, estimateRole);
  if (anchor.groupedLine) score += 8;
  return score;
}

function drawFindingAnnotation(
  pdfDoc: PDFDocument,
  page: PDFPage,
  match: MatchedFinding,
  number: number,
  options: {
    mode: AnnotationMode;
    font: PDFFont;
    boldFont: PDFFont;
    estimateRole: "carrier" | "shop" | "selected";
    redactSensitive: boolean;
    trace: CitationDensityDebugTrace;
    reportIdentity: AnnotatedEstimateReportIdentity;
  }
) {
  const { anchor, finding } = match;
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const rotation = normalizeRotation(page.getRotation().angle);
  const highlightRect = buildPdfRectFromTopLeftAnchor(anchor, { pdfWidth: pageWidth, pdfHeight: pageHeight, rotation }, 0);
  const pdfLibRect = topLeftRectToPdfLibRect(highlightRect, { pdfWidth: pageWidth, pdfHeight: pageHeight, rotation });
  if (highlightRect.width <= 0 || highlightRect.height <= 0 || Number.isNaN(pdfLibRect.x) || Number.isNaN(pdfLibRect.y)) {
    const reason = `invalid render rect for anchor ${anchor.anchorId}`;
    options.trace.rendererDrops.push({ findingId: finding.id, anchorId: anchor.anchorId, reason });
    return { written: false as const, reason };
  }
  if (anchor.pageNumber < 1 || anchor.pageNumber > pdfDoc.getPageCount()) {
    const reason = `invalid pageIndex ${anchor.pageNumber - 1}`;
    options.trace.rendererDrops.push({ findingId: finding.id, anchorId: anchor.anchorId, reason });
    return { written: false as const, reason };
  }
  const label = getProofBucketLabel(finding);
  const shortTitle = formatShortIssueTitle(finding);
  const metadata = buildAnnotationMetadata(finding, anchor, number, label, shortTitle, {
    x: highlightRect.x,
    y: highlightRect.y,
    width: highlightRect.width,
    height: highlightRect.height,
    xPct: highlightRect.xPct,
    yPct: highlightRect.yPct,
    wPct: highlightRect.wPct,
    hPct: highlightRect.hPct,
    pageWidth,
    pageHeight,
    rotation,
    estimateRole: options.estimateRole,
    redactSensitive: options.redactSensitive,
    reportIdentity: options.reportIdentity,
  });

  if (options.mode === "inline_highlight" || options.mode === "both") {
    page.drawRectangle({
      x: pdfLibRect.x,
      y: pdfLibRect.y,
      width: pdfLibRect.width,
      height: pdfLibRect.height,
      color: rgb(1, 0.9, 0.3),
      opacity: 0.1,
    });
  }

  if (options.mode === "margin_callouts" || options.mode === "both") {
    drawCompactMarker(page, {
      number,
      anchorX: anchor.x,
      highlightX: pdfLibRect.x,
      highlightY: pdfLibRect.y,
      pageWidth,
      font: options.font,
      boldFont: options.boldFont,
    });
  }

  attachPdfFindingAnnotations(pdfDoc, page, metadata, options.reportIdentity);
  return { written: true as const, metadata };
}

function drawCompactMarker(
  page: PDFPage,
  options: {
    number: number;
    anchorX: number;
    highlightX: number;
    highlightY: number;
    pageWidth: number;
    font: PDFFont;
    boldFont: PDFFont;
  }
) {
  const markerX = options.anchorX > 56
    ? clamp(options.highlightX - 18, 8, options.pageWidth - 28)
    : clamp(options.highlightX + 4, 8, options.pageWidth - 28);
  const markerY = options.highlightY + 2;
  page.drawEllipse({
    x: markerX + 7,
    y: markerY + 7,
    xScale: 7,
    yScale: 7,
    color: rgb(0.72, 0.12, 0.1),
    opacity: 0.95,
  });
  page.drawText(String(options.number), {
    x: markerX + (options.number < 10 ? 4.6 : 2.2),
    y: markerY + 3.2,
    size: 7,
    font: options.boldFont,
    color: rgb(1, 1, 1),
  });
}

function attachPdfFindingAnnotations(
  pdfDoc: PDFDocument,
  page: PDFPage,
  metadata: CitationDensityAnnotationMetadata,
  reportIdentity: AnnotatedEstimateReportIdentity = CITATION_DENSITY_REPORT_IDENTITY
) {
  const annots = page.node.Annots() ?? pdfDoc.context.obj([]);
  page.node.set(PDFName.Annots, annots);
  const pageRef = page.ref;
  const pdfLibRect = topLeftRectToPdfLibRect(metadata, {
    pdfWidth: metadata.pdfPageWidth,
    pdfHeight: metadata.pdfPageHeight,
    rotation: metadata.rotation,
  });
  const rect = [
    pdfLibRect.x,
    pdfLibRect.y,
    pdfLibRect.x + pdfLibRect.width,
    pdfLibRect.y + pdfLibRect.height,
  ];
  const quadPoints = [
    pdfLibRect.x,
    pdfLibRect.y + pdfLibRect.height,
    pdfLibRect.x + pdfLibRect.width,
    pdfLibRect.y + pdfLibRect.height,
    pdfLibRect.x,
    pdfLibRect.y,
    pdfLibRect.x + pdfLibRect.width,
    pdfLibRect.y,
  ];
  const highlightRef = addPdfAnnotation(pdfDoc, pageRef, {
    Type: "Annot",
    Subtype: "Highlight",
    Rect: rect,
    QuadPoints: quadPoints,
    C: [1, 0.88, 0.22],
    CA: 0.36,
    T: PDFHexString.fromText(reportIdentity.pdfAnnotationTitle),
    Contents: PDFHexString.fromText(metadata.comment),
    NM: PDFHexString.fromText(`citation-density-${sanitizePdfAnnotationName(metadata.findingId)}-${sanitizePdfAnnotationName(metadata.anchorId)}-highlight`),
    M: PDFHexString.fromText(formatPdfDate(new Date())),
    F: 4,
  });
  annots.push(highlightRef);
}

function addPdfAnnotation(
  pdfDoc: PDFDocument,
  pageRef: PDFRef,
  values: Record<string, unknown>
) {
  const dict = pdfDoc.context.obj({
    ...values,
    P: pageRef,
  });
  return pdfDoc.context.register(dict);
}

function buildAnnotationMetadata(
  finding: CitationDensityFinding,
  anchor: EstimateRowAnchor,
  number: number,
  label: string,
  shortTitle: string,
  options: {
    x: number;
    y: number;
    width: number;
    height: number;
    xPct: number;
    yPct: number;
    wPct: number;
    hPct: number;
    pageWidth: number;
    pageHeight: number;
    rotation: 0 | 90 | 180 | 270;
    estimateRole: "carrier" | "shop" | "selected";
    redactSensitive: boolean;
    reportIdentity?: AnnotatedEstimateReportIdentity;
  }
): CitationDensityAnnotationMetadata {
  const sanitize = (value: string) => {
    const text = normalizeSourceBoundaryText(value.replace(/\s+/g, " ").trim());
    return options.redactSensitive ? redactAnnotationText(text) : text;
  };
  const sourceRefs = formatAnnotationSourceRefs(finding).map(sanitize);
  const bestAuthority = sanitize(formatBestAuthority(finding));
  const sourceDocumentRole = anchor.sourceDocumentRole;
  const findingSourceDocumentId = getSourceDocumentId(finding, sourceDocumentRole);
  const sourceDocumentId = findingSourceDocumentId || anchor.sourceDocumentId;
  const targetRawText = sanitize(getAnchorSourceText(anchor) || formatEstimateLineForCallout(finding, options.estimateRole));
  const metadata: CitationDensityAnnotationMetadata = {
    findingId: finding.id,
    anchorId: anchor.anchorId,
    sourceAnchorId: anchor.anchorId,
    sourceDocumentId,
    sourceDocumentRole,
    sourcePdfPageNumber: anchor.pageNumber,
    sourcePageNumber: anchor.pageNumber,
    sourceLineNumber: anchor.lineNumber ?? undefined,
    sourceAnchorType: anchor.anchorType,
    sourceAnchorText: targetRawText,
    sourceAnchorNormalizedText: anchor.normalizedRowText,
    sourceAnchorOperation: anchor.operation,
    sourceAnchorDescription: anchor.description,
    sourceAnchorPartNumber: anchor.partNumber,
    sourceAnchorQty: anchor.qty,
    sourceAnchorPrice: anchor.price,
    sourceAnchorLabor: anchor.labor,
    sourceAnchorPaint: anchor.paint,
    sourceAnchorPdfBoundingBox: anchor.pdfBoundingBox,
    sourceAnchorPdfQuad: anchor.pdfQuad,
    sourceAnchorNormalizedUiRect: anchor.normalizedUiRect,
    markerNumber: number,
    pageNumber: anchor.pageNumber,
    pdfPageWidth: normalizePdfRect({ x: 0, y: 0, width: options.pageWidth, height: options.pageHeight }, { pdfWidth: options.pageWidth, pdfHeight: options.pageHeight }).width,
    pdfPageHeight: normalizePdfRect({ x: 0, y: 0, width: options.pageWidth, height: options.pageHeight }, { pdfWidth: options.pageWidth, pdfHeight: options.pageHeight }).height,
    rotation: options.rotation,
    x: options.x,
    y: options.y,
    width: options.width,
    height: options.height,
    xPct: options.xPct,
    yPct: options.yPct,
    wPct: options.wPct,
    hPct: options.hPct,
    coordinateSpace: "pdf-points",
    targetLineNumber: anchor.lineNumber ?? getTargetLineNumber(finding, options.estimateRole),
    targetSection: anchor.section || getTargetSection(finding, options.estimateRole),
    targetRawText,
    targetNormalizedText: anchor.normalizedRowText,
    matchConfidence: getMatchConfidence(anchor),
    anchorType: anchor.anchorType,
    label,
    shortTitle,
    estimateLine: sanitize(formatEstimateLineForCallout(finding, options.estimateRole)),
    bestAuthority,
    authorityStatus: finding.bestAvailableAuthority?.status ?? label,
    missingProof: sanitize(finding.missingProofSummary),
    whyItMatters: sanitize(finding.currentSupportSummary || buildRoleCalloutNote(finding, options.estimateRole)),
    nextAction: sanitize(finding.recommendedNextAction),
    authorityNeeded: finding.authorityNeeded,
    authorityType: finding.authorityType,
    retrievalAttempted: finding.retrievalAttempted,
    retrievalSourcesSearched: finding.retrievalSourcesSearched,
    retrievalStatus: finding.retrievalStatus,
    matchedDocumentTitle: finding.matchedDocumentTitle ? sanitize(finding.matchedDocumentTitle) : finding.matchedDocumentTitle,
    matchedDocumentUrl: finding.matchedDocumentUrl ? sanitize(finding.matchedDocumentUrl) : finding.matchedDocumentUrl,
    sourceExcerpt: finding.sourceExcerpt ? sanitize(finding.sourceExcerpt) : finding.sourceExcerpt,
    sourcePageLine: finding.sourcePageLine ? sanitize(finding.sourcePageLine) : finding.sourcePageLine,
    appliesToShopEstimate: finding.appliesToShopEstimate,
    appliesToCarrierEstimate: finding.appliesToCarrierEstimate,
    lineTieStatus: finding.lineTieStatus,
    nextActionOwner: finding.nextActionOwner,
    sourceRefs,
    comment: "",
  };
  metadata.comment = buildPdfCommentBody(metadata, finding, options.estimateRole, options.redactSensitive, options.reportIdentity);
  return metadata;
}

function getTargetLineNumber(
  finding: CitationDensityFinding,
  estimateRole: "carrier" | "shop" | "selected"
) {
  if (estimateRole === "shop") return finding.shopEvidence?.lineNumber || finding.shopAnchor?.lineNumber || undefined;
  if (estimateRole === "carrier") return finding.carrierEvidence?.lineNumber || finding.carrierAnchor?.lineNumber || undefined;
  return finding.carrierEvidence?.lineNumber || finding.carrierAnchor?.lineNumber || finding.shopEvidence?.lineNumber || finding.shopAnchor?.lineNumber || undefined;
}

function getTargetSection(
  finding: CitationDensityFinding,
  estimateRole: "carrier" | "shop" | "selected"
) {
  const anchor = estimateRole === "shop"
    ? finding.shopAnchor
    : estimateRole === "carrier"
      ? finding.carrierAnchor
      : finding.carrierAnchor ?? finding.shopAnchor;
  return anchor?.section || undefined;
}

function getSourceDocumentId(
  finding: CitationDensityFinding,
  sourceDocumentRole: CitationDensityAnnotationMetadata["sourceDocumentRole"]
) {
  if (sourceDocumentRole === "carrier") {
    return finding.carrierAnchor?.sourceDocumentId || finding.embeddedEstimateLinks?.find((link) => link.estimateRole === "carrier")?.sourceDocumentId;
  }
  if (sourceDocumentRole === "shop") {
    return finding.shopAnchor?.sourceDocumentId || finding.embeddedEstimateLinks?.find((link) => link.estimateRole === "shop")?.sourceDocumentId;
  }
  return finding.carrierAnchor?.sourceDocumentId || finding.embeddedEstimateLinks?.find((link) => link.estimateRole === "carrier")?.sourceDocumentId;
}

function getMatchConfidence(anchor: EstimateRowAnchor): "high" | "medium" | "low" {
  if (anchor.synthetic) return "medium";
  if (anchor.confidence >= 0.9) return "high";
  return anchor.confidence >= 0.82 ? "medium" : "low";
}

function getAnchorType(
  finding: CitationDensityFinding,
  anchor: TextAnchor,
  matchKind: "line" | "page",
  estimateRole: "carrier" | "shop" | "selected"
): "exact_line" | "description" | "note" | "amount" | "section" | "totals" | "supplier" | "page_fallback" {
  if (matchKind === "page") return "page_fallback";
  const lineNumber = getTargetLineNumber(finding, estimateRole);
  if (lineNumber && matchesLineNumber(anchor.text, lineNumber)) return "exact_line";
  const text = normalizeMatchText(anchor.text);
  if (/\btotal|subtotal|net cost|grand total|paint supplies|labor summary|body labor|paint labor|mechanical labor\b/.test(text)) return "totals";
  if (/\bsupplier|alternate|a m|aftermarket|part|oem\b/.test(text)) return "supplier";
  if (/\bnote|remark|message\b/.test(text)) return "note";
  if (/\$?\d[\d,.]*|\b\d+(?:\.\d+)?\s*(?:hrs?|hours)\b/.test(anchor.text)) return "amount";
  if (getTargetSection(finding, estimateRole)) return "section";
  return "description";
}

function buildPdfCommentBody(
  metadata: CitationDensityAnnotationMetadata,
  finding: CitationDensityFinding,
  estimateRole: "carrier" | "shop" | "selected",
  redactSensitive: boolean,
  reportIdentity: AnnotatedEstimateReportIdentity = CITATION_DENSITY_REPORT_IDENTITY
) {
  const lines = buildCalloutLines(finding, metadata.markerNumber, metadata.label, redactSensitive, estimateRole, reportIdentity);
  return [
    `Finding #${metadata.markerNumber}: ${metadata.shortTitle}`,
    `Finding id: ${metadata.findingId}`,
    `Anchor id: ${metadata.anchorId}`,
    ...lines.slice(1),
    metadata.sourceRefs.length ? `Source refs: ${metadata.sourceRefs.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}

function sanitizePdfAnnotationName(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "anchor";
}

function formatShortIssueTitle(finding: CitationDensityFinding) {
  const evidence = finding.carrierEvidence ?? finding.shopEvidence;
  return truncateText(evidence?.description || finding.operationLabel || "Citation Density finding", 48);
}

function formatAnnotationSourceRefs(finding: CitationDensityFinding) {
  const refs = [
    finding.carrierEvidence?.sourceLabel,
    finding.shopEvidence?.sourceLabel,
    finding.bestAvailableAuthority?.title,
    ...formatEmbeddedLinkLines(finding),
  ].filter((value): value is string => Boolean(value && value.trim()));
  return [...new Set(refs)].slice(0, 6);
}

function formatPdfDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function truncateText(value: string, maxLength: number) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function addLegendPage(
  pdfDoc: PDFDocument,
  options: { font: PDFFont; boldFont: PDFFont; reportIdentity?: AnnotatedEstimateReportIdentity }
) {
  const reportIdentity = options.reportIdentity ?? CITATION_DENSITY_REPORT_IDENTITY;
  const page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  page.drawText(reportIdentity.legendTitle, {
    x: 48,
    y: height - 58,
    size: 18,
    font: options.boldFont,
    color: rgb(0.12, 0.14, 0.18),
  });
  drawWrappedLines(page, [
    SOURCE_BOUNDARY_TEXT,
    CCC_SOURCE_BOUNDARY_TEXT,
    CCC_LIMITATION_TEXT,
  ], {
    x: 48,
    y: height - 84,
    width: width - 96,
    font: options.font,
    boldFont: options.boldFont,
    size: 10,
    lineHeight: 13,
    maxLines: 8,
  });

  let y = height - 178;
  for (const label of LABELS) {
    page.drawRectangle({
      x: 48,
      y: y - 3,
      width: 16,
      height: 10,
      color: rgb(1, 0.9, 0.3),
      opacity: 0.35,
    });
    page.drawText(label, {
      x: 74,
      y,
      size: 11,
      font: options.boldFont,
      color: rgb(0.12, 0.14, 0.18),
    });
    y -= 24;
  }
}

function addNoLineAnchorWarningPage(
  pdfDoc: PDFDocument,
  options: { font: PDFFont; boldFont: PDFFont; message: string; pageCalloutCount: number; appendixCount: number }
) {
  const page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  page.drawText(options.message, {
    x: 48,
    y: height - 58,
    size: 14,
    font: options.boldFont,
    color: rgb(0.68, 0.2, 0.16),
  });
  drawWrappedLines(page, [
    options.message,
    `Page-level callouts placed on original estimate pages: ${options.pageCalloutCount}.`,
    `Findings appended in the unanchored appendix: ${options.appendixCount}.`,
    "Review the highlighted sections and appendix before relying on these findings.",
  ], {
    x: 48,
    y: height - 92,
    width: width - 96,
    font: options.font,
    boldFont: options.boldFont,
    size: 10,
    lineHeight: 14,
    maxLines: 16,
  });
}

function addSummaryPage(
  pdfDoc: PDFDocument,
  options: {
    font: PDFFont;
    boldFont: PDFFont;
    annotatedCount: number;
    unresolvedCount: number;
    warnings: string[];
  }
) {
  const page = pdfDoc.addPage();
  const { height } = page.getSize();
  page.drawText("Annotated Estimate Summary", {
    x: 48,
    y: height - 58,
    size: 18,
    font: options.boldFont,
  });
  drawWrappedLines(page, [
    `Annotated findings: ${options.annotatedCount}`,
    `Unresolved anchors: ${options.unresolvedCount}`,
    ...options.warnings,
  ], {
    x: 48,
    y: height - 92,
    width: 500,
    font: options.font,
    boldFont: options.boldFont,
    size: 10,
    lineHeight: 14,
    maxLines: 30,
  });
}

function addCitationDensityFindingDetailPages(
  pdfDoc: PDFDocument,
  details: FindingDetail[],
  options: {
    font: PDFFont;
    boldFont: PDFFont;
    sourcePdfName?: string;
    sourcePdfHash?: string;
    buildCommit?: string;
    reportIdentity?: AnnotatedEstimateReportIdentity;
  }
) {
  const detailLayoutBlocks: NonNullable<CitationDensityDebugTrace["detailLayoutBlocks"]> = [];
  let nextDetailPageNumber = 1;

  details.forEach(({ finding, metadata }) => {
    let context = createFindingDetailLayoutContext(pdfDoc, {
      ...options,
      findingNumber: metadata.markerNumber,
      detailLayoutBlocks,
    }, nextDetailPageNumber);

    context = drawFindingDetailHeader(context, metadata);

    for (const field of buildFindingDetailFields(finding, metadata, options.reportIdentity ?? CITATION_DENSITY_REPORT_IDENTITY)) {
      context = drawWrappedDetailField(field.label, field.value, context);
    }
    nextDetailPageNumber = context.detailPageNumber + 1;
  });

  return detailLayoutBlocks;
}

type FindingDetailField = {
  label: string;
  value: string;
};

function buildFindingDetailFields(
  finding: CitationDensityFinding,
  metadata: CitationDensityAnnotationMetadata,
  reportIdentity: AnnotatedEstimateReportIdentity = CITATION_DENSITY_REPORT_IDENTITY
): FindingDetailField[] {
  return [
    { label: "Finding number", value: String(metadata.markerNumber) },
    { label: "Finding id", value: metadata.findingId },
    { label: "Issue", value: finding.operationLabel },
    { label: "Anchor id", value: metadata.anchorId },
    { label: "Label", value: metadata.label },
    { label: reportIdentity.scoreLabel, value: `${finding.citationDensityScore}/100` },
    { label: "Source estimate", value: `${metadata.sourceDocumentRole} estimate` },
    { label: "Source page", value: String(metadata.sourcePageNumber) },
    { label: "Source line", value: metadata.sourceLineNumber ?? "section" },
    { label: "Source row text", value: metadata.sourceAnchorText },
    { label: "Best authority", value: metadata.bestAuthority },
    { label: "Missing proof", value: metadata.missingProof },
    { label: "Why it matters", value: metadata.whyItMatters },
    { label: "Next action", value: metadata.nextAction },
    { label: "Support refs", value: metadata.sourceRefs.length ? metadata.sourceRefs.join("; ") : "none listed" },
    { label: "Source", value: `page ${metadata.sourcePageNumber}, line ${metadata.sourceLineNumber ?? "section"}` },
  ];
}

type FindingDetailLayoutContext = {
  pdfDoc: PDFDocument;
  page: PDFPage;
  pageIndex: number;
  findingNumber: number;
  detailPageNumber: number;
  currentY: number;
  marginLeft: number;
  marginRight: number;
  topY: number;
  bottomY: number;
  fieldWidth: number;
  headingSize: number;
  findingHeaderSize: number;
  labelSize: number;
  bodySize: number;
  lineHeight: number;
  fieldGap: number;
  sectionGap: number;
  font: PDFFont;
  boldFont: PDFFont;
  sourcePdfName?: string;
  sourcePdfHash?: string;
  buildCommit?: string;
  reportIdentity: AnnotatedEstimateReportIdentity;
  detailLayoutBlocks: NonNullable<CitationDensityDebugTrace["detailLayoutBlocks"]>;
};

function createFindingDetailLayoutContext(
  pdfDoc: PDFDocument,
  options: {
    font: PDFFont;
    boldFont: PDFFont;
    sourcePdfName?: string;
    sourcePdfHash?: string;
    buildCommit?: string;
    reportIdentity?: AnnotatedEstimateReportIdentity;
    findingNumber: number;
    detailLayoutBlocks: NonNullable<CitationDensityDebugTrace["detailLayoutBlocks"]>;
  },
  detailPageNumber: number,
  continuationLabel?: string
): FindingDetailLayoutContext {
  const page = pdfDoc.addPage();
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const marginLeft = 54;
  const marginRight = 54;
  const headingSize = 18;
  const topY = pageHeight - 72;
  const context: FindingDetailLayoutContext = {
    pdfDoc,
    page,
    pageIndex: pdfDoc.getPageCount() - 1,
    findingNumber: options.findingNumber,
    detailPageNumber,
    currentY: topY,
    marginLeft,
    marginRight,
    topY,
    bottomY: 72,
    fieldWidth: pageWidth - marginLeft - marginRight,
    headingSize,
    findingHeaderSize: 13,
    labelSize: 8.5,
    bodySize: 8.5,
    lineHeight: 11,
    fieldGap: 5,
    sectionGap: 8,
    font: options.font,
    boldFont: options.boldFont,
    sourcePdfName: options.sourcePdfName,
    sourcePdfHash: options.sourcePdfHash,
    buildCommit: options.buildCommit,
    reportIdentity: options.reportIdentity ?? CITATION_DENSITY_REPORT_IDENTITY,
    detailLayoutBlocks: options.detailLayoutBlocks,
  };

  page.drawText(context.reportIdentity.detailTitle, {
    x: marginLeft,
    y: pageHeight - 54,
    size: headingSize,
    font: options.boldFont,
    color: rgb(0.12, 0.14, 0.18),
  });
  recordDetailLayoutBlock(context, "heading", pageHeight - 54 + headingSize, pageHeight - 54);
  if (continuationLabel) {
    page.drawText(continuationLabel, {
      x: marginLeft,
      y: topY,
      size: context.labelSize,
      font: options.boldFont,
      color: rgb(0.45, 0.1, 0.08),
    });
    recordDetailLayoutBlock(context, "continuation-header", topY + context.labelSize, topY);
    context.currentY -= context.lineHeight + context.fieldGap;
  }
  drawFindingDetailFooter(context);
  return context;
}

function drawFindingDetailHeader(
  context: FindingDetailLayoutContext,
  metadata: CitationDensityAnnotationMetadata
) {
  context = ensureDetailLineSpace(context);
  const headerY = context.currentY;
  context.page.drawText(`Finding ${metadata.markerNumber}`, {
    x: context.marginLeft,
    y: headerY,
    size: context.findingHeaderSize,
    font: context.boldFont,
    color: rgb(0.45, 0.1, 0.08),
  });
  context.page.drawText(`Source: page ${metadata.sourcePageNumber}, line ${metadata.sourceLineNumber ?? "section"}`, {
    x: context.marginLeft + 96,
    y: headerY + 1,
    size: context.bodySize,
    font: context.boldFont,
    color: rgb(0.28, 0.32, 0.38),
  });
  recordDetailLayoutBlock(context, "finding-header", headerY + context.findingHeaderSize, headerY);
  context.currentY -= context.lineHeight + context.sectionGap;
  return context;
}

function drawFindingDetailFooter(context: FindingDetailLayoutContext) {
  const hash = context.sourcePdfHash ? context.sourcePdfHash.slice(0, 10) : "unknown";
  const commit = context.buildCommit ? context.buildCommit.slice(0, 10) : "local";
  const source = normalizeDetailText(context.sourcePdfName || context.reportIdentity.sourcePdfFallbackName);
  const footer = `${context.reportIdentity.detailTitle} | page ${context.detailPageNumber} | ${source} | pdf ${hash} | build ${commit}`;
  context.page.drawText(footer, {
    x: context.marginLeft,
    y: 34,
    size: 7.5,
    font: context.font,
    color: rgb(0.35, 0.38, 0.43),
  });
  recordDetailLayoutBlock(context, "footer", 34 + 7.5, 34);
}

function drawWrappedDetailField(
  label: string,
  value: string,
  context: FindingDetailLayoutContext
) {
  const lines = wrapTextToWidth(normalizeDetailText(value), context.font, context.bodySize, context.fieldWidth);
  let nextContext = ensureDetailLineSpace(context);
  const labelText = `${label}:`;
  const labelY = nextContext.currentY;
  nextContext.page.drawText(labelText, {
    x: nextContext.marginLeft,
    y: labelY,
    size: nextContext.labelSize,
    font: nextContext.boldFont,
    color: rgb(0.12, 0.14, 0.18),
  });
  recordDetailLayoutBlock(nextContext, `field-label:${label}`, labelY + nextContext.labelSize, labelY);
  nextContext.currentY -= nextContext.lineHeight;

  for (const line of lines.length ? lines : [""]) {
    nextContext = ensureDetailLineSpace(nextContext);
    const lineY = nextContext.currentY;
    nextContext.page.drawText(line, {
      x: nextContext.marginLeft,
      y: lineY,
      size: nextContext.bodySize,
      font: nextContext.font,
      color: rgb(0.12, 0.14, 0.18),
    });
    recordDetailLayoutBlock(nextContext, `field-body:${label}`, lineY + nextContext.bodySize, lineY);
    nextContext.currentY -= nextContext.lineHeight;
  }
  nextContext.currentY -= nextContext.fieldGap;
  return nextContext;
}

function ensureDetailLineSpace(context: FindingDetailLayoutContext) {
  if (context.currentY - context.lineHeight >= context.bottomY) return context;
  return createFindingDetailLayoutContext(
    context.pdfDoc,
    context,
    context.detailPageNumber + 1,
    `Finding ${context.findingNumber} continued`
  );
}

function recordDetailLayoutBlock(
  context: FindingDetailLayoutContext,
  blockType: string,
  topY: number,
  bottomY: number
) {
  context.detailLayoutBlocks.push({
    findingNumber: context.findingNumber,
    pageIndex: context.pageIndex,
    blockType,
    topY: Math.round(topY * 100) / 100,
    bottomY: Math.round(bottomY * 100) / 100,
  });
}

function normalizeDetailText(value: string | number | null | undefined) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function wrapTextToWidth(text: string, font: PDFFont, fontSize: number, maxWidth: number) {
  const paragraphs = normalizeDetailText(text).split("\n");
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const pieces = splitWordToFitWidth(word, font, fontSize, maxWidth);
      for (const piece of pieces) {
        const candidate = line ? `${line} ${piece}` : piece;
        if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth || !line) {
          line = candidate;
        } else {
          lines.push(line);
          line = piece;
        }
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function splitWordToFitWidth(word: string, font: PDFFont, fontSize: number, maxWidth: number) {
  if (font.widthOfTextAtSize(word, fontSize) <= maxWidth) return [word];
  const pieces: string[] = [];
  let piece = "";
  for (const character of word) {
    const candidate = `${piece}${character}`;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth || !piece) {
      piece = candidate;
    } else {
      pieces.push(piece);
      piece = character;
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}

function addUnanchoredAppendix(
  pdfDoc: PDFDocument,
  findings: CitationDensityFinding[],
  options: {
    font: PDFFont;
    boldFont: PDFFont;
    estimateRole: "carrier" | "shop" | "selected";
    redactSensitive: boolean;
    reportIdentity?: AnnotatedEstimateReportIdentity;
  }
) {
  const reportIdentity = options.reportIdentity ?? CITATION_DENSITY_REPORT_IDENTITY;
  let page = pdfDoc.addPage();
  let y = page.getHeight() - 54;
  page.drawText(reportIdentity.unanchoredTitle, {
    x: 48,
    y,
    size: 18,
    font: options.boldFont,
  });
  y -= 28;

  findings.forEach((finding, index) => {
    const lines = buildCalloutLines(finding, index + 1, getProofBucketLabel(finding), options.redactSensitive, options.estimateRole, reportIdentity);
    if (y < 118) {
      page = pdfDoc.addPage();
      y = page.getHeight() - 54;
    }
    drawWrappedLines(page, lines, {
      x: 48,
      y,
      width: page.getWidth() - 96,
      font: options.font,
      boldFont: options.boldFont,
      size: 9,
      lineHeight: 12,
      maxLines: 8,
    });
    y -= 104;
  });
}

function buildCalloutLines(
  finding: CitationDensityFinding,
  number: number,
  label: string,
  redactSensitive: boolean,
  estimateRole: "carrier" | "shop" | "selected" = "selected",
  reportIdentity: AnnotatedEstimateReportIdentity = CITATION_DENSITY_REPORT_IDENTITY
) {
  const sanitize = (value: string) => {
    const text = normalizeSourceBoundaryText(value.replace(/\s+/g, " ").trim());
    return redactSensitive ? redactAnnotationText(text) : text;
  };

  return [
    `Finding #: ${number}`,
    `Label: ${label}`,
    `${reportIdentity.scoreCommentLabel}: ${finding.citationDensityScore}/100`,
    `Estimate line: ${sanitize(formatEstimateLineForCallout(finding, estimateRole))}`,
    `Best authority: ${sanitize(formatBestAuthority(finding))}`,
    ...formatEmbeddedLinkLines(finding).map((line) => `Estimate link: ${sanitize(line)}`),
    `Missing authority: ${sanitize(formatMissingAuthority(finding))}`,
    `Estimate note: ${sanitize(buildRoleCalloutNote(finding, estimateRole))}`,
    `Current support: ${sanitize(finding.currentSupportSummary)}`,
    `Missing proof: ${sanitize(finding.missingProofSummary)}`,
    ...finding.limitations
      .filter((line) => /anchor reject|visual anchor suppressed|unanchored/i.test(line))
      .slice(0, 2)
      .map((line) => `Anchor status: ${sanitize(line)}`),
    `Next action: ${sanitize(finding.recommendedNextAction)}`,
  ];
}

function formatEstimateLineForCallout(
  finding: CitationDensityFinding,
  estimateRole: "carrier" | "shop" | "selected"
) {
  const evidence = estimateRole === "shop"
    ? finding.shopEvidence ?? finding.shopAnchor ?? finding.carrierEvidence
    : estimateRole === "carrier"
      ? finding.carrierEvidence ?? finding.carrierAnchor ?? finding.shopEvidence
      : finding.carrierEvidence ?? finding.carrierAnchor ?? finding.shopEvidence ?? finding.shopAnchor;
  const linePrefix = evidence?.lineNumber ? `Line ${evidence.lineNumber}: ` : "";
  return `${linePrefix}${evidence?.description ?? finding.operationLabel}`;
}

function formatEmbeddedLinkLines(finding: CitationDensityFinding) {
  return (finding.embeddedEstimateLinks ?? [])
    .slice(0, 2)
    .map((link) => `${link.redactedUrl} (${link.retrievalStatus}; ${link.authorityStatus})`);
}

function getProofBucketLabel(finding: CitationDensityFinding): string {
  if (finding.citationLabel) {
    if (/^NEEDS ADAS$/i.test(finding.citationLabel) && !isAdasRelatedFinding(finding)) return fallbackNonAdasOemLabel(finding);
    if (/^NEEDS OEM$/i.test(finding.citationLabel) && !isOemHvRelatedFinding(finding)) return fallbackNonAdasOemLabel(finding);
    return finding.citationLabel;
  }
  if (finding.bestAvailableAuthority?.type === "online_fallback") return "ONLINE FALLBACK";
  if (finding.citationStatus.oem === "verified") return "VERIFIED OEM";
  if (finding.citationStatus.adas === "verified") return "VERIFIED ADAS";
  if (finding.citationStatus.stateRegulation === "verified" || finding.citationStatus.policy === "verified") return "VERIFIED LEGAL";
  if (
    finding.citationStatus.invoiceOrCompletionProof === "verified" ||
    finding.citationStatus.photoOrTeardownProof === "verified"
  ) {
    return "VERIFIED DOCUMENTATION";
  }
  if (Object.values(finding.citationStatus).some((value) => value === "referenced_not_produced")) return "REFERENCED / NOT PRODUCED";
  if (finding.estimateGapType === "referenced_not_produced") return "REFERENCED / NOT PRODUCED";
  if (finding.citationStatus.adas === "needed" && isAdasRelatedFinding(finding)) return "NEEDS ADAS";
  if (finding.estimateGapType === "weak_do_not_lead") return "WEAK — DO NOT LEAD";
  if (finding.citationStatus.invoiceOrCompletionProof === "needed") return "NEEDS INVOICE";
  if (isPPageDegMotorFinding(finding)) return "NEEDS P-PAGE";
  if (
    (finding.citationStatus.oem === "needed" || finding.missingAuthorityTypes.some((item) => /oem|high[-\s]?voltage|hv/i.test(item))) &&
    isOemHvRelatedFinding(finding)
  ) return "NEEDS OEM";
  if (finding.citationStatus.pPages === "needed" || finding.missingAuthorityTypes.some((item) => /p-?page/i.test(item))) return "NEEDS P-PAGE";
  return "ESTIMATE GAP ONLY";
}

function fallbackNonAdasOemLabel(finding: CitationDensityFinding) {
  if (Object.values(finding.citationStatus).some((value) => value === "referenced_not_produced")) return "REFERENCED / NOT PRODUCED";
  if (finding.estimateGapType === "referenced_not_produced") return "REFERENCED / NOT PRODUCED";
  if (finding.citationStatus.invoiceOrCompletionProof === "needed") return "NEEDS INVOICE";
  if (isPPageDegMotorFinding(finding)) return "NEEDS P-PAGE";
  if (finding.citationStatus.pPages === "needed" || finding.missingAuthorityTypes.some((item) => /p-?page|deg|motor/i.test(item))) return "NEEDS P-PAGE";
  return "ESTIMATE GAP ONLY";
}

function isAdasRelatedFinding(finding: CitationDensityFinding) {
  const text = [
    finding.category,
    finding.operationLabel,
    finding.carrierEvidence?.description,
    finding.shopEvidence?.description,
    finding.currentSupportSummary,
    finding.missingProofSummary,
    finding.recommendedNextAction,
  ].join(" ");
  const canonicalText = normalizeMatchText(text).split(" ").map(canonicalMatchToken).join(" ");
  if (isPPageDegMotorFinding(finding)) return false;
  return /\b(?:adas|calibration|calibrate|aim|scan|diagnostic|dtc|radar|camera|sensor|blind spot|lane|aeb|srs|airbag|restraint|initiali[sz]ation|programming|module|pre[-\s]?scan|post[-\s]?scan)\b/i.test(`${text} ${canonicalText}`);
}

function isOemHvRelatedFinding(finding: CitationDensityFinding) {
  if (isPartSourceFinding(finding)) return true;
  const text = [
    finding.category,
    finding.operationLabel,
    finding.carrierEvidence?.description,
    finding.shopEvidence?.description,
    finding.currentSupportSummary,
    finding.missingProofSummary,
    finding.recommendedNextAction,
    ...finding.missingAuthorityTypes,
  ].join(" ");
  if (isPPageDegMotorFinding(finding)) return false;
  return /\b(?:high[-\s]?voltage|hv\b|ev battery|battery charge|isolation|deactivate|activate|oem procedure|position statement|one[-\s]?time[-\s]?use|structural|substrate|aluminum|material rule|repair method|fit[-\s]?sensitive)\b/i.test(text);
}

function isPPageDegMotorFinding(finding: CitationDensityFinding) {
  const text = [
    finding.category,
    finding.operationLabel,
    finding.carrierEvidence?.description,
    finding.shopEvidence?.description,
    finding.currentSupportSummary,
    finding.missingProofSummary,
    finding.recommendedNextAction,
    ...finding.missingAuthorityTypes,
  ].join(" ");
  return /\b(?:finish sand|de[-\s]?nib|polish|mask|primer|refinish|paint|color|tint|pre[-\s]?wash|clean for delivery|adhesive|feather|prime|block|overlap|included|not included|database|manual entr|p-?page|deg|motor)\b/i.test(text);
}

function formatBestAuthority(finding: CitationDensityFinding) {
  const authority = finding.bestAvailableAuthority;
  if (!authority) {
    return "Estimate evidence only; no reviewed authority attached.";
  }
  return `${authority.title} (${authority.status}; ${authority.type}; ${authority.confidence} confidence)`;
}

function formatMissingAuthority(finding: CitationDensityFinding) {
  const missing = finding.missingAuthority?.length ? finding.missingAuthority : finding.missingAuthorityTypes;
  return missing.length ? missing.join(", ") : "None identified from current Citation Density review.";
}

function buildRoleCalloutNote(
  finding: CitationDensityFinding,
  estimateRole: "carrier" | "shop" | "selected"
) {
  const delta = buildEstimateDeltaText(finding);
  if (finding.crossEstimateIssue || finding.primaryAnnotationRole === "both" || finding.estimateGapType === "reduced_by_carrier") {
    return `Cross-estimate conflict. Carrier and shop estimates carry different labor/amount/scope. Reconcile with procedure support and completion proof.${delta}`;
  }
  if (estimateRole === "carrier") {
    if (finding.estimateGapType === "missing_from_carrier") {
      return "Missing or not located compared with shop estimate. Estimate evidence shows a difference, but OEM/P-page/invoice support has not yet been verified.";
    }
    return `Reduced or missing compared with shop estimate. Estimate evidence shows a difference, but OEM/P-page/invoice support has not yet been verified.${delta}`;
  }
  if (estimateRole === "shop") {
    if (finding.estimateGapType === "missing_from_carrier") {
      return "Not clearly carried on carrier estimate. Do not lead with this line until the missing OEM/P-page/invoice support is attached.";
    }
    return "Shop-added item. Do not lead with this line until the missing OEM/P-page/invoice support is attached.";
  }
  return "Estimate evidence shows a Citation Density issue. Verify authority and completion proof before leading with this item.";
}

function buildEstimateDeltaText(finding: CitationDensityFinding) {
  const amountDelta =
    typeof finding.shopEvidence?.amount === "number" && typeof finding.carrierEvidence?.amount === "number"
      ? ` Amount delta: ${formatSignedNumber(finding.shopEvidence.amount - finding.carrierEvidence.amount)}.`
      : "";
  const laborDelta =
    typeof finding.shopEvidence?.laborHours === "number" && typeof finding.carrierEvidence?.laborHours === "number"
      ? ` Labor delta: ${formatSignedNumber(finding.shopEvidence.laborHours - finding.carrierEvidence.laborHours)} hrs.`
      : "";
  const counterpart = finding.counterpartSummary ? ` ${finding.counterpartSummary}` : "";
  return `${amountDelta}${laborDelta}${counterpart}`;
}

function formatSignedNumber(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function redactAnnotationText(value: string): string {
  return normalizeSourceBoundaryText(redactDownloadContent(value))
    .replace(/\b[A-HJ-NPR-Z0-9]{11}\*{6}\b/g, "[REDACTED_VIN]")
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, "[REDACTED_VIN]")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_EMAIL]")
    .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[REDACTED_PHONE]")
    .replace(/\b\d{1,6}\s+[A-Za-z0-9 .'-]+\s+(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Boulevard|Ct|Court)\b\.?/gi, "[REDACTED_ADDRESS]");
}

function normalizeSourceBoundaryText(value: string) {
  return value
    .replace(/\bEstimate documentation the existence of a difference\.?/gi, "Estimate evidence supports the existence of a difference.")
    .replace(/\bCCC Secure Share documentation this estimate line was present in the structured estimate data\.?/gi, CCC_SOURCE_BOUNDARY_TEXT)
    .replace(/\bOEMdocumentation support\b/gi, "OEM/P-page/DEG/legal support")
    .replace(/\bBase Coatdocumentation\b/gi, "Base Coat support")
    .replace(/\b(OEM|P-page|DEG|legal)documentation\b/gi, "$1 support");
}

function drawWrappedLines(
  page: PDFPage,
  lines: string[],
  options: {
    x: number;
    y: number;
    width: number;
    font: PDFFont;
    boldFont: PDFFont;
    size: number;
    lineHeight: number;
    maxLines: number;
  }
) {
  let y = options.y;
  let drawn = 0;
  for (const line of lines) {
    const [label, ...rest] = line.split(":");
    const body = rest.join(":").trim();
    const wrapped = wrapText(body ? `${label}: ${body}` : label, options.font, options.size, options.width);
    for (const wrappedLine of wrapped) {
      if (drawn >= options.maxLines) return;
      const labelMatch = wrappedLine.match(/^([^:]{1,22}:)(.*)$/);
      if (labelMatch) {
        page.drawText(labelMatch[1], {
          x: options.x,
          y,
          size: options.size,
          font: options.boldFont,
          color: rgb(0.12, 0.14, 0.18),
        });
        page.drawText(labelMatch[2].trim(), {
          x: options.x + options.boldFont.widthOfTextAtSize(labelMatch[1], options.size) + 2,
          y,
          size: options.size,
          font: options.font,
          color: rgb(0.12, 0.14, 0.18),
        });
      } else {
        page.drawText(wrappedLine, {
          x: options.x,
          y,
          size: options.size,
          font: options.font,
          color: rgb(0.12, 0.14, 0.18),
        });
      }
      y -= options.lineHeight;
      drawn += 1;
    }
  }
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function normalizeMatchText(value: string) {
  return value
    .toLowerCase()
    .replace(/\ba\/m\b/g, " aftermarket ")
    .replace(/\bnon[-\s]?oem\b/g, " non oem ")
    .replace(/[^a-z0-9.$]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMoney(value: number) {
  return String(Math.round(value * 100) / 100).replace(/\.00$/, "");
}

function sharedTermScore(a: string, b: string, max: number) {
  const terms = a.split(" ")
    .map(canonicalMatchToken)
    .filter((term) => term.length > 2 && !/^\d+$/.test(term) && !COMMON_MATCH_TERMS.has(term));
  if (!terms.length) return 0;
  const haystack = new Set(b.split(" ").map(canonicalMatchToken));
  const matches = terms.filter((term) => haystack.has(term) || b.includes(term)).length;
  return Math.min(max, Math.round((matches / terms.length) * max));
}

function keyTokenScore(a: string, b: string, max: number) {
  const sourceTokens = buildKeyTokens(a);
  if (!sourceTokens.size) return 0;
  const targetTokens = buildKeyTokens(b);
  const sourceList = [...sourceTokens];
  const targetList = [...targetTokens];
  const matches = sourceList.filter((token) =>
    targetTokens.has(token) ||
    targetList.some((target) => token.length > 4 && (target.includes(token) || token.includes(target)))
  ).length;
  return Math.min(max, Math.round((matches / sourceList.length) * max));
}

function buildKeyTokens(value: string) {
  return new Set(
    normalizeMatchText(value)
      .split(" ")
      .map(canonicalMatchToken)
      .filter((term) =>
        term.length > 2 &&
        !/^\d+$/.test(term) &&
        !COMMON_MATCH_TERMS.has(term)
      )
  );
}

function canonicalMatchToken(value: string) {
  const token = value.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  if (!token) return "";
  const known = [
    "aftermarket",
    "alternate",
    "bumper",
    "cover",
    "reflector",
    "molding",
    "blind",
    "spot",
    "radar",
    "calibration",
    "initialization",
    "pre",
    "post",
    "repair",
    "scan",
    "adas",
    "revvadas",
    "corrosion",
    "protection",
    "mask",
    "jamb",
    "jambs",
    "color",
    "sand",
    "polish",
    "paint",
    "supplies",
    "materials",
    "refinish",
    "labor",
    "rate",
    "manual",
    "motor",
    "database",
    "included",
    "section",
    "note",
    "total",
  ];
  const directAlias: Record<string, string> = {
    "a": "",
    "m": "",
    "am": "aftermarket",
    "scanm": "scan",
    "spre": "pre",
    "spost": "post",
    "proc": "",
    "hrs": "hours",
    "lt": "left",
    "rt": "right",
  };
  if (directAlias[token] !== undefined) return directAlias[token];
  const embedded = known.find((item) =>
    token !== item &&
    token.length <= item.length + 3 &&
    token.includes(item)
  );
  return embedded ?? token.replace(/s$/, "");
}

function scoreSectionAffinity(
  finding: CitationDensityFinding,
  anchor: TextAnchor,
  estimateRole: "carrier" | "shop" | "selected"
) {
  const roleAnchor = estimateRole === "shop" ? finding.shopAnchor : estimateRole === "carrier" ? finding.carrierAnchor : null;
  const text = anchor.normalizedText;
  let score = 0;
  const section = normalizeMatchText(roleAnchor?.section ?? "");
  if (section) {
    if (text.includes(section) || section.includes(text)) score += 36;
    score += keyTokenScore(section, text, 22);
  }

  const operation = normalizeMatchText(`${finding.operationLabel} ${roleAnchor?.operation ?? ""}`);
  if (/scan|calibration|radar|initialization|adas/.test(operation) && /scan|calibration|diagnostic|adas|radar|electrical/.test(text)) {
    score += 22;
  }
  if (/aftermarket|bumper|cover|reflector|molding|part/.test(operation) && /parts|part|bumper|cover|reflector|molding|aftermarket|a m/.test(text)) {
    score += 22;
  }
  if (/refinish|paint|mask|jamb|sand|polish|material|suppl/.test(operation) && /refinish|paint|mask|jamb|sand|polish|material|suppl/.test(text)) {
    score += 22;
  }
  if (/corrosion|protection|seam|cavity|weld/.test(operation) && /corrosion|protection|seam|cavity|weld/.test(text)) {
    score += 22;
  }
  if (/total|labor|rate|paint/.test(operation) && /total|labor|rate|paint|suppl|material/.test(text)) {
    score += 18;
  }
  return score;
}

function matchesLineNumber(text: string, lineNumber: string) {
  const escaped = escapeRegex(lineNumber.trim());
  if (!escaped) return false;
  return new RegExp(`(^|\\D)${escaped}(\\D|$)`).test(text);
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

const COMMON_MATCH_TERMS = new Set([
  "line",
  "item",
  "estimate",
  "carrier",
  "shop",
  "proof",
  "needed",
  "needs",
  "support",
  "current",
  "missing",
  "action",
  "attach",
  "procedure",
  "invoice",
  "present",
]);

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pruneExportCache() {
  const cutoff = Date.now() - EXPORT_TTL_MS;
  for (const [id, entry] of exportCache.entries()) {
    if (entry.createdAt < cutoff) exportCache.delete(id);
  }
}

function getBuildCommit() {
  return process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT_SHA ||
    process.env.COMMIT_SHA ||
    "local";
}

function hashPdfBytes(bytes: Uint8Array) {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function truncateDebugText(value: string, maxLength = 500) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}
