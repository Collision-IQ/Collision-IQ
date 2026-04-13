import {
  getUploadedAttachments,
  type StoredAttachment,
} from "@/lib/uploadedAttachmentStore";
import { orchestrateRetrieval } from "../retrievalOrchestrator";
import { buildComparisonAnalysis } from "../builders/comparisonEngine";
import { extractEstimateFacts } from "../extractors/extractEstimateFacts";
import { runRepairPipeline } from "../pipeline/repairPipeline";
import { computeConfidenceScore } from "../scoring/confidenceScore";
import { computeEvidenceQuality } from "../scoring/evidenceScore";
import { computeRiskScore } from "../scoring/riskScore";
import {
  extractVehicleIdentityFromText,
  mergeVehicleIdentity,
  normalizeVehicleIdentity,
} from "../vehicleContext";
import type {
  AnalysisIssue,
  RepairIntelligenceReport,
  RequiredProcedureRecord,
  VehicleIdentity,
  Severity,
} from "../types/analysis";
import type { EvidenceRecord } from "../types/evidence";

type VehicleSessionContext = {
  vehicleMake?: string | null;
  system?: string | null;
  component?: string | null;
  procedure?: string | null;
} | null | undefined;

type RunRepairAnalysisParams = {
  artifactIds: string[];
  preloadedAttachments?: StoredAttachment[];
  sessionContext?: VehicleSessionContext;
  userIntent?: string | null;
};

type AnalysisIntentProfile = {
  repairability: number;
  supplementReview: number;
  disputeReview: number;
  estimateCompleteness: number;
};

type RepairabilityAssessment = {
  visibleDamageSummary: string;
  estimateScopeSummary: string;
  physicalRepairability: "yes" | "no" | "uncertain";
  economicRepairability: "favorable" | "borderline" | "unlikely" | "unknown";
  finalDetermination: string;
  grade: string;
  teardownDependencies: string[];
};

type RepairabilityFocusedReport = RepairIntelligenceReport & {
  repairabilityAssessment?: RepairabilityAssessment;
};

function scoreAnalysisIntent(userIntent?: string | null): AnalysisIntentProfile {
  const lower = (userIntent ?? "").toLowerCase();

  let repairability = 0;
  let supplementReview = 0;
  let disputeReview = 0;
  let estimateCompleteness = 0;

  if (
    lower.includes("repairability") ||
    lower.includes("repairable") ||
    lower.includes("total loss") ||
    lower.includes("total-loss") ||
    lower.includes("totaled")
  ) {
    repairability += 4;
  }

  if (
    lower.includes("grade") ||
    lower.includes("graded") ||
    lower.includes("score")
  ) {
    repairability += 2;
    estimateCompleteness += 2;
  }

  if (
    lower.includes("supplement") ||
    lower.includes("missing line") ||
    lower.includes("add line") ||
    lower.includes("operations missing")
  ) {
    supplementReview += 3;
  }

  if (
    lower.includes("carrier") ||
    lower.includes("rebuttal") ||
    lower.includes("negotiation") ||
    lower.includes("dispute")
  ) {
    disputeReview += 3;
  }

  if (
    lower.includes("review") ||
    lower.includes("complete") ||
    lower.includes("completeness") ||
    lower.includes("scope")
  ) {
    estimateCompleteness += 2;
  }

  return {
    repairability,
    supplementReview,
    disputeReview,
    estimateCompleteness,
  };
}

function shouldPrioritizeRepairability(profile: AnalysisIntentProfile): boolean {
  return (
    profile.repairability >= 4 &&
    profile.repairability >= profile.supplementReview &&
    profile.repairability >= profile.disputeReview
  );
}

function inferPhotoVisibleDamageSummary(
  documents: Array<{
    filename?: string | null;
    mime?: string | null;
    text?: string | null;
    imageDataUrl?: string | null;
  }>
): string {
  const photoCount = documents.filter((document) => Boolean(document.imageDataUrl)).length;

  if (photoCount === 0) {
    return "No photo set was available, so visible damage could not be independently confirmed from images.";
  }

  return "Photo set is present. Visible damage appears concentrated in the documented impact area, but teardown-only damage cannot be confirmed from photos alone.";
}

