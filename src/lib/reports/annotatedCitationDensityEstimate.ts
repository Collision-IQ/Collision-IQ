import { randomUUID } from "node:crypto";
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
import type { CitationDensityFinding } from "@/lib/ai/types/estimateScrubber";
import {
  buildPdfRectFromTopLeftAnchor,
  normalizePdfRect,
  normalizeRotation,
  topLeftRectToPdfLibRect,
} from "./citationDensityCoordinates";
import {
  extractPdfRowAnchors,
  findBestEstimateRowAnchorForFinding,
  type EstimateRowAnchor,
  type EstimateRowAnchorType,
} from "./citationDensityRowAnchors";

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
};

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

const exportCache = new Map<string, {
  bytes: Uint8Array;
  filename: string;
  createdAt: number;
  annotationMetadata: CitationDensityAnnotationMetadata[];
}>();
const EXPORT_TTL_MS = 30 * 60 * 1000;

export function putAnnotatedEstimateExport(
  bytes: Uint8Array,
  filename: string,
  annotationMetadata: CitationDensityAnnotationMetadata[] = []
) {
  pruneExportCache();
  const exportId = randomUUID();
  exportCache.set(exportId, { bytes, filename, createdAt: Date.now(), annotationMetadata });
  return exportId;
}

export function getAnnotatedEstimateExport(exportId: string) {
  pruneExportCache();
  return exportCache.get(exportId) ?? null;
}

export function dataUrlToPdfBytes(dataUrl: string): Uint8Array | null {
  const match = dataUrl.match(/^data:application\/pdf(?:;[^,]*)?;base64,(.+)$/i);
  if (!match) return null;
  return Uint8Array.from(Buffer.from(match[1], "base64"));
}

export async function buildAnnotatedCitationDensityEstimatePdf(params: {
  sourcePdfBytes: Uint8Array;
  sourceDocumentId?: string;
  sourceText?: string | null;
  findings: CitationDensityFinding[];
  request?: AnnotatedEstimateRequest;
}): Promise<AnnotatedEstimateResult> {
  const request = params.request ?? {};
  const mode = request.annotationMode ?? "both";
  const estimateRole = request.estimateRole ?? "selected";
  const selectedIds = new Set(request.findingIds?.filter(Boolean) ?? []);
  const selectedFindings = params.findings.filter((finding) => !selectedIds.size || selectedIds.has(finding.id));
  const { findings, suppressed } = sanitizeCitationDensityFindingsForVisibleLayer(selectedFindings);
  const warnings: string[] = [];
  const sourcePdfBytes = params.sourcePdfBytes.slice();
  const pdfDoc = await PDFDocument.load(sourcePdfBytes);
  const originalPageCount = pdfDoc.getPageCount();
  if (originalPageCount === 0) {
    throw new Error("Annotated Citation Density export requires an original estimate PDF with source pages.");
  }
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const sourceDocumentRole = estimateRole === "shop" ? "shop" : "carrier";
  const pdfAnchors = await extractPdfRowAnchors(sourcePdfBytes, {
    sourceDocumentRole,
    sourceDocumentId: params.sourceDocumentId,
  }).catch((error) => {
    warnings.push(
      `Text-coordinate extraction failed; findings were placed in the appendix. ${error instanceof Error ? error.message : "Unknown PDF text extraction error."}`
    );
    return [] as EstimateRowAnchor[];
  });
  const anchors = pdfAnchors;

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

  const candidateResult = buildAnchoredCitationCandidates({
    anchors,
    findings,
    topicFindings: selectedFindings,
    estimateRole,
    sourceDocumentRole,
  });
  debugMetadata.suppressedPageMismatchCount = candidateResult.suppressedPageMismatchCount;
  debugMetadata.findingsWithoutAnchorId = [
    ...suppressed.map((finding) => finding.id),
    ...candidateResult.findingsWithoutAnchorId,
  ];

  const matches: MatchedFinding[] = candidateResult.candidates.map((candidate) => ({
    finding: candidate.finding,
    anchor: candidate.anchor,
  }));
  const matchedFindingIds = new Set(candidateResult.candidates.map((candidate) => candidate.derivedFromFindingId).filter(Boolean));
  const unmatched: CitationDensityFinding[] = findings.filter((finding) => !matchedFindingIds.has(finding.id));

  const lineMatchCount = matches.length;
  if (findings.length > 0 && lineMatchCount === 0) {
    warnings.push(anchors.length ? NO_SAFE_ROW_FINDINGS_WARNING : NO_ROWS_EXTRACTED_WARNING);
    warnings.push("all_findings_unanchored");
  }
  if (suppressed.length > 0) {
    warnings.push(`${suppressed.length} generic or malformed Citation Density finding(s) were suppressed from the visible estimate layer.`);
  }

  const annotationMetadata: CitationDensityAnnotationMetadata[] = [];
  const findingDetails: FindingDetail[] = [];
  matches.forEach((match, index) => {
    const sourcePdfPageNumber = match.anchor.pageNumber;
    const page = pdfDoc.getPage(toSourcePdfPageIndex(sourcePdfPageNumber));
    const metadata = drawFindingAnnotation(pdfDoc, page, match, index + 1, {
      mode,
      font,
      boldFont,
      estimateRole,
      redactSensitive: request.redactSensitive !== false,
    });
    annotationMetadata.push(metadata);
    findingDetails.push({ finding: match.finding, metadata });
  });

  if (findingDetails.length > 0) {
    addCitationDensityFindingDetailPages(pdfDoc, findingDetails, {
      font,
      boldFont,
    });
  }

  if (findings.length > 0 && lineMatchCount === 0) {
    addNoLineAnchorWarningPage(pdfDoc, {
      font,
      boldFont,
      message: anchors.length ? NO_SAFE_ROW_FINDINGS_WARNING : NO_ROWS_EXTRACTED_WARNING,
      pageCalloutCount: matches.length,
      appendixCount: unmatched.length,
    });
  }

  if (request.includeLegend !== false) {
    addLegendPage(pdfDoc, { font, boldFont });
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
    });
  }

  const bytes = await pdfDoc.save();
  debugMetadata.visibleAnnotationCount = annotationMetadata.length;
  debugMetadata.appendixOnlyCount = unmatched.length;
  const exportId = putAnnotatedEstimateExport(
    bytes,
    "citation-density-annotated-estimate.pdf",
    annotationMetadata
  );
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
  };
}

