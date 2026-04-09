import { ParsedEstimate } from "./estimateExtractor";
import { buildFactsFromEstimate } from "./buildFactsFromEstimate";

export interface ComparisonFacts {
  shop: Record<string, boolean>;
  insurer: Record<string, boolean>;
}

export function extractComparisonFacts(
  shop: ParsedEstimate,
  insurer: ParsedEstimate
): ComparisonFacts {
  return {
    shop: buildFactsFromEstimate(shop),
    insurer: buildFactsFromEstimate(insurer),
  };
}
