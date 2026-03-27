import { NextResponse } from "next/server";
import { saveAnalysisReport } from "@/lib/analysisReportStore";
import {
  getUploadedAttachments,
  type StoredAttachment,
} from "@/lib/uploadedAttachmentStore";
import {
  buildDriveRefinementContext,
  detectChatTaskType,
  retrieveDriveSupport,
} from "@/lib/ai/driveRetrievalService";
import { buildDecisionPanelHybrid } from "@/lib/ai/builders/buildDecisionPanel";
import { normalizeReportToAnalysisResult } from "@/lib/ai/builders/normalizeReportToAnalysisResult";
import { runRepairAnalysis } from "@/lib/ai/orchestrator/analysisOrchestrator";
import {
  inferDriveRetrievalTopics,
  inferDriveVehicleContext,
} from "@/lib/ai/contracts/driveRetrievalContract";
import type {
  ChatAnalysisOutput,
} from "@/lib/ai/contracts/chatAnalysisSchema";
import type {
  RepairIntelligenceReport,
  VehicleIdentity,
} from "@/lib/ai/types/analysis";
import type { DriveRetrievalResponse, DriveRetrievalResult } from "@/lib/ai/contracts/driveRetrievalContract";
import { mergeVehicleIdentity, normalizeVehicleIdentity } from "@/lib/ai/vehicleContext";
import type { EvidenceRecord, } from "@/lib/ai/types/evidence";
import { collisionIqModels } from "@/lib/modelConfig";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";

const SUPPLEMENT_MODEL =
  process.env.COLLISION_IQ_SUPPLEMENT_MODEL?.trim() ||
  process.env.COLLISION_IQ_MODEL_PRIMARY?.trim() ||
  process.env.COLLISION_IQ_MODEL?.trim() ||
  collisionIqModels.helper;

type AnalysisRequestBody = {
  artifactIds?: string[];
  sessionContext?: {
    vehicleMake?: string | null;
    system?: string | null;
    component?: string | null;
    procedure?: string | null;
  } | null;
  userIntent?: string | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AnalysisRequestBody;
    const artifactIds = body.artifactIds ?? [];

    if (!artifactIds.length) {
      return NextResponse.json(
        { error: "artifactIds are required" },
        { status: 400 }
      );
    }

    const storedAttachments = getUploadedAttachments(artifactIds);
    console.info("[analysis-attachments] analysis request assembled", {
      attachmentCount: storedAttachments.length,
      artifactCount: artifactIds.length,
      attachments: storedAttachments.map((attachment) => ({
        filename: attachment.filename,
        mimeType: attachment.type || "unknown",
        textLength: attachment.text.length,
        hasImageDataUrl: Boolean(attachment.imageDataUrl),
        pageCount: attachment.pageCount ?? null,
      })),
    });

    const normalizedAttachments = await normalizeAnalysisAttachments(storedAttachments);

    let report = await runRepairAnalysis({
      artifactIds,
      preloadedAttachments: normalizedAttachments,
      sessionContext: body.sessionContext ?? null,
      userIntent: body.userIntent ?? null,
    });
    let analysis = normalizeReportToAnalysisResult(report);
    const retrievalSnapshot = buildAnalysisRetrievalSnapshot({
      userMessage: body.userIntent ?? "",
      report,
      analysis,
      hasDocuments: artifactIds.length > 0,
    });
    const retrieval = await retrieveDriveSupport({
      taskType: retrievalSnapshot.taskType,
      userQuery: body.userIntent ?? "repair analysis",
      estimateText: analysis.rawEstimateText ?? "",
      firstPassAnswer: retrievalSnapshot.summary.overview,
      analysis: retrievalSnapshot,
      maxResults: 5,
      maxExcerptChars: 500,
    }).catch((error) => {
      console.error("Analysis Drive retrieval skipped:", error);
      return null;
    });

    if (retrieval?.results.length) {
      console.info("[analysis-drive-retrieval]", {
        retrievalMode: retrieval.request.retrievalMode,
        lanes: retrieval.request.targetLanes,
        matchedFiles: retrieval.results.map((result) => ({
          filename: result.filename,
          bucket: result.sourceBucket,
          documentClass: result.documentClass,
          confidence: result.confidence,
        })),
      });

      report = await refineAnalysisReportWithDriveSupport({
        report,
        analysis,
        retrieval,
        userMessage: body.userIntent ?? "",
      });
      analysis = normalizeReportToAnalysisResult(report);
    }

    const supplementCandidates = await generateSupplementCandidates(
      analysis.rawEstimateText ?? "",
      report
    );
    const panel = await buildDecisionPanelHybrid({
      result: analysis,
      supplementCandidates,
      supplementContext: {
        requiredProcedures: report.requiredProcedures.map((entry) => entry.procedure),
        presentProcedures: report.presentProcedures,
        missingProcedures: report.missingProcedures,
      },
    });

    const stored = saveAnalysisReport({
      artifactIds,
      report,
    });

    return NextResponse.json({
      reportId: stored.id,
      createdAt: stored.createdAt,
      report: stored.report,
      panel,
      retrieval: retrieval ? buildClientSafeRetrievalSummary(retrieval) : null,
    });
  } catch (error) {
    console.error("ANALYSIS ERROR:", error);
    return NextResponse.json(
      { error: "Analysis failed" },
      { status: 500 }
    );
  }
}

