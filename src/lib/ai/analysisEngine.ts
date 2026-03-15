import { runRepairIntelligence } from "./intelligenceEngine"

export function analyzeRepair(estimateText: string) {
  return runRepairIntelligence(estimateText)
}