function inferEstimateScopeSummary(params: {
  estimateTotal?: number | null;
  rawEstimateText?: string | null;
}): string {
  const lower = (params.rawEstimateText ?? "").toLowerCase();
  const estimateTotal =
    typeof params.estimateTotal === "number" ? `$${params.estimateTotal.toFixed(2)}` : "unknown";

  const hasStructuralLines =
    lower.includes("frame") ||
    lower.includes("rail") ||
    lower.includes("apron") ||
    lower.includes("core support") ||
    lower.includes("structural labor") ||
    lower.includes("pull");

  if (hasStructuralLines) {
    return `The current estimate carries documented repair scope totaling ${estimateTotal}, including at least some structural or support-area indicators.`;
  }

  return `The current estimate carries documented repair scope totaling ${estimateTotal}, but does not clearly show frame, rail, apron, core-support, pull, or structural labor lines.`;
}

function inferEconomicRepairabilityBand(params: {
  estimateTotal?: number | null;
  inferredAcv?: number | null;
}): RepairabilityAssessment["economicRepairability"] {
  const estimateTotal = params.estimateTotal;
  const inferredAcv = params.inferredAcv;

  if (
    typeof estimateTotal !== "number" ||
    !Number.isFinite(estimateTotal) ||
    estimateTotal <= 0 ||
    typeof inferredAcv !== "number" ||
    !Number.isFinite(inferredAcv) ||
    inferredAcv <= 0
  ) {
    return "unknown";
  }

  const ratio = estimateTotal / inferredAcv;

  if (ratio < 0.45) return "favorable";
  if (ratio <= 0.7) return "borderline";
  return "unlikely";
}

function computeRepairGrade(params: {
  estimateTotal?: number | null;
  inferredAcv?: number | null;
  issueCount: number;
  highSeverityIssues: number;
  hasStructuralUnknowns: boolean;
}): string {
  const economicBand = inferEconomicRepairabilityBand({
    estimateTotal: params.estimateTotal,
    inferredAcv: params.inferredAcv,
  });

  if (economicBand === "unlikely") return "D";
  if (params.highSeverityIssues >= 3 || params.hasStructuralUnknowns) return "C-";
  if (economicBand === "borderline") return "C";
  if (params.issueCount >= 4) return "B-";
  return "B";
}

function buildRepairabilityAssessment(params: {
  report: RepairIntelligenceReport;
  estimateFacts?: RepairIntelligenceReport["estimateFacts"];
  documents: Array<{
    filename?: string | null;
    mime?: string | null;
    text?: string | null;
    imageDataUrl?: string | null;
  }>;
}): RepairabilityAssessment {
  const estimateTotal = params.estimateFacts?.estimateTotal ?? null;
  const inferredAcv = inferAcvFromDocuments(params.documents);
  const lowerEstimate = (params.report.sourceEstimateText ?? "").toLowerCase();

  const hasStructuralUnknowns =
    !lowerEstimate.includes("frame") &&
    !lowerEstimate.includes("rail") &&
    !lowerEstimate.includes("apron") &&
    !lowerEstimate.includes("core support") &&
    !lowerEstimate.includes("structural labor");

  const economicRepairability = inferEconomicRepairabilityBand({
    estimateTotal,
    inferredAcv,
  });

  const physicalRepairability: RepairabilityAssessment["physicalRepairability"] =
    hasStructuralUnknowns ? "uncertain" : "yes";

  const issueCount = params.report.issues.length;
  const highSeverityIssues = params.report.issues.filter(
    (issue) => issue.severity === "high"
  ).length;

  const grade = computeRepairGrade({
    estimateTotal,
    inferredAcv,
    issueCount,
    highSeverityIssues,
    hasStructuralUnknowns,
  });

  const finalDetermination =
    physicalRepairability === "yes" && economicRepairability === "favorable"
      ? "Vehicle appears physically repairable and economically more favorable to repair from the current file set."
      : physicalRepairability === "yes" && economicRepairability === "borderline"
        ? "Vehicle appears physically repairable, but economic repairability is borderline and teardown could materially change the decision."
        : physicalRepairability === "uncertain" && economicRepairability === "unlikely"
          ? "Repairability remains uncertain from the current file set, and the economics trend against repair unless teardown stays limited."
          : "Vehicle may be physically repairable from visible/documented scope, but final determination should wait for teardown, structure verification, and value confirmation.";

  return {
    visibleDamageSummary: inferPhotoVisibleDamageSummary(params.documents),
    estimateScopeSummary: inferEstimateScopeSummary({
      estimateTotal,
      rawEstimateText: params.report.sourceEstimateText ?? "",
    }),
    physicalRepairability,
    economicRepairability,
    finalDetermination,
    grade,
    teardownDependencies: [
      "Confirm hidden front structure or support-area damage after teardown.",
      "Verify whether rail, apron, tie-bar, lock-support, or adjacent support scope expands.",
      "Confirm final market value / ACV before making the economic repair-vs-total-loss decision.",
    ],
  };
}