function isImageAttachment(attachment: StoredAttachment) {
  return Boolean(attachment.imageDataUrl) && attachment.type.startsWith("image/");
}

async function normalizeAnalysisAttachments(attachments: StoredAttachment[]) {
  return Promise.all(
    attachments.map(async (attachment) => {
      if (!isImageAttachment(attachment) || !attachment.imageDataUrl) {
        console.info("[analysis-attachments] attachment normalized", {
          filename: attachment.filename,
          mimeType: attachment.type || "unknown",
          normalization: "original_text",
          textLength: attachment.text.length,
          hasImageDataUrl: Boolean(attachment.imageDataUrl),
        });
        return attachment;
      }

      const imageSummary = await summarizeImageAttachment(attachment);
      const normalized = {
        ...attachment,
        text: imageSummary || attachment.text,
      };

      console.info("[analysis-attachments] attachment normalized", {
        filename: attachment.filename,
        mimeType: attachment.type || "unknown",
        normalization: imageSummary ? "vision_summary" : "original_text_fallback",
        textLength: normalized.text.length,
        hasImageDataUrl: Boolean(normalized.imageDataUrl),
      });

      return normalized;
    })
  );
}

async function summarizeImageAttachment(attachment: StoredAttachment) {
  if (!attachment.imageDataUrl) {
    return "";
  }

  console.info("[analysis-attachments] final model payload built", {
    filename: attachment.filename,
    mimeType: attachment.type || "unknown",
    model: collisionIqModels.primary,
    contentParts: ["input_text", "input_image"],
    hasImageDataUrl: true,
  });

  try {
    const response = await openai.responses.create({
      model: collisionIqModels.primary,
      temperature: 0.1,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `You are preparing a repair-analysis attachment summary for a collision estimator.

Return concise plain text only. Focus on:
- visible damage areas and likely affected panels/components
- severity or impact cues that matter to estimate review
- any readable vehicle identifiers such as VIN, year, make, model, trim, or badges
- any scan/calibration, structural, lighting, wheel/suspension, or alignment clues

Do not mention that this is an AI summary.
Do not use markdown or JSON.`,
            },
            {
              type: "input_image",
              image_url: attachment.imageDataUrl,
              detail: "auto",
            },
          ],
        },
      ],
    });

    return response.output_text?.trim() ?? "";
  } catch (error) {
    console.warn("[analysis-attachments] image normalization failed", {
      filename: attachment.filename,
      mimeType: attachment.type || "unknown",
      message: error instanceof Error ? error.message : String(error),
    });
    return "";
  }
}

function buildAnalysisRetrievalSnapshot(params: {
  userMessage: string;
  report: RepairIntelligenceReport;
  analysis: ReturnType<typeof normalizeReportToAnalysisResult>;
  hasDocuments: boolean;
}): Pick<
  ChatAnalysisOutput,
  "taskType" | "summary" | "repairStrategy" | "keyDrivers" | "missingOperations" | "vehicleIdentification"
