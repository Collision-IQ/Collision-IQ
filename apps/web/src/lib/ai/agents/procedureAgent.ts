import type { ComparisonFacts } from "../extractors/comparisonExtractor";
import type { OemRequirements } from "../extractors/oemProcedureExtractor";
import type { AgentFindingEnhanced } from "../types/analysis";

export type ProcedureAgentFinding = {
  category: "corrosion protection" | "scan" | "calibration";
  issue: string;
  severity: "low" | "medium" | "high";
  detail: string;
  enhanced: AgentFindingEnhanced;
};

export async function runProcedureAgent(
  facts: ComparisonFacts,
  oemProcedures: OemRequirements
): Promise<ProcedureAgentFinding[]> {
  const findings: ProcedureAgentFinding[] = [];

  if (oemProcedures.collisionDamageRequiresScan && !facts.insurer.preScan) {
    findings.push({
      category: "scan",
      issue: "Pre-repair scan missing",
      severity: "high",
      detail: "OEM procedure requires scan support for collision damage.",
      enhanced: {
        issue: "Pre-repair scan not documented on insurer estimate",
        finding:
          "The insurer estimate does not include a pre-repair diagnostic scan line, but the OEM procedure for this type of collision damage requires one.",
        evidenceLevel: "referenced",
        supportSources: ["upload", "google-drive"],
        risk: "high",
        confidence: 0.88,
        secondLevelReasoning:
          "Pre-repair scans are required by most OEMs after any moderate-to-severe collision because DTC codes, airbag readiness, and ADAS system faults cannot be detected visually. Without a scan, hidden damage to safety systems goes undetected and creates post-repair liability.",
        thirdLevelAction:
          "Produce the OEM scan requirement position statement or repair procedure for this make and model. Request that the insurer add a scan line or issue sublet authorization. Document actual scan results as supporting evidence.",
      },
    });
  }

  if (!facts.insurer.cavityWax) {
    findings.push({
      category: "corrosion protection",
      issue: "Cavity wax missing",
      severity: "medium",
      detail: "The estimate does not show cavity wax / corrosion protection.",
      enhanced: {
        issue: "Corrosion protection not included on insurer estimate",
        finding:
          "No cavity wax or seam sealer line appears on the insurer estimate for repaired structural or enclosed panel areas.",
        evidenceLevel: "referenced",
        supportSources: ["upload", "google-drive"],
        risk: "medium",
        confidence: 0.75,
        secondLevelReasoning:
          "Corrosion protection is required by all major OEMs when enclosed panel sections or weld areas are disturbed. Omitting it voids the factory corrosion warranty and creates long-term rust exposure that is not visible at the time of repair completion.",
        thirdLevelAction:
          "Pull the OEM corrosion protection requirement for the panels involved. Confirm whether the shop has documented cavity wax application on the repair order. Add a supplement line for materials and labor if not reimbursed.",
      },
    });
  }

  if (!facts.insurer.preScan && !oemProcedures.collisionDamageRequiresScan) {
    findings.push({
      category: "scan",
      issue: "Post-repair scan not confirmed",
      severity: "medium",
      detail: "No post-repair scan line is visible on the insurer estimate.",
      enhanced: {
        issue: "Post-repair scan absent from estimate",
        finding:
          "The insurer estimate does not include a post-repair scan. Post-repair scans are required to confirm all DTCs are cleared and safety systems are functioning after structural or electrical work.",
        evidenceLevel: "inferred",
        supportSources: ["upload"],
        risk: "medium",
        confidence: 0.6,
        secondLevelReasoning:
          "A post-repair scan documents that no fault codes remain after the repair. Without it, the shop and insurer cannot confirm all airbag, ABS, and ADAS systems are functioning. This is a liability gap for both parties.",
        thirdLevelAction:
          "Request OEM position statement on post-repair scan requirements for the involved systems. If the shop has a scan report, attach it. Add a supplement line for post-repair scan if not included.",
      },
    });
  }

  return findings;
}