function mergeRepairabilityAssessmentIntoReport(params: {
  report: RepairIntelligenceReport;
  assessment: RepairabilityAssessment;
}): RepairabilityFocusedReport {
  const economicLabel =
    params.assessment.economicRepairability === "favorable"
      ? "favorable"
      : params.assessment.economicRepairability === "borderline"
        ? "borderline"
        : params.assessment.economicRepairability === "unlikely"
          ? "unlikely"
          : "unknown";

  const leadingActions = [
    `Physical repairability: ${params.assessment.physicalRepairability.toUpperCase()}.`,
    `Economic repairability: ${economicLabel.toUpperCase()}.`,
    `Final determination: ${params.assessment.finalDetermination}`,
    `Grade: ${params.assessment.grade}`,
    ...params.assessment.teardownDependencies.map(
      (item) => `Teardown dependency: ${item}`
    ),
  ];

  return {
    ...params.report,
    repairabilityAssessment: params.assessment,
    recommendedActions: dedupeStrings([
      ...leadingActions,
      ...params.report.recommendedActions,
    ]).slice(0, 8),
  };
}

function inferAcvFromDocuments(
  documents: Array<{
    filename?: string | null;
    mime?: string | null;
    text?: string | null;
  }>
): number | null {
  const valuationDoc = documents.find((document) =>
    `${document.filename ?? ""}`.toLowerCase().includes("value")
  );

  const text = valuationDoc?.text ?? "";
  if (!text.trim()) return null;

  const matches = [...text.matchAll(/\$?\s*([\d,]+\.\d{2}|\d{1,3}(?:,\d{3})+|\d{3,6})/g)]
    .map((match) => Number.parseFloat(match[1].replace(/,/g, "")))
    .filter((value) => Number.isFinite(value) && value >= 500 && value <= 50000);

  if (matches.length === 0) return null;

  const sorted = [...matches].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

export async function runRepairAnalysis({
  artifactIds,
  preloadedAttachments,
  sessionContext,
  userIntent,
}: RunRepairAnalysisParams): Promise<RepairIntelligenceReport> {
  const attachments = preloadedAttachments ?? (await getUploadedAttachments(artifactIds));
  const documents = attachments.map((attachment) => ({
    filename: attachment.filename,
    mime: attachment.type,
    text: attachment.text,
    imageDataUrl: attachment.imageDataUrl,
  }));
  const intentProfile = scoreAnalysisIntent(userIntent);

  console.info("[analysis-attachments] orchestrator received", {
    attachmentCount: documents.length,
    attachments: documents.map((document) => ({
      filename: document.filename,
      mimeType: document.mime || "unknown",
      textLength: document.text?.length ?? 0,
      hasImageDataUrl: Boolean(document.imageDataUrl),
    })),
  });

  const shopText =
    findDocumentText(documents, ["shop", "body shop", "repair facility"]) ?? null;
  const insurerText =
    findDocumentText(documents, ["insurer", "insurance", "carrier", "sor"]) ?? null;
  const shopVehicle = inferVehicleFromDocument(documents, ["shop", "body shop", "repair facility"]);
  const insurerVehicle = inferVehicleFromDocument(documents, ["insurer", "insurance", "carrier", "sor"]);
  const sessionVehicle =
    sessionContext?.vehicleMake
      ? {
          make: sessionContext.vehicleMake,
          confidence: 0.6,
          source: "session" as const,
        }
      : null;

  if (shopText && insurerText) {
    const analysis = buildComparisonAnalysis({
      shopEstimateText: shopText,
      insurerEstimateText: insurerText,
    });
    const comparisonVehicle = resolveComparisonVehicleIdentity(
      sessionVehicle,
      shopVehicle,
      insurerVehicle,
      analysis.vehicle
    );
    const comparisonAnalysis = {
      ...analysis,
      vehicle: comparisonVehicle,
    };

    return {
      summary: {
        riskScore:
          comparisonAnalysis.summary.riskScore === "unknown"
            ? "moderate"
            : comparisonAnalysis.summary.riskScore,
        confidence:
          comparisonAnalysis.summary.confidence === "moderate"
            ? "moderate"
            : comparisonAnalysis.summary.confidence,
        criticalIssues: comparisonAnalysis.summary.criticalIssues,
        evidenceQuality: comparisonAnalysis.summary.evidenceQuality,
      },
      vehicle: comparisonVehicle,
      issues: comparisonAnalysis.findings
        .filter((finding) => finding.status !== "present")
        .map((finding, index) => ({
          id: finding.id || `comparison-issue-${index + 1}`,
          category:
            finding.category === "structural_difference"
              ? "safety"
              : finding.category === "scope_difference"
                ? "documentation"
                : "parts",
          title: finding.title,
          finding: finding.title,
          impact: finding.detail,
          severity: finding.severity,
          evidenceIds: [],
        })),
      requiredProcedures: [],
      presentProcedures: comparisonAnalysis.findings
        .filter((finding) => finding.status === "present")
        .map((finding) => finding.title),
      missingProcedures: [],
      supplementOpportunities: comparisonAnalysis.supplements.map((finding) => finding.title),
      evidence: comparisonAnalysis.evidence.map((entry, index) => ({
        id: `comparison-evidence-${index + 1}`,
        title: entry.source,
        snippet: entry.quote ?? "",
        source: entry.source,
        authority: "inferred",
      })),
      recommendedActions: [comparisonAnalysis.narrative],
      analysis: comparisonAnalysis,
    };
  }

  const pipeline = runRepairPipeline(documents);
  const estimateText = documents.map((document) => document.text ?? "").join("\n\n");
  const inferredVehicle = mergeVehicleIdentity(
    sessionVehicle,
    ...documents.map((document) =>
      extractVehicleIdentityFromText(document.text ?? "", "attachment")
    ),
    extractVehicleIdentityFromText(userIntent ?? "", "user")
  );
  const estimateFacts = extractEstimateFacts({
    text: estimateText,
    vehicle: inferredVehicle,
  });

  console.info("[vehicle-reconciliation:analysis]", {
    documentCount: documents.length,
    sessionVehicleMake: sessionContext?.vehicleMake ?? null,
    extractedVehicle: inferredVehicle ?? null,
  });

  const retrievedEvidence = await orchestrateRetrieval({
    userQuery: userIntent || "repair analysis",
    activeContext: buildActiveContext(sessionContext, inferredVehicle),
    intelligence: pipeline,
    limit: 5,
  });

  const ragProcedures = inferProceduresFromRag({
    estimateText,
    retrievedEvidence,
    sessionContext,
  });

  const evidence = buildEvidenceRecords(pipeline.evidenceReferences, retrievedEvidence);
  const issues = buildIssues(pipeline, evidence, ragProcedures);
  const requiredProcedures = mergeRequiredProcedures(
    buildRequiredProcedures(pipeline),
    ragProcedures
  );
  const presentProcedures = dedupeStrings([
    ...pipeline.observations
      .filter((observation) => observation.status === "present")
      .map((observation) => observation.procedure ?? "")
      .filter(Boolean),
    ...ragProcedures.filter((procedure) => !procedure.isMissing).map((procedure) => procedure.procedure),
  ]);
  const missingProcedures = dedupeStrings([
    ...pipeline.observations
      .filter(
        (observation) =>
          observation.status === "unclear" || observation.status === "not_detected"
      )
      .map((observation) => observation.procedure ?? "")
      .filter(Boolean),
    ...ragProcedures.filter((procedure) => procedure.isMissing).map((procedure) => procedure.procedure),
  ]);
  const supplementOpportunities = dedupeStrings([
    ...pipeline.supplementOpportunities.map((issue) => issue.issue),
    ...ragProcedures
      .filter((procedure) => procedure.isMissing && procedure.category === "supplement")
      .map((procedure) => `Add and document ${procedure.procedure}.`),
  ]);

  const highSeverityIssues = issues.filter((issue) => issue.severity === "high").length;
  const mediumSeverityIssues = issues.filter((issue) => issue.severity === "medium").length;
  const lowSeverityIssues = issues.filter((issue) => issue.severity === "low").length;

  const report: RepairIntelligenceReport = {
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
        oemEvidenceCount: 0,
        totalEvidenceCount: evidence.length,
      }),
    },
    vehicle: estimateFacts.vehicle ?? inferredVehicle,
    issues,
    requiredProcedures,
    presentProcedures,
    missingProcedures,
    supplementOpportunities,
    evidence,
    recommendedActions: buildRecommendedActions(missingProcedures, supplementOpportunities),
    analysis: undefined,
    sourceEstimateText: estimateText,
    estimateFacts,
  };

  console.info("[analysis-intent-profile]", {
    userIntent: userIntent ?? null,
    intentProfile,
  });

  if (shouldPrioritizeRepairability(intentProfile)) {
    const repairabilityAssessment = buildRepairabilityAssessment({
      report,
      estimateFacts,
      documents,
    });

    return mergeRepairabilityAssessmentIntoReport({
      report,
      assessment: repairabilityAssessment,
    });
  }

  return report;
}

