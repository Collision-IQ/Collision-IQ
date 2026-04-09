import { ParsedEstimate } from "./estimateParser";
import { ProcedureRequirement } from "./procedureDetector";
import {
  findProcedureMatches,
  hasProcedure,
  type ProcedureMatch,
} from "./procedureEquivalence";

export interface RepairObservation {
  procedure: string;
  status: "present" | "unclear" | "not_detected";
  confidence: "high" | "medium" | "low";
  evidence: string[];
  reasoning: string;
  category: ProcedureRequirement["category"];
}

export interface ValidationResult {
  observations: RepairObservation[];
  matchedProcedures: string[];
}

type ProcedureEvaluation = Pick<
  RepairObservation,
  "status" | "confidence" | "evidence" | "reasoning"
>;

export function validateRepair(
  estimate: ParsedEstimate,
  procedures: ProcedureRequirement[]
): ValidationResult {
  const lines = estimate.rawText.split("\n");

  const rawMatches = lines.flatMap((line) => findProcedureMatches(line));
  const allMatches = applyDominanceRules(rawMatches);

  const observations: RepairObservation[] = [];
  const matchedProcedures: string[] = [];

  for (const proc of procedures) {
    const evaluation = evaluateProcedure(proc, allMatches);

    if (evaluation.status === "present") {
      matchedProcedures.push(proc.procedure);
    }

    observations.push({
      procedure: proc.procedure,
      status: evaluation.status,
      confidence: evaluation.confidence,
      evidence: evaluation.evidence,
      reasoning: evaluation.reasoning,
      category: proc.category,
    });
  }

  return {
    observations: dedupeObservations(observations),
    matchedProcedures: [...new Set(matchedProcedures)],
  };
}

function evaluateProcedure(
  procedure: ProcedureRequirement,
  matches: ProcedureMatch[]
): ProcedureEvaluation {
  const name = procedure.procedure.toLowerCase();

  if (name.includes("pre-repair scan")) {
    return buildResult(
      hasProcedure(matches, "pre_scan"),
      matches,
      "pre_scan",
      procedure
    );
  }

  if (name.includes("post-repair scan")) {
    return buildResult(
      hasProcedure(matches, "post_scan"),
      matches,
      "post_scan",
      procedure
    );
  }

  if (name.includes("camera")) {
    const present =
      hasProcedure(matches, "front_camera_calibration") ||
      hasProcedure(matches, "rear_camera_calibration") ||
      hasProcedure(matches, "side_camera_calibration") ||
      hasProcedure(matches, "surround_camera_calibration");

    return buildResult(present, matches, "camera", procedure);
  }

  if (name.includes("radar") || name.includes("acc")) {
    const present =
      hasProcedure(matches, "acc_radar_calibration") ||
      hasProcedure(matches, "front_side_radar_calibration");

    return buildResult(present, matches, "radar", procedure);
  }

  if (name.includes("lane")) {
    const present =
      hasProcedure(matches, "lane_change_calibration") ||
      hasProcedure(matches, "lane_departure_calibration") ||
      hasProcedure(matches, "front_side_radar_calibration");

    return buildResult(present, matches, "lane", procedure);
  }

  if (name.includes("steering angle")) {
    return buildResult(
      hasProcedure(matches, "steering_angle_calibration"),
      matches,
      "steering",
      procedure
    );
  }

  if (name.includes("seat belt")) {
    return buildResult(
      hasProcedure(matches, "seat_belt_check"),
      matches,
      "seatbelt",
      procedure
    );
  }

  if (name.includes("alignment")) {
    return buildResult(
      hasProcedure(matches, "wheel_alignment"),
      matches,
      "alignment",
      procedure
    );
  }

  return {
    status: "unclear" as const,
    confidence: "low" as const,
    evidence: [],
    reasoning:
      "Procedure could not be confidently matched to any detected operation.",
  };
}

function buildResult(
  present: boolean,
  matches: ProcedureMatch[],
  type: string,
  procedure: ProcedureRequirement
): ProcedureEvaluation {
  const related = matches
    .filter((m) => m.key.includes(type))
    .map((m) => m.matchedAlias);

  if (present) {
    return {
      status: "present" as const,
      confidence: (related.length > 1 ? "high" : "medium") as "high" | "medium",
      evidence: related,
      reasoning:
        "Function is represented in the estimate, either directly or through equivalent operations.",
    };
  }

  return {
    status: (related.length > 0 ? "unclear" : "not_detected") as
      | "unclear"
      | "not_detected",
    confidence: (related.length > 0 ? "low" : "medium") as "low" | "medium",
    evidence: related,
    reasoning:
      related.length > 0
        ? "Related operations were found, but functional coverage is not clearly confirmed."
        : `No matching or equivalent operation found for ${procedure.procedure}.`,
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

    return [...matches, ...impliedMatches];
  }

  return matches;
}

function dedupeObservations(observations: RepairObservation[]) {
  const seen = new Map<string, RepairObservation>();

  for (const obs of observations) {
    const key = obs.procedure.toLowerCase();

    if (!seen.has(key)) {
      seen.set(key, obs);
      continue;
    }

    const existing = seen.get(key)!;

    seen.set(key, {
      ...existing,
      confidence:
        existing.confidence === "high" || obs.confidence === "high"
          ? "high"
          : existing.confidence === "medium" || obs.confidence === "medium"
            ? "medium"
            : "low",
      evidence: [...new Set([...existing.evidence, ...obs.evidence])],
    });
  }

  return [...seen.values()];
}
