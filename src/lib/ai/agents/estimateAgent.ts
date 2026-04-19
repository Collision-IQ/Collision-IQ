import {
  extractEstimateOps,
  parseEstimate,
  type ParsedEstimate,
  type EstimateOperation,
} from "../extractors/estimateExtractor";

export type EstimateAgentInsight = {
  observation: string;
  impact?: string;
  comparison?: string;
};

export type EstimateAgentFinding = {
  scope: EstimateAgentInsight;
  labor: EstimateAgentInsight | null;
  structure: EstimateAgentInsight;
  cost: EstimateAgentInsight | null;
};

export async function runEstimateAgent(
  shopEstimateText: string,
  insurerEstimateText: string
): Promise<EstimateAgentFinding> {
  const shop = parseEstimate(shopEstimateText);
  const insurer = parseEstimate(insurerEstimateText);
  const shopOperations = extractEstimateOps(shopEstimateText);
  const insurerOperations = extractEstimateOps(insurerEstimateText);

  return {
    scope: analyzeScope(shop, insurer, shopOperations, insurerOperations),
    labor: analyzeLabor(shop, insurer),
    structure: analyzeStructure(shop, insurer, shopOperations, insurerOperations),
    cost: analyzeCost(shop, insurer),
  };
}

function analyzeScope(
  shop: ParsedEstimate,
  insurer: ParsedEstimate,
  shopOperations: EstimateOperation[],
  insurerOperations: EstimateOperation[]
): EstimateAgentInsight {
  const primaryComponents = summarizeComponents(shopOperations);
  const scopeLabel =
    primaryComponents.length > 0
      ? primaryComponents.join(", ")
      : "the visible repair operations";

  return {
    observation: `The repair scope is centered around ${scopeLabel}.`,
    comparison:
      shop.lines.length > insurer.lines.length || shopOperations.length > insurerOperations.length
        ? "The documents carry different scope depth."
        : "Scope appears generally aligned.",
  };
}

function analyzeLabor(
  shop: ParsedEstimate,
  insurer: ParsedEstimate
): EstimateAgentInsight | null {
  if (
    typeof shop.bodyHours === "number" &&
    typeof insurer.bodyHours === "number" &&
    shop.bodyHours > insurer.bodyHours
  ) {
    return {
      observation: "Body labor differs between the two estimates.",
      impact:
        "The difference should be evaluated against documented damage, access needs, repair procedures, and verification requirements.",
    };
  }

  return null;
}

function analyzeStructure(
  shop: ParsedEstimate,
  insurer: ParsedEstimate,
  shopOperations: EstimateOperation[],
  insurerOperations: EstimateOperation[]
): EstimateAgentInsight {
  const compressed =
    shopOperations.length > insurerOperations.length ||
    shop.lines.length > insurer.lines.length;

  return {
    observation:
      "The structure of the estimate matters more than individual line items.",
    impact: compressed
      ? "Different operation depth can affect repair completeness, but significance requires confirmation against the file evidence."
      : "The line structure appears broadly aligned, so the bigger question is whether the documented operations are supported clearly enough.",
  };
}

function analyzeCost(
  shop: ParsedEstimate,
  insurer: ParsedEstimate
): EstimateAgentInsight | null {
  if (
    typeof shop.totalCost === "number" &&
    typeof insurer.totalCost === "number" &&
    shop.totalCost > insurer.totalCost
  ) {
    return {
      observation: "The estimates carry different total costs.",
      impact:
        "The cost difference should be read through documented scope, safety verification, fit, function, and value rather than assumed fault by either party.",
    };
  }

  return null;
}

function summarizeComponents(operations: EstimateOperation[]): string[] {
  return [...new Set(
    operations
      .map((operation) => operation.component.trim())
      .filter(Boolean)
  )].slice(0, 3);
}
