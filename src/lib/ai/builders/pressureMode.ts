/**
 * Pressure Mode Logic
 *
 * Derives the recommended communication tone for dispute outputs
 * (rebuttal email, snapshot, dispute intelligence) based on the
 * relationship between evidence level and leverage score.
 *
 * Rule table:
 *   evidence missing  + high leverage  → assertive
 *   referenced        + medium leverage → explanatory
 *   documented        + high leverage  → assertive
 *   documented        + medium leverage → explanatory
 *   inferred / weak evidence            → cautious
 *   missing           + low leverage   → cautious
 */

import type { ReportFindingReasoning } from "../types/analysis";
import type { ExportSupplementItem, DisputeIntelligenceDriver } from "./buildExportModel";

// ─── Public types ──────────────────────────────────────────────────────────

export type PressureMode = "assertive" | "explanatory" | "cautious";

export type PressureModeContext = {
  mode: PressureMode;
  rationale: string;
  /**
   * Computed from the top-ranked findings. One entry per finding
   * that contributed to the aggregate decision.
   */
  itemBreakdown: Array<{
    issue: string;
    evidenceLevel: string;
    leverageScore: number;
    mode: PressureMode;
  }>;
};

// ─── Thresholds ────────────────────────────────────────────────────────────

const HIGH_LEVERAGE = 65;
const MEDIUM_LEVERAGE_MIN = 35;

// ─── Per-item rule engine ──────────────────────────────────────────────────

/**
 * Computes the pressure mode for a single dispute item.
 *
 * | evidenceLevel | leverageScore     | mode          |
 * |---------------|-------------------|---------------|
 * | missing       | ≥ HIGH_LEVERAGE   | assertive     |
 * | documented    | ≥ HIGH_LEVERAGE   | assertive     |
 * | referenced    | ≥ HIGH_LEVERAGE   | assertive     |
 * | documented    | MEDIUM..HIGH      | explanatory   |
 * | referenced    | MEDIUM..HIGH      | explanatory   |
 * | missing       | MEDIUM..HIGH      | explanatory   |
 * | inferred      | any               | cautious      |
 * | unsupported   | any               | cautious      |
 * | *             | < MEDIUM          | cautious      |
 */
export function computeItemPressureMode(
  evidenceLevel: string,
  leverageScore: number
): PressureMode {
  const isWeak =
    evidenceLevel === "inferred" ||
    evidenceLevel === "unsupported";

  if (isWeak) return "cautious";
  if (leverageScore < MEDIUM_LEVERAGE_MIN) return "cautious";

  const isHigh = leverageScore >= HIGH_LEVERAGE;

  if (isHigh) {
    // missing evidence + high leverage = carrier is clearly holding out
    if (evidenceLevel === "missing") return "assertive";
    // well-documented + high leverage = strongest ground
    if (evidenceLevel === "documented" || evidenceLevel === "referenced") return "assertive";
  }

  // medium leverage with partial or missing support → explain the gap
  return "explanatory";
}

// ─── Model-level aggregation ───────────────────────────────────────────────

/**
 * Derives an overall pressure mode for the export model from the
 * top-ranked findings and supplement items.
 *
 * Aggregation rule:
 *   - majority assertive → assertive
 *   - majority cautious  → cautious
 *   - otherwise          → explanatory
 *
 * At least 2 assertive votes (from top-3 findings) are required to
 * reach assertive. A single cautious majority blocks assertive.
 */
