import type { ComparisonFacts } from "../extractors/comparisonExtractor";
import type { AgentFindingEnhanced } from "../types/analysis";

export type SupplementAgentFinding = {
  category: "supplement";
  opportunity: string;
  detail: string;
  enhanced: AgentFindingEnhanced;
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
      enhanced: {
        issue: "Calibration transport not reimbursed",
        finding:
          "The insurer estimate does not include a transport line for ADAS calibration at a sublet facility.",
        evidenceLevel: "referenced",
        supportSources: ["upload"],
        risk: "medium",
        confidence: 0.7,
        secondLevelReasoning:
          "If calibration must be performed at a dealership or specialized sublet shop, transport costs are a legitimate repair-related expense. Omitting this from the estimate means the shop absorbs the cost or the customer pays out of pocket.",
        thirdLevelAction:
          "Document the calibration facility used, confirm it is a required sublet (not on-site capable), and submit transport as a supplement line item with the sublet invoice.",
      },
    });
  }

  if (!facts.insurer.cavityWax) {
    supplements.push({
      category: "supplement",
      opportunity: "Corrosion protection materials",
      detail: "Cavity wax / corrosion protection is not shown in the insurer estimate.",
      enhanced: {
        issue: "Corrosion protection materials excluded from reimbursement",
        finding:
          "Cavity wax and seam sealer are absent from the insurer estimate for this repair.",
        evidenceLevel: "referenced",
        supportSources: ["upload", "google-drive"],
        risk: "medium",
        confidence: 0.75,
        secondLevelReasoning:
          "These materials are consumed during the repair and are required by OEM procedure. If not included, the shop is performing unreimbursed OEM-required steps, which is disputable under standard claims handling rules.",
        thirdLevelAction:
          "Attach the OEM corrosion protection requirement document and submit a supplement for material cost. If the shop already applied these materials, include the product name and quantity used from the repair order.",
      },
    });
  }

  if (!facts.insurer.finishSandPolish) {
    supplements.push({
      category: "supplement",
      opportunity: "Finish sand and polish",
      detail: "Finish sand and polish is not shown in the insurer estimate.",
      enhanced: {
        issue: "Finish sand and polish not included on insurer estimate",
        finding:
          "No finish sand and polish line appears on the insurer estimate for refinished panels.",
        evidenceLevel: "inferred",
        supportSources: ["upload"],
        risk: "low",
        confidence: 0.6,
        secondLevelReasoning:
          "Finish sand and polish is a recognized included operation in most refinish labor guides when overspray or blend inconsistency is present. While sometimes bundled into refinish labor, the absence should be verified against the estimating guide entry for this panel.",
        thirdLevelAction:
          "Check the estimating guide (CCC/Mitchell/Audatex) to confirm whether finish sand and polish is a separate line for this panel or subsumed into refinish time. If separate, add as supplement with guide reference.",
      },
    });
  }

  return supplements;
}
