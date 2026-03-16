import type { EstimateOperation } from "../extractors/estimateExtractor";

export type ADASAgentFinding = {
  system: "ADAS";
  requirement: string;
  status: "required" | "included" | "missing";
  detail: string;
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
      requirement: "ACC radar calibration",
      status: "required",
      detail: "Front bumper operations are present in the estimate.",
    });

    findings.push({
      system: "ADAS",
      requirement: "KAFAS camera calibration",
      status: "required",
      detail: "Front bumper operations are present in the estimate.",
    });
  }

  return findings;
}