export function computeModelPressureMode(params: {
  findingReasoning: ReportFindingReasoning[];
  supplementItems: ExportSupplementItem[];
  topDrivers?: DisputeIntelligenceDriver[];
}): PressureModeContext {
  const topFindings = params.findingReasoning.slice(0, 5);
  const breakdown: PressureModeContext["itemBreakdown"] = topFindings.map((finding) => ({
    issue: finding.issue,
    evidenceLevel: finding.evidenceLevel,
    leverageScore: finding.leverageScore ?? 0,
    mode: computeItemPressureMode(finding.evidenceLevel, finding.leverageScore ?? 0),
  }));

  // Also factor in top supplement items when findings are sparse
  if (breakdown.length < 2 && params.supplementItems.length > 0) {
    for (const item of params.supplementItems.slice(0, 3)) {
      breakdown.push({
        issue: item.title,
        evidenceLevel: mapSupplementKindToEvidenceHint(item.kind),
        leverageScore: item.leverageScore ?? 0,
        mode: computeItemPressureMode(
          mapSupplementKindToEvidenceHint(item.kind),
          item.leverageScore ?? 0
        ),
      });
    }
  }

  const modes = breakdown.map((b) => b.mode);
  const assertiveCount = modes.filter((m) => m === "assertive").length;
  const cautiousCount = modes.filter((m) => m === "cautious").length;
  const total = modes.length;

  let mode: PressureMode;
  if (total === 0) {
    mode = "cautious";
  } else if (assertiveCount >= 2 || (assertiveCount > 0 && cautiousCount === 0 && assertiveCount / total >= 0.5)) {
    mode = "assertive";
  } else if (cautiousCount > assertiveCount) {
    mode = "cautious";
  } else {
    mode = "explanatory";
  }

  return {
    mode,
    rationale: buildModeRationale(mode, breakdown),
    itemBreakdown: breakdown,
  };
}

// ─── Copy helpers (used by rebuttal + snapshot builders) ───────────────────

/**
 * Opening paragraph for a rebuttal email, shaped by pressure mode.
 */
export function buildRebuttalOpeningLine(
  mode: PressureMode,
  subjectVehicle: string,
  repairPosition: string
): string {
  const position = lowercaseFirst(repairPosition);
  switch (mode) {
    case "assertive":
      return (
        `After a detailed review of the current estimate and supporting file for the ${subjectVehicle}, ` +
        `the following items require immediate revision. The file clearly shows ${position} ` +
        `Each numbered item below must be addressed in a revised estimate or written response.`
      );
    case "explanatory":
      return (
        `After reviewing the current estimate for the ${subjectVehicle}, our position is that ${position} ` +
        `The items below still require a revised estimate line or a written explanation of the file basis used to exclude or reduce them.`
      );
    case "cautious":
      return (
        `Based on the current file review for the ${subjectVehicle}, we have noted several items for consideration. ` +
        `Additional documentation or clarification on the items below would help confirm the intended estimate scope.`
      );
  }
}

/**
 * Closing call-to-action for a rebuttal email, shaped by pressure mode.
 */
export function buildRebuttalClosingCta(mode: PressureMode): string {
  switch (mode) {
    case "assertive":
      return "Please issue a revised estimate or provide a written line-item explanation for each item listed above, tied to the specific file evidence used to support the current position.";
    case "explanatory":
      return "Please issue a revised estimate or provide a written line-item explanation for any item not added.";
    case "cautious":
      return "Please issue a revised estimate or provide a written line-item explanation for any item where documentation supports the included basis.";
  }
}

/**
 * A short pressure mode label for display in summaries and PDF metadata.
 */
export function formatPressureMode(mode: PressureMode): string {
  switch (mode) {
    case "assertive":
      return "Assertive";
    case "explanatory":
      return "Explanatory";
    case "cautious":
      return "Cautious";
  }
}

// ─── Internal helpers ──────────────────────────────────────────────────────

function buildModeRationale(
  mode: PressureMode,
  breakdown: PressureModeContext["itemBreakdown"]
): string {
  const top = breakdown[0];
  if (!top) return "Insufficient findings to determine dispute tone.";

  switch (mode) {
    case "assertive":
      return (
        `Top findings show ${top.evidenceLevel === "missing" ? "missing evidence" : "strong evidence"} ` +
        `with a leverage score of ${top.leverageScore}. The file supports a direct revision request.`
      );
    case "explanatory":
      return (
        `Top findings show ${top.evidenceLevel} evidence with a leverage score of ${top.leverageScore}. ` +
        `A clear explanation of the file gap is the appropriate approach.`
      );
    case "cautious":
      return (
        `Evidence is ${top.evidenceLevel} and leverage is low (${top.leverageScore}). ` +
        `A cautious, documentation-requesting stance is most defensible at this stage.`
      );
  }
}

function mapSupplementKindToEvidenceHint(kind: ExportSupplementItem["kind"]): string {
  switch (kind) {
    case "missing_operation":
      return "missing";
    case "underwritten_operation":
      return "referenced";
    case "disputed_repair_path":
      return "inferred";
    case "missing_verification":
      return "missing";
  }
}

function lowercaseFirst(value: string): string {
  if (!value) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}