function toSourcePdfPageIndex(sourcePdfPageNumber: number) {
  return Math.max(0, sourcePdfPageNumber - 1);
}

function buildAnchoredCitationCandidates(params: {
  anchors: EstimateRowAnchor[];
  findings: CitationDensityFinding[];
  topicFindings: CitationDensityFinding[];
  estimateRole: "carrier" | "shop" | "selected";
  sourceDocumentRole: "carrier" | "shop";
}): {
  candidates: AnchoredCitationCandidate[];
  suppressedPageMismatchCount: number;
  findingsWithoutAnchorId: string[];
} {
  const anchorIndex = new Map(params.anchors.map((anchor) => [anchor.anchorId, anchor]));
  const candidates: AnchoredCitationCandidate[] = [];
  const usedAnchorIds = new Set<string>();
  const matchedFindingIds = new Set<string>();
  let suppressedPageMismatchCount = 0;

  for (const finding of params.findings) {
    if (!hasConcreteFindingAnchor(finding)) continue;
    const anchor = findBestEstimateRowAnchorForFinding(finding, params.anchors, usedAnchorIds, params.estimateRole);
    if (!anchor) {
      continue;
    }
    const candidate = buildCandidateFromFinding(finding, anchor, params.estimateRole);
    const gate = gateAnchoredCitationCandidate(candidate, anchorIndex);
    if (gate === "allowed") {
      candidates.push(candidate);
      usedAnchorIds.add(anchor.anchorId);
      matchedFindingIds.add(finding.id);
    } else if (gate === "page_mismatch") {
      suppressedPageMismatchCount += 1;
    }
  }

  const hasConcreteRequestedFinding = params.findings.some(hasConcreteFindingAnchor);
  const rowBackedTopics = buildRowBackedCandidateTopics(params.topicFindings);
  if (!hasConcreteRequestedFinding && candidates.length === 0 && rowBackedTopics.size > 0) {
    for (const anchor of params.anchors) {
      if (usedAnchorIds.has(anchor.anchorId)) continue;
      const candidate = buildCandidateFromAnchor(anchor, params.sourceDocumentRole, rowBackedTopics);
      if (!candidate) continue;
      const gate = gateAnchoredCitationCandidate(candidate, anchorIndex);
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
    return {
      type: "totals_delta",
      topic: "totals",
      label: "ESTIMATE GAP ONLY",
      category: "not_included_operation",
      estimateGapType: "present_but_under_documented",
      adasStatus: "not_applicable",
      missingAuthorityTypes: ["CCC/MOTOR guide support"],
    };
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

  if (!normalized.trim()) return false;
  if (/\brepair operation\b|\bproc report\b|\bcomparison or screenshot cues\b/i.test(text)) return false;
  if (/\bgeneric visible damage photo observations\b|\bgeneric key visible estimate facts\b/i.test(text)) return false;
  if (/\bproc\s+(?:pre|post)[-\s]?repair scanm\b/i.test(text)) return false;
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
  }
) {
  const { anchor, finding } = match;
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const rotation = normalizeRotation(page.getRotation().angle);
  const highlightRect = buildPdfRectFromTopLeftAnchor(anchor, { pdfWidth: pageWidth, pdfHeight: pageHeight, rotation }, 0);
  const pdfLibRect = topLeftRectToPdfLibRect(highlightRect, { pdfWidth: pageWidth, pdfHeight: pageHeight, rotation });
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

  attachPdfFindingAnnotations(pdfDoc, page, metadata);
  return metadata;
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
  metadata: CitationDensityAnnotationMetadata
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
    T: PDFHexString.fromText("Collision IQ Citation Density"),
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
    sourceRefs,
    comment: "",
  };
  metadata.comment = buildPdfCommentBody(metadata, finding, options.estimateRole, options.redactSensitive);
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
  redactSensitive: boolean
) {
  const lines = buildCalloutLines(finding, metadata.markerNumber, metadata.label, redactSensitive, estimateRole);
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

function addLegendPage(pdfDoc: PDFDocument, options: { font: PDFFont; boldFont: PDFFont }) {
  const page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  page.drawText("Citation Density Annotation Legend", {
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
  }
) {
  let page = pdfDoc.addPage();
  let y = page.getHeight() - 54;
  page.drawText("Citation Density Finding Details", {
    x: 48,
    y,
    size: 18,
    font: options.boldFont,
    color: rgb(0.12, 0.14, 0.18),
  });
  y -= 30;

  details.forEach(({ finding, metadata }) => {
    const lines = buildFindingDetailLines(finding, metadata);
    const estimatedHeight = Math.min(lines.length, 14) * 12 + 30;
    if (y < Math.max(170, estimatedHeight)) {
      page = pdfDoc.addPage();
      y = page.getHeight() - 54;
      page.drawText("Citation Density Finding Details", {
        x: 48,
        y,
        size: 18,
        font: options.boldFont,
        color: rgb(0.12, 0.14, 0.18),
      });
      y -= 30;
    }

    page.drawText(`Finding ${metadata.markerNumber}`, {
      x: 48,
      y,
      size: 12,
      font: options.boldFont,
      color: rgb(0.45, 0.1, 0.08),
    });
    page.drawText(`Source: page ${metadata.sourcePageNumber}, line ${metadata.sourceLineNumber ?? "section"}`, {
      x: 126,
      y,
      size: 9,
      font: options.boldFont,
      color: rgb(0.28, 0.32, 0.38),
    });
    y -= 16;

    drawWrappedLines(page, lines, {
      x: 48,
      y,
      width: page.getWidth() - 96,
      font: options.font,
      boldFont: options.boldFont,
      size: 9,
      lineHeight: 12,
      maxLines: 18,
    });
    y -= Math.min(lines.length, 18) * 12 + 18;
  });
}

function buildFindingDetailLines(
  finding: CitationDensityFinding,
  metadata: CitationDensityAnnotationMetadata
) {
  return [
    `Finding number: ${metadata.markerNumber}`,
    `Label: ${metadata.label}`,
    `Citation Density score: ${finding.citationDensityScore}/100`,
    `Source estimate: ${metadata.sourceDocumentRole} estimate`,
    `Source page: ${metadata.sourcePageNumber}`,
    `Source line: ${metadata.sourceLineNumber ?? "section"}`,
    `Source row text: ${metadata.sourceAnchorText}`,
    `Best authority: ${metadata.bestAuthority}`,
    `Missing proof: ${metadata.missingProof}`,
    `Why it matters: ${metadata.whyItMatters}`,
    `Next action: ${metadata.nextAction}`,
    metadata.sourceRefs.length ? `Support refs: ${metadata.sourceRefs.join("; ")}` : "Support refs: none listed",
    `Source: page ${metadata.sourcePageNumber}, line ${metadata.sourceLineNumber ?? "section"}`,
  ];
}

function addUnanchoredAppendix(
  pdfDoc: PDFDocument,
  findings: CitationDensityFinding[],
  options: { font: PDFFont; boldFont: PDFFont; estimateRole: "carrier" | "shop" | "selected"; redactSensitive: boolean }
) {
  let page = pdfDoc.addPage();
  let y = page.getHeight() - 54;
  page.drawText("Unanchored Citation Density Findings", {
    x: 48,
    y,
    size: 18,
    font: options.boldFont,
  });
  y -= 28;

  findings.forEach((finding, index) => {
    const lines = buildCalloutLines(finding, index + 1, getProofBucketLabel(finding), options.redactSensitive, options.estimateRole);
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
  estimateRole: "carrier" | "shop" | "selected" = "selected"
) {
  const sanitize = (value: string) => {
    const text = normalizeSourceBoundaryText(value.replace(/\s+/g, " ").trim());
    return redactSensitive ? redactAnnotationText(text) : text;
  };

  return [
    `Finding #: ${number}`,
    `Label: ${label}`,
    `Citation Density: ${finding.citationDensityScore}/100`,
    `Estimate line: ${sanitize(formatEstimateLineForCallout(finding, estimateRole))}`,
    `Best authority: ${sanitize(formatBestAuthority(finding))}`,
    ...formatEmbeddedLinkLines(finding).map((line) => `Estimate link: ${sanitize(line)}`),
    `Missing authority: ${sanitize(formatMissingAuthority(finding))}`,
    `Estimate note: ${sanitize(buildRoleCalloutNote(finding, estimateRole))}`,
    `Current support: ${sanitize(finding.currentSupportSummary)}`,
    `Missing proof: ${sanitize(finding.missingProofSummary)}`,
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
  if (finding.citationStatus.adas === "needed" && isAdasRelatedFinding(finding)) return "NEEDS ADAS";
  if (finding.estimateGapType === "weak_do_not_lead") return "WEAK — DO NOT LEAD";
  if (finding.estimateGapType === "referenced_not_produced") return "REFERENCED / NOT PRODUCED";
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
