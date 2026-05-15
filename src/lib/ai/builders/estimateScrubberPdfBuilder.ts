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
import type { EstimateScrubFinding, SourceCitation } from "@/lib/ai/types/estimateScrubber";
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
  | "Needs invoice/proof"
  | "Needs supplement review"
  | "Informational repair-planning reminder";

export type EstimateAnnotationSeverity = "green" | "yellow" | "red" | "blue" | "gray";
export type EstimateAnnotationSupportStatus = "verified" | "referenced" | "inferred" | "missing";

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
    filename: "annotated-estimate-scrubber.pdf",
    title: "Annotated Estimate Scrubber",
    reportLabel: "Annotated Estimate Scrubber",
    subtitle:
      "Scrubbed estimate markup that places missing, under-documented, reduced, or proof-needed items beside the estimate line or section they relate to.",
    sections: [
      {
        title: "Markup Legend",
        bullets: buildMarkupLegendBullets(),
      },
      {
        title: "Estimate Selected For Scrub",
        body: `${model.scrubTarget.label} was selected for the annotated scrub. ${model.scrubTarget.basis}`,
      },
      {
        title: "Annotated Estimate Lines",
        bullets: buildTargetEstimateMarkupBullets({
          model,
          annotations,
          audience,
          promptGeneratedText: params.promptGeneratedText,
        }),
      },
      {
        title: "Requested Clarifications",
        bullets: buildEstimatorChangeRequestBullets({
          annotations,
          audience,
          promptGeneratedText: params.promptGeneratedText,
        }),
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
      { label: "Scrub Target", value: params.model.scrubTarget.label },
      { label: "Line Anchors", value: String(params.model.lineAnchors.length) },
      { label: "Annotated Findings", value: String(params.annotations.length) },
      { label: "Missing / Reduced", value: String(redCount) },
      { label: "Under-Documented", value: String(yellowCount) },
      { label: "Needs Proof / OEM", value: String(blueCount) },
    ],
    sections: params.sections,
    footer: params.footer ?? [
      "This annotated estimate review is an estimate markup, not a DOI complaint or legal-violation analysis.",
      "Estimate changes are framed as repair-scope, documentation, supplement, or proof requests.",
      "Inferred support is not treated as confirmed procedure support. Attach the OEM procedure, invoice, or completion record before treating a support item as verified.",
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
      "Only one usable estimate set was isolated. The annotated review scrubs the uploaded estimate lines that could be matched to the current repair intelligence findings.",
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

function buildMarkupLegendBullets(): string[] {
  return [
    "[SUPPORTED]: supported and present.",
    "[UNDER-DOCUMENTED]: present but under-documented.",
    "[MISSING / REDUCED]: missing or materially reduced.",
    "[NEEDS PROOF]: needs proof, invoice, scan, calibration record, OEM procedure, or alignment printout.",
    "[INFO]: informational only.",
  ];
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
      const severity = category === "Informational repair-planning reminder" ? "gray" : "red";
      const anchor = findBestLineAnchor(normalizeDedupeKey(`${targetLine} ${higherLine ?? ""} ${title}`), lineAnchors);
      const explanation = buildComparisonExplanation(comparisonRow, lowerLine, higherLine);

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
  if (/labor|rate|material|refinish|reduced|allowance|price|pricing/i.test(combined)) return "Reduced labor/material";
  if (/scan|calibration|alignment|invoice|printout|record/i.test(combined)) return "Needs invoice/proof";
  return row.deltaType === "same" ? "Informational repair-planning reminder" : "Needs supplement review";
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
  if (bestAnchor) return bestAnchor;

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

  return {
    estimateId: "estimate-upload",
    lineId: `anchor-${normalizeDedupeKey(`${section} ${rawLine}`).replace(/\s+/g, "-") || "unisolated"}`,
    lineNumber: 0,
    section: cleanCustomerFacingEstimateLine(section) || "Related estimate section",
    text: cleanCustomerFacingEstimateLine(rawLine) || cleanCustomerFacingEstimateLine(finding.operation) || "Estimate line not isolated",
    sourceRole: "unknown",
  };
}

function classifyAnnotationCategory(finding: EstimateScrubFinding): EstimateAnnotationCategory {
  const text = `${finding.operation} ${finding.status} ${finding.whyItMatters} ${finding.recommendedRevision}`;
  if (finding.estimatePresence === "missing") return "Missing operation";
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
  if (
    finding.estimatePresence === "missing" ||
    category === "Reduced labor/material" ||
    category === "Alternate/aftermarket part concern"
  ) return "red";
  if (category === "Needs invoice/proof" || category === "Needs OEM procedure support") return "blue";
  if (finding.estimatePresence === "under-documented" || category === "Needs supplement review") return "yellow";
  if (finding.estimatePresence === "present") return "green";
  return "gray";
}

function buildCustomerFacingRequest(
  finding: EstimateScrubFinding,
  category: EstimateAnnotationCategory
): string {
  if (category === "Needs invoice/proof") {
    return `Ask for written confirmation that ${finding.operation.toLowerCase()} was completed and documented.`;
  }
  if (category === "Needs OEM procedure support") {
    return `Ask the insurer or repair shop to confirm whether ${finding.operation.toLowerCase()} is included and documented.`;
  }
  if (category === "Alternate/aftermarket part concern") {
    return "Ask for written confirmation that the selected part is appropriate for the repair, policy, fit, safety, warranty, and repair-procedure requirements.";
  }
  if (category === "Missing operation") {
    return `Ask the insurer or repair shop to confirm whether ${finding.operation.toLowerCase()} is included and documented.`;
  }
  return `Ask the insurer or repair shop to confirm whether this item is included and documented.`;
}

function buildEstimatorFacingRequest(
  finding: EstimateScrubFinding,
  category: EstimateAnnotationCategory
): string {
  if (category === "Needs invoice/proof") {
    return `Needs proof: ${finding.operation} is referenced but final invoice-backed completion is not shown. Request final scan, calibration, alignment, material, or invoice support before closing this item.`;
  }
  if (category === "Needs OEM procedure support") {
    return `Add or document ${finding.operation} if OEM procedure applies; attach procedure-backed scan, calibration, fit-verification, or repair-method support.`;
  }
  if (category === "Alternate/aftermarket part concern") {
    return "Alternate part difference. Confirm whether the selected part complies with policy, fit, safety, warranty, and repair-procedure requirements.";
  }
  if (category === "Reduced labor/material") {
    return `Review labor, refinish, material, rate, alternate-part, or allowance reduction for ${finding.operation}; add a supported supplement line or document the accepted variance.`;
  }
  if (category === "Needs supplement review") {
    return `Route ${finding.operation} for supplement review with the supporting estimate excerpt, photos, procedure note, and repair-plan basis.`;
  }
  return `Add or clarify ${finding.operation}; document the estimate basis and attach supporting repair-plan evidence.`;
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

function formatAnnotationEvidence(
  annotation: EstimateAnnotation,
  audience: AnnotatedEstimateAudience
): string {
  if (annotation.sourceRefs.length > 0) {
    return annotation.sourceRefs.join("; ");
  }
  if (audience === "customer") {
    return "Current estimate review; supporting document still needs to be attached or confirmed";
  }
  return annotation.supportStatus === "verified"
    ? "Verified support attached"
    : annotation.supportStatus === "referenced"
      ? "Referenced estimate comparison or source; confirm final document"
      : annotation.supportStatus === "inferred"
        ? "Inferred from current estimate review; verify before treating as procedure support"
        : "No support document attached";
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

function formatAnnotatedIssue(
  annotation: EstimateAnnotation,
  audience: AnnotatedEstimateAudience
): string {
  const evidenceBasis = formatAnnotationEvidence(annotation, audience);
  const request = audience === "customer" ? annotation.customerText : annotation.estimatorText;
  const lineLabel = annotation.lineId ? `Line ${extractDisplayLineNumber(annotation.lineId)}` : annotation.section ?? "The selected estimate section";
  const status = formatStatusToken(annotation.severity);
  const support = formatSupportPosture(annotation.supportStatus);

  return [
    `${status}: ${annotation.title}`,
    `${lineLabel} currently shows ${annotation.anchorText}. ${annotation.explanation}`,
    `This matters because ${lowercaseFirst(buildWhyAnnotationMatters(annotation))}`,
    `The file support is ${support}: ${evidenceBasis}. ${request}`,
    audience === "admin" ? `Internal annotation reference: ${annotation.id}.` : null,
  ].filter(Boolean).join("\n\n");
}

function extractDisplayLineNumber(lineId: string): string {
  const match = lineId.match(/^line-(\d+)/);
  return match?.[1] ?? "item";
}

function buildWhyAnnotationMatters(annotation: EstimateAnnotation): string {
  if (annotation.category === "Needs invoice/proof") {
    return "completion proof affects whether the estimate can be treated as documented and closed.";
  }
  if (annotation.category === "Needs OEM procedure support") {
    return "procedure support controls whether the repair step is documented as applicable to this vehicle and damage path.";
  }
  if (annotation.category === "Reduced labor/material") {
    return "a reduced allowance can change whether the estimate carries the labor, material, refinish, or pricing support reflected elsewhere in the file.";
  }
  if (annotation.category === "Alternate/aftermarket part concern") {
    return "alternate part selection can affect fit, safety, warranty, repair procedure compliance, and policy review.";
  }
  if (annotation.category === "Missing operation") {
    return "an omitted operation may leave the repair plan incomplete unless another line clearly includes the work.";
  }
  return "the estimate should explain the repair basis clearly enough for supplement review and file documentation.";
}

function formatSupportPosture(status: EstimateAnnotationSupportStatus): string {
  switch (status) {
    case "verified":
      return "verified";
    case "referenced":
      return "referenced but not fully closed";
    case "inferred":
      return "inferred and not yet verified";
    case "missing":
      return "not established";
  }
}

function isPriorityEstimateLine(text: string): boolean {
  return /scan|calibration|adas|test fit|alignment|frame|structural|measure|corrosion|cavity|wax|refinish|material|aftermarket|a\/m|manual|included|labor|rate|pricing|one[- ]?time|supplement|seat belt|road test/i.test(text);
}

function formatEstimatorChangeRequest(
  annotation: EstimateAnnotation,
  audience: AnnotatedEstimateAudience
): string {
  const request = audience === "customer" ? annotation.customerText : annotation.estimatorText;
  const label = normalizeEstimateOperationLabel({
    label: annotation.title,
    operation: annotation.title,
    category: annotation.section,
  });
  if (!label) return "";

  const badge = getVisibleAnnotationBadge(annotation);
  return `${badge} ${label}: ${request} The support currently tied to this request is ${formatAnnotationEvidence(annotation, audience)}. Treat this as a supplement or documentation request unless the file also contains written claim-handling conduct.`;
}

function buildTargetEstimateMarkupBullets(params: {
  model: AnnotatedEstimateReviewModel;
  annotations: EstimateAnnotation[];
  audience: AnnotatedEstimateAudience;
  promptGeneratedText?: string | null;
}): string[] {
  const targetRole = params.model.scrubTarget.role;
  const targetAnchors = params.model.lineAnchors
    .filter((anchor) => targetRole === "unknown" || anchor.sourceRole === targetRole || anchor.sourceRole === "unknown")
    .slice(0, 40);
  const annotationByLine = new Map<string, EstimateAnnotation[]>();
  for (const annotation of params.annotations) {
    const key = annotation.lineId ?? normalizeDedupeKey(annotation.anchorText);
    annotationByLine.set(key, [...(annotationByLine.get(key) ?? []), annotation]);
  }
  const lineBlocks = targetAnchors.flatMap((anchor) => {
    const direct = annotationByLine.get(anchor.lineId) ?? [];
    const fuzzy = direct.length
      ? []
      : params.annotations.filter((annotation) =>
          normalizeDedupeKey(annotation.anchorText) === normalizeDedupeKey(anchor.text) ||
          normalizeDedupeKey(anchor.text).includes(normalizeDedupeKey(annotation.title))
        );
    const attached = [...direct, ...fuzzy].slice(0, 2);
    if (attached.length === 0 && !isPriorityEstimateLine(anchor.text)) {
      return [];
    }
    return [
      [
        `Line ${anchor.lineNumber}: ${anchor.text}`,
        ...(attached.length
          ? attached.map((annotation) => formatAnnotatedIssue(annotation, params.audience))
          : ["[INFO]: This line is present in the selected estimate and is retained as informational repair-planning context. No specific correction was generated for this line from the current structured scrubber model."]),
      ].join("\n\n"),
    ];
  });

  return [
    ...formatPromptGeneratedBullets(params.promptGeneratedText, "Stored prompt markup summary"),
    ...(lineBlocks.length
      ? lineBlocks
      : params.annotations.map((annotation) => formatAnnotatedIssue(annotation, params.audience))),
    ...(lineBlocks.length || params.annotations.length
      ? []
      : ["No line-level annotations were available from the current structured estimate model."]),
  ];
}

function buildEstimatorChangeRequestBullets(params: {
  annotations: EstimateAnnotation[];
  audience: AnnotatedEstimateAudience;
  promptGeneratedText?: string | null;
}): string[] {
  return [
    ...formatPromptGeneratedBullets(params.promptGeneratedText, "Stored prompt change request summary"),
    ...(params.annotations.length
      ? params.annotations
          .map((annotation) => formatEstimatorChangeRequest(annotation, params.audience))
          .filter(Boolean)
      : ["No estimator-facing change requests were isolated from the current estimate review."]),
  ];
}

type EstimateDeltaBucket = "only_first" | "only_second" | "changed" | "gap";
type EstimateDeltaMode = "dueling" | "sequential" | "neutral";

function buildEstimateDeltaSections(comparisonRows: EstimateComparisonRow[]): CarrierReportDocument["sections"] {
  const mode = detectEstimateDeltaMode(comparisonRows);
  const titles = getEstimateDeltaSectionTitles(mode);
  const sections: CarrierReportDocument["sections"] = [
    {
      title: titles.onlyFirst,
      bullets: buildEstimateDeltaBullets(comparisonRows, "only_first", mode),
    },
    {
      title: titles.onlySecond,
      bullets: buildEstimateDeltaBullets(comparisonRows, "only_second", mode),
    },
    {
      title: titles.changed,
      bullets: buildEstimateDeltaBullets(comparisonRows, "changed", mode),
    },
    {
      title: "Possible Rekey / Lock / Supplement Gaps",
      bullets: buildEstimateDeltaBullets(comparisonRows, "gap", mode),
    },
  ];

  return sections.filter((section) => (section.bullets?.length ?? 0) > 0);
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
): string[] {
  const seenLabels = new Set<string>();
  const bullets = comparisonRows
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
    })
    .slice(0, 8);

  if (bullets.length > 0) {
    return bullets;
  }

  switch (bucket) {
    case "only_first":
      return ["No added items isolated from the newer estimate."];
    case "only_second":
      return ["No items missing from the newer estimate were isolated."];
    case "changed":
      return ["No changed labor, quantity, or price lines were isolated."];
    case "gap":
      return ["No rekey, lock, or supplement gap was detectable."];
    default:
      return [];
  }
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
  const label = normalizeEstimateOperationLabel({
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

function getVisibleAnnotationBadge(annotation: EstimateAnnotation): string {
  switch (annotation.severity) {
    case "green":
      return "[SUPPORTED]";
    case "yellow":
      return "[UNDER-DOCUMENTED]";
    case "red":
      return "[MISSING / REDUCED]";
    case "blue":
      return "[NEEDS PROOF / OEM]";
    case "gray":
      return "[INFO]";
  }
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

function formatPromptGeneratedBullets(value: string | null | undefined, label: string): string[] {
  const cleaned = cleanPromptGeneratedText(value);
  if (!cleaned) return [];

  const bullets = cleaned
    .split(/\n+/)
    .map((line) => line.replace(/^[-*\d. )]+/, "").trim())
    .filter(Boolean)
    .slice(0, 8);

  return bullets.length
    ? bullets.map((line, index) => `${index === 0 ? label : "Stored prompt detail"}: ${line}`)
    : [`${label}: ${cleaned}`];
}

function formatStatusToken(status: EstimateAnnotationSeverity): string {
  switch (status) {
    case "green":
      return "[SUPPORTED]";
    case "yellow":
      return "[UNDER-DOCUMENTED]";
    case "red":
      return "[MISSING / REDUCED]";
    case "blue":
      return "[NEEDS PROOF]";
    case "gray":
      return "[INFO]";
  }
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

    return {
      operation,
      status: formatFindingStatus(estimatePresence, `${item.title} ${item.category}`),
      supportType: inferSupportType(`${item.title} ${item.category} ${item.rationale}`),
      severity: mapSeverity(item.priority, item.leverageScore),
      whyItMatters: cleanScrubberText(item.rationale),
      estimatePresence,
      sources: buildFindingSources(item.source, item.evidence, sourceFallback),
      recommendedRevision: buildRecommendedRevision(operation, estimatePresence, item.rationale),
    } satisfies Omit<
      EstimateScrubFinding,
      "rationaleSummary" | "evidenceChainSummary" | "riskIfOmitted" | "supportConfidenceIndicator"
    >;
  });

  return dedupeFindings(findings.map(enrichEstimateScrubFinding)).slice(0, 12);
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

function lowercaseFirst(value: string): string {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
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
  if (/inferred|pending invoice|procedure support/i.test(value)) {
    return false;
  }
  return /\b(oem procedure|official procedure|position statement|invoice|final scan report|scan report|calibration certificate|alignment printout|uploaded procedure|repair procedure document|estimate excerpt|carrier estimate|shop estimate|current estimate|estimate parser|uploaded claim documents?)\b/i.test(value);
}

function cleanCustomerFacingEstimateLine(value: string | null | undefined): string {
  if (!value) return "";
  const scrubbed = cleanScrubberText(value);
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

function cleanPromptGeneratedText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/\b(?:evidence|chain|source|finding|issue|doc|line)[-_ ]?[a-z0-9]{4,}\b/gi, "")
    .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, "")
    .replace(/\b(?:debug confidence|internal reasoning|parser fragment)\b/gi, "")
    .replace(/[{}[\]<>]/g, "")
    .replace(/\b(?:undefined|null|NaN)\b/gi, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 1800);
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