function findDocumentText(
  documents: Array<{
    filename?: string | null;
    mime?: string | null;
    text?: string | null;
  }>,
  keywords: string[]
): string | undefined {
  const match = documents.find((document) => {
    const haystack = `${document.filename ?? ""} ${document.mime ?? ""}`.toLowerCase();
    return keywords.some((keyword) => haystack.includes(keyword));
  });

  return match?.text ?? undefined;
}

function inferVehicleFromDocument(
  documents: Array<{
    filename?: string | null;
    mime?: string | null;
    text?: string | null;
  }>,
  keywords: string[]
) {
  const match = documents.find((document) => {
    const haystack = `${document.filename ?? ""} ${document.mime ?? ""}`.toLowerCase();
    return keywords.some((keyword) => haystack.includes(keyword));
  });

  return match?.text ? extractVehicleIdentityFromText(match.text, "attachment") : null;
}

function resolveComparisonVehicleIdentity(
  sessionVehicle: VehicleIdentity | null | undefined,
  shopVehicle: VehicleIdentity | null | undefined,
  insurerVehicle: VehicleIdentity | null | undefined,
  analysisVehicle: VehicleIdentity | null | undefined
) {
  // Keep the strongest structured identity first; later sources only fill gaps or add better-supported fields.
  return mergeVehicleIdentity(
    normalizeVehicleIdentity(sessionVehicle),
    normalizeVehicleIdentity(shopVehicle),
    normalizeVehicleIdentity(insurerVehicle),
    normalizeVehicleIdentity(analysisVehicle)
  );
}

