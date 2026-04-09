import type { AnalysisFinding, RepairIntelligenceReport } from "../types/analysis";
import { buildSupplementLines } from "./supplementBuilder";
import { calculateDV } from "./dvCalculator";

export function buildCarrierReport(
  result: RepairIntelligenceReport,
  meta: {
    vehicle?: string;
    repairCost?: number;
    structural?: boolean;
    airbag?: boolean;
    year?: number;
  },
  findings: AnalysisFinding[]
) {
  const supplements = buildSupplementLines(findings);

  const dv = calculateDV({
    repairCost: meta.repairCost || 0,
    structural: meta.structural || false,
    airbag: meta.airbag || false,
    vehicleYear: meta.year,
  });

  return `
Collision Repair Supplement & Evaluation

Vehicle: ${meta.vehicle || "Unknown"}

----------------------------------------
SUPPLEMENT ITEMS
----------------------------------------

${supplements.length > 0
    ? supplements
        .map(
          (item) => `- ${item.title}
  Reason: ${item.rationale}`
        )
        .join("\n\n")
    : "- No clear supplement items were generated from the current findings."}

----------------------------------------
DIMINISHED VALUE
----------------------------------------

${dv
    ? `Estimated DV: ${formatDVRange(dv.low, dv.high)}

${dv.rationale}`
    : "Not enough data to determine diminished value."}

----------------------------------------
POSITION STATEMENT
----------------------------------------

The current estimate does not clearly support a fully verified and documented repair process.

The listed items are required to ensure:
- proper system functionality
- compliance with repair standards
- defensible repair documentation

Please review and advise how these operations are being addressed.
`.trim();
}

function formatDVRange(low: number, high: number): string {
  if (low === 0 && high === 0) {
    return "Not enough data to quantify a DV range yet.";
  }

  return `$${low} - $${high}`;
}
