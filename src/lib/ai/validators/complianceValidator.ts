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
    const found = aliases.some((alias) => normalizedEstimate.includes(alias));

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