function buildActiveContext(
  sessionContext: VehicleSessionContext,
  inferredVehicle: VehicleIdentity | undefined
) {
  if (!sessionContext && !inferredVehicle) {
    return null;
  }

  const now = new Date().toISOString();
  const normalizedVehicle = normalizeVehicleIdentity(inferredVehicle);
  const hasRepairContext = Boolean(
    sessionContext?.system || sessionContext?.component || sessionContext?.procedure
  );
  const hasVehicleContext = Boolean(
    normalizedVehicle?.vin ||
      normalizedVehicle?.year ||
      normalizedVehicle?.make ||
      normalizedVehicle?.model ||
      normalizedVehicle?.trim ||
      sessionContext?.vehicleMake
  );

  if (!hasVehicleContext && !hasRepairContext) {
    return null;
  }

  const vehicleSource: "explicit" | "inferred" | "none" =
    normalizedVehicle?.source && normalizedVehicle.source !== "unknown"
      ? "explicit"
      : sessionContext?.vehicleMake
        ? "inferred"
        : "none";
  const repairSource: "explicit" | "inferred" | "none" = hasRepairContext ? "inferred" : "none";

  return {
    vehicle: {
      vin: normalizedVehicle?.vin ?? null,
      year: normalizedVehicle?.year ?? null,
      make: normalizedVehicle?.make ?? sessionContext?.vehicleMake ?? null,
      model: normalizedVehicle?.model ?? null,
      trim: normalizedVehicle?.trim ?? null,
      confidence: normalizedVehicle?.confidence ?? (sessionContext?.vehicleMake ? 0.6 : 0),
      source: vehicleSource,
      updatedAt: now,
    },
    repair: {
      system: sessionContext?.system ?? null,
      component: sessionContext?.component ?? null,
      procedure: sessionContext?.procedure ?? null,
      confidence: hasRepairContext ? 0.5 : 0,
      source: repairSource,
      updatedAt: now,
    },
  };
}

