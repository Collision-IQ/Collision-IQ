export type DocumentKind =
  | "estimate"
  | "policy"
  | "photo"
  | "invoice"
  | "scan"
  | "calibration"
  | "repair_order"
  | "unknown";

export type ReportFocus =
  | "estimate_delta"
  | "labor_delta"
  | "supplement_review"
  | "repair_operations"
  | "test_fit"
  | "measurements"
  | "calibrations"
  | "scans"
  | "policy_review"
  | "coverage_review"
  | "jurisdiction_review"
  | "customer_explanation";

export type UploadedDocument = {
  id?: string;
  filename?: string;
  kind?: DocumentKind;
  text?: string;
};

export type ClaimFacts = {
  damageDescription?: string;
  vehicle?: string;
  jurisdiction?: string;
};

export type ReportApplicability = {
  documentKinds: Set<DocumentKind>;
  allowedFocus: Set<ReportFocus>;
  blockedFocus: Set<ReportFocus>;
  instruction: string;
};

const IMPACT_TERMS = [
  "impact",
  "collision",
  "hit",
  "crushed",
  "buckled",
  "pushed",
  "shifted",
  "misaligned",
  "gap",
  "absorber",
  "reinforcement",
  "bracket",
  "mounting",
  "sensor",
  "radar",
  "blind spot",
  "parking sensor",
];

const SCRATCH_ONLY_TERMS = [
  "scratch",
  "scuff",
  "scrape",
  "cosmetic",
  "paint transfer",
];

function includesAny(value: string, terms: string[]) {
  const lower = value.toLowerCase();
  return terms.some(term => lower.includes(term));
}

export function buildReportApplicability(params: {
  documents: UploadedDocument[];
  claimFacts?: ClaimFacts;
}): ReportApplicability {
  const { documents, claimFacts } = params;

  const documentKinds = new Set<DocumentKind>(
    documents.map(doc => doc.kind ?? "unknown"),
  );

  const combinedText = [
    claimFacts?.damageDescription,
    claimFacts?.vehicle,
    claimFacts?.jurisdiction,
    ...documents.map(doc => `${doc.filename ?? ""}\n${doc.text ?? ""}`),
  ]
    .filter(Boolean)
    .join("\n");

  const hasEstimate = documentKinds.has("estimate");
  const hasPolicy = documentKinds.has("policy");
  const hasPhotos = documentKinds.has("photo");
  const hasScan = documentKinds.has("scan");
  const hasCalibration = documentKinds.has("calibration");

  const hasImpactIndicators = includesAny(combinedText, IMPACT_TERMS);
  const appearsScratchOnly =
    includesAny(combinedText, SCRATCH_ONLY_TERMS) && !hasImpactIndicators;

  const allowedFocus = new Set<ReportFocus>();
  const blockedFocus = new Set<ReportFocus>();

  allowedFocus.add("customer_explanation");

  if (hasEstimate) {
    allowedFocus.add("repair_operations");
    allowedFocus.add("labor_delta");
    allowedFocus.add("supplement_review");
    allowedFocus.add("estimate_delta");
  }

  if (hasPolicy) {
    allowedFocus.add("policy_review");
    allowedFocus.add("coverage_review");
  }

  if (claimFacts?.jurisdiction) {
    allowedFocus.add("jurisdiction_review");
  }

  if (hasScan) {
    allowedFocus.add("scans");
  }

  if (hasCalibration) {
    allowedFocus.add("calibrations");
  }

  if (hasEstimate && hasImpactIndicators && !appearsScratchOnly) {
    allowedFocus.add("measurements");
    allowedFocus.add("test_fit");
  }

  const allFocus: ReportFocus[] = [
    "estimate_delta",
    "labor_delta",
    "supplement_review",
    "repair_operations",
    "test_fit",
    "measurements",
    "calibrations",
    "scans",
    "policy_review",
    "coverage_review",
    "jurisdiction_review",
    "customer_explanation",
  ];

  for (const focus of allFocus) {
    if (!allowedFocus.has(focus)) {
      blockedFocus.add(focus);
    }
  }

  const instruction = `
Evidence-first applicability rule:

Do not fill predefined boxes.
Do not discuss a focus area merely because a report template contains it.
Only discuss issues that are supported by uploaded documents, claim facts, vehicle facts, OEM/OE authority, or jurisdiction-specific authority.

Allowed focus areas:
${Array.from(allowedFocus).join(", ") || "none"}

Blocked focus areas:
${Array.from(blockedFocus).join(", ") || "none"}

If a blocked focus area would normally appear in the report, omit it entirely.
Do not replace missing evidence with generic language, assumptions, placeholders, or boilerplate.

Special bumper example:
- Scratch-only bumper damage does not justify test-fit, structural measurement, calibration, or impact-procedure discussion unless the evidence supports those concerns.
- Impact-damaged bumper, sensor-area damage, absorber/reinforcement damage, bracket damage, alignment gaps, or mounting damage may justify test-fit, measurement, sensor, calibration, and OEM procedure review.

If only a policy document is uploaded, produce a policy/coverage review only.
Do not discuss estimates, supplements, labor deltas, repair operations, scans, calibrations, or estimate totals unless those documents are present.
`.trim();

  return {
    documentKinds,
    allowedFocus,
    blockedFocus,
    instruction,
  };
}

