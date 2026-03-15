import { ParsedEstimate } from "./estimateParser"
import { ProcedureRequirement } from "./procedureDetector"

export interface RepairIssue {
  issue: string
  severity: "low" | "medium" | "high"
  category:
    | "missing_procedure"
    | "missing_scan"
    | "safety_risk"
    | "supplement_opportunity"
  procedure?: string
  evidenceBasis?: string
  rationale?: string
}

export interface ValidationResult {
  missingProcedures: ProcedureRequirement[]
  issues: RepairIssue[]
  matchedProcedures: string[]
}

export function validateRepair(
  estimate: ParsedEstimate,
  procedures: ProcedureRequirement[]
): ValidationResult {
  const normalizedEstimate = estimate.rawText.toLowerCase()
  const missingProcedures: ProcedureRequirement[] = []
  const matchedProcedures: string[] = []
  const issues: RepairIssue[] = []

  for (const proc of procedures) {
    const aliases = [proc.procedure, ...proc.aliases].map((value) =>
      value.toLowerCase()
    )

    const included = aliases.some((alias) => normalizedEstimate.includes(alias))

    if (included) {
      matchedProcedures.push(proc.procedure)
      continue
    }

    missingProcedures.push(proc)

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
    })

    if (proc.category === "adas" || proc.category === "safety") {
      issues.push({
        issue: `Safety exposure created by missing ${proc.procedure}`,
        severity: "high",
        category: "safety_risk",
        procedure: proc.procedure,
        evidenceBasis: proc.evidenceBasis,
        rationale: proc.reason,
      })
    }
  }

  return {
    missingProcedures,
    issues: dedupeIssues(issues),
    matchedProcedures: [...new Set(matchedProcedures)],
  }
}

function dedupeIssues(issues: RepairIssue[]): RepairIssue[] {
  const seen = new Map<string, RepairIssue>()

  for (const issue of issues) {
    const key = `${issue.category}:${issue.procedure ?? issue.issue}`.toLowerCase()
    const existing = seen.get(key)

    if (!existing) {
      seen.set(key, issue)
      continue
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
    })
  }

  return [...seen.values()]
}
