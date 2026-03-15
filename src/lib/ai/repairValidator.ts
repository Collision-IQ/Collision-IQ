import { ParsedEstimate } from "./estimateParser"
import { ProcedureRequirement } from "./procedureDetector"

export interface RepairIssue {
  issue: string
  severity: "low" | "medium" | "high"
}

export function validateRepair(
  estimate: ParsedEstimate,
  procedures: ProcedureRequirement[]
): RepairIssue[] {

  const issues: RepairIssue[] = []

  for (const proc of procedures) {

    const included = estimate.operations.some(op =>
      op.panel.toLowerCase().includes(proc.procedure.toLowerCase())
    )

    if (!included) {
      issues.push({
        issue: `Missing required procedure: ${proc.procedure}`,
        severity: "high"
      })
    }
  }

  return issues
}