/**
 * Safety check: Remove content from generated report that matches blocked focus areas.
 * 
 * ⚠️ LAST-RESORT GUARD ONLY
 * 
 * This is a post-generation cleanup layer. The PRIMARY FIX should be upstream:
 *   1. Classify documents (kind: policy, estimate, photo, scan, etc.)
 *   2. Infer applicable focus areas based on document classification
 *   3. Build ONLY the allowed prompt/report sections (use filterSectionsByApplicability)
 * 
 * This function should only be needed if generated content somehow escapes section-level filtering.
 * It removes blocked language patterns AFTER content generation as a failsafe.
 */
export function removeUnsupportedReportLanguage(params: {
  content: string;
  allowedFocus: Set<string>;
}) {
  let content = params.content;

  if (!params.allowedFocus.has("estimate_delta")) {
    content = content.replace(/^.*Estimate\s+\d+.*$/gim, "");
    content = content.replace(/^.*estimate total.*$/gim, "");
    content = content.replace(/^.*supplement growth.*$/gim, "");
  }

  if (!params.allowedFocus.has("labor_delta")) {
    content = content.replace(/^.*labor delta.*$/gim, "");
    content = content.replace(/^.*labor hours.*$/gim, "");
  }

  if (!params.allowedFocus.has("test_fit")) {
    content = content.replace(/^.*test[- ]?fit.*$/gim, "");
  }

  if (!params.allowedFocus.has("measurements")) {
    content = content.replace(/^.*measurement.*$/gim, "");
  }

  if (!params.allowedFocus.has("calibrations")) {
    content = content.replace(/^.*calibration.*$/gim, "");
  }

  return content.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Helper to filter report sections based on allowed focus areas.
 * 
 * Use this BEFORE composing estimate-related report sections to hard-block
 * sections that should not appear in the report.
 * 
 * Example:
 *   const sections = buildInitialSections();
 *   const filtered = filterSectionsByApplicability(sections, applicability.allowedFocus);
 */
export function filterSectionsByApplicability(
  sections: Array<{ type?: string; [key: string]: unknown }>,
  allowedFocus: Set<string>,
): Array<{ type?: string; [key: string]: unknown }> {
  if (!allowedFocus.has("estimate_delta")) {
    sections = sections.filter(section => section.type !== "estimate_delta");
  }

  if (!allowedFocus.has("labor_delta")) {
    sections = sections.filter(section => section.type !== "labor_delta");
  }

  if (!allowedFocus.has("repair_operations")) {
    sections = sections.filter(section => section.type !== "repair_operations");
  }

  if (!allowedFocus.has("test_fit")) {
    sections = sections.filter(section => section.type !== "test_fit");
  }

  if (!allowedFocus.has("measurements")) {
    sections = sections.filter(section => section.type !== "measurements");
  }

  if (!allowedFocus.has("calibrations")) {
    sections = sections.filter(section => section.type !== "calibrations");
  }

  return sections;
}
