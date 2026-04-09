import { NextResponse } from "next/server";
import { saveAnalysisReport } from "@/lib/analysisReportStore";
import {
  getUploadedAttachments,
} from "@/lib/uploadedAttachmentStore";
import {
  buildDriveRefinementContext,
  detectChatTaskType,
  retrieveDriveSupport,
} from "@/lib/ai/driveRetrievalService";
import { buildDecisionPanelHybrid } from "@/lib/ai/builders/buildDecisionPanel";
import { normalizeReportToAnalysisResult } from "@/lib/ai/builders/normalizeReportToAnalysisResult";
import { runRepairAnalysis } from "@/lib/ai/orchestrator/analysisOrchestrator";
import { enrichAnalysisAttachments } from "@/lib/ai/analysisAttachmentService";
import {
  inferDriveRetrievalTopics,
  inferDriveVehicleContext,
} from "@/lib/ai/contracts/driveRetrievalContract";
import type { ChatAnalysisOutput } from "@/lib/ai/contracts/chatAnalysisSchema";
import type {
  RepairIntelligenceReport,
  VehicleIdentity,
} from "@/lib/ai/types/analysis";
import type { WorkspaceData } from "@/types/workspaceTypes";
import type {
  DriveRetrievalResponse,
  DriveRetrievalResult,
} from "@/lib/ai/contracts/driveRetrievalContract";
import { mergeVehicleIdentity, normalizeVehicleIdentity } from "@/lib/ai/vehicleContext";
import type { EvidenceRecord } from "@/lib/ai/types/evidence";
import { collisionIqModels } from "@/lib/modelConfig";
import { openai } from "@/lib/openai";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";
import {
  UsageAccessError,
  assertAnalysisAllowed,
  recordCompletedAnalysisUsage,
} from "@/lib/billing/usage";
import { prisma } from "@/lib/prisma";

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

class AttachmentAccessError extends Error {
  status = 404;

  constructor(message = "One or more attachments were not found for the current account.") {
    super(message);
    this.name = "AttachmentAccessError";
  }
}

