import { RepairIntelligenceResult } from "./intelligenceEngine"

export function buildRepairIntelligenceReport(
  analysis: RepairIntelligenceResult
): string {
  if (
    analysis.operations.length === 0 &&
    analysis.requiredProcedures.length === 0 &&
    analysis.issues.length === 0
  ) {
    return ""
  }

  const operationLines =
    analysis.operations.length > 0
      ? analysis.operations
          .slice(0, 12)
          .map((operation) => `- ${operation.operation} ${operation.component}`)
          .join("\n")
      : "- No structured estimate operations detected"

  const requiredProcedureLines =
    analysis.requiredProcedures.length > 0
      ? analysis.requiredProcedures
          .map(
            (procedure) =>
              `- ${procedure.procedure} | Trigger: ${procedure.sourceTrigger} | Evidence Basis: ${procedure.evidenceBasis}`
          )
          .join("\n")
      : "- No required procedures identified"

  const missingProcedureLines =
    analysis.missingProcedures.length > 0
      ? analysis.missingProcedures
          .map(
            (procedure) =>
              `- ${procedure.procedure} | Triggered by: ${procedure.matchedOperation} | Why: ${procedure.reason}`
          )
          .join("\n")
      : "- No missing procedures detected from current rule set"

  const issueLines =
    analysis.issues.length > 0
      ? analysis.issues
          .map(
            (issue) =>
              `- ${issue.issue} | Severity: ${issue.severity} | Evidence Basis: ${issue.evidenceBasis ?? "Professional Standard of Care"}`
          )
          .join("\n")
      : "- No issues detected"

  return `
[REPAIR INTELLIGENCE ENGINE]

Risk Score: ${analysis.riskScore.toUpperCase()}
Confidence: ${analysis.confidence.toUpperCase()}

Detected Operations:
${operationLines}

Required Procedures:
${requiredProcedureLines}

Missing Procedures:
${missingProcedureLines}

Critical Issues:
${issueLines}
`.trim()
}
