import type { AnalysisResult, RepairIntelligenceReport } from "@/lib/ai/types/analysis";
import type { WorkspaceEstimateComparisons } from "@/types/workspaceTypes";

export type EstimatePostureDecision = {
  selectedEstimateLabel: "shop" | "carrier" | "inconclusive";
  selectedEstimateReason: string;
  confidence: "high" | "medium" | "low";
  limitations: string[];
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
    };
  }

  return {
    selectedEstimateLabel: "inconclusive",
    selectedEstimateReason:
      "The shared estimate posture is inconclusive because the current structured comparison does not establish one estimate as more complete.",
    confidence: "low",
    limitations: [
      "The file still needs clearer line-item, teardown, repair procedure, and verification support before selecting an estimate posture.",
    ],
  };
}

export function formatEstimatePostureLabel(posture: EstimatePostureDecision): string {
  if (posture.selectedEstimateLabel === "shop") return "shop estimate";
  if (posture.selectedEstimateLabel === "carrier") return "carrier estimate";
  return "inconclusive estimate posture";
}

export function buildCustomerEstimatePostureHeading(posture: EstimatePostureDecision): string {
  if (posture.selectedEstimateLabel === "shop") return "Why The Shop Estimate Looks More Complete";
  if (posture.selectedEstimateLabel === "carrier") return "Why The Insurance Estimate Looks More Complete";
  return "Why The Estimate Posture Is Not Yet Clear";
}

export function alignCustomerEstimatePostureText(
  text: string,
  posture: EstimatePostureDecision
): string {
  const fallback = posture.selectedEstimateReason;
  const value = text.trim() || fallback;
  if (posture.selectedEstimateLabel === "carrier") {
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

function isOnlyOnLeft(row: WorkspaceEstimateComparisons["rows"][number]) {
  return row.rhsValue == null || /not shown|missing|absent/i.test(`${row.rhsValue} ${row.delta ?? ""}`);
}

function isOnlyOnRight(row: WorkspaceEstimateComparisons["rows"][number]) {
  return row.lhsValue == null || /not shown|missing|absent/i.test(`${row.lhsValue} ${row.delta ?? ""}`);
}
