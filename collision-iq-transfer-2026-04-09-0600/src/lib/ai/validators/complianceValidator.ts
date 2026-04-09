import type { RequiredProcedure } from "../rules/procedureRules";

export interface ComplianceIssue {
  issue: string;
  procedure?: string;
  status?: "present" | "unclear" | "not_detected";
  observation?: string;
  confidence?: "low" | "medium" | "high";
  basis?: string;
  impact?: string;
  severity: "low" | "medium" | "high";
  category:
    | "missing_procedure"
    | "calibration_requirement"
    | "compliance_issue"
    | "supplement_opportunity"
    | "safety_risk";
  evidenceBasis: string;
  reference: string;
}

export interface ComplianceValidationResult {
  observations: ComplianceIssue[];
  supplementOpportunities: ComplianceIssue[];
  matchedProcedures: string[];
}

const calibrationEquivalents = {
  frontCamera: [
    "front camera",
    "forward camera",
    "kafas",
    "camera dynamic",
    "all-around camera",
    "all around camera",
    "peripheral camera",
    "surround view",
    "360 camera",
  ],
  radar: [
    "acc",
    "radar",
    "adaptive cruise",
    "front radar",
    "calibrate acc",
    "front side radar",
  ],
  laneChange: [
    "lane change calibration",
    "blind spot",
    "side radar",
    "front side radar",
    "all-around camera",
    "peripheral camera",
    "surround view",
    "360 camera",
  ],
  seatBelt: [
    "seat belt system operational check",
    "inspect seat belt system",
    "seat belt dynamic function test",
    "seat belt function test",
  ],
} as const;

function detectFunction(
  text: string,
  group: keyof typeof calibrationEquivalents
) {
  return calibrationEquivalents[group].some((term) => text.includes(term));
}

function matchesProcedureFunction(
  normalizedEstimate: string,
  procedure: RequiredProcedure
): boolean {
  const lowerProcedure = procedure.procedure.toLowerCase();

  if (lowerProcedure.includes("kafas") || lowerProcedure.includes("camera calibration")) {
    return detectFunction(normalizedEstimate, "frontCamera");
  }

  if (
    lowerProcedure.includes("acc radar") ||
    lowerProcedure.includes("radar calibration") ||
    lowerProcedure.includes("adaptive cruise")
  ) {
    return detectFunction(normalizedEstimate, "radar");
  }

  if (lowerProcedure.includes("lane change")) {
    return detectFunction(normalizedEstimate, "laneChange");
  }

  if (lowerProcedure.includes("seat belt")) {
    return detectFunction(normalizedEstimate, "seatBelt");
  }

  return false;
}

export function validateRepair(
  estimateText: string,
  procedures: RequiredProcedure[]
): ComplianceValidationResult {
  const normalizedEstimate = estimateText.toLowerCase();
  const observations: ComplianceIssue[] = [];
  const supplementOpportunities: ComplianceIssue[] = [];
  const matchedProcedures: string[] = [];

  for (const procedure of procedures) {
    const aliases = [procedure.procedure, ...procedure.aliases].map((alias) =>
      alias.toLowerCase()
    );
    const found =
      aliases.some((alias) => normalizedEstimate.includes(alias)) ||
      matchesProcedureFunction(normalizedEstimate, procedure);

    if (found) {
      matchedProcedures.push(procedure.procedure);
    }
    const issue = buildProcedureObservation(procedure, found);
    observations.push(issue);

    if (issue.category === "supplement_opportunity" && issue.status !== "present") {
      supplementOpportunities.push(issue);
    }
  }

  return {
    observations: dedupeIssues(observations),
    supplementOpportunities: dedupeIssues(supplementOpportunities),
    matchedProcedures: [...new Set(matchedProcedures)],
  };
}

function buildProcedureObservation(
  procedure: RequiredProcedure,
  found: boolean
): ComplianceIssue {
  const category =
    procedure.category === "supplement"
      ? "supplement_opportunity"
      : procedure.category === "adas"
        ? "calibration_requirement"
        : "missing_procedure";

  const status = found ? "present" : "not_detected";
  const observation = found
    ? `${humanizeProcedure(procedure.procedure)} function appears represented in estimate`
    : `${humanizeProcedure(procedure.procedure)} function not clearly represented in estimate`;
  const basis = found
    ? "Matching or equivalent operation detected"
    : "No matching or equivalent operation found";
  const impact =
    found
      ? "Function appears covered based on estimate wording"
      : procedure.category === "adas"
      ? "Potential ADAS verification gap"
      : procedure.category === "safety"
        ? "Potential safety verification gap"
        : procedure.category === "supplement"
          ? "Potential supplement or process-depth gap"
          : "Potential repair process gap";

  return {
    issue: observation,
    procedure: procedure.procedure,
    status,
    observation,
    confidence: found ? "medium" : procedure.severity === "high" ? "medium" : "low",
    basis,
    impact,
    severity: procedure.severity,
    category,
    evidenceBasis: procedure.evidenceBasis,
    reference: `${basis}. ${procedure.matchedOperation} -> ${procedure.rationale}`,
  };
}

function humanizeProcedure(procedure: string): string {
  const lower = procedure.toLowerCase();

  if (lower.includes("radar")) return "Radar calibration";
  if (lower.includes("camera")) return "Camera calibration";
  if (lower.includes("scan")) return "Scan";
  if (lower.includes("alignment")) return "Alignment";
  if (lower.includes("seat belt")) return "Seat belt system check";

  return procedure;
}

function dedupeIssues(issues: ComplianceIssue[]): ComplianceIssue[] {
  const seen = new Map<string, ComplianceIssue>();

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
      reference:
        existing.reference === issue.reference
          ? existing.reference
          : `${existing.reference}; ${issue.reference}`,
      status:
        existing.status === "present" || issue.status === "present"
          ? "present"
          : existing.status === "unclear" || issue.status === "unclear"
            ? "unclear"
            : "not_detected",
    });
  }

  return [...seen.values()];
}
