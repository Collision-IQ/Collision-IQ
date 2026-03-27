import {
  getUploadedAttachments,
  type StoredAttachment,
} from "@/lib/uploadedAttachmentStore";
import { orchestrateRetrieval } from "../retrievalOrchestrator";
import { buildComparisonAnalysis } from "../builders/comparisonEngine";
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

export async function runRepairAnalysis({
  artifactIds,
  preloadedAttachments,
  sessionContext,
  userIntent,
}: RunRepairAnalysisParams): Promise<RepairIntelligenceReport> {
  const attachments = preloadedAttachments ?? getUploadedAttachments(artifactIds);
  const documents = attachments.map((attachment) => ({
    filename: attachment.filename,
    mime: attachment.type,
    text: attachment.text,
    imageDataUrl: attachment.imageDataUrl,
  }));

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
        oemEvidenceCount: 0,
        totalEvidenceCount: evidence.length,
      }),
    },
    vehicle: inferredVehicle,
    issues,
    requiredProcedures,
    presentProcedures,
    missingProcedures,
    supplementOpportunities,
    evidence,
    recommendedActions: buildRecommendedActions(missingProcedures, supplementOpportunities),
    analysis: undefined,
  };
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
    ...supplementOpportunities.map(
      (issue) => `Review supplement line item: ${issue}.`
    ),
  ];

  return [...new Set(actions)].slice(0, 6);
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