> {
  const firstPassAnswer = buildFirstPassAnalysisAnswer(params.report, params.analysis);
  const vehicle = inferDriveVehicleContext({
    estimateText: params.analysis.rawEstimateText ?? "",
    userQuery: params.userMessage,
    analysisVehicle: params.report.vehicle
      ? {
          year: params.report.vehicle.year,
          make: params.report.vehicle.make,
          model: params.report.vehicle.model,
          trim: params.report.vehicle.trim,
          manufacturer: params.report.vehicle.manufacturer,
          vin: params.report.vehicle.vin,
          source: toChatVehicleSource(params.report.vehicle.source),
          confidence: params.report.vehicle.confidence ?? 0.45,
        }
      : null,
  });
  const inferredTopics = inferDriveRetrievalTopics({
    estimateText: params.analysis.rawEstimateText ?? "",
    userQuery: params.userMessage,
    analysis: {
      summary: {
        headline: "",
        overview: firstPassAnswer,
      },
      repairStrategy: {
        overallAssessment: firstPassAnswer,
        repairVsReplace: [],
        structuralImplications: [],
        calibrationImplications: [],
      },
      keyDrivers: params.report.issues.map((issue) => issue.title).slice(0, 6),
      missingOperations: params.report.missingProcedures.slice(0, 6).map((procedure) => ({
        operation: procedure,
        severity: "medium" as const,
        reason: "This function is not clearly represented in the current estimate.",
      })),
    },
  });

  return {
    taskType: detectChatTaskType({
      userQuery: params.userMessage,
      hasDocuments: params.hasDocuments,
    }),
    summary: {
      headline: firstPassAnswer.slice(0, 120),
      overview: firstPassAnswer,
    },
    repairStrategy: {
      overallAssessment: firstPassAnswer,
      repairVsReplace: [],
      structuralImplications: [],
      calibrationImplications: [],
    },
    keyDrivers: inferredTopics.map((topic) => topic.topic.replace(/_/g, " ")).slice(0, 6),
    missingOperations: params.report.missingProcedures.slice(0, 6).map((procedure) => ({
      operation: procedure,
      severity: "medium" as const,
      reason: "This function is not clearly represented in the current estimate.",
    })),
    vehicleIdentification: {
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim,
      manufacturer: vehicle.manufacturer,
      vin: vehicle.vin,
      source: vehicle.sources.includes("vin_decode_hint")
        ? "vin_decoded"
        : vehicle.sources.includes("estimate_text")
          ? "attachment"
          : vehicle.sources.includes("user_query")
            ? "user"
            : vehicle.sources.includes("analysis_output")
              ? "attachment"
              : "unknown",
      confidence:
        vehicle.confidence === "high"
          ? 0.9
          : vehicle.confidence === "medium"
            ? 0.7
            : 0.45,
    },
  };
}

function buildFirstPassAnalysisAnswer(
  report: RepairIntelligenceReport,
  analysis: ReturnType<typeof normalizeReportToAnalysisResult>
): string {
  if (analysis.narrative?.trim()) {
    return analysis.narrative.trim();
  }

  if (report.recommendedActions.length > 0) {
    return report.recommendedActions.join(" ");
  }

  const topIssues = report.issues.slice(0, 3).map((issue) => issue.title.toLowerCase());
  if (topIssues.length > 0) {
    return `The estimate needs clearer support around ${topIssues.join(", ")} before it reads as fully defended.`;
  }

  return "The estimate needs clearer repair support before it can be treated as fully defended.";
}

