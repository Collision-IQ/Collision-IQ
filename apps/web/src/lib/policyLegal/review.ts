import type {
  AnalysisIssue,
  PolicyLegalContext,
  PolicyLegalLineItemReview,
  PolicyLegalReview,
  RepairIntelligenceReport,
  RequiredProcedureRecord,
  Severity,
} from "@/lib/ai/types/analysis";
import type { EstimateOperation } from "@/lib/ai/extractors/estimateExtractor";
import { PLACEHOLDER_CITATION, REGULATORY_CATEGORIES } from "./regulations";
import { observePolicyLegalReviewGenerated } from "./observability";

const NO_GOVERNING_REGULATION = "No governing regulation found.";
const DISCLAIMER =
  "This is not legal advice. Collision IQ provides claim intelligence and citation-backed repair review support.";

type BuildPolicyLegalReviewParams = {
  context: PolicyLegalContext;
  report: RepairIntelligenceReport;
  operations: EstimateOperation[];
};

export function buildPolicyLegalReview(
  params: BuildPolicyLegalReviewParams
): PolicyLegalReview {
  const lineItems = params.operations.length > 0
    ? params.operations
    : buildFallbackOperations(params.report);

  const issues = Array.isArray(params.report.issues) ? params.report.issues : [];
  const requiredProcedures = Array.isArray(params.report.requiredProcedures)
    ? params.report.requiredProcedures
    : [];
  const reviews = lineItems.map((operation) =>
    buildLineItemReview({
      operation,
      context: params.context,
      issues,
      requiredProcedures,
    })
  );

  const citationCompleteness = ratio(
    reviews.filter((review) => !review.incomplete).length,
    reviews.length,
    0
  );
  const oemApplicableReviews = reviews.filter((review) => review.oem_compliant !== null);
  const oemCompliance = ratio(
    reviews.filter((review) => review.oem_compliant === true).length,
    oemApplicableReviews.length,
    0
  );
  const regulatoryApplicableReviews = reviews.filter(
    (review) => review.regulatory_compliant !== null
  );
  const regulatoryCompliance = ratio(
    reviews.filter((review) => review.regulatory_compliant === true).length,
    regulatoryApplicableReviews.length,
    0
  );
  const insurerApplicableReviews = reviews.filter((review) => review.insurer_aligned !== null);
  const insurerAlignment = ratio(
    reviews.filter((review) => review.insurer_aligned === true).length,
    insurerApplicableReviews.length,
    0
  );
  const disputeStrength = ratio(
    reviews.reduce((sum, review) => sum + disputeStrengthValue(review.dispute_strength), 0),
    reviews.length * 3,
    0
  );
  const finalScore = Math.round(
    (citationCompleteness * 0.3 +
      oemCompliance * 0.25 +
      regulatoryCompliance * 0.2 +
      insurerAlignment * 0.1 +
      disputeStrength * 0.15) *
      100
  );

  const review = {
    claim_context: params.context,
    compliance_summary: {
      total_line_items: reviews.length,
      complete_citations: reviews.filter((review) => !review.incomplete).length,
      incomplete_items: reviews.filter((review) => review.incomplete).length,
      oem_supported_items: reviews.filter((review) => review.source_type === "OEM").length,
      regulation_supported_items: reviews.filter((review) => review.source_type === "Regulation").length,
      insurer_aligned_items: reviews.filter((review) => review.insurer_aligned === true).length,
      unsupported_legal_claims_blocked: reviews.filter(
        (review) => review.regulatory_support === "No" && review.source_type !== "Regulation"
      ).length,
      disclaimer: DISCLAIMER,
    },
    line_item_reviews: reviews,
    disputable_items: reviews.filter((review) => review.dispute_strength !== "Low"),
    regulatory_support_log: REGULATORY_CATEGORIES.map((category) => {
      const regulation = params.context.applicable_regulations.find(
        (item) => item.category === category
      );
      const verified = regulation?.verification_state === "verified";
      return {
        state: params.context.claim_state,
        category,
        support: verified ? "verified" as const : regulation ? "placeholder" as const : "none" as const,
        citation: verified ? regulation.citation : NO_GOVERNING_REGULATION,
        note: verified
          ? "Verified regulation available for citation-backed use."
          : "No verified governing regulation is available in the MVP dataset.",
      };
    }),
    citation_log: reviews.map((review) => ({
      line_item: review.line_item,
      citation: review.citation,
      source_type: review.source_type,
      complete: !review.incomplete,
    })),
    missing_support: reviews
      .filter((review) => review.source_type === "None")
      .map((review) => `${review.line_item}: ${NO_GOVERNING_REGULATION}`),
    final_score: {
      PolicyLegalConfidenceScore: finalScore,
      components: {
        citation_completeness: Math.round(citationCompleteness * 100),
        oem_compliance: Math.round(oemCompliance * 100),
        regulatory_compliance: Math.round(regulatoryCompliance * 100),
        insurer_alignment: Math.round(insurerAlignment * 100),
        dispute_strength: Math.round(disputeStrength * 100),
      },
    },
  };

  observePolicyLegalReviewGenerated(review);

  return review;
}

