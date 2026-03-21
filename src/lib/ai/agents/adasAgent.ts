import type { EstimateOperation } from "../extractors/estimateExtractor";

export type ADASAgentFinding = {
  system: "ADAS";
  signal: string;
  implication: string;
};

export async function runADASAgent(
  operations: EstimateOperation[]
): Promise<ADASAgentFinding[]> {
  const findings: ADASAgentFinding[] = [];

  const bumperRemoved = operations.some((operation) =>
    operation.component.toLowerCase().includes("bumper")
  );

  if (bumperRemoved) {
    findings.push({
      system: "ADAS",
      signal: "Front-end work detected",
      implication:
        "ADAS calibration may be relevant depending on system involvement.",
    });
  }

  return findings;
}
