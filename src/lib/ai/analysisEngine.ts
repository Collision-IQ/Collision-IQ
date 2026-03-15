import { parseEstimate } from "./estimateParser"
import { detectProcedures } from "./procedureDetector"
import { validateRepair } from "./repairValidator"

export function analyzeRepair(estimateText: string) {

  const parsed = parseEstimate(estimateText)

  const procedures = detectProcedures(parsed)

  const issues = validateRepair(parsed, procedures)

  return {
    parsed,
    procedures,
    issues
  }
}