async function refineAnalysisReportWithDriveSupport(params: {
  report: RepairIntelligenceReport;
  analysis: ReturnType<typeof normalizeReportToAnalysisResult>;
  retrieval: DriveRetrievalResponse;
  userMessage: string;
}): Promise<RepairIntelligenceReport> {
  const retrievalContext = buildDriveRefinementContext(params.retrieval);
  const refined = await generateDriveRefinedAnalysis({
    report: params.report,
    analysis: params.analysis,
    retrieval: params.retrieval,
    retrievalContext,
    userMessage: params.userMessage,
  });

  const mergedVehicle = mergeVehicleIdentity(
    normalizeVehicleIdentity(params.report.vehicle),
    normalizeVehicleIdentity({
      year: params.retrieval.request.vehicle.year,
      make: params.retrieval.request.vehicle.make,
      model: params.retrieval.request.vehicle.model,
      trim: params.retrieval.request.vehicle.trim,
      manufacturer: params.retrieval.request.vehicle.manufacturer,
      vin: params.retrieval.request.vehicle.vin,
      confidence:
        params.retrieval.request.vehicle.confidence === "high"
          ? 0.9
          : params.retrieval.request.vehicle.confidence === "medium"
            ? 0.7
            : 0.45,
      source: params.retrieval.request.vehicle.sources.includes("estimate_text")
        ? "attachment"
        : params.retrieval.request.vehicle.sources.includes("user_query")
          ? "user"
          : params.retrieval.request.vehicle.sources.includes("vin_decode_hint")
            ? "vin_decoded"
            : "inferred",
    })
  );

  const mergedEvidence = mergeDriveEvidence(params.report.evidence, params.retrieval.results);
  const driveProcedureState = deriveDriveProcedureState(
    params.analysis.rawEstimateText ?? "",
    params.report.presentProcedures,
    params.report.missingProcedures,
    params.retrieval.results
  );
  const recommendedActions = dedupeStrings([
    refined.narrative,
    ...refined.recommendedActions,
    ...params.report.recommendedActions,
  ]).slice(0, 6);
  const requiredProcedures = mergeDriveRequiredProcedures(
    params.report.requiredProcedures,
    params.retrieval.results
  );

  return {
    ...params.report,
    vehicle: mergedVehicle,
    requiredProcedures,
    evidence: mergedEvidence,
    recommendedActions,
    presentProcedures: driveProcedureState.presentProcedures,
    missingProcedures: driveProcedureState.missingProcedures,
    supplementOpportunities: dedupeStrings([
      ...params.report.supplementOpportunities,
      ...driveProcedureState.supplementOpportunities,
    ]),
    summary: {
      ...params.report.summary,
      evidenceQuality: upgradeEvidenceQuality(
        params.report.summary.evidenceQuality,
        params.retrieval.results
      ),
    },
    analysis: params.report.analysis
      ? {
          ...params.report.analysis,
          narrative: refined.narrative || params.report.analysis.narrative,
          vehicle: mergedVehicle ?? params.report.analysis.vehicle,
          evidence: [
            ...params.report.analysis.evidence,
            ...params.retrieval.results.map((result) => ({
              source: buildClientFacingSourceLabel(result),
              quote: result.excerpt.excerpt,
            })),
          ].slice(0, 12),
        }
      : params.report.analysis,
  };
}

async function generateDriveRefinedAnalysis(params: {
  report: RepairIntelligenceReport;
  analysis: ReturnType<typeof normalizeReportToAnalysisResult>;
  retrieval: DriveRetrievalResponse;
  retrievalContext: string;
  userMessage: string;
}): Promise<{ narrative: string; recommendedActions: string[] }> {
  const response = await openai.responses.create({
    model: collisionIqModels.primary,
    temperature: 0.2,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: `You are refining a collision repair analysis after targeted Google Drive retrieval.

Rules:
- keep the original estimator-style repair judgment as the base
- use OEM support to reinforce or adjust repair, procedure, calibration, structural, and compliance conclusions
- use PA law support only for rebuttal, negotiation, appraisal, aftermarket, valuation, or rights issues when the retrieval lane shows that legal support is relevant
- do not let legal commentary replace the core repair judgment
- do not dump documents or overquote excerpts
- keep the narrative concise, natural, and direct
- preserve a professional estimator tone
- return JSON only with this shape:
{
  "narrative": "string",
  "recommendedActions": ["string"]
}`,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `[User Request]
${params.userMessage || "repair analysis"}

[First-Pass Analysis]
${buildFirstPassAnalysisAnswer(params.report, params.analysis)}

[Current Issues]
${params.report.issues.map((issue) => `- ${issue.title}: ${issue.impact || issue.finding}`).join("\n") || "- None listed"}

[Current Missing Procedures]
${params.report.missingProcedures.map((procedure) => `- ${procedure}`).join("\n") || "- None listed"}

[Drive Retrieval Mode]
${params.retrieval.request.retrievalMode}

[Retrieved Drive Support]
${params.retrievalContext}`,
          },
        ],
      },
    ],
  });

  const parsed = safeParseJsonObject<{
    narrative?: string;
    recommendedActions?: string[];
  }>(
    typeof response.output_text === "string" ? response.output_text : ""
  );

  return {
    narrative:
      parsed?.narrative?.trim() ||
      buildFirstPassAnalysisAnswer(params.report, params.analysis),
    recommendedActions: (parsed?.recommendedActions ?? [])
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 5),
  };
}

