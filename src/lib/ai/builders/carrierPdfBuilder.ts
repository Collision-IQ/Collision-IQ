import { buildSupplementLines } from "./supplementBuilder";
import { calculateDV } from "./dvCalculator";
import { generateNegotiationResponse } from "./negotiationEngine";
import type { AnalysisResult, RepairIntelligenceReport } from "../types/analysis";

export function buildCarrierReport({
  result,
  meta,
}: {
  result: AnalysisResult | RepairIntelligenceReport;
  meta: {
    vehicle?: string;
    vin?: string;
    repairCost?: number;
    structural?: boolean;
    airbag?: boolean;
    year?: number;
    isLuxury?: boolean;
  };
}) {
  const supplements = buildSupplementLines(result);
  const narrative = "narrative" in result ? result.narrative : result.analysis?.narrative ?? "";

  const dv = calculateDV({
    repairCost: meta.repairCost,
    structural: meta.structural,
    airbag: meta.airbag,
    vehicleYear: meta.year,
    isLuxury: meta.isLuxury,
  });

  const negotiation = generateNegotiationResponse(result);

  return `
COLLISION REPAIR SUPPLEMENT & EVALUATION

----------------------------------------
VEHICLE
----------------------------------------
Vehicle: ${meta.vehicle || "Unknown"}
VIN: ${meta.vin || "Unknown"}

----------------------------------------
REPAIR POSITION
----------------------------------------
${narrative || "No repair narrative was available from the current analysis."}

----------------------------------------
SUPPLEMENT ITEMS
----------------------------------------

${supplements
    .map(
      (item) => `- ${item.title}
  Category: ${item.category}
  Reason: ${item.rationale}`
    )
    .join("\n\n")}

----------------------------------------
DIMINISHED VALUE
----------------------------------------

${
    dv
      ? `${formatDVRange(dv.low, dv.high)}

Confidence: ${dv.confidence}

${dv.rationale}`
      : "Not enough data to determine diminished value."
  }

----------------------------------------
POSITION STATEMENT
----------------------------------------

The current estimate does not clearly support a fully verified and defensible repair process.

Proper repair requires:
- system verification
- documented procedures
- complete process support

----------------------------------------
REQUEST
----------------------------------------

${negotiation || "Please review and advise how the repair is being supported."}
`.trim();
}

function formatDVRange(low: number, high: number): string {
  if (low === 0 && high === 0) {
    return "Not enough data to quantify a DV range yet.";
  }

  return `$${low} - $${high}`;
}
