import type { AnalysisResult, RepairIntelligenceReport } from "@/lib/ai/types/analysis";
import type { WorkspaceEstimateComparisons } from "@/types/workspaceTypes";

export type EstimatePostureDecision = {
  selectedEstimateLabel: "shop" | "carrier" | "insurer" | "mixed" | "undetermined";
  selectedEstimateReason: string;
  confidence: "high" | "medium" | "low";
  limitations: string[];
  /**
   * True only when the file actually contains an estimate COMPARISON (two or
   * more estimates). When false, customer-facing output must never use
   * carrier/insurer-comparison framing ("where the estimates differ", "the
   * insurance estimate may be missing items").
   */
  comparisonAvailable: boolean;
};

type EstimatePostureInput = {
  report?: RepairIntelligenceReport | null;
  analysis?: AnalysisResult | null;
  estimateComparisons?: WorkspaceEstimateComparisons | null;
  narrative?: string | null;
};

export function resolveEstimatePosture(input: EstimatePostureInput): EstimatePostureDecision {
  const comparisons = input.estimateComparisons ?? input.analysis?.estimateComparisons ?? null;
  const rows = comparisons?.rows ?? [];
  const comparisonAvailable = rows.length > 0;

  // Only ONE estimate in the file: there is nothing to compare. Support gaps
  // and missing procedures are completeness-of-proof items for THAT estimate,
  // never grounds for shop-vs-carrier posture language.
  if (!comparisonAvailable) {
    return {
      selectedEstimateLabel: "undetermined",
      selectedEstimateReason:
        "Only one estimate is present in the reviewed file, so no estimate comparison was made. Open items are documentation and proof needs for that estimate.",
      confidence: "low",
      limitations: [
        "No second estimate was uploaded; comparison-based conclusions are not available.",
        "This can change if another estimate (carrier or shop) is added to the file.",
      ],
      comparisonAvailable: false,
    };
  }

  const onlyShopCount = rows.filter((row) =>
    /shop/i.test(`${row.lhsSource ?? ""}`) &&
    isOnlyOnLeft(row)
  ).length;
  const onlyCarrierCount = rows.filter((row) =>
    /carrier|insurer|insurance/i.test(`${row.rhsSource ?? ""}`) &&
    isOnlyOnRight(row)
  ).length;
  const supplementGaps = input.report?.supplementOpportunities?.length ?? 0;
  const missingProcedures = input.report?.missingProcedures?.length ?? 0;
  const specificFindings = input.report?.findingReasoning?.filter((finding) =>
    finding.claimSpecificity === "high" && finding.confidence >= 0.7
  ).length ?? 0;

  if (onlyShopCount > onlyCarrierCount || supplementGaps > 0 || missingProcedures > 0 || specificFindings > 0) {
    return {
      selectedEstimateLabel: "shop",
      selectedEstimateReason:
        "The shared estimate posture favors the shop estimate because the current evidence identifies repair-scope, verification, or documentation items that are not clearly carried in the carrier estimate.",
      confidence: onlyShopCount > 0 || supplementGaps + missingProcedures + specificFindings > 1 ? "medium" : "low",
      limitations: [
        "This is a repair-scope completeness posture, not a legal conclusion or final appraisal award.",
        "The selected posture can change if additional teardown, scan, calibration, invoice, or OEM procedure proof is uploaded.",
      ],
      comparisonAvailable: true,
    };
  }

  if (onlyCarrierCount > onlyShopCount) {
    return {
      selectedEstimateLabel: "carrier",
      selectedEstimateReason:
        "The shared estimate posture favors the carrier estimate because the structured comparison shows more supported items unique to the carrier-side estimate than to the shop-side estimate.",
      confidence: "medium",
      limitations: [
        "This is a repair-scope completeness posture, not a legal conclusion or final appraisal award.",
        "The selected posture can change if additional claim-file proof is uploaded.",
      ],
      comparisonAvailable: true,
    };
  }

  return {
    selectedEstimateLabel: "undetermined",
    selectedEstimateReason:
      "The shared estimate posture is undetermined because the current structured comparison does not establish one estimate as more complete.",
    confidence: "low",
    limitations: [
      "The file still needs clearer line-item, teardown, repair procedure, and verification support before selecting an estimate posture.",
    ],
    comparisonAvailable: true,
  };
}

export function formatEstimatePostureLabel(posture: EstimatePostureDecision): string {
  if (posture.selectedEstimateLabel === "shop") return "shop estimate";
  if (isCarrierSelectedPosture(posture)) return "carrier estimate";
  if (posture.selectedEstimateLabel === "mixed") return "mixed estimate posture";
  return "undetermined estimate posture";
}