function buildEvidenceRecords(
  pipelineReferences: string[],
  retrievalEvidence: Array<{
    content: string;
    file_id?: string | null;
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
    title: toHumanReadableRetrievedSource(item.file_id) || `Retrieved Evidence ${index + 1}`,
    snippet: item.content.slice(0, 280),
    source: toHumanReadableRetrievedSource(item.file_id) || "Drive knowledge base",
    authority: "internal" as const,
  }));

  return [...inline, ...retrieved].slice(0, 8);
}

function toHumanReadableRetrievedSource(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^[A-Za-z0-9_-]{16,}$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function buildIssues(
  pipeline: ReturnType<typeof runRepairPipeline>,
  evidence: EvidenceRecord[],
  ragProcedures: RAGProcedure[]
): AnalysisIssue[] {
  const pipelineIssues: AnalysisIssue[] = pipeline.observations
    .filter((issue) => issue.status !== "present")
    .map((issue, index) => ({
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
    missingOperation: issue.procedure ?? extractMissingOperation(issue.reference),
    severity: issue.severity,
    evidenceIds: evidence.slice(0, 2).map((item) => item.id),
  }));

  const ragIssues: AnalysisIssue[] = ragProcedures
    .filter((procedure) => procedure.isMissing)
    .map((procedure, index) => ({
      id: `rag-issue-${index + 1}`,
      category:
        procedure.category === "adas"
          ? "calibration"
          : procedure.category === "supplement"
            ? "parts"
            : procedure.category === "safety"
              ? "safety"
              : procedure.procedure.toLowerCase().includes("scan")
                ? "scan"
                : "documentation",
      title: `${procedure.procedure} function not clearly represented`,
      finding: `${procedure.procedure} function not clearly represented`,
      impact: `${procedure.reason} OEM context: ${procedure.evidenceSnippet}`,
      missingOperation: procedure.procedure,
      severity: procedure.severity,
      evidenceIds: evidence
        .filter((item) => item.id === procedure.evidenceId)
        .map((item) => item.id),
    }));

  return dedupeIssuesByTitle([...pipelineIssues, ...ragIssues]);
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
    ...supplementOpportunities.map((issue) =>
      buildSupplementOpportunityAction(issue)
    ),
  ];

  return [...new Set(actions)].slice(0, 6);
}

