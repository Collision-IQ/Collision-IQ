import { runRepairPipeline } from "./pipeline/repairPipeline"

export function analyzeRepair(estimateText: string) {
  return runRepairPipeline([
    {
      filename: "estimate.txt",
      mime: "text/plain",
      text: estimateText,
    },
  ])
}
