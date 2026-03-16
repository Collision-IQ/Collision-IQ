import { parseEstimate, type ParsedEstimate } from "../extractors/estimateExtractor";

export type EstimateAgentFinding = {
  category: "labor" | "operation" | "cost";
  issue: string;
  difference?: number;
  detail: string;
};

export async function runEstimateAgent(
  shopEstimateText: string,
  insurerEstimateText: string
): Promise<EstimateAgentFinding[]> {
  const shopEstimate = parseEstimate(shopEstimateText);
  const insurerEstimate = parseEstimate(insurerEstimateText);

  return compareEstimates(shopEstimate, insurerEstimate);
}

function compareEstimates(
  shopEstimate: ParsedEstimate,
  insurerEstimate: ParsedEstimate
): EstimateAgentFinding[] {
  const findings: EstimateAgentFinding[] = [];

  if (
    typeof shopEstimate.bodyHours === "number" &&
    typeof insurerEstimate.bodyHours === "number" &&
    shopEstimate.bodyHours > insurerEstimate.bodyHours
  ) {
    findings.push({
      category: "labor",
      issue: "Reduced body labor in insurer estimate",
      difference: shopEstimate.bodyHours - insurerEstimate.bodyHours,
      detail: `Shop body hours: ${shopEstimate.bodyHours}. Insurer body hours: ${insurerEstimate.bodyHours}.`,
    });
  }

  if (
    typeof shopEstimate.totalCost === "number" &&
    typeof insurerEstimate.totalCost === "number" &&
    shopEstimate.totalCost > insurerEstimate.totalCost
  ) {
    findings.push({
      category: "cost",
      issue: "Lower total cost in insurer estimate",
      difference: shopEstimate.totalCost - insurerEstimate.totalCost,
      detail: `Shop total: ${shopEstimate.totalCost}. Insurer total: ${insurerEstimate.totalCost}.`,
    });
  }

  return findings;
}