function buildSupplementOpportunityAction(issue: string): string {
  const cleaned = issue.trim().replace(/\.$/, "");
  if (!cleaned) {
    return "Please review the current estimate support and document any remaining open repair items.";
  }

  if (/^add and document\b/i.test(cleaned)) {
    return `${cleaned} before final repair delivery.`;
  }

  if (/oem support in\b/i.test(cleaned)) {
    const normalized = cleaned
      .replace(/^OEM support in\s+/i, "")
      .replace(/\s+indicates\s+/i, " indicates ")
      .replace(/\s+adds\s+/i, " adds ");

    return `Please review whether ${normalized} is already represented in the estimate, what support remains open, and what should likely be added or documented more clearly.`;
  }

  return `Please review whether ${cleaned} is already represented in the estimate and what should be added or documented more clearly if it remains part of the repair path.`;
}

type RAGProcedure = {
  procedure: string;
  reason: string;
  source: "oem_doc";
  severity: Severity;
  category: "adas" | "scanning" | "compliance" | "safety" | "supplement";
  isMissing: boolean;
  evidenceSnippet: string;
  evidenceId: string;
};

const RAG_PROCEDURE_RULES: Array<{
  procedure: string;
  aliases: string[];
  triggerKeywords: string[];
  category: RAGProcedure["category"];
  severity: Severity;
  rationale: string;
}> = [
  {
    procedure: "Structural measurement",
    aliases: ["structural measurement", "measure structure", "three-dimensional measuring"],
    triggerKeywords: ["quarter panel", "pillar", "rocker", "rail", "apron", "unibody", "sectioning"],
    category: "safety",
    severity: "high",
    rationale: "Structural repairs commonly require measurement and documented dimensional verification.",
  },
  {
    procedure: "Pre-repair scan",
    aliases: ["pre-repair scan", "pre scan", "pre-scan", "diagnostic scan"],
    triggerKeywords: ["scan", "diagnostic", "collision", "adas"],
    category: "scanning",
    severity: "high",
    rationale: "Collision documentation indicates diagnostic discovery is required before repairs begin.",
  },
  {
    procedure: "Post-repair scan",
    aliases: ["post-repair scan", "post scan", "post-scan", "final scan"],
    triggerKeywords: ["scan", "diagnostic", "collision", "adas"],
    category: "scanning",
    severity: "high",
    rationale: "Repair verification documentation indicates a post-repair diagnostic confirmation is required.",
  },
  {
    procedure: "Wheel alignment check",
    aliases: ["wheel alignment", "alignment check", "four wheel alignment"],
    triggerKeywords: ["suspension", "steering", "subframe", "quarter panel", "frame"],
    category: "safety",
    severity: "medium",
    rationale: "Structural and suspension-related repairs commonly require alignment verification.",
  },
  {
    procedure: "Corrosion protection materials",
    aliases: ["corrosion protection", "cavity wax", "anti-corrosion", "rust proofing"],
    triggerKeywords: ["quarter panel", "panel replacement", "weld", "sectioning", "pillar"],
    category: "supplement",
    severity: "medium",
    rationale: "Replacement and weld operations require corrosion protection restoration.",
  },
  {
    procedure: "Seam sealer application",
    aliases: ["seam sealer", "seam sealing"],
    triggerKeywords: ["quarter panel", "panel replacement", "weld", "sectioning", "pillar"],
    category: "supplement",
    severity: "medium",
    rationale: "Panel replacement procedures commonly require seam sealer restoration.",
  },
];

