import type { CarrierReportDocument } from "./carrierPdfBuilder";
import {
  buildExportModel,
  resolveCanonicalInsurer,
  resolveCanonicalVehicleLabel,
  resolveCanonicalVin,
} from "./buildExportModel";
import {
  buildExportTemplateSourceModel,
  type ExportBuilderInput,
  type ExportLineComparison,
} from "./exportTemplates";
import type {
  CitationDensityFinding,
  CitationSupportStatus,
  EstimateScrubCitationGapBucket,
  EstimateScrubFinding,
  SourceCitation,
} from "@/lib/ai/types/estimateScrubber";
import type { RepairIntelligenceReport } from "@/lib/ai/types/analysis";
import type { EstimateComparisonRow } from "@/types/workspaceTypes";
import { normalizeWorkspaceEstimateComparisons } from "@/lib/workspace/estimateComparisons";
import {
  cleanEstimateLineForTechnicalExport,
  cleanOperationDisplayText,
  normalizeEstimateOperationLabel,
} from "@/lib/ui/presentationText";
import { CCC_WORKFILE_DISCLAIMER } from "@/lib/ccc/cccWorkfileClient";

export type AnnotatedEstimateAudience = "customer" | "estimator" | "admin";

export type EstimateAnnotationCategory =
  | "Missing operation"
  | "Under-documented operation"
  | "Reduced labor/material"
  | "Alternate/aftermarket part concern"
  | "Needs OEM procedure support"
  | "Needs P-page support"
  | "Needs invoice/proof"
  | "Needs supplement review"
  | "Informational repair-planning reminder";

export type EstimateAnnotationSeverity = "green" | "yellow" | "red" | "blue" | "gray";
export type EstimateAnnotationSupportStatus = "verified" | "referenced" | "inferred" | "missing";
export type CitationReadiness =
  | "citation_ready"
  | "estimate_evidence_only"
  | "needs_authority"
  | "needs_completion_proof"
  | "weak_do_not_lead";

export type EstimateLineAnchor = {
  estimateId: string;
  lineId: string;
  lineNumber: number;
  section: string;
  text: string;
  sourceRole: "carrier" | "shop" | "unknown";
};

export type EstimateAnnotation = {
  id: string;
  estimateId: string;
  lineId?: string;
  section?: string;
  category: EstimateAnnotationCategory;
  severity: EstimateAnnotationSeverity;
  title: string;
  explanation: string;
  recommendedAction: string;
  customerText: string;
  estimatorText: string;
  supportStatus: EstimateAnnotationSupportStatus;
  citationGapBucket: EstimateScrubCitationGapBucket;
  citationDensityScore: number;
  citationReadiness: CitationReadiness;
  citationFinding: CitationDensityFinding;
  sourceRefs: string[];
  visibility: {
    customer: boolean;
    estimator: boolean;
    admin: boolean;
  };
  anchorText: string;
  shopLine?: string;
  carrierLine?: string;
  difference?: string;
};

export type AnnotatedEstimateReviewModel = {
  estimateId: string;
  citationDensityFindings: CitationDensityFinding[];
  lineAnchors: EstimateLineAnchor[];
  annotations: EstimateAnnotation[];
  comparisonRows: EstimateComparisonRow[];
  scrubTarget: {
    role: "carrier" | "shop" | "unknown";
    label: string;
    basis: string;
    lowerCostTotal?: number;
    higherCostTotal?: number;
  };
  generatedLabel: string;
  vehicleIdentity: string;
  vin: string;
  insurer?: string | null;
};

export function buildEstimateScrubberPdf(params: ExportBuilderInput): CarrierReportDocument {
  return buildAnnotatedEstimateReviewPdf(params, { audience: "estimator" });
}

export function buildAnnotatedEstimateReviewPdf(
  params: ExportBuilderInput,
  options: { audience?: AnnotatedEstimateAudience } = {}
): CarrierReportDocument {
  const audience = options.audience ?? "customer";
  const model = buildAnnotatedEstimateReviewModel(params);
  const annotations = filterAnnotationsForAudience(model.annotations, audience);
  const redCount = annotations.filter((item) => item.severity === "red").length;
  const yellowCount = annotations.filter((item) => item.severity === "yellow").length;
  const blueCount = annotations.filter((item) => item.severity === "blue").length;

  return buildAnnotatedEstimateDocument({
    model,
    annotations,
    audience,
    filename: "citation-density-gap-report.pdf",
    title: "Citation Density Gap Report",
    reportLabel: "Citation Density Gap Report",
    subtitle:
      "Estimate gaps ranked by repair impact, citation readiness, and missing proof.",
    sections: [
      {
        title: "1. Bottom Line",
        bullets: buildCitationBottomLineBullets(model),
      },
      {
        title: "2. Citation Density Score",
        bullets: buildCitationDensityScoreBullets(model.citationDensityFindings),
      },
      {
        title: "3. Highest-Priority Gaps",
        bullets: buildHighestPriorityGapRows(model.citationDensityFindings),
      },
      {
        title: "4. Authority Matrix",
        bullets: buildAuthorityMatrixRows(model.citationDensityFindings),
      },
      {
        title: "5. Supplement-Ready Items",
        bullets: buildSupplementReadyBullets(model.citationDensityFindings),
      },
      {
        title: "6. Proof Needed Before Leading With This",
        bullets: buildProofNeededBeforeLeadingBullets(model.citationDensityFindings),
      },
      {
        title: "7. Weak / Do Not Lead",
        bullets: buildWeakDoNotLeadBullets(model.citationDensityFindings),
      },
      {
        title: "8. Source Boundary",
        bullets: buildSourceBoundaryBullets(),
      },
    ],
    redCount,
    yellowCount,
    blueCount,
  });
}

export function buildEstimatorChangeRequestListPdf(
  params: ExportBuilderInput,
  options: { audience?: AnnotatedEstimateAudience } = {}
): CarrierReportDocument {
  const audience = options.audience ?? "estimator";
  const model = buildAnnotatedEstimateReviewModel(params);
  const annotations = filterAnnotationsForAudience(model.annotations, audience);

  const deltaSections = buildEstimateDeltaSections(model.comparisonRows);

  return buildAnnotatedEstimateDocument({
    model,
    annotations,
    audience,
    filename: "estimate-delta-change-requests.pdf",
    title: "Estimate Delta / Change Requests",
    reportLabel: "Estimate Delta / Change Requests",
    subtitle:
      "Short find-the-differences report for added, missing, and changed estimate items.",
    summary: buildEstimateDeltaSummary(model),
    sections: deltaSections,
    footer: [
      "Estimate delta only. Verify any unclear line against the source estimates before sending.",
    ],
  });
}

export function buildAnnotatedEstimateReviewModel(params: ExportBuilderInput): AnnotatedEstimateReviewModel {
  const source = buildExportTemplateSourceModel(params);
  const { exportModel } = source;
  const findings = buildEstimateScrubFindings(exportModel);
  const lineAnchors = buildEstimateLineAnchors(params, source.lineItems);
  const comparisonRows = normalizeWorkspaceEstimateComparisons(
    params.workspaceData?.estimateComparisons ?? params.analysis?.estimateComparisons ?? params.report?.analysis?.estimateComparisons
  ).rows;
  const scrubTarget = selectScrubTarget(comparisonRows);
  const annotations = buildEstimateAnnotations({
    findings,
    lineItems: source.lineItems,
    lineAnchors,
    comparisonRows,
    scrubTargetRole: scrubTarget.role,
    params,
  });
  const vehicleIdentity = resolveCanonicalVehicleLabel(exportModel) ?? "Unspecified";
  const vin = resolveCanonicalVin(exportModel) ?? "Unspecified";
  const insurer = resolveCanonicalInsurer(exportModel);

  return {
    estimateId: buildEstimateId(vehicleIdentity, vin),
    citationDensityFindings: annotations.map((annotation) => annotation.citationFinding),
    lineAnchors,
    annotations,
    comparisonRows,
    scrubTarget,
    generatedLabel: source.generatedLabel,
    vehicleIdentity,
    vin,
    insurer,
  };
}

function buildAnnotatedEstimateDocument(params: {
  model: AnnotatedEstimateReviewModel;
  annotations: EstimateAnnotation[];
  audience: AnnotatedEstimateAudience;
  filename: string;
  title: string;
  reportLabel: string;
  subtitle: string;
  sections: CarrierReportDocument["sections"];
  summary?: CarrierReportDocument["summary"];
  redCount?: number;
  yellowCount?: number;
  blueCount?: number;
  footer?: string[];
}): CarrierReportDocument {
  const redCount = params.redCount ?? params.annotations.filter((item) => item.severity === "red").length;
  const yellowCount = params.yellowCount ?? params.annotations.filter((item) => item.severity === "yellow").length;
  const blueCount = params.blueCount ?? params.annotations.filter((item) => item.severity === "blue").length;
  const greenCount = params.annotations.filter((item) => item.severity === "green").length;
  const grayCount = params.annotations.filter((item) => item.severity === "gray").length;

  return {
    filename: params.filename,
    brand: {
      companyName: "Collision Academy",
      reportLabel: params.reportLabel,
      logoPath: "/brand/logos/logo-horizontal.png",
    },
    header: {
      title: params.title,
      subtitle: params.subtitle,
      generatedLabel: `Generated ${params.model.generatedLabel}`,
    },
    summary: params.summary ?? [
      { label: "Vehicle", value: params.model.vehicleIdentity },
      { label: "VIN", value: params.model.vin },
      ...(params.model.insurer ? [{ label: "Insurer", value: params.model.insurer }] : []),
      { label: "Review Target", value: params.model.scrubTarget.label },
      { label: "Line Anchors", value: String(params.model.lineAnchors.length) },
      { label: "Citation Gap Items", value: String(params.annotations.length) },
      { label: "Citation-Ready", value: String(greenCount) },
      { label: "Estimate Gaps", value: String(redCount) },
      { label: "Under-Documented", value: String(yellowCount) },
      { label: "Needs Authority / Proof", value: String(blueCount) },
      { label: "Weak / Do Not Lead", value: String(grayCount) },
    ],
    sections: params.sections,
    footer: params.footer ?? [
      "This Citation Density Gap Report is an estimate and support-readiness review, not a DOI complaint or legal-violation analysis.",
      "Estimate changes are framed as repair-scope, documentation, supplement, or proof requests.",
      "Estimate evidence can show that a line exists, is missing, or changed. It is not treated as OEM, P-page, DEG, legal, policy, invoice, scan, calibration, or completion proof.",
      "Attach the controlling procedure, estimating guide, citation, invoice, scan, calibration, photo, measurement, or completion record before treating a support item as verified authority.",
      "Customer-facing exports omit confidence scoring and evidence-chain identifiers.",
    ],
  };
}

export function buildCccWorkfileScrubberBullets(
  cccWorkfileContext: RepairIntelligenceReport["cccWorkfileContext"]
): string[] {
  if (!cccWorkfileContext?.artifacts.length) return [];

  return [
    CCC_WORKFILE_DISCLAIMER,
    ...cccWorkfileContext.artifacts.map((artifact) =>
      `${artifact.filename} (${artifact.classification}; ${artifact.parserStatus ?? "metadata recorded"}).`
    ),
  ];
}

function buildEstimateLineAnchors(
  params: ExportBuilderInput,
  lineItems: ExportLineComparison[]
): EstimateLineAnchor[] {
  const rawLines = [
    ...(params.analysis?.rawEstimateText?.split(/\r?\n/) ?? []),
    ...(params.report?.analysis?.rawEstimateText?.split(/\r?\n/) ?? []),
    ...lineItems.map((line) => line.rawLine ?? line.operation),
  ];
  const anchors = rawLines
    .map(cleanCustomerFacingEstimateLine)
    .filter(Boolean)
    .map((line, index) => ({
      estimateId: inferEstimateIdFromLine(line),
      lineId: buildStableLineId(line, index),
      lineNumber: index + 1,
      section: inferEstimateSection(line),
      text: line,
      sourceRole: inferEstimateSourceRole(line),
    } satisfies EstimateLineAnchor));

  return dedupeLineAnchors(anchors);
}

