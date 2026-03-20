import type { ComparisonFacts } from "../extractors/comparisonExtractor";

export type SupplementAgentFinding = {
  category: "supplement";
  opportunity: string;
  detail: string;
};

export async function runSupplementAgent(
  facts: ComparisonFacts
): Promise<SupplementAgentFinding[]> {
  const supplements: SupplementAgentFinding[] = [];

  if (!facts.insurer.calibrationTransport) {
    supplements.push({
      category: "supplement",
      opportunity: "Calibration transport line",
      detail: "No transport to/from sublet calibration appears in the insurer estimate.",
    });
  }

  if (!facts.insurer.cavityWax) {
    supplements.push({
      category: "supplement",
      opportunity: "Corrosion protection materials",
      detail: "Cavity wax / corrosion protection is not shown in the insurer estimate.",
    });
  }

  if (!facts.insurer.finishSandPolish) {
    supplements.push({
      category: "supplement",
      opportunity: "Finish sand and polish",
      detail: "Finish sand and polish is not shown in the insurer estimate.",
    });
  }

  return supplements;
}
