import { parseEstimate } from "./estimateParser"
import { detectProcedures, ProcedureRequirement } from "./procedureDetector"
import { validateRepair, RepairIssue } from "./repairValidator"

export interface RepairIntelligenceResult {
  parsed: ReturnType<typeof parseEstimate>
  operations: ReturnType<typeof parseEstimate>["operations"]
  requiredProcedures: ProcedureRequirement[]
  missingProcedures: ProcedureRequirement[]
  matchedProcedures: string[]
  issues: RepairIssue[]
  riskScore: "low" | "medium" | "high"
  confidence: "low" | "medium" | "high"
}

export function runRepairIntelligence(
  estimateText: string
): RepairIntelligenceResult {
  const parsed = parseEstimate(estimateText)
  const requiredProcedures = detectProcedures(parsed)
  const validation = validateRepair(parsed, requiredProcedures)

  return {
    parsed,
    operations: parsed.operations,
    requiredProcedures,
    missingProcedures: validation.missingProcedures,
    matchedProcedures: validation.matchedProcedures,
    issues: validation.issues,
    riskScore: calculateRiskScore(validation.issues),
    confidence: calculateConfidence(parsed.operations.length, requiredProcedures.length),
  }
}

function calculateRiskScore(
  issues: RepairIssue[]
): RepairIntelligenceResult["riskScore"] {
  if (issues.some((issue) => issue.severity === "high")) return "high"
  if (issues.some((issue) => issue.severity === "medium")) return "medium"
  return "low"
}

function calculateConfidence(
  operationCount: number,
  requirementCount: number
): RepairIntelligenceResult["confidence"] {
  if (operationCount >= 3 && requirementCount > 0) return "high"
  if (operationCount > 0) return "medium"
  return "low"
}