function buildLineItemReview(params: {
  operation: EstimateOperation;
  context: PolicyLegalContext;
  issues: AnalysisIssue[];
  requiredProcedures: RequiredProcedureRecord[];
}): PolicyLegalLineItemReview {
  const lineItem = params.operation.rawLine || `${params.operation.operation} ${params.operation.component}`.trim();
  const lowerLine = lineItem.toLowerCase();
  const relatedIssue = params.issues.find((issue) =>
    [issue.title, issue.finding, issue.missingOperation, issue.impact]
      .filter(Boolean)
      .some((value) => lowerLine.includes(String(value).toLowerCase()) ||
        String(value).toLowerCase().includes(params.operation.component.toLowerCase()))
  );
  const oemProcedure = params.requiredProcedures.find((procedure) =>
    lowerLine.includes(procedure.procedure.toLowerCase()) ||
    procedure.procedure.toLowerCase().includes(params.operation.component.toLowerCase())
  );
  const regulatoryCategory = inferRegulatoryCategory(lineItem, relatedIssue);
  const verifiedRegulation = params.context.applicable_regulations.find(
    (regulation) =>
      regulation.category === regulatoryCategory &&
      regulation.verification_state === "verified" &&
      regulation.citation !== PLACEHOLDER_CITATION
  );
  const carrierGuideline = params.context.carrier_guidelines.find((guideline) =>
    lowerLine.includes(guideline.toLowerCase())
  );

  const citation = oemProcedure
    ? `OEM procedure support: ${oemProcedure.procedure} - ${oemProcedure.reason}`
    : verifiedRegulation
      ? `${verifiedRegulation.citation}`
      : carrierGuideline
        ? `Insurer guideline: ${carrierGuideline}`
        : NO_GOVERNING_REGULATION;
  const sourceType = oemProcedure
    ? "OEM"
    : verifiedRegulation
      ? "Regulation"
      : carrierGuideline
        ? "Insurer"
        : "None";
  const regulatorySupport = verifiedRegulation ? "Yes" : "No";
  const disputeStrength = resolveDisputeStrength(relatedIssue?.severity, Boolean(oemProcedure));
  const recommendation = relatedIssue
    ? relatedIssue.finding
    : "Line item reviewed for citation-backed repair, policy, and regulatory support.";

  return {
    line_item: lineItem,
    recommendation,
    oem_compliant: oemProcedure ? true : null,
    regulatory_compliant: verifiedRegulation ? true : null,
    insurer_aligned: carrierGuideline ? true : null,
    regulatory_support: regulatorySupport,
    citation,
    source_type: sourceType,
    dispute_strength: disputeStrength,
    recommended_rebuttal: buildRebuttal({
      recommendation,
      oemSupport: Boolean(oemProcedure),
      regulatorySupport,
      disputeStrength,
      citation,
    }),
    incomplete: !citation.trim(),
  };
}

function buildRebuttal(params: {
  recommendation: string;
  oemSupport: boolean;
  regulatorySupport: "Yes" | "No";
  disputeStrength: "Low" | "Medium" | "High";
  citation: string;
}) {
  const regulatoryText =
    params.regulatorySupport === "Yes" ? params.citation : NO_GOVERNING_REGULATION;

  return `${params.recommendation} Regulatory Support: ${regulatoryText} OEM Support: ${
    params.oemSupport ? "Yes" : "No"
  }. Dispute Strength: ${params.disputeStrength}.`;
}

function resolveDisputeStrength(
  severity: Severity | undefined,
  hasOemSupport: boolean
): "Low" | "Medium" | "High" {
  if (severity === "high" && hasOemSupport) return "High";
  if (severity === "high" || hasOemSupport) return "Medium";
  if (severity === "medium") return "Medium";
  return "Low";
}

function disputeStrengthValue(value: "Low" | "Medium" | "High") {
  if (value === "High") return 3;
  if (value === "Medium") return 2;
  return 1;
}

function inferRegulatoryCategory(
  lineItem: string,
  issue?: AnalysisIssue
): (typeof REGULATORY_CATEGORIES)[number] {
  const haystack = `${lineItem} ${issue?.category ?? ""} ${issue?.title ?? ""} ${
    issue?.finding ?? ""
  } ${issue?.impact ?? ""}`.toLowerCase();

  if (/\btotal\s*loss|salvage|acv|actual cash value\b/.test(haystack)) {
    return "total_loss";
  }
  if (/\bdiminished\s+value|\bdv\b/.test(haystack)) {
    return "diminished_value";
  }
  if (/\baftermarket|a\/m|lkq|recycled|used|oem part|parts?\b/.test(haystack)) {
    return "parts_usage";
  }
  if (/\bsteer|steering|alignment|pull|drift\b/.test(haystack)) {
    return "steering";
  }
  if (/\bdisclos|written|notify|authorization\b/.test(haystack)) {
    return "disclosure";
  }
  if (/\blabor|procedure|scan|calibration|r&i|remove|install\b/.test(haystack)) {
    return "labor_procedures";
  }
  if (/\brepair standard|pre-loss|preloss|safe repair|crashworthiness\b/.test(haystack)) {
    return "repair_standards";
  }
  return "unfair_claims_practices";
}

function ratio(numerator: number, denominator: number, fallback = 1) {
  if (!denominator) return fallback;
  return Math.max(0, Math.min(1, numerator / denominator));
}

function buildFallbackOperations(report: RepairIntelligenceReport): EstimateOperation[] {
  const issues = Array.isArray(report.issues) ? report.issues : [];
  return issues.map((issue) => ({
    operation: "Review",
    component: issue.missingOperation || issue.title,
    rawLine: issue.missingOperation || issue.title,
  }));
}
