import type { RequiredProcedure } from "../rules/procedureRules";

export interface ComplianceIssue {
  issue: string;
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
  missingProcedures: RequiredProcedure[];
  complianceIssues: ComplianceIssue[];
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
  const missingProcedures: RequiredProcedure[] = [];
  const complianceIssues: ComplianceIssue[] = [];
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
      continue;
    }

    missingProcedures.push(procedure);

    const issue: ComplianceIssue = {
      issue: `Missing required procedure: ${procedure.procedure}`,
      severity: procedure.severity,
      category:
        procedure.category === "supplement"
          ? "supplement_opportunity"
          : procedure.category === "adas"
            ? "calibration_requirement"
            : "missing_procedure",
      evidenceBasis: procedure.evidenceBasis,
      reference: `${procedure.matchedOperation} -> ${procedure.rationale}`,
    };

    complianceIssues.push(issue);

    if (issue.category === "supplement_opportunity") {
      supplementOpportunities.push(issue);
    }

    if (procedure.category === "adas" || procedure.category === "safety") {
      complianceIssues.push({
        issue: `Safety exposure created by missing ${procedure.procedure}`,
        severity: "high",
        category: "safety_risk",
        evidenceBasis: procedure.evidenceBasis,
        reference: procedure.rationale,
      });
    }
  }

  return {
    missingProcedures,
    complianceIssues: dedupeIssues(complianceIssues),
    supplementOpportunities: dedupeIssues(supplementOpportunities),
    matchedProcedures: [...new Set(matchedProcedures)],
  };
}

function dedupeIssues(issues: ComplianceIssue[]): ComplianceIssue[] {
  const seen = new Map<string, ComplianceIssue>();

  for (const issue of issues) {
    const key = `${issue.category}:${issue.issue}`.toLowerCase();
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
    });
  }

  return [...seen.values()];
}