function mergeDriveEvidence(
  existing: EvidenceRecord[],
  results: DriveRetrievalResult[]
): EvidenceRecord[] {
  const merged = [
    ...existing.map(sanitizeExistingEvidenceRecord),
    ...results.map((result, index) => ({
      id: `drive-${index + 1}`,
      title: result.filename,
      snippet: result.excerpt.excerpt,
      source: buildClientFacingSourceLabel(result),
      authority:
        result.sourceBucket === "pa_law" ? "internal" : "oem",
    } satisfies EvidenceRecord)),
  ];

  const deduped = new Map<string, EvidenceRecord>();
  for (const item of merged) {
    const key = `${item.title}:${item.source}:${item.snippet}`;
    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  }

  return [...deduped.values()].slice(0, 12);
}

function mergeDriveRequiredProcedures(
  existing: RepairIntelligenceReport["requiredProcedures"],
  results: DriveRetrievalResult[]
): RepairIntelligenceReport["requiredProcedures"] {
  const merged = new Map(
    existing.map((procedure) => [procedure.procedure.toLowerCase(), procedure] as const)
  );

  for (const result of results) {
    for (const topic of result.metadata.topicTags ?? []) {
      const procedure = mapDriveTopicToProcedure(topic);
      if (!procedure) continue;
      const key = procedure.toLowerCase();
      if (merged.has(key)) continue;

      merged.set(key, {
        procedure,
        reason: `Direct Drive support found in ${result.filename}. ${result.matchReason}`,
        source: "oem_doc",
        severity: result.confidence === "high" ? "high" : "medium",
      });
    }
  }

  return [...merged.values()];
}

function mapDriveTopicToProcedure(topic: string): string | null {
  switch (topic) {
    case "pre_scan":
      return "Pre-repair scan";
    case "post_scan":
      return "Post-repair scan";
    case "adas_calibration":
      return "ADAS calibration procedure support";
    case "headlamp_aim":
      return "Headlamp aiming check";
    case "structural_measurement":
      return "Structural measurement";
    case "frame_setup_realignment":
      return "Structural setup and pull verification";
    case "corrosion_protection_cavity_wax_seam_sealer":
      return "Corrosion protection materials";
    case "weld_prep_weld_protection":
      return "Weld protection restoration";
    case "one_time_use_hardware":
      return "One-time-use hardware";
    case "restraint_srs_verification":
      return "SRS / restraint verification";
    default:
      return null;
  }
}

function deriveDriveProcedureState(
  estimateText: string,
  existingPresentProcedures: string[],
  existingMissingProcedures: string[],
  results: DriveRetrievalResult[]
): {
  presentProcedures: string[];
  missingProcedures: string[];
  supplementOpportunities: string[];
} {
  const lowerEstimate = estimateText.toLowerCase();
  const present = new Set(existingPresentProcedures);
  const missing = new Set(existingMissingProcedures);
  const supplementOpportunities = new Set<string>();

  for (const result of results) {
    for (const topic of result.metadata.topicTags ?? []) {
      const procedure = mapDriveTopicToProcedure(topic);
      if (!procedure) continue;

      const presenceHints = getDriveProcedurePresenceHints(topic);
      const isPresent = presenceHints.some((hint) => lowerEstimate.includes(hint));

      if (isPresent) {
        present.add(procedure);
        missing.delete(procedure);
        continue;
      }

      if (present.has(procedure)) {
        continue;
      }

      missing.add(procedure);
      if (
        topic === "corrosion_protection_cavity_wax_seam_sealer" ||
        topic === "weld_prep_weld_protection" ||
        topic === "one_time_use_hardware"
      ) {
        supplementOpportunities.add(`Add and document ${procedure}.`);
      }
    }
  }

  return {
    presentProcedures: [...present],
    missingProcedures: [...missing],
    supplementOpportunities: [...supplementOpportunities],
  };
}

function getDriveProcedurePresenceHints(topic: string): string[] {
  switch (topic) {
    case "pre_scan":
      return ["pre scan", "pre-scan", "pre-repair scan", "diagnostic scan"];
    case "post_scan":
      return ["post scan", "post-scan", "post-repair scan", "final scan"];
    case "adas_calibration":
      return ["calibration", "adas", "camera", "radar", "sensor"];
    case "headlamp_aim":
      return ["headlamp aim", "headlamp aiming", "lamp aim"];
    case "structural_measurement":
      return ["structural measurement", "measure", "measuring", "dimension"];
    case "frame_setup_realignment":
      return ["frame setup", "realignment", "pull", "bench setup"];
    case "corrosion_protection_cavity_wax_seam_sealer":
      return ["corrosion protection", "cavity wax", "seam sealer"];
    case "weld_prep_weld_protection":
      return ["weld prep", "weld protection", "weld-through"];
    case "one_time_use_hardware":
      return ["one-time-use", "fastener", "clip", "seal"];
    case "restraint_srs_verification":
      return ["srs", "airbag", "seat belt", "pretensioner"];
    default:
      return [];
  }
}