function inferProceduresFromRag(params: {
  estimateText: string;
  retrievedEvidence: Array<{
    content: string;
    file_id?: string | null;
  }>;
  sessionContext?: RunRepairAnalysisParams["sessionContext"];
}): RAGProcedure[] {
  const estimateText = params.estimateText.toLowerCase();
  const contextText = [
    params.sessionContext?.vehicleMake,
    params.sessionContext?.system,
    params.sessionContext?.component,
    params.sessionContext?.procedure,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const procedures: RAGProcedure[] = [];

  for (const [evidenceIndex, evidence] of params.retrievedEvidence.entries()) {
    const evidenceText = evidence.content.toLowerCase();
    const haystack = `${evidenceText} ${evidence.file_id ?? ""} ${contextText}`.trim();

    for (const rule of RAG_PROCEDURE_RULES) {
      const mentionsProcedure =
        haystack.includes(rule.procedure.toLowerCase()) ||
        rule.aliases.some((alias) => haystack.includes(alias.toLowerCase()));
      const mentionsTrigger = rule.triggerKeywords.some((keyword) => haystack.includes(keyword));

      if (!mentionsProcedure && !mentionsTrigger) {
        continue;
      }

      const matchedInEstimate = [rule.procedure, ...rule.aliases].some((alias) =>
        estimateText.includes(alias.toLowerCase())
      );

      procedures.push({
        procedure: rule.procedure,
        reason: rule.rationale,
        source: "oem_doc",
        severity: rule.severity,
        category: rule.category,
        isMissing: !matchedInEstimate,
        evidenceSnippet: evidence.content.slice(0, 220),
        evidenceId: `retrieved-${evidenceIndex + 1}`,
      });
    }
  }

  const deduped = new Map<string, RAGProcedure>();

  for (const procedure of procedures) {
    const key = procedure.procedure.toLowerCase();
    const existing = deduped.get(key);

    if (!existing) {
      deduped.set(key, procedure);
      continue;
    }

    deduped.set(key, {
      ...existing,
      isMissing: existing.isMissing && procedure.isMissing,
      severity:
        existing.severity === "high" || procedure.severity === "high"
          ? "high"
          : existing.severity === "medium" || procedure.severity === "medium"
            ? "medium"
            : "low",
      evidenceSnippet:
        existing.evidenceSnippet.length >= procedure.evidenceSnippet.length
          ? existing.evidenceSnippet
          : procedure.evidenceSnippet,
    });
  }

  return [...deduped.values()];
}

function mergeRequiredProcedures(
  existing: RequiredProcedureRecord[],
  ragProcedures: RAGProcedure[]
): RequiredProcedureRecord[] {
  const merged = new Map(
    existing.map((procedure) => [procedure.procedure.toLowerCase(), procedure] as const)
  );

  for (const procedure of ragProcedures) {
    if (merged.has(procedure.procedure.toLowerCase())) {
      continue;
    }

    merged.set(procedure.procedure.toLowerCase(), {
      procedure: procedure.procedure,
      reason: procedure.reason,
      source: "oem_doc",
      severity: procedure.severity,
    });
  }

  return [...merged.values()];
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function dedupeIssuesByTitle(issues: AnalysisIssue[]): AnalysisIssue[] {
  const seen = new Map<string, AnalysisIssue>();

  for (const issue of issues) {
    const key = `${issue.category}:${issue.title}`.toLowerCase();
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, issue);
      continue;
    }

    seen.set(key, {
      ...existing,
      severity:
        existing.severity === "high" || issue.severity === "high"
          ? "high"
          : existing.severity === "medium" || issue.severity === "medium"
            ? "medium"
            : "low",
      evidenceIds: [...new Set([...existing.evidenceIds, ...issue.evidenceIds])],
    });
  }

  return [...seen.values()];
}

function extractMissingOperation(reference: string): string | undefined {
  const [operation] = reference.split("->");
  return operation?.trim() || undefined;
}