function selectScrubTarget(comparisonRows: EstimateComparisonRow[]): AnnotatedEstimateReviewModel["scrubTarget"] {
  const totals = detectEstimateTotals(comparisonRows);
  if (typeof totals.carrier === "number" && typeof totals.shop === "number") {
    const carrierLower = totals.carrier <= totals.shop;
    return {
      role: carrierLower ? "carrier" : "shop",
      label: carrierLower ? "Lower-cost carrier estimate" : "Lower-cost shop estimate",
      basis: `The available comparison data shows the carrier estimate at ${formatMoney(totals.carrier)} and the shop estimate at ${formatMoney(totals.shop)}. The lower-cost estimate is scrubbed first because it is the estimate most likely to omit, reduce, or under-document disputed work.`,
      lowerCostTotal: carrierLower ? totals.carrier : totals.shop,
      higherCostTotal: carrierLower ? totals.shop : totals.carrier,
    };
  }

  if (comparisonRows.length > 0) {
    return {
      role: "carrier",
      label: "Lower-cost carrier estimate",
      basis:
        "The file contains competing estimate comparison data, but exact competing totals were not isolated in structured form. The carrier estimate is treated as the scrub target by default because carrier estimates are commonly the lower-cost estimate in repair-scope disputes unless the user selects another estimate.",
    };
  }

  return {
    role: "unknown",
    label: "Uploaded estimate",
    basis:
      "Only one usable estimate set was isolated. The citation-density review checks uploaded estimate lines against the current repair intelligence findings and separates estimate evidence from authority or proof gaps.",
  };
}

function detectEstimateTotals(comparisonRows: EstimateComparisonRow[]): { shop?: number; carrier?: number } {
  const totalRows = comparisonRows.filter((row) =>
    /\b(total|grand total|estimate total|net total)\b/i.test(`${row.category ?? ""} ${row.operation ?? ""} ${row.partName ?? ""}`)
  );

  for (const row of totalRows) {
    const lhs = parseMoney(row.lhsValue);
    const rhs = parseMoney(row.rhsValue);
    if (typeof lhs === "number" && typeof rhs === "number") {
      return { shop: lhs, carrier: rhs };
    }
  }

  return {};
}

