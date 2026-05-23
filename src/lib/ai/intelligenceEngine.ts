import { parseEstimate } from "./estimateParser";
import { detectProcedures, ProcedureRequirement } from "./procedureDetector";
import { validateRepair, RepairObservation } from "./repairValidator";

export interface RepairIntelligenceResult {
  parsed: ReturnType<typeof parseEstimate>;
  operations: ReturnType<typeof parseEstimate>["operations"];
  requiredProcedures: ProcedureRequirement[];
  matchedProcedures: string[];
  observations: RepairObservation[];
  confidence: "low" | "medium" | "high";
}

export function runRepairIntelligence(
  estimateText: string
): RepairIntelligenceResult {
  const parsed = parseEstimate(estimateText);
  const requiredProcedures = detectProcedures(parsed);
  const validation = validateRepair(parsed, requiredProcedures);

  return {
    parsed,
    operations: parsed.operations,
    requiredProcedures,
    matchedProcedures: validation.matchedProcedures,
    observations: validation.observations,
    confidence: calculateConfidence(
      parsed.operations.length,
      requiredProcedures.length,
      validation.observations
    ),
  };
}

function calculateConfidence(
  operationCount: number,
  requirementCount: number,
  observations: RepairObservation[]
): RepairIntelligenceResult["confidence"] {
  if (operationCount === 0) return "low";

  const presentCount = observations.filter(
    (obs) => obs.status === "present"
  ).length;

  const unclearCount = observations.filter(
    (obs) => obs.status === "unclear"
  ).length;

  if (operationCount >= 3 && requirementCount > 0) {
    if (presentCount > 0 && unclearCount <= Math.max(1, requirementCount / 2)) {
      return "high";
    }
    return "medium";
  }

  return "medium";
}
