import {
  extractEstimateOps,
  parseEstimate,
  type ParsedEstimate,
  type EstimateOperation,
} from "../extractors/estimateExtractor";
import type { AgentFindingEnhanced } from "../types/analysis";

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
  enhanced: AgentFindingEnhanced[];
};

export type EstimateAgentInput = {
  shopEstimateText?: string;
  insurerEstimateText?: string;
  complianceRules?: string;
};

export async function runEstimateAgent(
  shopEstimateTextOrInput: string | EstimateAgentInput,
  insurerEstimateTextArg?: string
): Promise<EstimateAgentFinding> {
  const { shopEstimateText, insurerEstimateText } =
    typeof shopEstimateTextOrInput === "string"
      ? {
          shopEstimateText: shopEstimateTextOrInput,
          insurerEstimateText: insurerEstimateTextArg ?? "",
        }
      : {
          shopEstimateText: shopEstimateTextOrInput.shopEstimateText ?? "",
          insurerEstimateText: shopEstimateTextOrInput.insurerEstimateText ?? "",
        };

  const shop = parseEstimate(shopEstimateText);
  const insurer = parseEstimate(insurerEstimateText);
  const shopOperations = extractEstimateOps(shopEstimateText);
  const insurerOperations = extractEstimateOps(insurerEstimateText);

  const enhanced = buildEnhancedFindings(shop, insurer, shopOperations, insurerOperations);

  return {
    scope: analyzeScope(shop, insurer, shopOperations, insurerOperations),
    labor: analyzeLabor(shop, insurer),
    structure: analyzeStructure(shop, insurer, shopOperations, insurerOperations),
    cost: analyzeCost(shop, insurer),
    enhanced,
  };
}

function buildEnhancedFindings(
  shop: ParsedEstimate,
  insurer: ParsedEstimate,
  shopOperations: EstimateOperation[],
  insurerOperations: EstimateOperation[]
): AgentFindingEnhanced[] {
  const findings: AgentFindingEnhanced[] = [];

  if (shopOperations.length > insurerOperations.length) {
    findings.push({
      issue: "Scope depth gap between estimates",
      finding: `Shop estimate contains ${shopOperations.length} operations vs ${insurerOperations.length} in the insurer estimate.`,
      evidenceLevel: "referenced",
      supportSources: ["upload"],
      risk: "medium",
      confidence: 0.72,
      secondLevelReasoning:
        "A scope gap matters because missing operations represent work the shop will perform without reimbursement, creating a supplement cycle or out-of-pocket exposure for the vehicle owner.",
      thirdLevelAction:
        "Identify which specific operations are present in the shop estimate but absent from the insurer estimate, then confirm each against OEM repair procedures or standard estimating guides.",
    });
  }

  if (
    typeof shop.totalCost === "number" &&
    typeof insurer.totalCost === "number" &&
    shop.totalCost > insurer.totalCost
  ) {
    const gap = shop.totalCost - insurer.totalCost;
    findings.push({
      issue: "Cost gap between estimates",
      finding: `Shop total exceeds insurer total by approximately $${gap.toFixed(2)}.`,
      evidenceLevel: "documented",
      supportSources: ["upload"],
      risk: gap > 1500 ? "high" : "medium",
      confidence: 0.85,
      secondLevelReasoning:
        "Cost gaps driven by labor, parts, or procedure differences each carry different dispute leverage. Labor gaps require OEM or I-CAR procedure support; parts gaps require documented availability and OEM certification status.",
      thirdLevelAction:
        "Break the gap into labor, parts, and procedure categories. Request line-by-line reconciliation from the insurer, and support each category with OEM position statements or invoiced parts documentation.",
    });
  }

  if (
    typeof shop.bodyHours === "number" &&
    typeof insurer.bodyHours === "number" &&
    shop.bodyHours > insurer.bodyHours
  ) {
    findings.push({
      issue: "Body labor hours gap",
      finding: `Shop documents ${shop.bodyHours} body hours vs ${insurer.bodyHours} in the insurer estimate.`,
      evidenceLevel: "referenced",
      supportSources: ["upload"],
      risk: "medium",
      confidence: 0.78,
      secondLevelReasoning:
        "Body labor hours drive a significant portion of total cost. If the insurer's hours are based on a generic flat rate rather than damage-specific access time, the gap is disputable with photo and teardown documentation.",
      thirdLevelAction:
        "Request the estimating guide labor time used for each panel. Compare against damage photos and teardown records to confirm access-driven labor is accounted for.",
    });
  }

  return findings;
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