function parseMoney(value: string | number | null | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[$,\s]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function extractLineNumberFromText(value: string): string | null {
  const match = value.match(/\b(?:line|ln)\s*#?\s*(\d+[A-Za-z]?)\b/i) ?? value.match(/^\s*(\d+[A-Za-z]?)\s*[-.)]/);
  return match?.[1] ?? null;
}

function extractLaborHours(value: string): number | null {
  const match = value.match(/\b(\d+(?:\.\d+)?)\s*(?:hr|hrs|hour|hours|labor\s*hours?)\b/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function filterAnnotationsForAudience(
  annotations: EstimateAnnotation[],
  audience: AnnotatedEstimateAudience
): EstimateAnnotation[] {
  return annotations.filter((annotation) => annotation.visibility[audience]);
}

function buildEstimateId(vehicleIdentity: string, vin: string): string {
  return `estimate-${normalizeDedupeKey(`${vehicleIdentity} ${vin}`).replace(/\s+/g, "-") || "upload"}`;
}

function inferEstimateIdFromLine(line: string): string {
  if (/shop|repair facility|body shop/i.test(line)) return "shop-estimate";
  if (/carrier|insurer|insurance|claim/i.test(line)) return "carrier-estimate";
  return "estimate-upload";
}

function buildStableLineId(line: string, index: number): string {
  const normalized = normalizeDedupeKey(line).replace(/\s+/g, "-").slice(0, 64);
  return `line-${index + 1}-${normalized || "estimate"}`;
}

function inferEstimateSourceRole(line: string): EstimateLineAnchor["sourceRole"] {
  if (/shop|repair facility|body shop/i.test(line)) return "shop";
  if (/carrier|insurer|insurance/i.test(line)) return "carrier";
  return "unknown";
}

function dedupeLineAnchors(anchors: EstimateLineAnchor[]): EstimateLineAnchor[] {
  const seen = new Set<string>();
  const kept: EstimateLineAnchor[] = [];
  for (const anchor of anchors) {
    const key = normalizeDedupeKey(`${anchor.section} ${anchor.text}`);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(anchor);
  }
  return kept;
}

function findBestLineAnchor(
  operationKey: string,
  lineAnchors: EstimateLineAnchor[]
): EstimateLineAnchor | null {
  const priorityAnchors = lineAnchors
    .map((anchor) => ({ anchor, score: scoreAnchorMatch(operationKey, anchor) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return priorityAnchors[0]?.anchor ?? null;
}

function scoreAnchorMatch(operationKey: string, anchor: EstimateLineAnchor): number {
  const anchorKey = normalizeDedupeKey(`${anchor.section} ${anchor.text}`);
  if (anchorKey.includes(operationKey) || operationKey.includes(anchorKey)) return 100;
  const terms = operationKey.split(" ").filter((term) => term.length > 2);
  const matches = terms.filter((term) => anchorKey.includes(term)).length;
  const priorityBoost = /scan|calibration|test fit|alignment|frame|structural|measure|corrosion|refinish|material|aftermarket|a m|manual|included|labor|pricing|one time|supplement/i.test(anchor.text)
    ? 10
    : 0;
  return matches + priorityBoost;
}

function mapAnnotationSupportStatus(finding: EstimateScrubFinding): EstimateAnnotationSupportStatus {
  if (finding.supportConfidenceIndicator === "verified") return "verified";
  if (finding.supportConfidenceIndicator === "referenced") return "referenced";
  if (finding.sources.some((source) => source.sourceType === "EstimateParser" || source.sourceType === "UploadedDocument")) {
    return "referenced";
  }
  if (finding.sources.length > 0) return "referenced";
  return "missing";
}

function calculateCitationDensityScore(
  finding: EstimateScrubFinding,
  supportStatus: EstimateAnnotationSupportStatus
): number {
  const verifiedAuthorityCount = finding.sources.filter((source) =>
    source.verified && isAuthoritySource(source)
  ).length;
  const verifiedEstimateCount = finding.sources.filter((source) =>
    source.verified && isEstimateEvidenceSource(source)
  ).length;
  const referencedCount = finding.sources.filter((source) => !source.verified).length;
  const proofGapPenalty =
    finding.citationGapBucket === "needs_invoice_or_completion_proof" ||
    finding.citationGapBucket === "needs_oem_procedure" ||
    finding.citationGapBucket === "needs_p_page_support"
      ? 30
      : 0;
  const weakPenalty = finding.citationGapBucket === "weak_do_not_lead" ? 50 : 0;
  const supportBase =
    supportStatus === "verified" ? 35 :
    supportStatus === "referenced" ? 20 :
    supportStatus === "inferred" ? 10 :
    0;
  const score = supportBase + (verifiedAuthorityCount * 25) + (verifiedEstimateCount * 10) + Math.min(referencedCount * 5, 15) - proofGapPenalty - weakPenalty;
  return Math.max(0, Math.min(100, score));
}

function classifyCitationReadiness(
  finding: EstimateScrubFinding,
  supportStatus: EstimateAnnotationSupportStatus,
  score: number
): CitationReadiness {
  if (finding.citationGapBucket === "weak_do_not_lead") return "weak_do_not_lead";
  if (finding.citationGapBucket === "needs_invoice_or_completion_proof") return "needs_completion_proof";
  if (finding.citationGapBucket === "needs_oem_procedure" || finding.citationGapBucket === "needs_p_page_support") {
    return "needs_authority";
  }
  if (supportStatus === "verified" && score >= 60 && finding.sources.some((source) => source.verified && isAuthoritySource(source))) {
    return "citation_ready";
  }
  return "estimate_evidence_only";
}

function isAuthoritySource(source: SourceCitation): boolean {
  const text = `${source.sourceType} ${source.title} ${source.note ?? ""}`;
  return /DriveOEM|PositionStatement|SCRS|DEG|OEM|procedure|position statement|p-?page|estimating guide|NHTSA|federal|state regulation|DOI|policy|invoice|scan|calibration|completion|photo|teardown|measurement/i.test(text) &&
    !/EstimateParser|estimate excerpt|carrier estimate|shop estimate|current estimate|uploaded claim documents?/i.test(text);
}

function isEstimateEvidenceSource(source: SourceCitation): boolean {
  return /EstimateParser|UploadedDocument|estimate|CCC|Mitchell|Audatex/i.test(`${source.sourceType} ${source.title}`);
}

function findComparisonForFinding(
  finding: EstimateScrubFinding,
  comparisonRows: EstimateComparisonRow[]
): { shopLine?: string; carrierLine?: string; difference?: string } | null {
  const key = normalizeDedupeKey(finding.operation);
  const row = comparisonRows.find((candidate) =>
    normalizeDedupeKey(`${candidate.category ?? ""} ${candidate.operation ?? ""} ${candidate.partName ?? ""} ${candidate.lhsValue ?? ""} ${candidate.rhsValue ?? ""}`).includes(key)
  );
  if (!row) return null;

  return {
    shopLine: formatComparisonValue(row.lhsValue),
    carrierLine: formatComparisonValue(row.rhsValue),
    difference: formatComparisonValue(row.delta) || formatDeltaType(row.deltaType),
  };
}

function buildComparisonOnlyAnnotations(
  comparisonRows: EstimateComparisonRow[],
  lineAnchors: EstimateLineAnchor[],
  offset: number,
  scrubTargetRole: AnnotatedEstimateReviewModel["scrubTarget"]["role"]
): EstimateAnnotation[] {
  return comparisonRows
    .map((row) => ({ row, score: scoreComparisonRowForAnnotation(row) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 30)
    .map((row, index) => {
      const comparisonRow = row.row;
      const lowerLine = getLowerEstimateLine(comparisonRow, scrubTargetRole);
      const higherLine = getHigherEstimateLine(comparisonRow, scrubTargetRole);
      const targetLine = lowerLine || "Not clearly shown";
      const title = cleanCustomerFacingEstimateLine(comparisonRow.operation ?? comparisonRow.partName ?? comparisonRow.category ?? "Estimate comparison item");
      const category = classifyComparisonAnnotationCategory(comparisonRow);
      const severity = classifyComparisonAnnotationSeverity(category);
      const citationGapBucket = classifyComparisonCitationGapBucket(comparisonRow, category);
      const citationDensityScore = calculateComparisonCitationDensityScore(category);
      const citationReadiness = classifyComparisonCitationReadiness(citationGapBucket, citationDensityScore);
      const anchor = findBestLineAnchor(normalizeDedupeKey(`${targetLine} ${higherLine ?? ""} ${title}`), lineAnchors);
      const explanation = buildComparisonExplanation(comparisonRow, lowerLine, higherLine);
      const citationFinding = buildCitationDensityFindingFromComparison({
        id: `citation-density-${offset + index + 1}-comparison-${normalizeDedupeKey(title).replace(/\s+/g, "-") || "item"}`,
        row: comparisonRow,
        title,
        category,
        citationGapBucket,
        citationDensityScore,
        anchor: anchor ?? undefined,
        lowerLine,
        higherLine,
      });

      return {
        id: `estimate-annotation-${offset + index + 1}-comparison-${normalizeDedupeKey(title).replace(/\s+/g, "-") || "item"}`,
        estimateId: anchor?.estimateId ?? "carrier-estimate",
        lineId: anchor?.lineId,
        section: anchor?.section ?? cleanCustomerFacingEstimateLine(comparisonRow.category) ?? "Estimate comparison",
        category,
        severity,
        title,
        explanation,
        recommendedAction: buildComparisonEstimatorText(comparisonRow, category),
        customerText: buildComparisonCustomerText(comparisonRow, category),
        estimatorText: buildComparisonEstimatorText(comparisonRow, category),
        supportStatus: "referenced",
        citationGapBucket,
        citationDensityScore,
        citationReadiness,
        citationFinding,
        sourceRefs: [],
        visibility: {
          customer: true,
          estimator: true,
          admin: true,
        },
        anchorText: anchor?.text ?? targetLine,
        shopLine: scrubTargetRole === "shop" ? lowerLine : higherLine,
        carrierLine: scrubTargetRole === "carrier" || scrubTargetRole === "unknown" ? lowerLine : higherLine,
        difference: formatComparisonValue(comparisonRow.delta) || formatDeltaType(comparisonRow.deltaType),
      };
    });
}

function getLowerEstimateLine(
  row: EstimateComparisonRow,
  scrubTargetRole: AnnotatedEstimateReviewModel["scrubTarget"]["role"]
): string | undefined {
  if (scrubTargetRole === "shop") return formatComparisonValue(row.lhsValue);
  return formatComparisonValue(row.rhsValue);
}

function getHigherEstimateLine(
  row: EstimateComparisonRow,
  scrubTargetRole: AnnotatedEstimateReviewModel["scrubTarget"]["role"]
): string | undefined {
  if (scrubTargetRole === "shop") return formatComparisonValue(row.rhsValue);
  return formatComparisonValue(row.lhsValue);
}

function scoreComparisonRowForAnnotation(row: EstimateComparisonRow): number {
  const combined = `${row.category ?? ""} ${row.operation ?? ""} ${row.partName ?? ""} ${row.lhsValue ?? ""} ${row.rhsValue ?? ""} ${row.delta ?? ""} ${row.deltaType ?? ""} ${row.notes?.join(" ") ?? ""}`;
  const hasDifference =
    row.deltaType === "changed" ||
    row.deltaType === "added" ||
    row.deltaType === "removed" ||
    Boolean(formatComparisonValue(row.delta)) ||
    formatComparisonValue(row.lhsValue) !== formatComparisonValue(row.rhsValue);
  if (!hasDifference || /\b(total|subtotal|tax|betterment|deductible)\b/i.test(combined)) return 0;

  let score = 10;
  if (/scan|calibration|adas|diagnostic|aiming/i.test(combined)) score += 45;
  if (/frame|structural|measure|pull|setup|rail|apron|pillar/i.test(combined)) score += 42;
  if (/airbag|seat belt|srs|safety/i.test(combined)) score += 40;
  if (/alignment|sublet|road test/i.test(combined)) score += 34;
  if (/corrosion|cavity|wax|foam|seam sealer/i.test(combined)) score += 32;
  if (/test fit|fit|gap|panel alignment/i.test(combined)) score += 30;
  if (/refinish|paint|material|blend|clear coat/i.test(combined)) score += 28;
  if (/aftermarket|a\/m|rcy|lkq|capa|used|recycled|alternate/i.test(combined)) score += 38;
  if (/invoice|proof|pending|receipt|printout|report|certificate/i.test(combined)) score += 25;
  if (/labor|hour|rate|price|allowance|reduced/i.test(combined)) score += 20;
  if (row.deltaType === "added" || row.deltaType === "removed") score += 18;
  return score;
}

function classifyComparisonAnnotationCategory(row: EstimateComparisonRow): EstimateAnnotationCategory {
  const combined = `${row.category ?? ""} ${row.operation ?? ""} ${row.partName ?? ""} ${row.lhsValue ?? ""} ${row.rhsValue ?? ""} ${row.notes?.join(" ") ?? ""}`;
  if (/aftermarket|a\/m|alternate|used|lkq|recycled/i.test(combined)) return "Alternate/aftermarket part concern";
  if (/scan|calibration|alignment|invoice|printout|record/i.test(combined)) return "Needs invoice/proof";
  if (/p-?page|included|not included|estimating guide|database/i.test(combined)) return "Needs P-page support";
  if (/oem|procedure|position statement|repair manual|adas/i.test(combined)) return "Needs OEM procedure support";
  if (/labor|rate|material|refinish|reduced|allowance|price|pricing/i.test(combined)) return "Reduced labor/material";
  return row.deltaType === "same" ? "Informational repair-planning reminder" : "Needs supplement review";
}

function classifyComparisonAnnotationSeverity(category: EstimateAnnotationCategory): EstimateAnnotationSeverity {
  if (category === "Informational repair-planning reminder") return "gray";
  if (category === "Needs invoice/proof" || category === "Needs OEM procedure support" || category === "Needs P-page support") {
    return "blue";
  }
  if (category === "Needs supplement review" || category === "Under-documented operation") return "yellow";
  return "red";
}

function classifyComparisonCitationGapBucket(
  row: EstimateComparisonRow,
  category: EstimateAnnotationCategory
): EstimateScrubCitationGapBucket {
  if (category === "Needs invoice/proof") return "needs_invoice_or_completion_proof";
  if (category === "Needs OEM procedure support") return "needs_oem_procedure";
  if (category === "Needs P-page support") return "needs_p_page_support";
  if (category === "Informational repair-planning reminder") return "weak_do_not_lead";
  if (category === "Reduced labor/material" || /reduced|changed|rate|labor|price|amount|hour/i.test(`${row.delta ?? ""} ${row.notes?.join(" ") ?? ""}`)) {
    return "reduced_by_carrier";
  }
  if (row.deltaType === "same") return "weak_do_not_lead";
  return "missing_from_carrier";
}

function calculateComparisonCitationDensityScore(category: EstimateAnnotationCategory): number {
  if (category === "Informational repair-planning reminder") return 10;
  if (category === "Needs invoice/proof" || category === "Needs OEM procedure support" || category === "Needs P-page support") return 35;
  if (category === "Needs supplement review") return 45;
  return 50;
}

function classifyComparisonCitationReadiness(
  bucket: EstimateScrubCitationGapBucket,
  score: number
): CitationReadiness {
  if (bucket === "weak_do_not_lead") return "weak_do_not_lead";
  if (bucket === "needs_invoice_or_completion_proof") return "needs_completion_proof";
  if (bucket === "needs_oem_procedure" || bucket === "needs_p_page_support") return "needs_authority";
  return score >= 70 ? "citation_ready" : "estimate_evidence_only";
}

function buildCitationDensityFindingFromScrubFinding(params: {
  id: string;
  finding: EstimateScrubFinding;
  category: EstimateAnnotationCategory;
  supportStatus: EstimateAnnotationSupportStatus;
  citationDensityScore: number;
  anchor: EstimateLineAnchor;
  comparison: { shopLine?: string; carrierLine?: string; difference?: string } | null;
  sourceRefs: string[];
}): CitationDensityFinding {
  const text = `${params.finding.operation} ${params.finding.status} ${params.finding.whyItMatters} ${params.finding.recommendedRevision}`;
  const citationStatus = buildCitationSupportStatus(params.finding.sources, params.finding.citationGapBucket, text);
  const verifiedAuthorityCount = countVerifiedAuthoritySources(params.finding.sources);
  const missingAuthorityTypes = buildMissingAuthorityTypes(citationStatus);
  const limitations = buildCitationFindingLimitations(params.finding, citationStatus);

  return {
    id: params.id,
    operationLabel: cleanCustomerFacingEstimateLine(params.finding.operation) || "Estimate review item",
    category: classifyCitationDensityCategory(text),
    estimateGapType: mapEstimateGapType(params.finding.citationGapBucket, params.supportStatus),
    shopEvidence: params.comparison?.shopLine
      ? buildCitationEvidence(params.comparison.shopLine, "Shop estimate")
      : undefined,
    carrierEvidence: buildCitationEvidence(params.comparison?.carrierLine ?? params.anchor.text, "Carrier or selected estimate"),
    impact: buildCitationImpact(text, params.finding.severity),
    citationStatus,
    citationDensityScore: params.citationDensityScore,
    verifiedAuthorityCount,
    missingAuthorityTypes,
    currentSupportSummary: formatCitationCurrentSupport(params.sourceRefs, params.supportStatus),
    missingProofSummary: summarizeMissingProofTypes(missingAuthorityTypes, params.finding.citationGapBucket),
    recommendedNextAction: buildEstimatorFacingRequest(params.finding, params.category),
    supplementReadyLanguage: verifiedAuthorityCount > 0
      ? `${cleanCustomerFacingEstimateLine(params.finding.operation)} has attached authority support and may be stronger for supplement review, subject to final estimate and repair-file verification.`
      : undefined,
    confidence: classifyCitationFindingConfidence(params.citationDensityScore, params.supportStatus),
    limitations,
  };
}

function buildCitationDensityFindingFromComparison(params: {
  id: string;
  row: EstimateComparisonRow;
  title: string;
  category: EstimateAnnotationCategory;
  citationGapBucket: EstimateScrubCitationGapBucket;
  citationDensityScore: number;
  anchor?: EstimateLineAnchor;
  lowerLine?: string;
  higherLine?: string;
}): CitationDensityFinding {
  const text = `${params.title} ${params.row.category ?? ""} ${params.row.operation ?? ""} ${params.row.partName ?? ""} ${params.row.delta ?? ""} ${params.row.notes?.join(" ") ?? ""}`;
  const citationStatus = buildCitationSupportStatus([], params.citationGapBucket, text);
  const missingAuthorityTypes = buildMissingAuthorityTypes(citationStatus);

  return {
    id: params.id,
    operationLabel: params.title,
    category: classifyCitationDensityCategory(text),
    estimateGapType: mapEstimateGapType(params.citationGapBucket, "referenced"),
    shopEvidence: buildCitationEvidence(params.higherLine ?? formatComparisonValue(params.row.lhsValue), params.row.lhsSource ?? "Shop estimate"),
    carrierEvidence: buildCitationEvidence(params.lowerLine ?? params.anchor?.text ?? formatComparisonValue(params.row.rhsValue), params.row.rhsSource ?? "Carrier or selected estimate"),
    impact: buildCitationImpact(text, mapCategoryPriority(params.category)),
    citationStatus,
    citationDensityScore: params.citationDensityScore,
    verifiedAuthorityCount: 0,
    missingAuthorityTypes,
    currentSupportSummary: "Estimate comparison evidence only; no authority source is attached to this comparison row.",
    missingProofSummary: summarizeMissingProofTypes(missingAuthorityTypes, params.citationGapBucket),
    recommendedNextAction: buildComparisonEstimatorText(params.row, params.category),
    confidence: classifyCitationFindingConfidence(params.citationDensityScore, "referenced"),
    limitations: [
      "Comparison rows support the existence of an estimate difference only.",
      "Authority, policy, legal, invoice, scan, calibration, and completion support must be verified from separate sources.",
    ],
  };
}

function classifyCitationDensityCategory(value: string): CitationDensityFinding["category"] {
  if (/adas|calibration|radar|camera|aim|blind spot|sensor/i.test(value)) return "adas_calibration";
  if (/scan|diagnostic|dtc|pre[-\s]?scan|post[-\s]?scan/i.test(value)) return "scan_diagnostic";
  if (/refinish|paint|blend|clear coat|color/i.test(value)) return "refinish";
  if (/\br[&\s-]?i\b|remove and install|remove\/install/i.test(value)) return "r_and_i";
  if (/aftermarket|a\/m|lkq|used|recycled|alternate|parts downgrade/i.test(value)) return "parts_downgrade";
  if (/fastener|clip|bolt|nut|rivet|hardware/i.test(value)) return "hardware_fasteners";
  if (/one[-\s]?time|single use|non[-\s]?reusable/i.test(value)) return "one_time_use_parts";
  if (/not included|included operation|p-?page|database/i.test(value)) return "not_included_operation";
  if (/labor|hour|rate|allowance/i.test(value)) return "labor_difference";
  if (/rental|loss of use/i.test(value)) return "rental";
  if (/tow|towing|storage/i.test(value)) return "towing_storage";
  if (/policy|coverage|deductible|endorsement/i.test(value)) return "policy_coverage";
  if (/state regulation|doi|statute|regulation|unfair claims/i.test(value)) return "state_regulation";
  if (/structural|measure|frame|fit|test fit|aperture|pull|alignment/i.test(value)) return "structural_or_fit_verification";
  return "other";
}

function mapEstimateGapType(
  bucket: EstimateScrubCitationGapBucket,
  supportStatus: EstimateAnnotationSupportStatus
): CitationDensityFinding["estimateGapType"] {
  if (bucket === "missing_from_carrier") return "missing_from_carrier";
  if (bucket === "reduced_by_carrier") return "reduced_by_carrier";
  if (bucket === "present_but_under_documented") return "present_but_under_documented";
  if (bucket === "weak_do_not_lead") return "weak_do_not_lead";
  if (supportStatus === "referenced") return "referenced_not_produced";
  return "needs_proof";
}

function buildCitationSupportStatus(
  sources: SourceCitation[],
  bucket: EstimateScrubCitationGapBucket,
  text: string
): CitationDensityFinding["citationStatus"] {
  return {
    oem: resolveCitationSupportStatus(sources, /DriveOEM|PositionStatement|oem|procedure|repair manual|position statement/i, bucket === "needs_oem_procedure"),
    pPages: resolveCitationSupportStatus(sources, /p-?page|estimating guide|included|not included|database/i, bucket === "needs_p_page_support"),
    scrs: resolveCitationSupportStatus(sources, /SCRS|guide to complete repair planning/i, /scrs|guide to complete repair planning/i.test(text)),
    deg: resolveCitationSupportStatus(sources, /DEG|database enhancement gateway/i, /deg|database/i.test(text)),
    nhtsa: resolveCitationSupportStatus(sources, /NHTSA|federal|safety recall/i, /nhtsa|federal|safety/i.test(text)),
    stateRegulation: resolveCitationSupportStatus(sources, /state regulation|DOI|statute|regulation|unfair claims/i, /state regulation|doi|statute|regulation/i.test(text)),
    policy: resolveCitationSupportStatus(sources, /policy|coverage|endorsement|declaration/i, /policy|coverage|endorsement/i.test(text)),
    invoiceOrCompletionProof: resolveCitationSupportStatus(sources, /invoice|receipt|completion|final scan|scan report|calibration certificate|alignment printout/i, bucket === "needs_invoice_or_completion_proof"),
    photoOrTeardownProof: resolveCitationSupportStatus(sources, /photo|teardown|measurement|measure|frame printout/i, /photo|teardown|measurement|measure|frame/i.test(text)),
  };
}

function resolveCitationSupportStatus(
  sources: SourceCitation[],
  pattern: RegExp,
  needed: boolean
): CitationSupportStatus {
  const matching = sources.filter((source) => pattern.test(`${source.sourceType} ${source.title} ${source.note ?? ""}`));
  if (matching.some((source) => source.verified && isAuthoritySource(source))) return "verified";
  if (matching.length > 0) return "referenced_not_produced";
  return needed ? "needed" : "not_applicable";
}

function countVerifiedAuthoritySources(sources: SourceCitation[]): number {
  return sources.filter((source) => source.verified && isAuthoritySource(source)).length;
}

function buildMissingAuthorityTypes(status: CitationDensityFinding["citationStatus"]): string[] {
  return Object.entries(status)
    .filter(([, value]) => value === "needed" || value === "not_found" || value === "referenced_not_produced")
    .map(([key]) => key);
}

function buildCitationFindingLimitations(
  finding: EstimateScrubFinding,
  status: CitationDensityFinding["citationStatus"]
): string[] {
  const limitations = [
    "Estimate evidence supports line presence, omission, reduction, or changed value only.",
  ];
  if (Object.values(status).some((value) => value === "needed" || value === "referenced_not_produced")) {
    limitations.push("Authority or completion proof must be attached before this item is treated as citation-ready.");
  }
  if (finding.sources.every((source) => isEstimateEvidenceSource(source))) {
    limitations.push("Current support is estimate evidence only and is not OEM, P-page, DEG, legal, policy, or completion authority.");
  }
  return limitations;
}

function buildCitationEvidence(
  description: string | null | undefined,
  sourceLabel: string | null | undefined
): NonNullable<CitationDensityFinding["shopEvidence"]> | undefined {
  const cleaned = cleanCustomerFacingEstimateLine(description);
  if (!cleaned) return undefined;
  return {
    lineNumber: extractLineNumberFromText(cleaned),
    description: cleaned,
    amount: parseMoney(cleaned) ?? null,
    laborHours: extractLaborHours(cleaned),
    sourceLabel: sourceLabel ?? null,
  };
}

function buildCitationImpact(
  text: string,
  severity: EstimateScrubFinding["severity"]
): CitationDensityFinding["impact"] {
  const dollarImpact = parseMoney(text) ?? null;
  const laborHoursImpact = extractLaborHours(text);
  const safetyImpact = /adas|calibration|scan|srs|restraint|structural|frame|alignment|sensor/i.test(text)
    ? "high"
    : /refinish|r&i|one[-\s]?time|fastener|fit|measure/i.test(text)
      ? "medium"
      : "low";
  const supplementPriority = severity === "critical" || safetyImpact === "high"
    ? "high"
    : severity === "high" || severity === "moderate" || dollarImpact !== null || laborHoursImpact !== null
      ? "medium"
      : "low";
  return {
    dollarImpact,
    laborHoursImpact,
    safetyImpact,
    supplementPriority,
  };
}

function mapCategoryPriority(category: EstimateAnnotationCategory): EstimateScrubFinding["severity"] {
  if (category === "Needs OEM procedure support" || category === "Needs invoice/proof" || category === "Needs P-page support") return "high";
  if (category === "Missing operation" || category === "Reduced labor/material" || category === "Alternate/aftermarket part concern") return "moderate";
  return "informational";
}

function formatCitationCurrentSupport(
  sourceRefs: string[],
  supportStatus: EstimateAnnotationSupportStatus
): string {
  if (sourceRefs.length > 0) return sourceRefs.join("; ");
  if (supportStatus === "verified") return "Verified supporting source is attached.";
  if (supportStatus === "referenced") return "Referenced in file, but final authority or proof is not fully produced.";
  if (supportStatus === "inferred") return "Inferred from estimate review and not independently verified.";
  return "No usable support source was isolated.";
}

function summarizeMissingProofTypes(
  missingAuthorityTypes: string[],
  bucket: EstimateScrubCitationGapBucket
): string {
  if (missingAuthorityTypes.length > 0) {
    return `Missing or unresolved support: ${missingAuthorityTypes.map((item) => item.replace(/([A-Z])/g, " $1").toLowerCase()).join(", ")}.`;
  }
  if (bucket === "missing_from_carrier" || bucket === "reduced_by_carrier") {
    return "Estimate gap is visible; no additional authority type was inferred from the current text.";
  }
  return "No missing proof type was isolated.";
}

function classifyCitationFindingConfidence(
  score: number,
  supportStatus: EstimateAnnotationSupportStatus
): CitationDensityFinding["confidence"] {
  if (score >= 70 && supportStatus === "verified") return "high";
  if (score >= 30 || supportStatus === "referenced") return "medium";
  return "low";
}

function buildComparisonExplanation(
  row: EstimateComparisonRow,
  lowerLine?: string,
  higherLine?: string
): string {
  const label = cleanCustomerFacingEstimateLine(row.operation ?? row.partName ?? row.category ?? "Estimate item");
  const lower = lowerLine ?? "not clearly shown on the lower estimate";
  const higher = higherLine ?? "documented differently on the higher estimate";
  return `The lower estimate shows ${lower}. The higher estimate shows ${higher}. ${label} should be reviewed by section, operation, part description, labor category, paint hours, price, and proof status as a repair-scope or documentation issue, not as a regulatory complaint ground by itself.`;
}

function buildComparisonCustomerText(
  row: EstimateComparisonRow,
  category: EstimateAnnotationCategory
): string {
  if (category === "Alternate/aftermarket part concern") {
    return "Ask for written confirmation that the selected part is appropriate for the repair, policy, fit, safety, warranty, and repair-procedure requirements.";
  }
  return `Ask the insurer or repair shop to confirm the difference for ${cleanCustomerFacingEstimateLine(row.operation ?? row.partName ?? "this estimate item")}.`;
}

function buildComparisonEstimatorText(
  row: EstimateComparisonRow,
  category: EstimateAnnotationCategory
): string {
  if (category === "Alternate/aftermarket part concern") {
    return "Alternate part difference. Confirm whether the selected part complies with policy, fit, safety, warranty, and repair-procedure requirements.";
  }
  return `Review side-by-side difference for ${cleanCustomerFacingEstimateLine(row.operation ?? row.partName ?? "this estimate item")}; add supplement support or document accepted variance.`;
}

function dedupeAnnotations(annotations: EstimateAnnotation[]): EstimateAnnotation[] {
  const seen = new Set<string>();
  const kept: EstimateAnnotation[] = [];
  for (const annotation of annotations) {
    const key = normalizeDedupeKey(`${annotation.category} ${annotation.section ?? ""} ${annotation.anchorText} ${annotation.title}`);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(annotation);
  }
  return kept;
}

function buildEstimateAnnotations(params: {
  findings: EstimateScrubFinding[];
  lineItems: ExportLineComparison[];
  lineAnchors: EstimateLineAnchor[];
  comparisonRows: EstimateComparisonRow[];
  scrubTargetRole: AnnotatedEstimateReviewModel["scrubTarget"]["role"];
  params: ExportBuilderInput;
}): EstimateAnnotation[] {
  const findingAnnotations = params.findings.map((finding, index) => {
    const anchor = findEstimateAnchorForFinding(finding, params.lineItems, params.lineAnchors, params.params);
    const category = classifyAnnotationCategory(finding);
    const severity = classifyAnnotationSeverity(category, finding);
    const supportStatus = mapAnnotationSupportStatus(finding);
    const comparison = findComparisonForFinding(finding, params.comparisonRows);
    const title = cleanCustomerFacingEstimateLine(finding.operation) || "Estimate review item";
    const sourceRefs = buildAnnotationSourceRefs(finding);
    const citationDensityScore = calculateCitationDensityScore(finding, supportStatus);
    const citationReadiness = classifyCitationReadiness(finding, supportStatus, citationDensityScore);
    const citationFinding = buildCitationDensityFindingFromScrubFinding({
      id: `citation-density-${index + 1}-${normalizeDedupeKey(title).replace(/\s+/g, "-") || "item"}`,
      finding,
      category,
      supportStatus,
      citationDensityScore,
      anchor,
      comparison,
      sourceRefs,
    });

    return {
      id: `estimate-annotation-${index + 1}-${normalizeDedupeKey(title).replace(/\s+/g, "-") || "item"}`,
      estimateId: anchor.estimateId,
      lineId: anchor.lineId,
      section: anchor.section,
      category,
      severity,
      title,
      explanation: buildAnnotationExplanation(finding, category, supportStatus),
      recommendedAction: buildEstimatorFacingRequest(finding, category),
      customerText: buildCustomerFacingRequest(finding, category),
      estimatorText: buildEstimatorFacingRequest(finding, category),
      supportStatus,
      citationGapBucket: finding.citationGapBucket,
      citationDensityScore,
      citationReadiness,
      citationFinding,
      sourceRefs,
      visibility: {
        customer: true,
        estimator: true,
        admin: true,
      },
      anchorText: anchor.text,
      shopLine: comparison?.shopLine,
      carrierLine: comparison?.carrierLine ?? anchor.text,
      difference: comparison?.difference,
    };
  });

  const comparisonAnnotations = buildComparisonOnlyAnnotations(
    params.comparisonRows,
    params.lineAnchors,
    findingAnnotations.length,
    params.scrubTargetRole
  );
  const shouldUseExpandedFallback = findingAnnotations.length < 5 && params.comparisonRows.length > 5;
  const combined = shouldUseExpandedFallback
    ? [...findingAnnotations, ...comparisonAnnotations]
    : [...findingAnnotations, ...comparisonAnnotations.slice(0, 12)];

  return dedupeAnnotations(combined).slice(0, 30);
}

function findEstimateAnchorForFinding(
  finding: EstimateScrubFinding,
  lineItems: ExportLineComparison[],
  lineAnchors: EstimateLineAnchor[],
  params: ExportBuilderInput
): EstimateLineAnchor {
  const operationKey = normalizeDedupeKey(finding.operation);
  const bestAnchor = findBestLineAnchor(operationKey, lineAnchors);
  if (bestAnchor && !shouldSuppressAnchorForFinding(finding, bestAnchor.text)) return bestAnchor;

  const bestLine = lineItems.find((line) =>
    normalizeDedupeKey(`${line.operation} ${line.component} ${line.rawLine ?? ""} ${line.carrierPosition}`).includes(operationKey) ||
    operationKey.includes(normalizeDedupeKey(line.operation))
  );
  const analysisOperations = params.analysis?.operations ?? params.report?.analysis?.operations ?? [];
  const bestOperation = analysisOperations.find((operation) =>
    normalizeDedupeKey(`${operation.operation} ${operation.component ?? ""} ${operation.rawLine ?? ""}`).includes(operationKey) ||
    operationKey.includes(normalizeDedupeKey(operation.operation))
  );
  const rawLine = bestLine?.rawLine ?? bestOperation?.rawLine ?? bestLine?.operation ?? bestOperation?.operation ?? finding.operation;
  const section = bestLine?.component ?? bestOperation?.component ?? inferEstimateSection(finding.operation);

  if (shouldSuppressAnchorForFinding(finding, rawLine)) {
    return buildUnanchoredClarificationAnchor(finding);
  }

  return {
    estimateId: "estimate-upload",
    lineId: `anchor-${normalizeDedupeKey(`${section} ${rawLine}`).replace(/\s+/g, "-") || "unisolated"}`,
    lineNumber: 0,
    section: cleanCustomerFacingEstimateLine(section) || "Related estimate section",
    text: cleanCustomerFacingEstimateLine(rawLine) || cleanCustomerFacingEstimateLine(finding.operation) || "Estimate line not isolated",
    sourceRole: "unknown",
  };
}

function shouldSuppressAnchorForFinding(finding: EstimateScrubFinding, anchorText?: string | null): boolean {
  if (!anchorText || !/\btest\s*fit\b/i.test(finding.operation)) return false;
  return isGenericVehicleOptionsLine(anchorText);
}

function isGenericVehicleOptionsLine(value: string): boolean {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return false;

  const optionTerms = /\b(?:power|driver seat|passenger seat|telescopic wheel|traction control|paint|cruise|bluetooth|navigation|heated seat|intermittent|air conditioning)\b/i;
  const repairTerms = /\b(?:repair|replace|repl|r&i|r&r|refinish|align|measure|scan|calibration|door|quarter|bumper|fender|pillar|rocker|fit|test|weld|pull|frame)\b/i;
  return optionTerms.test(text) && !repairTerms.test(text.replace(/\bpaint\b/gi, ""));
}

function buildUnanchoredClarificationAnchor(finding: EstimateScrubFinding): EstimateLineAnchor {
  const operation = cleanCustomerFacingEstimateLine(finding.operation) || "Estimate line not isolated";
  return {
    estimateId: "estimate-upload",
    lineId: `anchor-${normalizeDedupeKey(`fit-clarification ${operation}`).replace(/\s+/g, "-") || "unanchored-clarification"}`,
    lineNumber: 0,
    section: "Fit and finish clarification",
    text: operation,
    sourceRole: "unknown",
  };
}

function classifyAnnotationCategory(finding: EstimateScrubFinding): EstimateAnnotationCategory {
  const text = `${finding.operation} ${finding.status} ${finding.whyItMatters} ${finding.recommendedRevision}`;
  if (finding.citationGapBucket === "needs_invoice_or_completion_proof") return "Needs invoice/proof";
  if (finding.citationGapBucket === "needs_oem_procedure") return "Needs OEM procedure support";
  if (finding.citationGapBucket === "needs_p_page_support") return "Needs P-page support";
  if (finding.citationGapBucket === "present_but_under_documented") return "Under-documented operation";
  if (finding.citationGapBucket === "reduced_by_carrier") return "Reduced labor/material";
  if (finding.citationGapBucket === "missing_from_carrier") return "Missing operation";
  if (finding.citationGapBucket === "weak_do_not_lead") return "Informational repair-planning reminder";
  if (/invoice|receipt|proof|completion record|pending invoice|scan report/i.test(text)) return "Needs invoice/proof";
  if (/a\/m|aftermarket|alternate|used|lkq|recycled/i.test(text)) return "Alternate/aftermarket part concern";
  if (/reduced|alternate|aftermarket|rate|labor|material|refinish allowance|underwrit/i.test(text)) {
    return "Reduced labor/material";
  }
  if (/oem|procedure|position statement|adas|calibration|scan/i.test(text)) return "Needs OEM procedure support";
  if (/supplement|review|reinspect/i.test(text)) return "Needs supplement review";
  if (finding.severity === "informational") return "Informational repair-planning reminder";
  return "Under-documented operation";
}

function classifyAnnotationSeverity(
  category: EstimateAnnotationCategory,
  finding: EstimateScrubFinding
): EstimateAnnotationSeverity {
  if (category === "Needs invoice/proof" || category === "Needs OEM procedure support" || category === "Needs P-page support") {
    return "blue";
  }
  if (
    finding.estimatePresence === "missing" ||
    category === "Reduced labor/material" ||
    category === "Alternate/aftermarket part concern"
  ) return "red";
  if (finding.estimatePresence === "under-documented" || category === "Needs supplement review") return "yellow";
  if (finding.estimatePresence === "present") return "green";
  return "gray";
}

function buildCustomerFacingRequest(
  finding: EstimateScrubFinding,
  category: EstimateAnnotationCategory
): string {
  if (category === "Needs invoice/proof") {
    return `Ask for written confirmation that ${cleanCustomerFacingEstimateLine(finding.operation).toLowerCase()} was completed and documented.`;
  }
  if (category === "Needs OEM procedure support") {
    return `Ask the insurer or repair shop to confirm whether ${cleanCustomerFacingEstimateLine(finding.operation).toLowerCase()} is included and documented.`;
  }
  if (category === "Needs P-page support") {
    return `Ask for the estimating-guide or P-page support showing whether ${cleanCustomerFacingEstimateLine(finding.operation).toLowerCase()} is included or separately billable.`;
  }
  if (category === "Alternate/aftermarket part concern") {
    return "Ask for written confirmation that the selected part is appropriate for the repair, policy, fit, safety, warranty, and repair-procedure requirements.";
  }
  if (category === "Missing operation") {
    return `Ask the insurer or repair shop to confirm whether ${cleanCustomerFacingEstimateLine(finding.operation).toLowerCase()} is included and documented.`;
  }
  return `Ask the insurer or repair shop to confirm whether this item is included and documented.`;
}

function buildEstimatorFacingRequest(
  finding: EstimateScrubFinding,
  category: EstimateAnnotationCategory
): string {
  const operation = cleanCustomerFacingEstimateLine(finding.operation);
  if (category === "Needs invoice/proof") {
    return `Needs proof: ${operation} is referenced but final invoice-backed completion is not shown. Request final scan, calibration, alignment, material, or invoice support before closing this item.`;
  }
  if (category === "Needs OEM procedure support") {
    return `Add or document ${operation} if OEM procedure applies; attach procedure-backed scan, calibration, fit-verification, or repair-method support.`;
  }
  if (category === "Needs P-page support") {
    return `Add P-page or estimating-guide support for ${operation}; do not present the estimate line alone as included/not-included authority.`;
  }
  if (category === "Alternate/aftermarket part concern") {
    return "Alternate part difference. Confirm whether the selected part complies with policy, fit, safety, warranty, and repair-procedure requirements.";
  }
  if (category === "Reduced labor/material") {
    return `Review labor, refinish, material, rate, alternate-part, or allowance reduction for ${operation}; add a supported supplement line or document the accepted variance.`;
  }
  if (category === "Needs supplement review") {
    return `Route ${operation} for supplement review with the supporting estimate excerpt, photos, procedure note, and repair-plan basis.`;
  }
  return `Add or clarify ${operation}; document the estimate basis and attach supporting repair-plan evidence.`;
}

function buildAnnotationSourceRefs(finding: EstimateScrubFinding): string[] {
  return finding.sources
    .map((source) => {
      const title = cleanCustomerFacingEstimateLine(source.title);
      if (!title) return "";
      return `${classifyScrubberSource(source.sourceType, title)}: ${title}`;
    })
    .filter(Boolean);
}

function classifyScrubberSource(sourceType: string | undefined, title: string): string {
  const text = `${sourceType ?? ""} ${title}`;
  if (/policy|declaration|endorsement/i.test(text)) return "POLICY_EVIDENCE";
  if (/estimate|ccc|mitchell|audatex|uploadeddocument|estimateparser/i.test(text)) return "ESTIMATE_EVIDENCE";
  if (/position statement/i.test(text)) return "OEM_POSITION_STATEMENT";
  if (/oem|procedure|repair manual|service manual/i.test(text)) return "OEM_PROCEDURE";
  if (/scrs|i-car|rts|repairer driven news|collision hub|industry/i.test(text)) return "INDUSTRY_CONTEXT";
  if (/chat|user/i.test(text)) return "USER_CHAT_CONTEXT";
  return "ESTIMATE_EVIDENCE";
}

function formatComparisonValue(value: EstimateComparisonRow["lhsValue"]): string | undefined {
  if (value === null || value === undefined) return undefined;
  const cleaned = cleanCustomerFacingEstimateLine(String(value));
  if (!cleaned || /^shown$/i.test(cleaned)) return undefined;
  return cleaned;
}

function formatDeltaType(value: EstimateComparisonRow["deltaType"]): string | undefined {
  if (!value || value === "unknown") return undefined;
  return value
    .split("_")
    .map((part) => capitalize(part))
    .join(" ");
}

function buildAnnotationExplanation(
  finding: EstimateScrubFinding,
  category: EstimateAnnotationCategory,
  supportStatus: EstimateAnnotationSupportStatus
): string {
  const supportPhrase =
    supportStatus === "verified"
      ? "The concern is tied to directly extracted estimate, policy, invoice, scan, procedure, or supporting evidence."
      : supportStatus === "referenced"
        ? "The item is referenced in the file, but the completion proof, invoice, scan record, procedure support, or estimate explanation should still be checked."
        : supportStatus === "inferred"
          ? "Support is inferred from the current estimate review and needs confirmation."
          : "The file does not yet establish the item with usable document support.";

  return `${cleanCustomerFacingEstimateLine(finding.whyItMatters)} ${supportPhrase}`;
}

function buildCitationBottomLineBullets(model: AnnotatedEstimateReviewModel): string[] {
  const findings = model.citationDensityFindings;
  const supplementReadyCount = findings.filter(isSupplementReadyFinding).length;
  const proofNeededCount = findings.filter(isProofNeededFinding).length;
  const weakCount = findings.filter(isWeakFinding).length;
  const highestRisk = selectHighestRiskMissingProof(findings);
  const broaderEstimate = model.scrubTarget.higherCostTotal && model.scrubTarget.lowerCostTotal
    ? model.scrubTarget.role === "carrier"
      ? "The shop estimate appears broader or more complete based on the isolated total comparison."
      : "The carrier estimate appears broader or more complete based on the isolated total comparison."
    : "The available file does not isolate two complete estimate totals, so completeness is based on line-level gaps and proof status.";
  const finalAwardReady = proofNeededCount === 0 && weakCount === 0 && supplementReadyCount > 0
    ? "Potentially closer to final-award ready for the isolated items, subject to final file review."
    : "Not final-award ready yet; authority or completion proof remains open for one or more items.";

  return [
    broaderEstimate,
    finalAwardReady,
    `Main proof gaps: ${highestRisk ?? "No high-risk missing proof type was isolated."}`,
    `Ready to raise: ${supplementReadyCount}. Needs proof before leading: ${proofNeededCount}. Weak/do-not-lead: ${weakCount}.`,
  ];
}

function buildCitationDensityScoreBullets(findings: CitationDensityFinding[]): string[] {
  const verifiedAuthorityCount = findings.reduce((sum, finding) => sum + finding.verifiedAuthorityCount, 0);
  const missingAuthorityTypes = new Set(findings.flatMap((finding) => finding.missingAuthorityTypes));
  const highestRisk = selectHighestRiskMissingProof(findings);
  const averageScore = findings.length
    ? Math.round(findings.reduce((sum, finding) => sum + finding.citationDensityScore, 0) / findings.length)
    : 0;

  return [
    `Average citation density score: ${averageScore}/100.`,
    `Verified authority count: ${verifiedAuthorityCount}.`,
    `Missing authority count: ${missingAuthorityTypes.size}.`,
    `Highest-risk missing proof: ${highestRisk ?? "none isolated"}.`,
  ];
}

function buildHighestPriorityGapRows(findings: CitationDensityFinding[]): string[] {
  const rows = findings
    .filter((finding) => !isWeakFinding(finding))
    .sort((a, b) => rankCitationDensityFinding(b) - rankCitationDensityFinding(a))
    .slice(0, 12);

  if (rows.length === 0) return ["No highest-priority citation gaps were isolated from the current estimate review."];

  return [
    "Gap / operation | Carrier issue | Estimate impact | Authority status | Missing proof | Priority | Next action",
    ...rows.map((finding) => [
      finding.operationLabel,
      formatEstimateGapType(finding.estimateGapType),
      formatFindingImpact(finding),
      formatAuthorityStatusSummary(finding),
      finding.missingProofSummary,
      finding.impact.supplementPriority,
      finding.recommendedNextAction,
    ].join(" | ")),
  ];
}

function buildAuthorityMatrixRows(findings: CitationDensityFinding[]): string[] {
  const rows: Array<{ label: string; key: keyof CitationDensityFinding["citationStatus"] }> = [
    { label: "OEM", key: "oem" },
    { label: "P-page", key: "pPages" },
    { label: "SCRS", key: "scrs" },
    { label: "DEG", key: "deg" },
    { label: "NHTSA", key: "nhtsa" },
    { label: "State regulation", key: "stateRegulation" },
    { label: "Policy", key: "policy" },
    { label: "Invoice/completion", key: "invoiceOrCompletionProof" },
    { label: "Photos/teardown", key: "photoOrTeardownProof" },
  ];

  return [
    "Authority | Verified | Referenced but not produced | Needed | Not found | Not applicable",
    ...rows.map(({ label, key }) => {
      const counts = countCitationStatuses(findings, key);
      return [
        label,
        String(counts.verified),
        String(counts.referenced_not_produced),
        String(counts.needed),
        String(counts.not_found),
        String(counts.not_applicable),
      ].join(" | ");
    }),
  ];
}

function buildSupplementReadyBullets(findings: CitationDensityFinding[]): string[] {
  const ready = findings
    .filter(isSupplementReadyFinding)
    .sort((a, b) => rankCitationDensityFinding(b) - rankCitationDensityFinding(a))
    .slice(0, 10);

  return ready.length
    ? ready.map((finding) =>
        `${finding.operationLabel}: ${finding.supplementReadyLanguage ?? "Enough estimate and authority support is attached to raise this item safely, subject to final review."} Next action: ${finding.recommendedNextAction}`
      )
    : ["No items currently have enough verified authority or completion proof to be treated as supplement-ready without more support."];
}

function buildProofNeededBeforeLeadingBullets(findings: CitationDensityFinding[]): string[] {
  const proofNeeded = findings
    .filter(isProofNeededFinding)
    .sort((a, b) => rankCitationDensityFinding(b) - rankCitationDensityFinding(a))
    .slice(0, 12);

  return proofNeeded.length
    ? proofNeeded.map((finding) =>
        `${finding.operationLabel}: ${finding.missingProofSummary} Current support: ${finding.currentSupportSummary}. Next action: ${finding.recommendedNextAction}`
      )
    : ["No items were isolated that need proof before leading."];
}

function buildWeakDoNotLeadBullets(findings: CitationDensityFinding[]): string[] {
  const weak = findings.filter(isWeakFinding).slice(0, 10);

  return weak.length
    ? weak.map((finding) =>
        `${finding.operationLabel}: ${finding.currentSupportSummary}. Limitation: ${finding.limitations.join(" ")}`
      )
    : ["No weak or distracting lead items were isolated from the current estimate review."];
}

function buildSourceBoundaryBullets(): string[] {
  return [
    "This report separates estimate gaps from citation support. A line-item difference may be real, but it is not supplement-ready until the file shows the authority or documentation needed to defend it.",
    "Estimate evidence supports the existence of a difference. It does not automatically prove OEM, P-page, DEG, legal, policy, or carrier-violation authority.",
    "Use estimate lines, CCC/workfile data, uploaded PDFs, and estimate deltas to show line presence, omission, reduced amount, changed labor hours, or source metadata.",
    "Use separate authority or completion proof for OEM procedures, P-pages, SCRS, DEG, NHTSA, state regulation, policy language, invoices, scans, calibration records, photos, teardown, and measurement support.",
  ];
}

function isSupplementReadyFinding(finding: CitationDensityFinding): boolean {
  return finding.verifiedAuthorityCount > 0 &&
    finding.citationDensityScore >= 60 &&
    !isWeakFinding(finding) &&
    finding.missingAuthorityTypes.length === 0;
}

function isProofNeededFinding(finding: CitationDensityFinding): boolean {
  return !isWeakFinding(finding) &&
    (finding.estimateGapType === "needs_proof" ||
      finding.estimateGapType === "referenced_not_produced" ||
      finding.estimateGapType === "present_but_under_documented" ||
      finding.missingAuthorityTypes.length > 0 ||
      finding.verifiedAuthorityCount === 0);
}

function isWeakFinding(finding: CitationDensityFinding): boolean {
  return finding.estimateGapType === "weak_do_not_lead" ||
    finding.confidence === "low" ||
    finding.impact.supplementPriority === "low";
}

function selectHighestRiskMissingProof(findings: CitationDensityFinding[]): string | null {
  const proofTypes = findings.flatMap((finding) => finding.missingAuthorityTypes);
  const priority = [
    "oem",
    "invoiceOrCompletionProof",
    "photoOrTeardownProof",
    "pPages",
    "deg",
    "nhtsa",
    "stateRegulation",
    "policy",
    "scrs",
  ];
  const found = priority.find((item) => proofTypes.includes(item));
  return found ? formatAuthorityKey(found) : null;
}

function rankCitationDensityFinding(finding: CitationDensityFinding): number {
  const priority = finding.impact.supplementPriority === "high" ? 40 :
    finding.impact.supplementPriority === "medium" ? 22 :
    5;
  const safety = finding.impact.safetyImpact === "high" ? 30 :
    finding.impact.safetyImpact === "medium" ? 15 :
    0;
  const proofPenalty = finding.missingAuthorityTypes.length * 6;
  const weakPenalty = isWeakFinding(finding) ? 45 : 0;
  return priority + safety + finding.citationDensityScore + (finding.verifiedAuthorityCount * 10) - proofPenalty - weakPenalty;
}

function countCitationStatuses(
  findings: CitationDensityFinding[],
  key: keyof CitationDensityFinding["citationStatus"]
): Record<CitationSupportStatus, number> {
  return findings.reduce<Record<CitationSupportStatus, number>>((counts, finding) => {
    counts[finding.citationStatus[key]] += 1;
    return counts;
  }, {
    verified: 0,
    referenced_not_produced: 0,
    needed: 0,
    not_found: 0,
    not_applicable: 0,
  });
}

function formatEstimateGapType(value: CitationDensityFinding["estimateGapType"]): string {
  return value.replace(/_/g, " ");
}

function formatFindingImpact(finding: CitationDensityFinding): string {
  const parts = [
    finding.impact.dollarImpact !== null && finding.impact.dollarImpact !== undefined
      ? formatMoney(finding.impact.dollarImpact)
      : null,
    finding.impact.laborHoursImpact !== null && finding.impact.laborHoursImpact !== undefined
      ? `${finding.impact.laborHoursImpact} labor hrs`
      : null,
    `safety ${finding.impact.safetyImpact}`,
  ].filter(Boolean);
  return parts.join(", ");
}

function formatAuthorityStatusSummary(finding: CitationDensityFinding): string {
  if (finding.verifiedAuthorityCount > 0) return `${finding.verifiedAuthorityCount} verified`;
  if (finding.missingAuthorityTypes.length > 0) return `missing ${finding.missingAuthorityTypes.map(formatAuthorityKey).join(", ")}`;
  return "estimate evidence only";
}

function formatAuthorityKey(value: string): string {
  const labels: Record<string, string> = {
    oem: "OEM",
    pPages: "P-page",
    scrs: "SCRS",
    deg: "DEG",
    nhtsa: "NHTSA",
    stateRegulation: "state regulation",
    policy: "policy",
    invoiceOrCompletionProof: "invoice/completion",
    photoOrTeardownProof: "photos/teardown",
  };
  return labels[value] ?? value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

type EstimateDeltaBucket = "only_first" | "only_second" | "changed" | "gap";
type EstimateDeltaMode = "dueling" | "sequential" | "neutral";

function buildEstimateDeltaSections(comparisonRows: EstimateComparisonRow[]): CarrierReportDocument["sections"] {
  const mode = detectEstimateDeltaMode(comparisonRows);
  const titles = getEstimateDeltaSectionTitles(mode);
  const sections: CarrierReportDocument["sections"] = [
    buildEstimateDeltaSection(comparisonRows, "only_first", mode, titles.onlyFirst),
    buildEstimateDeltaSection(comparisonRows, "only_second", mode, titles.onlySecond),
    buildEstimateDeltaSection(comparisonRows, "changed", mode, titles.changed),
    buildEstimateDeltaSection(comparisonRows, "gap", mode, "Possible Rekey / Lock / Supplement Gaps"),
  ];

  return sections.filter((section) => (section.bullets?.length ?? 0) > 0);
}

function buildEstimateDeltaSection(
  comparisonRows: EstimateComparisonRow[],
  bucket: EstimateDeltaBucket,
  mode: EstimateDeltaMode,
  title: string
): NonNullable<CarrierReportDocument["sections"]>[number] {
  const result = buildEstimateDeltaBullets(comparisonRows, bucket, mode);

  return {
    title: result.truncated ? `Top ${title.toLowerCase()}` : title,
    bullets: result.truncated
      ? [`Showing ${result.visibleCount} of ${result.totalCount} matching items.`, ...result.bullets]
      : result.bullets,
  };
}

function getEstimateDeltaSectionTitles(mode: EstimateDeltaMode): {
  onlyFirst: string;
  onlySecond: string;
  changed: string;
} {
  if (mode === "dueling") {
    return {
      onlyFirst: "ONLY IN SHOP ESTIMATE",
      onlySecond: "ONLY IN CARRIER ESTIMATE",
      changed: "CHANGED BETWEEN ESTIMATES",
    };
  }

  if (mode === "sequential") {
    return {
      onlyFirst: "ADDED IN NEWER ESTIMATE",
      onlySecond: "REMOVED FROM NEWER ESTIMATE",
      changed: "CHANGED FROM PRIOR ESTIMATE",
    };
  }

  return {
    onlyFirst: "ONLY IN ESTIMATE 1",
    onlySecond: "ONLY IN ESTIMATE 2",
    changed: "CHANGED BETWEEN ESTIMATES",
  };
}

function detectEstimateDeltaMode(comparisonRows: EstimateComparisonRow[]): EstimateDeltaMode {
  if (comparisonRows.length === 0) return "neutral";

  const sourcePairs = comparisonRows
    .map((row) => ({ lhs: (row.lhsSource ?? "").trim(), rhs: (row.rhsSource ?? "").trim() }))
    .filter((row) => row.lhs || row.rhs);

  if (sourcePairs.length === 0) {
    return "neutral";
  }

  const hasShopCarrierSignals = sourcePairs.some((pair) => {
    const leftRole = detectEstimateSourceRole(pair.lhs);
    const rightRole = detectEstimateSourceRole(pair.rhs);
    return (
      (leftRole === "shop" && rightRole === "carrier") ||
      (leftRole === "carrier" && rightRole === "shop")
    );
  });
  if (hasShopCarrierSignals) return "dueling";

  const hasSequentialSignals = sourcePairs.some((pair) =>
    looksSequentialEstimateLabel(pair.lhs) || looksSequentialEstimateLabel(pair.rhs)
  );
  const likelySameEstimateFamily = sourcePairs.some((pair) =>
    pair.lhs && pair.rhs && looksSameEstimateFamily(pair.lhs, pair.rhs)
  );

  if (hasSequentialSignals && likelySameEstimateFamily) {
    return "sequential";
  }

  return "neutral";
}

function buildEstimateDeltaBullets(
  comparisonRows: EstimateComparisonRow[],
  bucket: EstimateDeltaBucket,
  mode: EstimateDeltaMode
): { bullets: string[]; totalCount: number; visibleCount: number; truncated: boolean } {
  const seenLabels = new Set<string>();
  const allBullets = comparisonRows
    .filter((row) => !isEstimateDeltaExcludedRow(row))
    .filter((row) => rowMatchesEstimateDeltaBucket(row, bucket, mode))
    .map((row) => formatEstimateDeltaBullet(row, bucket, mode))
    .filter((bullet): bullet is string => Boolean(bullet))
    .filter((bullet) => {
      const label = bullet.split(":")[0]?.trim().toLowerCase();
      if (!label || seenLabels.has(label)) {
        return false;
      }
      seenLabels.add(label);
      return true;
    });
  const bullets = allBullets.slice(0, 8);

  if (bullets.length > 0) {
    return {
      bullets,
      totalCount: allBullets.length,
      visibleCount: bullets.length,
      truncated: allBullets.length > bullets.length,
    };
  }

  let fallback: string[];
  switch (bucket) {
    case "only_first":
      fallback = ["No added items isolated from the newer estimate."];
      break;
    case "only_second":
      fallback = ["No items missing from the newer estimate were isolated."];
      break;
    case "changed":
      fallback = ["No changed labor, quantity, or price lines were isolated."];
      break;
    case "gap":
      fallback = ["No rekey, lock, or supplement gap was detectable."];
      break;
  }

  return { bullets: fallback, totalCount: 0, visibleCount: fallback.length, truncated: false };
}

function rowMatchesEstimateDeltaBucket(
  row: EstimateComparisonRow,
  bucket: EstimateDeltaBucket,
  mode: EstimateDeltaMode
): boolean {
  const sides = resolveEstimateDeltaSides(row, mode);
  const hasFirst = hasComparisonValue(sides.firstValue);
  const hasSecond = hasComparisonValue(sides.secondValue);
  const text = buildEstimateDeltaSearchText(row);

  if (bucket === "only_first") return hasFirst && !hasSecond;
  if (bucket === "only_second") return !hasFirst && hasSecond;
  if (bucket === "changed") {
    return (
      hasFirst &&
      hasSecond &&
      formatEstimateDeltaComparableValue(sides.firstValue, row.valueUnit) !==
        formatEstimateDeltaComparableValue(sides.secondValue, row.valueUnit) &&
      isLaborQtyOrPriceDelta(row)
    );
  }
  return (
    /re-?key|lock support|\block\b|supplement|supp\b/i.test(text) &&
    (!hasFirst ||
      !hasSecond ||
      formatEstimateDeltaComparableValue(sides.firstValue, row.valueUnit) !==
        formatEstimateDeltaComparableValue(sides.secondValue, row.valueUnit))
  );
}

function formatEstimateDeltaBullet(
  row: EstimateComparisonRow,
  bucket: EstimateDeltaBucket,
  mode: EstimateDeltaMode
): string {
  const label =
    normalizeEstimateOperationLabel(row.operation) ||
    normalizeEstimateOperationLabel({
      operation: row.operation,
      partName: row.partName,
      category: row.category,
      label: cleanCustomerFacingEstimateLine(row.operation ?? row.partName ?? row.category ?? ""),
    });

  if (!label || /^(?:Repair Operation|Estimate item|Parser review needed)$/i.test(label)) {
    return "";
  }

  if (bucket === "only_first" || bucket === "only_second") {
    return label;
  }

  const sides = resolveEstimateDeltaSides(row, mode);
  const first = formatEstimateDeltaComparableValue(sides.firstValue, row.valueUnit) || "-";
  const second = formatEstimateDeltaComparableValue(sides.secondValue, row.valueUnit) || "-";
  const derivedDelta = deriveDirectionalDelta(sides.firstValue, sides.secondValue, row.valueUnit);
  const deltaSign = derivedDelta ?? formatEstimateDeltaComparableValue(row.delta, row.valueUnit);
  const change = deltaSign ? ` (${deltaSign})` : "";

  return `${label}: ${first} → ${second}${change}`;
}

function resolveEstimateDeltaSides(
  row: EstimateComparisonRow,
  mode: EstimateDeltaMode
): {
  firstValue: EstimateComparisonRow["lhsValue"];
  secondValue: EstimateComparisonRow["rhsValue"];
} {
  if (mode === "dueling") {
    const lhsRole = detectEstimateSourceRole(row.lhsSource ?? "");
    const rhsRole = detectEstimateSourceRole(row.rhsSource ?? "");
    if (lhsRole === "shop" && rhsRole === "carrier") {
      return { firstValue: row.lhsValue, secondValue: row.rhsValue };
    }
    if (lhsRole === "carrier" && rhsRole === "shop") {
      return { firstValue: row.rhsValue, secondValue: row.lhsValue };
    }
    return { firstValue: row.lhsValue, secondValue: row.rhsValue };
  }

  if (mode !== "sequential") {
    return { firstValue: row.lhsValue, secondValue: row.rhsValue };
  }

  const lhsSource = row.lhsSource ?? "";
  const rhsSource = row.rhsSource ?? "";
  const lhsLooksNewer = /\b(new|newer|latest|current|revised|updated|supplement|supp)\b/i.test(lhsSource);
  const rhsLooksOlder = /\b(old|older|prior|previous|original|initial)\b/i.test(rhsSource);

  if (lhsLooksNewer || rhsLooksOlder) {
    return { firstValue: row.lhsValue, secondValue: row.rhsValue };
  }

  return { firstValue: row.rhsValue, secondValue: row.lhsValue };
}

function isLaborQtyOrPriceDelta(row: EstimateComparisonRow): boolean {
  if (row.valueUnit === "currency" || row.valueUnit === "hours" || row.valueUnit === "count") {
    return true;
  }

  return /\b(labor|hour|qty|quantity|rate|price|pricing|cost|amount|total|material|refinish|paint)\b/i.test(
    buildEstimateDeltaSearchText(row)
  );
}

function formatEstimateDeltaComparableValue(
  value: EstimateComparisonRow["lhsValue"],
  unit?: EstimateComparisonRow["valueUnit"]
): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (unit === "currency") return value.toFixed(2);
    return value.toFixed(1);
  }

  const raw = value === null || value === undefined ? "" : `${value}`.trim();
  if (raw && /^\$/.test(raw)) return raw;
  if (raw && /^-?\d+(?:\.\d+)?$/.test(raw)) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return raw;
    if (unit === "currency") return parsed.toFixed(2);
    return parsed.toFixed(1);
  }

  if (raw && /[$\d]/.test(raw)) return raw;
  const formatted = formatComparisonValue(value);
  if (formatted) return formatted;
  return raw;
}

function deriveDirectionalDelta(
  firstValue: EstimateComparisonRow["lhsValue"],
  secondValue: EstimateComparisonRow["rhsValue"],
  unit?: EstimateComparisonRow["valueUnit"]
): string | null {
  const first = parseComparableNumber(firstValue);
  const second = parseComparableNumber(secondValue);
  if (first === null || second === null) return null;

  const precision = unit === "currency" ? 2 : 1;
  const delta = second - first;
  const formatted = delta.toFixed(precision);
  return `${delta >= 0 ? "+" : ""}${formatted}`;
}

function parseComparableNumber(value: EstimateComparisonRow["lhsValue"]): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[$,%\s,]/g, "");
  if (!cleaned || !/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildEstimateDeltaSearchText(row: EstimateComparisonRow): string {
  return `${row.category ?? ""} ${row.operation ?? ""} ${row.partName ?? ""} ${row.lhsValue ?? ""} ${row.rhsValue ?? ""} ${row.delta ?? ""} ${row.notes?.join(" ") ?? ""}`;
}

function hasComparisonValue(value: EstimateComparisonRow["lhsValue"]): boolean {
  return value !== null && value !== undefined && `${value}`.trim().length > 0;
}

function detectEstimateSourceRole(value: string): "shop" | "carrier" | "unknown" {
  const cleaned = value.toLowerCase();
  if (/\b(shop|repair\s+facility|body\s+shop|collision\s+center)\b/.test(cleaned)) return "shop";
  if (/\b(carrier|insurer|insurance)\b/.test(cleaned)) return "carrier";
  return "unknown";
}

function looksSequentialEstimateLabel(value: string): boolean {
  return /\b(old|older|prior|previous|original|initial|new|newer|latest|current|revised|updated|supplement|supp|version|revision)\b/i.test(
    value
  );
}

function looksSameEstimateFamily(lhsSource: string, rhsSource: string): boolean {
  const normalizeSource = (value: string) =>
    value
      .toLowerCase()
      .replace(/\b(old|older|prior|previous|original|initial|new|newer|latest|current|revised|updated|supplement|supp|version|revision|estimate|file|workfile)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const left = normalizeSource(lhsSource);
  const right = normalizeSource(rhsSource);
  if (!left || !right) return false;
  if (left === right) return true;

  const leftTokens = new Set(left.split(" ").filter((token) => token.length > 2));
  const rightTokens = right.split(" ").filter((token) => token.length > 2);
  const overlap = rightTokens.filter((token) => leftTokens.has(token)).length;
  return overlap >= Math.max(1, Math.min(leftTokens.size, rightTokens.length));
}

function isEstimateDeltaExcludedRow(row: EstimateComparisonRow): boolean {
  return /\b(total|subtotal|tax|deductible|betterment)\b/i.test(
    `${row.category ?? ""} ${row.operation ?? ""} ${row.partName ?? ""}`
  );
}

function buildEstimateDeltaSummary(
  model: AnnotatedEstimateReviewModel
): CarrierReportDocument["summary"] {
  const rows = model.comparisonRows.filter((row) => !isEstimateDeltaExcludedRow(row));
  const mode = detectEstimateDeltaMode(rows);
  const changedCount = rows.filter((row) => rowMatchesEstimateDeltaBucket(row, "changed", mode)).length;
  const addedCount = rows.filter((row) => rowMatchesEstimateDeltaBucket(row, "only_first", mode)).length;
  const missingCount = rows.filter((row) => rowMatchesEstimateDeltaBucket(row, "only_second", mode)).length;
  const gapCount = rows.filter((row) => rowMatchesEstimateDeltaBucket(row, "gap", mode)).length;

  return [
    { label: "Vehicle", value: model.vehicleIdentity },
    { label: "VIN", value: model.vin },
    { label: "Added", value: String(addedCount) },
    { label: "Missing", value: String(missingCount) },
    { label: "Changed", value: String(changedCount) },
    { label: "Possible Gaps", value: String(gapCount) },
  ];
}

function inferEstimateSection(operation: string): string {
  if (/scan|calibration|adas|road test/i.test(operation)) return "Scan, calibration, and road-test operations";
  if (/frame|measure|structural|aperture|door|geometry/i.test(operation)) return "Structural, measurement, and fit-verification operations";
  if (/paint|refinish|test fit|blend/i.test(operation)) return "Refinish and test-fit operations";
  if (/seat belt|srs|restraint/i.test(operation)) return "Safety restraint operations";
  if (/align/i.test(operation)) return "Alignment operations";
  return "Related estimate operations";
}

function buildEstimateScrubFindings(
  exportModel: ReturnType<typeof buildExportModel>
): EstimateScrubFinding[] {
  const sourceFallback = buildSourceFallback(exportModel);
  const findings = exportModel.supplementItems.map((item) => {
    const operation = normalizeEstimateOperationName(item.title);
    const estimatePresence =
      item.kind === "missing_operation" || item.kind === "missing_verification"
        ? "missing"
        : item.kind === "underwritten_operation"
          ? "under-documented"
          : "present";
    const sources = buildFindingSources(item.source, item.evidence, sourceFallback);
    const citationGapBucket = classifyEstimateScrubCitationGapBucket({
      text: `${item.title} ${item.category} ${item.rationale} ${item.source ?? ""} ${item.evidence ?? ""}`,
      estimatePresence,
      sources,
    });

    return {
      operation,
      status: formatFindingStatus(estimatePresence, `${item.title} ${item.category}`),
      supportType: inferSupportType(`${item.title} ${item.category} ${item.rationale}`),
      severity: mapSeverity(item.priority, item.leverageScore),
      whyItMatters: cleanScrubberText(item.rationale),
      citationGapBucket,
      estimatePresence,
      sources,
      recommendedRevision: buildRecommendedRevision(operation, estimatePresence, item.rationale),
    } satisfies Omit<
      EstimateScrubFinding,
      "rationaleSummary" | "evidenceChainSummary" | "riskIfOmitted" | "supportConfidenceIndicator"
    >;
  });

  return dedupeFindings(findings.map(enrichEstimateScrubFinding)).slice(0, 12);
}

export function classifyEstimateScrubCitationGapBucket(params: {
  text: string;
  estimatePresence: EstimateScrubFinding["estimatePresence"];
  sources?: SourceCitation[];
}): EstimateScrubCitationGapBucket {
  const text = params.text;
  const hasVerifiedProcedureSource = params.sources?.some((source) =>
    source.verified && /DriveOEM|PositionStatement/i.test(source.sourceType)
  ) ?? false;
  const hasVerifiedProofSource = params.sources?.some((source) =>
    source.verified && /invoice|receipt|completion|final scan|scan report|calibration certificate|alignment printout/i.test(`${source.title} ${source.note ?? ""}`)
  ) ?? false;
  const hasVerifiedPPageSource = params.sources?.some((source) =>
    source.verified && /p-?page|estimating guide|database/i.test(`${source.title} ${source.note ?? ""}`)
  ) ?? false;

  if (/general|non[-\s]?make[-\s]?specific|research lead|internet lead|not vehicle specific|weak/i.test(text)) {
    return "weak_do_not_lead";
  }
  if (/invoice|receipt|proof|completion record|final scan|scan report|calibration certificate|alignment printout|completed/i.test(text) && !hasVerifiedProofSource) {
    return "needs_invoice_or_completion_proof";
  }
  if (/p-?page|included operation|not included|estimating guide|database/i.test(text) && !hasVerifiedPPageSource) {
    return "needs_p_page_support";
  }
  if (/oem|procedure|position statement|repair manual|adas|calibration|scan/i.test(text) && !hasVerifiedProcedureSource) {
    return "needs_oem_procedure";
  }
  if (/reduced|rate|labor|material|refinish allowance|underwrit|price|pricing|alternate allowance/i.test(text)) {
    return "reduced_by_carrier";
  }
  if (params.estimatePresence === "under-documented") return "present_but_under_documented";
  if (params.estimatePresence === "missing") return "missing_from_carrier";
  return "present_but_under_documented";
}

function inferSupportType(value: string): EstimateScrubFinding["supportType"] {
  if (/refinish|blend|paint|clear coat|color/i.test(value)) {
    return "RefinishOperation";
  }
  if (/material|adhesive|seam sealer|corrosion|one-time|one time|hazard/i.test(value)) {
    return "MaterialRequirement";
  }
  if (/SCRS|position statement|procedure/i.test(value)) {
    return "PositionStatement";
  }
  return "OEM";
}

function buildFindingSources(
  source: string | undefined,
  evidence: string | undefined,
  fallback: SourceCitation[]
): SourceCitation[] {
  const sources: SourceCitation[] = [];

  if (source) {
    sources.push({
      title: cleanScrubberText(source),
      sourceType: inferSourceType(source),
      verified: isVerifiedScrubberSource(source),
    });
  }

  if (evidence && evidence !== source) {
    sources.push({
      title: cleanScrubberText(evidence),
      sourceType: inferSourceType(evidence),
      verified: isVerifiedScrubberSource(evidence),
    });
  }

  return sources.length > 0
    ? dedupeSources(sources).slice(0, 3)
    : fallback.slice(0, 3).map((item) => ({
        ...item,
        note: item.note ? `${item.note}; referenced file support` : "Referenced file support; verify procedure citation before treating as OEM support",
        verified: item.sourceType === "EstimateParser" || item.sourceType === "UploadedDocument" ? item.verified : false,
      }));
}

function buildSourceFallback(exportModel: ReturnType<typeof buildExportModel>): SourceCitation[] {
  const retrievalSources =
    exportModel.retrievalSummary?.sourcesInfluencingFindings.map((source) => ({
      title: cleanScrubberText(source.title),
      sourceType: inferSourceType(`${source.title} ${source.sourceType}`),
      note: `${source.sourceType} source`,
      verified: true,
    })) ?? [];

  return [
    ...retrievalSources,
    ...(exportModel.reportFields.documentedHighlights.some((item) => /ccc|awf|workfile/i.test(item))
      ? [{ title: "CCC workfile artifact", sourceType: "EstimateParser" as const, verified: true }]
      : []),
    { title: "Existing estimate parser", sourceType: "EstimateParser", verified: true },
    { title: "Uploaded claim documents", sourceType: "UploadedDocument", verified: true },
  ];
}

function inferSourceType(value: string): SourceCitation["sourceType"] {
  if (/SCRS/i.test(value)) return "SCRS";
  if (/DEG/i.test(value)) return "DEG";
  if (/position statement/i.test(value)) return "PositionStatement";
  if (/drive|folder|oem/i.test(value)) return "DriveOEM";
  if (/web|internet|http/i.test(value)) return "InternetOEM";
  if (/estimate parser/i.test(value)) return "EstimateParser";
  return "UploadedDocument";
}

function enrichEstimateScrubFinding(
  finding: Omit<
    EstimateScrubFinding,
    "rationaleSummary" | "evidenceChainSummary" | "riskIfOmitted" | "supportConfidenceIndicator"
  >
): EstimateScrubFinding {
  const verifiedCount = finding.sources.filter((source) => source.verified).length;
  const referencedCount = finding.sources.length - verifiedCount;
  const supportConfidenceIndicator =
    verifiedCount > 0 ? "verified" : referencedCount > 0 ? "referenced" : "missing";
  return {
    ...finding,
    rationaleSummary: `${finding.operation}: ${finding.whyItMatters}`,
    evidenceChainSummary: finding.sources.length > 0
      ? finding.sources.map((source) =>
          `${source.title} (${source.verified ? "verified" : "referenced"})`
        ).join("; ")
      : "No direct source chain is attached; verify OEM or procedure support before use.",
    riskIfOmitted:
      finding.estimatePresence === "present"
        ? "If under-explained, the operation may still lack enough support for review."
        : "If omitted, the estimate may fail to document a potentially required operation or allowance.",
    supportConfidenceIndicator,
  };
}

function formatMoney(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function mapSeverity(
  priority: "low" | "medium" | "high",
  leverageScore?: number
): EstimateScrubFinding["severity"] {
  if (priority === "high" && (leverageScore ?? 0) >= 85) return "critical";
  if (priority === "high") return "high";
  if (priority === "medium") return "moderate";
  return "informational";
}

function formatFindingStatus(
  presence: EstimateScrubFinding["estimatePresence"],
  text: string
): string {
  if (presence === "missing") return "Missing operation";
  if (presence === "under-documented") return "Under-documented operation";
  if (/refinish|blend/i.test(text)) return "Refinish review item";
  if (/material|allowance|hazard/i.test(text)) return "Material allowance review item";
  return "Present with review note";
}

function buildRecommendedRevision(
  operation: string,
  presence: EstimateScrubFinding["estimatePresence"],
  rationale: string
): string {
  const cleanedRationale = cleanScrubberText(rationale);
  if (presence === "missing") {
    return `Add or formally address ${operation} if verified procedure support applies. ${cleanedRationale}`;
  }
  if (presence === "under-documented") {
    return `Revise the estimate note for ${operation} to document the supporting procedure, material, labor, or verification basis. ${cleanedRationale}`;
  }
  return `Retain ${operation} only with clear estimate documentation and source support. ${cleanedRationale}`;
}

function normalizeEstimateOperationName(value: string): string {
  const cleaned =
    normalizeEstimateOperationLabel({
      label: cleanScrubberText(value),
      operation: cleanScrubberText(value),
    }) ||
    cleanEstimateLineForTechnicalExport(cleanScrubberText(value)) ||
    cleanOperationDisplayText(cleanScrubberText(value)) ||
    cleanScrubberText(value);
  return cleaned
    .replace(/\bpre repair\b/gi, "Pre-repair")
    .replace(/\bpost repair\b/gi, "Post-repair")
    .replace(/\badas\b/gi, "ADAS")
    .replace(/\boem\b/gi, "OEM")
    .replace(/\br\s*&\s*i\b/gi, "R&I")
    .trim() || "Estimate Operation";
}

function cleanScrubberText(value: string): string {
  return value
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/\b(?:page|pg)\s*\d+\b/gi, "")
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, "")
    .replace(/[|]{2,}/g, "|")
    .replace(/[_]{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isVerifiedScrubberSource(value: string): boolean {
  if (/inferred|pending invoice|procedure support|referenced but not produced|not produced|referenced[-\s]?only|missing|needs review|research lead|general|non[-\s]?make[-\s]?specific/i.test(value)) {
    return false;
  }
  return /\b(oem procedure|official procedure|position statement|invoice|final scan report|scan report|calibration certificate|alignment printout|uploaded procedure|repair procedure document|estimate excerpt|carrier estimate|shop estimate|current estimate|estimate parser|uploaded claim documents?)\b/i.test(value);
}

function cleanCustomerFacingEstimateLine(value: string | null | undefined): string {
  if (!value) return "";
  const scrubbed = cleanScrubberText(value);
  const structuralFallback = resolveStructuralParserFallback(scrubbed);
  if (structuralFallback) return structuralFallback;
  const cleaned =
    normalizeEstimateOperationLabel({ label: scrubbed, operation: scrubbed }) ||
    cleanEstimateLineForTechnicalExport(scrubbed) ||
    cleanOperationDisplayText(scrubbed) ||
    scrubbed;

  return cleaned
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\$?\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z$])/g, "$1 $2")
    .replace(/\bparser\s+fragment\b/gi, "")
    .replace(/\b(?:four-whe|four-w|post-pull c|alignmen|confi|repai)\b(?=[\s.,;:)]|$)/gi, "")
    .replace(/\b(?:evidence|chain|source|finding|issue|doc|line)[-_ ]?[a-z0-9]{4,}\b/gi, "")
    .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, "")
    .replace(/[{}[\]<>]/g, "")
    .replace(/\b(?:undefined|null|NaN)\b/gi, "")
    .replace(/\s*[|]{1,}\s*/g, " - ")
    .replace(/\s{2,}/g, " ")
    .replace(/\bA M\b/g, "A/M")
    .replace(/^[-:;,\s]+|[-:;,\s]+$/g, "")
    .trim()
    .slice(0, 220);
}

function resolveStructuralParserFallback(value: string): string {
  if (!/structural|frame|measure|measurement|pull|post-pull|setup|set up|alignment/i.test(value)) {
    return "";
  }
  if (/\b(pull|post-pull|set\s*up|setup|bench|realign)\b/i.test(value)) {
    return "Structural setup and pull verification";
  }
  if (/\b(structural|frame|measure|measurement|alignment|geometry)\b/i.test(value)) {
    return "Structural frame and measurement verification";
  }
  return "";
}

function dedupeFindings(findings: EstimateScrubFinding[]): EstimateScrubFinding[] {
  const byOperation = new Map<string, EstimateScrubFinding>();
  for (const finding of findings) {
    const key = normalizeDedupeKey(finding.operation);
    const existing = byOperation.get(key);
    if (!existing || severityRank(finding.severity) > severityRank(existing.severity)) {
      byOperation.set(key, finding);
    }
  }
  return [...byOperation.values()];
}

function dedupeSources(sources: SourceCitation[]): SourceCitation[] {
  const seen = new Set<string>();
  const kept: SourceCitation[] = [];
  for (const source of sources) {
    const key = normalizeDedupeKey(`${source.sourceType}:${source.title}`);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(source);
  }
  return kept;
}

function normalizeDedupeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function severityRank(severity: EstimateScrubFinding["severity"]): number {
  switch (severity) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "moderate":
      return 2;
    case "informational":
      return 1;
  }
}