export function buildCustomerEstimatePostureHeading(posture: EstimatePostureDecision): string {
  // Never use comparison headings when the file has only one estimate.
  if (posture.comparisonAvailable === false) return "What This Means for You";
  if (posture.selectedEstimateLabel === "shop") return "Why The Shop Estimate Looks More Complete";
  if (isCarrierSelectedPosture(posture)) return "Why The Insurance Estimate Looks More Complete";
  return "Where The Estimates Differ";
}

/**
 * Remove carrier/insurer-comparison framing from customer-facing text when the
 * file contains only ONE estimate. "The insurance estimate may be missing
 * items" reads as a comparison against a carrier estimate that was never
 * uploaded — reframe as proof needs for the single reviewed estimate.
 */
export function stripEstimateComparisonLanguage(text: string): string {
  const INSURER_ESTIMATE =
    /(?:\[REDACTED_INSURER\]('s)?|insurance|insurer'?s?|carrier)\s+estimate/;
  const stripped = text
    // "…estimate may be missing items" is a comparison claim — reframe first.
    .replace(
      new RegExp(`(?:the|your|any)?\\s*${INSURER_ESTIMATE.source}\\s+may\\s+be\\s+missing\\s+items?`, "gi"),
      "some items on the estimate still need supporting documentation"
    )
    .replace(/\bthe estimate may be missing items\b/gi, "some items on the estimate still need supporting documentation")
    // Keep the leading article when replacing the insurer-estimate reference.
    .replace(new RegExp(`\\b(the|your|any)\\s+${INSURER_ESTIMATE.source}`, "gi"), "$1 estimate")
    .replace(new RegExp(INSURER_ESTIMATE.source, "gi"), "the estimate")
    .replace(/\bwhere the estimates differ\b/gi, "what still needs supporting proof")
    .replace(/\b(?:both|the two|either)\s+estimates\b/gi, "the estimate")
    // Comparison residue against the (only) estimate, however it is named.
    .replace(/\bcompared (?:to|with|against) the (?:shop |insurance |insurer'?s? |carrier )?estimate\b/gi, "in the reviewed file")
    .replace(/\b(the|your|any)\s+shop\s+estimate\b/gi, "$1 estimate")
    // Redaction tokens already collapsed by an earlier sanitizer pass.
    .replace(/\[\s*\]\s+estimate\s+may\s+be\s+missing\s+items?/gi, "some items on the estimate still need supporting documentation")
    .replace(/(?:the|your|any)?\s*\[\s*\]\s+estimate/gi, " the estimate")
    // No carrier estimate in the file: route questions to the repair shop.
    .replace(/\bthe insurer or repair shop\b/gi, "the repair shop")
    .replace(/\binsurer or repair shop\b/gi, "repair shop")
    .replace(/\s{2,}/g, " ")
    .trim();
  // Repair sentence capitalization broken by leading-phrase removal.
  return stripped.replace(/(^|[.!?]\s+)([a-z])/g, (whole, lead, first) => `${lead}${first.toUpperCase()}`);
}

export function alignCustomerEstimatePostureText(
  text: string,
  posture: EstimatePostureDecision
): string {
  const fallback = posture.selectedEstimateReason;
  const value = text.trim() || fallback;
  if (posture.comparisonAvailable === false) {
    return stripEstimateComparisonLanguage(value);
  }
  if (isCarrierSelectedPosture(posture)) {
    return value
      .replace(/\bthe shop estimate (?:appears|looks|is) (?:materially )?more complete\b/gi, "the insurance estimate appears more complete")
      .replace(/\bshop estimate looks more complete\b/gi, "insurance estimate looks more complete");
  }
  if (posture.selectedEstimateLabel === "shop") {
    return value
      .replace(/\bthe (?:insurance|insurer|carrier) estimate (?:appears|looks|is) (?:materially )?more complete\b/gi, "the shop estimate appears more complete")
      .replace(/\b(?:insurance|insurer|carrier) estimate looks more complete\b/gi, "shop estimate looks more complete");
  }
  return value
    .replace(/\bthe shop estimate (?:appears|looks|is) (?:materially )?more complete\b/gi, "the estimate posture is not yet clear")
    .replace(/\bthe (?:insurance|insurer|carrier) estimate (?:appears|looks|is) (?:materially )?more complete\b/gi, "the estimate posture is not yet clear");
}

export function isCarrierSelectedPosture(posture: EstimatePostureDecision): boolean {
  return posture.selectedEstimateLabel === "carrier" || posture.selectedEstimateLabel === "insurer";
}

function isOnlyOnLeft(row: WorkspaceEstimateComparisons["rows"][number]) {
  return row.rhsValue == null || /not shown|missing|absent/i.test(`${row.rhsValue} ${row.delta ?? ""}`);
}

function isOnlyOnRight(row: WorkspaceEstimateComparisons["rows"][number]) {
  return row.lhsValue == null || /not shown|missing|absent/i.test(`${row.lhsValue} ${row.delta ?? ""}`);
}
