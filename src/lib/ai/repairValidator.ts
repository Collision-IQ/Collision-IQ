import { ParsedEstimate } from "./estimateParser";
import { ProcedureRequirement } from "./procedureDetector";
import {
  findProcedureMatches,
  hasProcedure,
  type ProcedureMatch,
} from "./procedureEquivalence";

export interface RepairIssue {
  issue: string;
  severity: "low" | "medium" | "high";
  category:
    | "missing_procedure"
    | "missing_scan"
    | "safety_risk"
    | "supplement_opportunity";
  procedure?: string;
  evidenceBasis?: string;
  rationale?: string;
}

export interface ValidationResult {
  missingProcedures: ProcedureRequirement[];
  issues: RepairIssue[];
  matchedProcedures: string[];
}

export function validateRepair(
  estimate: ParsedEstimate,
  procedures: ProcedureRequirement[]
): ValidationResult {
  const lines = estimate.rawText.split("\n");
  const rawMatches = lines.flatMap((line) => findProcedureMatches(line));
  const allMatches = applyDominanceRules(rawMatches);

  const missingProcedures: ProcedureRequirement[] = [];
  const matchedProcedures: string[] = [];
  const issues: RepairIssue[] = [];

  for (const proc of procedures) {
    const included = isProcedureFunctionallyPresent(proc, allMatches);

    if (included) {
      matchedProcedures.push(proc.procedure);
      continue;
    }

    missingProcedures.push(proc);

    issues.push({
      issue: `Missing required procedure: ${proc.procedure}`,
      severity: proc.severity,
      category:
        proc.category === "scanning"
          ? "missing_scan"
          : proc.category === "supplement"
            ? "supplement_opportunity"
            : "missing_procedure",
      procedure: proc.procedure,
      evidenceBasis: proc.evidenceBasis,
      rationale: `${proc.reason} Triggered by ${proc.matchedOperation}.`,
    });

    if (proc.category === "adas" || proc.category === "safety") {
      issues.push({
        issue: `Safety exposure created by missing ${proc.procedure}`,
        severity: "high",
        category: "safety_risk",
        procedure: proc.procedure,
        evidenceBasis: proc.evidenceBasis,
        rationale: proc.reason,
      });
    }
  }

  return {
    missingProcedures,
    issues: dedupeIssues(issues),
    matchedProcedures: [...new Set(matchedProcedures)],
  };
}

function applyDominanceRules(matches: ProcedureMatch[]) {
  const hasSurround = hasProcedure(matches, "surround_camera_calibration");

  if (hasSurround) {
    const impliedMatches: ProcedureMatch[] = [
      { key: "front_camera_calibration", matchedAlias: "[implied]", evidence: "surround system" },
      { key: "rear_camera_calibration", matchedAlias: "[implied]", evidence: "surround system" },
      { key: "side_camera_calibration", matchedAlias: "[implied]", evidence: "surround system" },
    ];

    return [
      ...matches,
      ...impliedMatches,
    ];
  }

  return matches;
}

function isProcedureFunctionallyPresent(
  procedure: ProcedureRequirement,
  matches: ReturnType<typeof findProcedureMatches>
): boolean {
  const name = procedure.procedure.toLowerCase();

  if (name.includes("pre-repair scan")) {
    return hasProcedure(matches, "pre_scan");
  }

  if (name.includes("post-repair scan")) {
    return hasProcedure(matches, "post_scan");
  }

  if (name.includes("camera")) {
    return (
      hasProcedure(matches, "front_camera_calibration") ||
      hasProcedure(matches, "rear_camera_calibration") ||
      hasProcedure(matches, "side_camera_calibration") ||
      hasProcedure(matches, "surround_camera_calibration")
    );
  }

  if (name.includes("radar") || name.includes("acc")) {
    return (
      hasProcedure(matches, "acc_radar_calibration") ||
      hasProcedure(matches, "front_side_radar_calibration")
    );
  }

  if (name.includes("lane")) {
    return (
      hasProcedure(matches, "lane_change_calibration") ||
      hasProcedure(matches, "lane_departure_calibration") ||
      hasProcedure(matches, "front_side_radar_calibration")
    );
  }

  if (name.includes("steering angle")) {
    return hasProcedure(matches, "steering_angle_calibration");
  }

  if (name.includes("seat belt")) {
    return hasProcedure(matches, "seat_belt_check");
  }

  if (name.includes("alignment")) {
    return hasProcedure(matches, "wheel_alignment");
  }

  return false;
}

function dedupeIssues(issues: RepairIssue[]): RepairIssue[] {
  const seen = new Map<string, RepairIssue>();

  for (const issue of issues) {
    const key = `${issue.category}:${issue.procedure ?? issue.issue}`.toLowerCase();
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, issue);
      continue;
    }

    seen.set(key, {
      ...existing,
      severity:
        existing.severity === "high" || issue.severity === "high"
          ? "high"
          : existing.severity === "medium" || issue.severity === "medium"
            ? "medium"
            : "low",
      rationale:
        existing.rationale === issue.rationale
          ? existing.rationale
          : `${existing.rationale ?? ""} ${issue.rationale ?? ""}`.trim(),
    });
  }

  return [...seen.values()];
}
