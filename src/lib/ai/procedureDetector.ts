import { ParsedEstimate } from "./estimateParser"

export interface ProcedureRequirement {
  procedure: string
  reason: string
}

export function detectProcedures(estimate: ParsedEstimate): ProcedureRequirement[] {

  const procedures: ProcedureRequirement[] = []

  for (const op of estimate.operations) {

    if (op.panel.includes("bumper")) {
      procedures.push({
        procedure: "ACC radar calibration",
        reason: "Radar sensors located behind front bumper"
      })
    }

    if (op.panel.includes("headlamp")) {
      procedures.push({
        procedure: "KAFAS camera calibration",
        reason: "Front camera alignment may be affected"
      })
    }
  }

  return procedures
}