async function getLatestUserSubscription(userId: string) {
  return prisma.subscription.findFirst({
    where: {
      userId,
    },
    orderBy: [
      {
        updatedAt: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
  });
}

export async function POST(req: Request) {
  try {
    const { user, isPlatformAdmin } = await requireCurrentUser();
    const subscription = await getLatestUserSubscription(user.id);
    const body = (await req.json()) as AnalysisRequestBody;
    const artifactIds = body.artifactIds ?? [];

    if (!artifactIds.length) {
      return NextResponse.json(
        { error: "artifactIds are required" },
        { status: 400 }
      );
    }

    const usageSnapshot = await assertAnalysisAllowed({ user, subscription });
    const storedAttachments = await getUploadedAttachments(artifactIds, {
      ownerUserId: user.id,
    });

    if (storedAttachments.length !== artifactIds.length) {
      throw new AttachmentAccessError();
    }

    console.info("[analysis-attachments] analysis request assembled", {
      ownerUserId: user.id,
      isPlatformAdmin,
      plan: usageSnapshot.entitlements.plan,
      analysesUsedThisPeriod: usageSnapshot.entitlements.analysesUsedThisPeriod,
      analysesRemaining: usageSnapshot.entitlements.analysesRemaining,
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

    const normalizedAttachments = await enrichAnalysisAttachments({
      attachments: storedAttachments,
      userIntent: body.userIntent ?? null,
    });

    const retrievalAttempted = true;
    let retrievalCompleted = false;
    let retrievalMatchCount = 0;
    let refinedWithRetrieval = false;
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
    })
      .then((result) => {
        retrievalCompleted = true;
        retrievalMatchCount = result?.results.length ?? 0;
        return result;
      })
      .catch((error) => {
        console.error("Analysis Drive retrieval skipped:", error);
        return null;
      });

    if (retrieval?.results.length) {
      console.info("[analysis-drive-retrieval]", {
        ownerUserId: user.id,
        isPlatformAdmin,
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
      refinedWithRetrieval = true;
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

    const stored = await saveAnalysisReport({
      ownerUserId: user.id,
      artifactIds,
      report,
    });

    await recordCompletedAnalysisUsage({
      userId: user.id,
      analysisReportId: stored.id,
      isPlatformAdmin,
      metadataJson: {
        artifactCount: artifactIds.length,
        reportId: stored.id,
      },
    });

    const workspaceData = buildWorkspaceDataFromReport(stored.report);

    return NextResponse.json({
      reportId: stored.id,
      createdAt: stored.createdAt,
      report: stored.report,
      panel,
      workspaceData,
      retrieval: retrieval ? buildClientSafeRetrievalSummary(retrieval) : null,
      retrievalAttempted,
      retrievalCompleted,
      retrievalMatchCount,
      refinedWithRetrieval,
      analysisCompletedAt: new Date().toISOString(),
      usage: {
        plan: usageSnapshot.entitlements.plan,
        analysesUsedThisPeriod:
          usageSnapshot.entitlements.analysesUsedThisPeriod + (isPlatformAdmin ? 0 : 1),
        analysesRemaining:
          usageSnapshot.entitlements.analysesRemaining === null
            ? null
            : Math.max(usageSnapshot.entitlements.analysesRemaining - 1, 0),
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof AttachmentAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof UsageAccessError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }

    console.error("ANALYSIS ERROR:", error);
    return NextResponse.json(
      { error: "Analysis failed" },
      { status: 500 }
    );
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
      const proactiveOpportunity = buildDriveSupportOpportunity(result, topic, lowerEstimate);
      if (proactiveOpportunity) {
        supplementOpportunities.add(proactiveOpportunity);
      }

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

function buildDriveSupportOpportunity(
  result: DriveRetrievalResult,
  topic: string,
  lowerEstimate: string
): string | null {
  const sourceLabel = result.filename.trim() || "retrieved OEM support";
  const clearlyDocumented = hasClearDriveSupportCoverage(lowerEstimate, topic);
  const partiallyRepresented = hasPartialDriveSupportCoverage(lowerEstimate, topic);

  if (clearlyDocumented) {
    return null;
  }

  switch (topic) {
    case "one_time_use_hardware":
      return partiallyRepresented
        ? `OEM support in ${sourceLabel} indicates one-time-use hardware, seals, or clips may already be implicated, but the replacement and related documentation posture remains open.`
        : `OEM support in ${sourceLabel} indicates one-time-use hardware, seals, or clips may need to be replaced and documented when disturbed.`;
    case "corrosion_protection_cavity_wax_seam_sealer":
      return partiallyRepresented
        ? `OEM support in ${sourceLabel} adds corrosion-protection, cavity-wax, seam-sealer, or related material-restoration requirements that may already be implicated, but the current support remains open.`
        : `OEM support in ${sourceLabel} adds corrosion-protection, cavity-wax, seam-sealer, or related material-restoration requirements that should be carried or documented for the affected repair path.`;
    case "weld_prep_weld_protection":
      return partiallyRepresented
        ? `OEM support in ${sourceLabel} adds weld-prep, weld-protection, joining-material, or restoration-material requirements that may already be implicated, but the current support remains open.`
        : `OEM support in ${sourceLabel} adds weld-prep, weld-protection, joining-material, or restoration-material requirements that should be reflected if those joining operations apply.`;
    case "adas_calibration":
      return partiallyRepresented
        ? `OEM support in ${sourceLabel} indicates scan, calibration, alignment, or verification burden may already be partly represented, but the current support remains open.`
        : `OEM support in ${sourceLabel} indicates scan, calibration, alignment, or verification burden may need to be added or better documented for the affected system.`;
    case "fit_sensitive_oem_parts":
      return partiallyRepresented
        ? `OEM support in ${sourceLabel} indicates a fit-sensitive repair path, so test-fit, mock-up, or related finish-sensitive documentation may already be implicated, but the current support remains open.`
        : `OEM support in ${sourceLabel} indicates a fit-sensitive repair path, so pre-paint test-fit or mock-up documentation may be needed before final finish work.`;
    default:
      return null;
  }
}

function hasAnyEstimateHint(lowerEstimate: string, hints: string[]): boolean {
  return hints.some((hint) => lowerEstimate.includes(hint));
}

function hasPartialDriveSupportCoverage(lowerEstimate: string, topic: string): boolean {
  switch (topic) {
    case "one_time_use_hardware":
      return hasAnyEstimateHint(lowerEstimate, ["fastener", "clip", "seal", "hardware"]);
    case "corrosion_protection_cavity_wax_seam_sealer":
      return hasAnyEstimateHint(lowerEstimate, [
        "corrosion",
        "cavity wax",
        "seam sealer",
        "anti-corrosion",
        "refinish protection",
      ]);
    case "weld_prep_weld_protection":
      return hasAnyEstimateHint(lowerEstimate, [
        "weld",
        "spot weld",
        "mig braze",
        "joining material",
        "weld primer",
      ]);
    case "adas_calibration":
      return hasAnyEstimateHint(lowerEstimate, [
        "calibration",
        "adas",
        "camera",
        "radar",
        "sensor",
        "alignment",
        "scan",
      ]);
    case "fit_sensitive_oem_parts":
      return hasAnyEstimateHint(lowerEstimate, [
        "test fit",
        "test-fit",
        "mock-up",
        "mock up",
        "fit check",
        "fit-check",
        "gap",
        "flushness",
        "stack-up",
        "refinish",
        "blend",
      ]);
    default:
      return false;
  }
}

function hasClearDriveSupportCoverage(lowerEstimate: string, topic: string): boolean {
  switch (topic) {
    case "one_time_use_hardware":
      return hasAnyEstimateHint(lowerEstimate, [
        "one-time-use",
        "one time use",
        "non-reusable",
        "replace hardware",
        "new fasteners",
        "new clips",
        "new seals",
      ]);
    case "corrosion_protection_cavity_wax_seam_sealer":
      return hasAnyEstimateHint(lowerEstimate, [
        "corrosion protection",
        "cavity wax",
        "seam sealer",
        "anti-corrosion coating",
      ]);
    case "weld_prep_weld_protection":
      return hasAnyEstimateHint(lowerEstimate, [
        "weld prep",
        "weld protection",
        "weld-through",
        "weld thru",
        "weld-through primer",
        "weld thru primer",
      ]);
    case "adas_calibration":
      return (
        hasAnyEstimateHint(lowerEstimate, ["calibration", "adas"]) &&
        hasAnyEstimateHint(lowerEstimate, ["scan", "verification", "alignment", "aim"])
      );
    case "fit_sensitive_oem_parts":
      return hasAnyEstimateHint(lowerEstimate, [
        "pre-paint test fit",
        "pre paint test fit",
        "mock-up",
        "mock up",
        "fit verification",
      ]);
    default:
      return false;
  }
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

function buildWorkspaceDataFromReport(report: RepairIntelligenceReport): WorkspaceData {
  const keyIssues = dedupeStrings([
    ...report.issues.map((issue) =>
      [issue.title, issue.impact || issue.finding].filter(Boolean).join(": ")
    ),
    ...report.missingProcedures.map((procedure) => `Missing procedure: ${procedure}`),
    ...report.supplementOpportunities,
  ]).slice(0, 5);

  return {
    riskLevel: report.summary.riskScore,
    confidence: report.summary.confidence,
    keyIssues,
    // TODO(workspace): Keep this empty until upstream structured comparison
    // output preserves row-shaped pairs for the Workspace table. The current
    // RepairIntelligenceReport only carries comparison summary data through
    // report.issues, report.recommendedActions, and report.analysis.narrative.
    // It does not expose category-level rows like:
    // { category, shopPosition, carrierPosition } or
    // { category, shop, insurance }.
    // Once those fields exist on RepairIntelligenceReport or report.analysis,
    // map them directly into WorkspaceData.estimateComparisons here.
    estimateComparisons: [],
    supplementLetter: buildWorkspaceSupplementLetter(keyIssues),
    fullAnalysis: buildWorkspaceFullAnalysis(report, keyIssues),
  };
}

function buildWorkspaceSupplementLetter(issues: string[]): string {
  if (!issues.length) return "";

  const numberedIssues = issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n");

  return `Subject: Request for Repair Supplement

After reviewing the repair estimate and related documentation, several issues
have been identified that may affect repair safety, OEM compliance, or repair
quality. These items should be addressed before proceeding with repairs.

Identified Issues:
${numberedIssues}

Based on these findings, we respectfully request authorization for the
appropriate adjustments to ensure the repair follows OEM procedures and
industry standards.

Please advise if additional documentation is required.

Sincerely,
Repair Review System
Collision-IQ
`;
}

function buildWorkspaceFullAnalysis(
  report: RepairIntelligenceReport,
  keyIssues: string[]
): string {
  const sections = [
    report.analysis?.narrative?.trim() || "",
    report.recommendedActions.length
      ? `Recommended actions:\n${report.recommendedActions.map((action) => `- ${action}`).join("\n")}`
      : "",
    keyIssues.length ? `Key issues:\n${keyIssues.map((issue) => `- ${issue}`).join("\n")}` : "",
  ].filter(Boolean);

  return sections.join("\n\n");
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
