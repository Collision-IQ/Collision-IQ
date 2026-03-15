import type { RepairPipelineResult } from "../pipeline/repairPipeline";

export interface InspectorPanelData {
  riskScore: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  criticalIssues: number;
  evidenceQuality: "present" | "limited" | "none";
  keyRisks: string[];
  complianceIssues: string[];
  supplementOpportunities: string[];
  evidenceReferences: string[];
}

export function buildRepairIntelligenceReport(
  intelligence: RepairPipelineResult
): string {
  if (
    intelligence.operations.length === 0 &&
    intelligence.complianceIssues.length === 0 &&
    intelligence.adasFindings.length === 0
  ) {
    return "";
  }

  const operations = intelligence.operations.length
    ? intelligence.operations
        .slice(0, 10)
        .map((operation) => `- ${operation.operation} ${operation.component}`)
        .join("\n")
    : "- No estimate operations detected";

  const requiredProcedures = intelligence.requiredProcedures.length
    ? intelligence.requiredProcedures
        .map(
          (procedure) =>
            `- ${procedure.procedure} | Trigger: ${procedure.trigger} | Evidence Basis: ${procedure.evidenceBasis}`
        )
        .join("\n")
    : "- No required procedures detected";

  const missingProcedures = intelligence.missingProcedures.length
    ? intelligence.missingProcedures
        .map(
          (procedure) =>
            `- ${procedure.procedure} | Triggered by: ${procedure.matchedOperation} | Why: ${procedure.rationale}`
        )
        .join("\n")
    : "- No missing procedures detected";

  const evidenceReferences = intelligence.evidenceReferences.length
    ? intelligence.evidenceReferences.map((reference) => `- ${reference}`).join("\n")
    : "- No evidence references extracted";

  return `
[REPAIR INTELLIGENCE PIPELINE]

Risk Score: ${intelligence.riskScore.toUpperCase()}
Confidence: ${intelligence.confidence.toUpperCase()}

Detected Operations:
${operations}

Required Procedures:
${requiredProcedures}

Missing Procedures:
${missingProcedures}

Evidence References:
${evidenceReferences}
`.trim();
}

export function buildInspectorPanelData(
  intelligence: RepairPipelineResult
): InspectorPanelData {
  return {
    riskScore: intelligence.riskScore,
    confidence: intelligence.confidence,
    criticalIssues: intelligence.complianceIssues.length,
    evidenceQuality: intelligence.evidenceReferences.length
      ? "present"
      : intelligence.adasFindings.length
        ? "limited"
        : "none",
    keyRisks: intelligence.complianceIssues
      .filter((issue) => issue.severity === "high")
      .slice(0, 4)
      .map((issue) => issue.issue),
    complianceIssues: intelligence.complianceIssues
      .slice(0, 4)
      .map((issue) => issue.issue),
    supplementOpportunities: intelligence.supplementOpportunities
      .slice(0, 4)
      .map((issue) => issue.issue),
    evidenceReferences: intelligence.evidenceReferences.slice(0, 4),
  };
}
