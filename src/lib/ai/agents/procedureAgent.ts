import type { ComparisonFacts } from "../extractors/comparisonExtractor";
import type { OemRequirements } from "../extractors/oemProcedureExtractor";

export type ProcedureAgentFinding = {
  category: "corrosion protection" | "scan" | "calibration";
  issue: string;
  severity: "low" | "medium" | "high";
  detail: string;
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
    });
  }

  if (!facts.insurer.cavityWax) {
    findings.push({
      category: "corrosion protection",
      issue: "Cavity wax missing",
      severity: "medium",
      detail: "The estimate does not show cavity wax / corrosion protection.",
    });
  }

  return findings;
}
