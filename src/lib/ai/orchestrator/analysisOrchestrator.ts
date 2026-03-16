import { getUploadedAttachments } from "@/lib/uploadedAttachmentStore";
import { orchestrateRetrieval } from "../retrievalOrchestrator";
import { runRepairPipeline } from "../pipeline/repairPipeline";
import { computeConfidenceScore } from "../scoring/confidenceScore";
import { computeEvidenceQuality } from "../scoring/evidenceScore";
import { computeRiskScore } from "../scoring/riskScore";
import type {
  AnalysisIssue,
  RepairIntelligenceReport,
  RequiredProcedureRecord,
} from "../types/analysis";
import type { EvidenceRecord } from "../types/evidence";

type RunRepairAnalysisParams = {
  artifactIds: string[];
  sessionContext?: {
    vehicleMake?: string | null;
    system?: string | null;
    component?: string | null;
    procedure?: string | null;
  } | null;
  userIntent?: string | null;
};

export async function runRepairAnalysis({
  artifactIds,
  sessionContext,
  userIntent,
}: RunRepairAnalysisParams): Promise<RepairIntelligenceReport> {
  const attachments = getUploadedAttachments(artifactIds);
  const documents = attachments.map((attachment) => ({
    filename: attachment.filename,
    mime: attachment.type,
    text: attachment.text,
  }));

  const pipeline = runRepairPipeline(documents);

  const retrievedEvidence = await orchestrateRetrieval({
    userQuery: userIntent || "repair analysis",
    activeContext: sessionContext
      ? {
          vehicle: {
            year: null,
            make: sessionContext.vehicleMake ?? null,
            model: null,
            vin: null,
            confidence: sessionContext.vehicleMake ? 0.6 : 0,
            source: sessionContext.vehicleMake ? "inferred" : "none",
            updatedAt: new Date().toISOString(),
          },
          repair: {
            system: sessionContext.system ?? null,
            component: sessionContext.component ?? null,
            procedure: sessionContext.procedure ?? null,
            confidence:
              sessionContext.system || sessionContext.component || sessionContext.procedure
                ? 0.5
                : 0,
            source:
              sessionContext.system || sessionContext.component || sessionContext.procedure
                ? "inferred"
                : "none",
            updatedAt: new Date().toISOString(),
          },
        }
      : null,
    intelligence: pipeline,
    limit: 5,
  });

  const evidence = buildEvidenceRecords(pipeline.evidenceReferences, retrievedEvidence);
  const issues = buildIssues(pipeline, evidence);
  const requiredProcedures = buildRequiredProcedures(pipeline);
  const presentProcedures = pipeline.requiredProcedures
    .map((procedure) => procedure.procedure)
    .filter((procedure) => !pipeline.missingProcedures.some((missing) => missing.procedure === procedure));
  const missingProcedures = pipeline.missingProcedures.map((procedure) => procedure.procedure);
  const supplementOpportunities = pipeline.supplementOpportunities.map((issue) => issue.issue);

  const highSeverityIssues = issues.filter((issue) => issue.severity === "high").length;
  const mediumSeverityIssues = issues.filter((issue) => issue.severity === "medium").length;
  const lowSeverityIssues = issues.filter((issue) => issue.severity === "low").length;

  return {
    summary: {
      riskScore: computeRiskScore({
        highSeverityIssues,
        mediumSeverityIssues,
        lowSeverityIssues,
      }),
      confidence: computeConfidenceScore({
        hasVehicleContext: Boolean(sessionContext?.vehicleMake),
        operationCount: pipeline.operations.length,
        evidenceCount: evidence.length,
      }),
      criticalIssues: highSeverityIssues,
      evidenceQuality: computeEvidenceQuality({
        oemEvidenceCount: evidence.filter((item) => item.authority === "oem").length,
        totalEvidenceCount: evidence.length,
      }),
    },
    vehicle: undefined,
    issues,
    requiredProcedures,
    presentProcedures,
    missingProcedures,
    supplementOpportunities,
    evidence,
    recommendedActions: buildRecommendedActions(missingProcedures, supplementOpportunities),
  };
}

function buildEvidenceRecords(
  pipelineReferences: string[],
  retrievalEvidence: Array<{
    text: string;
    drive_path?: string | null;
    oem?: string | null;
  }>
): EvidenceRecord[] {
  const inline = pipelineReferences.map((reference, index) => ({
    id: `inline-${index + 1}`,
    title: `Pipeline Evidence ${index + 1}`,
    snippet: reference,
    source: "repair-pipeline",
    authority: "inferred" as const,
  }));

  const retrieved = retrievalEvidence.map((item, index) => ({
    id: `retrieved-${index + 1}`,
    title: item.drive_path || `Retrieved Evidence ${index + 1}`,
    snippet: item.text.slice(0, 280),
    source: item.drive_path || "drive-knowledge-base",
    authority: item.oem ? ("oem" as const) : ("internal" as const),
  }));

  return [...inline, ...retrieved].slice(0, 8);
}

function buildIssues(
  pipeline: ReturnType<typeof runRepairPipeline>,
  evidence: EvidenceRecord[]
): AnalysisIssue[] {
  return pipeline.complianceIssues.map((issue, index) => ({
    id: `issue-${index + 1}`,
    category:
      issue.category === "calibration_requirement"
        ? "calibration"
        : issue.category === "supplement_opportunity"
          ? "parts"
          : issue.category === "safety_risk"
            ? "safety"
            : issue.category === "missing_procedure"
              ? "documentation"
              : "scan",
    title: issue.issue,
    finding: issue.issue,
    impact: issue.reference,
    missingOperation: extractMissingOperation(issue.reference),
    severity: issue.severity,
    evidenceIds: evidence.slice(0, 2).map((item) => item.id),
  }));
}

function buildRequiredProcedures(
  pipeline: ReturnType<typeof runRepairPipeline>
): RequiredProcedureRecord[] {
  return pipeline.requiredProcedures.map((procedure) => ({
    procedure: procedure.procedure,
    reason: procedure.rationale,
    source: "knowledge_graph",
    severity: procedure.severity,
  }));
}

function buildRecommendedActions(
  missingProcedures: string[],
  supplementOpportunities: string[]
): string[] {
  const actions = [
    ...missingProcedures.map(
      (procedure) => `Add and document ${procedure} before final repair delivery.`
    ),
    ...supplementOpportunities.map(
      (issue) => `Review supplement line item: ${issue}.`
    ),
  ];

  return [...new Set(actions)].slice(0, 6);
}

function extractMissingOperation(reference: string): string | undefined {
  const [operation] = reference.split("->");
  return operation?.trim() || undefined;
}