function buildClientFacingSourceLabel(result: DriveRetrievalResult): string {
  const bucketLabel =
    result.sourceBucket === "oem_procedures"
      ? "OEM Procedures"
      : result.sourceBucket === "oem_position_statements"
        ? "OEM Position Statements"
        : result.sourceBucket === "pa_law"
          ? "PA Law"
          : "Reference";
  const path = (result.metadata.source || result.filename).replace(/\\/g, "/").replace(/^\/+/, "");
  return `${bucketLabel} / ${path}`;
}

function sanitizeExistingEvidenceRecord(record: EvidenceRecord): EvidenceRecord {
  const normalizedTitle = looksOpaqueIdentifier(record.title)
    ? "Retrieved support"
    : record.title;
  const normalizedSource = looksOpaqueIdentifier(record.source)
    ? "Drive knowledge base"
    : record.source;

  return {
    ...record,
    title: normalizedTitle,
    source: normalizedSource,
  };
}

function looksOpaqueIdentifier(value?: string | null): boolean {
  if (!value) return false;
  return /^[A-Za-z0-9_-]{16,}$/.test(value.trim());
}

function toChatVehicleSource(
  source?: VehicleIdentity["source"]
): "attachment" | "user" | "inferred" | "vin_decoded" | "unknown" {
  switch (source) {
    case "attachment":
    case "user":
    case "inferred":
    case "vin_decoded":
      return source;
    default:
      return "unknown";
  }
}

function buildClientSafeRetrievalSummary(retrieval: DriveRetrievalResponse) {
  return {
    retrievalMode: retrieval.request.retrievalMode,
    lanes: retrieval.request.targetLanes,
    matchedSources: retrieval.results.map((result) => ({
      filename: result.filename,
      documentClass: result.documentClass,
      sourceBucket: result.sourceBucket,
      sourceLabel: buildClientFacingSourceLabel(result),
      matchReason: result.matchReason,
      confidence: result.confidence,
    })),
  };
}

function upgradeEvidenceQuality(
  current: RepairIntelligenceReport["summary"]["evidenceQuality"],
  results: DriveRetrievalResult[]
): RepairIntelligenceReport["summary"]["evidenceQuality"] {
  const oemCount = results.filter((result) => result.sourceBucket !== "pa_law").length;
  if (oemCount >= 2) return "strong";
  if (oemCount >= 1 && current === "weak") return "moderate";
  return current;
}

function safeParseJsonObject<T>(value: string): T | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;

    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

async function generateSupplementCandidates(
  text: string,
  report: RepairIntelligenceReport
) {
  if (!text.trim()) return [];

  const requiredProcedures = report.requiredProcedures
    .map((entry) => `- ${entry.procedure}`)
    .join("\n");
  const presentProcedures = report.presentProcedures
    .map((entry) => `- ${entry}`)
    .join("\n");
  const missingProcedures = report.missingProcedures
    .map((entry) => `- ${entry}`)
    .join("\n");

  const response = await openai.responses.create({
    model: SUPPLEMENT_MODEL,
    temperature: 0.2,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: `You are reviewing a collision repair estimate.

Use the vehicle-specific required procedure context below to decide what functions are not clearly represented.

Important:
- Do NOT assume every vehicle has the same ADAS systems
- Do NOT suggest front camera, radar, blind spot, or other ADAS calibrations unless they are supported by the required procedure context
- If a function is already represented in the estimate or present-procedure list, do NOT include it
- Only flag items that are truly unclear or absent

Return JSON only:
[
  {
    "title": "",
    "reason": ""
  }
]`,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `[Estimate Text]
${text}

[Vehicle-Specific Required Procedures From Drive/OEM]
${requiredProcedures || "- None provided"}

[Procedures Already Represented]
${presentProcedures || "- None documented"}

[Procedures Already Identified As Missing]
${missingProcedures || "- None identified"}`,
          },
        ],
      },
    ],
  });

  try {
    const output =
      "output_text" in response && typeof response.output_text === "string"
        ? response.output_text
        : "[]";
    return JSON.parse(output) as Array<{ title: string; reason: string }>;
  } catch {
    return [];
  }
}
