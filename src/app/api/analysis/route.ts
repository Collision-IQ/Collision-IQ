import { NextResponse } from "next/server";
import {
  getAnalysisReport,
  saveAnalysisReport,
  updateAnalysisReport,
} from "@/lib/analysisReportStore";
import { recordCarrierTrendEvent } from "@/lib/analytics/carrierTrends";
import {
  getUploadedAttachments,
  type StoredAttachment,
} from "@/lib/uploadedAttachmentStore";
import { buildEvidenceCorpus } from "@/lib/analysis/buildEvidenceCorpus";
import {
  applyAnalysisContextBudget,
  type AnalysisContextBudgetDiagnostics,
} from "@/lib/analysis/analysisContextBudget";
import {
  buildDriveRefinementContext,
  detectChatTaskType,
  retrieveDriveSupport,
} from "@/lib/ai/driveRetrievalService";
import { buildDecisionPanelHybrid } from "@/lib/ai/builders/buildDecisionPanel";
import { normalizeReportToAnalysisResult } from "@/lib/ai/builders/normalizeReportToAnalysisResult";
import { runRepairAnalysis } from "@/lib/ai/orchestrator/analysisOrchestrator";
import { enrichAnalysisAttachments } from "@/lib/ai/analysisAttachmentService";
import { NON_BIAS_ACCURACY_DIRECTIVE } from "@/lib/ai/nonBiasDirective";
import { buildAssistanceProfileInstruction } from "@/lib/ai/assistanceProfile";
import {
  inferDriveRetrievalTopics,
  inferDriveVehicleContext,
} from "@/lib/ai/contracts/driveRetrievalContract";
import type { ChatAnalysisOutput } from "@/lib/ai/contracts/chatAnalysisSchema";
import type {
  CaseEvidenceRegistryItem,
  CaseEvidenceSourceType,
  ArtifactRefreshPolicy,
  IssueEvidenceStatus,
  RepairIntelligenceReport,
  ReassessmentDelta,
  SharedFactualCore,
  VehicleIdentity,
} from "@/lib/ai/types/analysis";
import type {
  DriveRetrievalResponse,
  DriveRetrievalResult,
} from "@/lib/ai/contracts/driveRetrievalContract";
import { mergeVehicleIdentity, normalizeVehicleIdentity } from "@/lib/ai/vehicleContext";
import { extractEstimateFacts } from "@/lib/ai/extractors/extractEstimateFacts";
import { resolveStateFromZip } from "@/lib/policyLegal/stateFromZip";
import {
  analyzeEstimateOperations,
  inferImpactSide,
  isOperationAlreadyRepresented,
} from "@/lib/ai/estimateOperationEquivalence";
import {
  deriveImpactZone,
  hasFrontSupportZoneEvidence,
  isSideImpactZone,
} from "@/lib/ai/impactZone";
import type { EvidenceRecord } from "@/lib/ai/types/evidence";
import {
  collisionIqModels,
  getCollisionIqModelDiagnostic,
} from "@/lib/modelConfig";
import { openai } from "@/lib/openai";
import {
  generatePrimaryText,
  generateSupplementText,
} from "@/lib/ai/providerTextGeneration";
import { buildWorkspaceDataFromReport } from "@/lib/workspace/buildWorkspaceData";
import { buildLinkedEvidence, type LinkedEvidence } from "@/lib/ingest/fetchLinkedEvidence";
import { redactExternalDocumentUrls } from "@/lib/externalDocuments";
import {
  extractLinksFromFiles,
  extractLinksFromText,
} from "@/lib/ingest/extractLinks";
import {
  CCC_WORKFILE_DISCLAIMER,
  isCccUploadClassification,
} from "@/lib/ccc/cccWorkfile";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";
import {
  UsageAccessError,
  recordCompletedAnalysisUsage,
} from "@/lib/billing/usage";
import {
  getUploadBatchLimitMessage,
  resolveUploadPlanLimits,
  validateUploadBatchFileCount,
} from "@/lib/uploadSafety/uploadLimits";
import {
  normalizeReviewProgressCounts,
  type ExcludedFromReviewFileDiagnostic,
  type ExcludedFromReviewReason,
} from "@/lib/reviewCompleteness";
import {
  buildFileReviewLedger,
  resolveEvidenceCompletenessFromLedger,
} from "@/lib/fileReviewLedger";
import { classifyRetryableProviderError } from "@/lib/ai/providerRetryableError";
import {
  areInternalRetrievalPathsResolved,
  createAgentRetrievalTrace,
  logAgentTraceCompleted,
  logAgentTraceEvent,
  recordAgentRetrievalStep,
  type AgentRetrievalTrace,
} from "@/lib/ai/agentRetrievalTrace";

export const runtime = "nodejs";

type AnalysisRequestBody = {
  artifactIds?: string[];
  activeCaseId?: string | null;
  sessionContext?: {
    vehicleMake?: string | null;
    system?: string | null;
    component?: string | null;
    procedure?: string | null;
  } | null;
  userIntent?: string | null;
  assistanceProfile?: string | null;
  reviewProgress?: {
    uploaded?: number;
    indexed?: number;
    visionProcessed?: number;
    reviewedForDetermination?: number;
    reviewableFileCount?: number;
    excludedFromReviewCount?: number;
    excludedFromReviewReasons?: ExcludedFromReviewReason[];
    excludedFromReviewFiles?: ExcludedFromReviewFileDiagnostic[];
    totalKnownFiles?: number;
  } | null;
};

class AttachmentAccessError extends Error {
  status = 404;

  constructor(message = "One or more attachments were not found for the current account.") {
    super(message);
    this.name = "AttachmentAccessError";
  }
}

function assertAnalysisAllowedForEntitlements(
  entitlements: Awaited<ReturnType<typeof getCurrentEntitlements>>,
  isPlatformAdmin: boolean
) {
  if (isPlatformAdmin) {
    return;
  }

  if (!entitlements.canUpload) {
    if (entitlements.usageStatus === "trial_expired") {
      throw new UsageAccessError(
        "trial_expired",
        "Your 30-day trial has ended. Upgrade to continue running full analysis."
      );
    }

    throw new UsageAccessError(
      "upgrade_required",
      "Your current access does not include document-backed analysis. Upgrade to continue."
    );
  }

  if (!entitlements.canRunAnalysis) {
    if (entitlements.usageStatus === "trial_expired") {
      throw new UsageAccessError(
        "trial_expired",
        "Your 30-day trial has ended. Upgrade to continue running full analysis."
      );
    }

    throw new UsageAccessError(
      "usage_limit_reached",
      "You have reached your analysis limit for this period."
    );
  }
}

export async function POST(req: Request) {
  let agentTrace: AgentRetrievalTrace | null = null;
  let contextBudgetDiagnostics: AnalysisContextBudgetDiagnostics | null = null;

  try {
    const { user, verifiedEmails, isPlatformAdmin } = await requireCurrentUser();
    const entitlements = await getCurrentEntitlements({
      userEmail: user.email,
      userEmails: verifiedEmails,
      isPlatformAdmin,
    });
    const uploadLimits = resolveUploadPlanLimits({
      ...entitlements,
      isPlatformAdmin: entitlements.isPlatformAdmin || isPlatformAdmin,
    });
    const body = (await req.json()) as AnalysisRequestBody;
    agentTrace = createAgentRetrievalTrace({
      flow: "analysis",
      caseId: body.activeCaseId ?? null,
      userId: user.id,
    });
    const artifactIds = body.artifactIds ?? [];
    const profileInstruction = buildAssistanceProfileInstruction(body.assistanceProfile);
    const requestUserIntent = [body.userIntent ?? "", profileInstruction]
      .filter(Boolean)
      .join("\n\n");

    if (!artifactIds.length) {
      return NextResponse.json(
        { error: "artifactIds are required" },
        { status: 400 }
      );
    }

    const batchValidation = validateUploadBatchFileCount(artifactIds.length, uploadLimits);
    if (!batchValidation.valid) {
      console.info("[analysis-attachments] rejected oversized batch", {
        artifactCount: artifactIds.length,
        maxFileCount: uploadLimits.maxFilesPerReview,
        plan: uploadLimits.plan,
        ownerUserId: user.id,
      });
      return NextResponse.json(
        {
          error: batchValidation.reason ?? getUploadBatchLimitMessage(uploadLimits),
          code: batchValidation.code ?? "MAX_FILES_REACHED",
          limits: {
            maxFiles: uploadLimits.maxFilesPerReview,
          },
        },
        { status: 400 }
      );
    }

    assertAnalysisAllowedForEntitlements(entitlements, isPlatformAdmin);
    const existingCase = body.activeCaseId
      ? await getAnalysisReport(body.activeCaseId, {
          ownerUserId: user.id,
        })
      : null;

    if (body.activeCaseId && !existingCase) {
      throw new AttachmentAccessError(
        "The active case could not be found for the current account."
      );
    }

    const storedAttachments = await getUploadedAttachments(artifactIds, {
      ownerUserId: user.id,
    });

    if (storedAttachments.length !== artifactIds.length) {
      throw new AttachmentAccessError();
    }

    console.info("[analysis-attachments] analysis request assembled", {
      ownerUserId: user.id,
      isPlatformAdmin,
      plan: entitlements.plan,
      analysesUsedThisPeriod: entitlements.analysisCount,
      analysesRemaining: entitlements.usage.remaining,
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
      userIntent: requestUserIntent || null,
    });
    const budgetedContext = applyAnalysisContextBudget({
      attachments: normalizedAttachments,
      userIntent: requestUserIntent || null,
      provider: "openai",
      model: collisionIqModels.primary,
    });
    contextBudgetDiagnostics = budgetedContext.diagnostics;
    if (contextBudgetDiagnostics.contextReductionApplied) {
      console.info("[analysis-context-budget] reduction applied", contextBudgetDiagnostics);
    }
    const attachmentFilesForLinks = normalizedAttachments.map((attachment) => ({
      name: attachment.filename,
      text: attachment.text,
      summary: null,
    }));
    const detectedEstimateUrls = [
      ...new Set([
        ...extractLinksFromText(normalizedAttachments.map((attachment) => attachment.text).join("\n\n")),
        ...extractLinksFromFiles(attachmentFilesForLinks),
      ]),
    ];
    logAgentTraceEvent("estimate links detected", agentTrace, {
      found: detectedEstimateUrls.length,
    });
    const linkedEvidence = await buildLinkedEvidence({
      estimateText: normalizedAttachments.map((attachment) => attachment.text).join("\n\n"),
      files: attachmentFilesForLinks,
    });
    const linkedEvidenceOkCount = linkedEvidence.filter((doc) => doc.status === "ok").length;
    recordAgentRetrievalStep(agentTrace, {
      order: 1,
      tool: "estimate_link_reader",
      action: "open_estimate_links",
      resultCount: linkedEvidenceOkCount,
      status:
        detectedEstimateUrls.length === 0
          ? "skipped"
          : linkedEvidence.some((doc) => doc.status === "ok" || doc.status === "blocked" || doc.status === "skipped")
            ? "success"
            : "error",
      reason:
        detectedEstimateUrls.length === 0
          ? "No estimate/upload document links found."
          : linkedEvidenceOkCount === 0
            ? "Estimate links attempted; no retrievable document text retained."
            : undefined,
    });
    logAgentTraceEvent("estimate links attempted", agentTrace, {
      detectedCount: detectedEstimateUrls.length,
      attemptedCount: linkedEvidence.length,
      resultCount: linkedEvidenceOkCount,
    });
    const linkedEvidenceAttachments = linkedEvidenceToAttachments(linkedEvidence);
    let preloadedAttachments = prioritizeEstimateGapAttachments([
      ...budgetedContext.attachments,
      ...linkedEvidenceAttachments,
    ], requestUserIntent);

    let retrievalAttempted = false;
    let retrievalCompleted = false;
    let retrievalMatchCount = 0;
    let refinedWithRetrieval = false;
    let report: RepairIntelligenceReport;
    try {
      report = await runRepairAnalysis({
        artifactIds,
        preloadedAttachments,
        sessionContext: body.sessionContext ?? null,
        userIntent: requestUserIntent || null,
      });
    } catch (error) {
      if (!isContextLengthExceededError(error)) throw error;
      const retryBudget = applyAnalysisContextBudget({
        attachments: normalizedAttachments,
        userIntent: requestUserIntent || null,
        provider: "openai",
        model: collisionIqModels.primary,
        contextBudgetLimit: Math.floor((contextBudgetDiagnostics?.contextBudgetLimit ?? 60000) * 0.55),
        forceAggressive: true,
      });
      contextBudgetDiagnostics = retryBudget.diagnostics;
      preloadedAttachments = prioritizeEstimateGapAttachments([
        ...retryBudget.attachments,
        ...linkedEvidenceAttachments.map((attachment) => ({
          ...attachment,
          text: attachment.text.slice(0, 2400),
        })),
      ], requestUserIntent);
      console.warn("[analysis-context-budget] retrying after provider context error", contextBudgetDiagnostics);
      report = await runRepairAnalysis({
        artifactIds,
        preloadedAttachments,
        sessionContext: body.sessionContext ?? null,
        userIntent: requestUserIntent || null,
      });
    }
    report = applyLinkedEvidenceToReport({
      report,
      uploadedAttachments: normalizedAttachments,
      linkedEvidence,
      activeCaseId: body.activeCaseId ?? null,
      previousReport: existingCase?.report ?? null,
      userIntent: requestUserIntent || null,
      uploadLimitReached: artifactIds.length >= uploadLimits.maxFilesPerReview,
      totalUploadedFileCount: mergeArtifactIds(existingCase?.artifactIds ?? [], artifactIds).length,
      reviewProgress: body.reviewProgress ?? null,
    });
    let analysis = normalizeReportToAnalysisResult(report);
    const retrievalSnapshot = buildAnalysisRetrievalSnapshot({
      userMessage: requestUserIntent,
      report,
      analysis,
      hasDocuments: artifactIds.length > 0,
    });
    const shouldRunDriveRetrieval = (contextBudgetDiagnostics?.authoritySearchQueries.length ?? 0) > 0;
    let retrieval: DriveRetrievalResponse | null = null;
    if (shouldRunDriveRetrieval) {
      retrievalAttempted = true;
      logAgentTraceEvent("google drive search started", agentTrace, {
        retrievalMode: retrievalSnapshot.taskType,
        generatedQueries: contextBudgetDiagnostics?.authoritySearchQueries ?? [],
      });
      retrieval = await retrieveDriveSupport({
        taskType: retrievalSnapshot.taskType,
        userQuery: [
          requestUserIntent || "repair analysis",
          ...(contextBudgetDiagnostics?.authoritySearchQueries ?? []),
        ].join("\n"),
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
          recordAgentRetrievalStep(agentTrace!, {
            order: 2,
            tool: "google_drive_search",
            action: "search_internal_sources",
            resultCount: 0,
            status: "error",
            reason: "Internal retrieval failed.",
          });
          return null;
        });
    }
    if (!agentTrace.steps.some((step) => step.order === 2)) {
      recordAgentRetrievalStep(agentTrace, {
        order: 2,
        tool: "google_drive_search",
        action: "search_internal_sources",
        resultCount: retrieval?.results.length ?? 0,
        status: retrieval ? "success" : "skipped",
        reason: retrieval
          ? undefined
          : shouldRunDriveRetrieval
            ? "Google Drive/internal retrieval returned no usable result."
            : "Google Drive/internal retrieval skipped because no retrieval query was generated.",
      });
    }
    logAgentTraceEvent("google drive search completed", agentTrace, {
      resultCount: retrieval?.results.length ?? 0,
      status: agentTrace.steps.find((step) => step.order === 2)?.status ?? "skipped",
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
        userMessage: requestUserIntent,
      });
      analysis = normalizeReportToAnalysisResult(report);
      refinedWithRetrieval = true;
    }

    report = await attachMarketPreviewComparables({
      report,
      uploadedAttachments: normalizedAttachments,
      userIntent: requestUserIntent,
      agentTrace,
    });
    analysis = normalizeReportToAnalysisResult(report);

    const supplementCandidates = await generateSupplementCandidates(
      analysis.rawEstimateText ?? "",
      report,
      linkedEvidence,
      buildCccWorkfilePromptContext(storedAttachments)
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

    const stored =
      body.activeCaseId
        ? await updateAnalysisReport({
            id: body.activeCaseId,
            ownerUserId: user.id,
            artifactIds: mergeArtifactIds(existingCase?.artifactIds ?? [], artifactIds),
            report,
          })
        : await saveAnalysisReport({
            ownerUserId: user.id,
            artifactIds,
            report,
          });

    if (!stored) {
      throw new AttachmentAccessError(
        "The active case could not be found for the current account."
      );
    }

    await recordCompletedAnalysisUsage({
      userId: user.id,
      analysisReportId: stored.id,
      isPlatformAdmin,
      metadataJson: {
        artifactCount: artifactIds.length,
        reportId: stored.id,
      },
    });

    await recordCarrierTrendEvent({
      reportId: stored.id,
      report: stored.report,
      panel,
    }).catch((error) => {
      console.warn("[carrier-trends] record failed", {
        reportId: stored.id,
        message: error instanceof Error ? error.message : "Unknown carrier trend error",
      });
    });

    const workspaceData = buildWorkspaceDataFromReport(stored.report);

    const reviewProgress = buildReviewProgressPayload(stored.report, stored.artifactIds);

    logAgentTraceCompleted(agentTrace);

    return NextResponse.json({
      reportId: stored.id,
      createdAt: stored.createdAt,
      report: stored.report,
      reviewProgress,
      linkedEvidence: (stored.report.linkedEvidence ?? []).map((doc) => ({
        id: doc.title || doc.sourceType || "linked-supporting-document",
        title: doc.title,
        status: doc.status,
        sourceType: doc.sourceType,
        notes: doc.notes,
        textPreview: redactExternalDocumentUrls(doc.text || "").slice(0, 200),
      })),
      panel,
      workspaceData,
      retrieval: retrieval ? buildClientSafeRetrievalSummary(retrieval) : null,
      retrievalAttempted,
      retrievalCompleted,
      retrievalMatchCount,
      refinedWithRetrieval,
      contextBudget: contextBudgetDiagnostics,
      modelDiagnostics: [
        getCollisionIqModelDiagnostic({
          stage: "analysis_primary",
          provider: "openai",
          role: "primary",
          model: collisionIqModels.primary,
        }),
        getCollisionIqModelDiagnostic({
          stage: "analysis_supplement_candidates",
          provider: "openai",
          role: collisionIqModels.supplement === collisionIqModels.helper ? "helper" : "supplement",
          model: collisionIqModels.supplement,
        }),
      ],
      toolUsageTrace: [
        ...(contextBudgetDiagnostics?.toolUsageTrace ?? []),
        ...agentTrace.steps.map((step) => ({
          tool: step.tool,
          status: step.status,
          reason: step.reason,
          resultCount: step.resultCount,
        })),
      ],
      contextBudgetMessage: contextBudgetDiagnostics?.contextReductionApplied
        ? "Analysis context was too large. I reduced the file set to the most relevant policy/estimate sections and retried."
        : null,
      analysisCompletedAt: new Date().toISOString(),
      caseContinuity: {
        activeCaseId: stored.id,
        mode: body.activeCaseId ? "active_case_update" : "new_case",
        evidenceRegistryCount: stored.report.evidenceRegistry?.length ?? 0,
      },
      reassessmentDelta: stored.report.reassessmentDelta ?? null,
      artifactRefreshPolicy: stored.report.artifactRefreshPolicy ?? null,
      usage: {
        plan: entitlements.plan,
        analysesUsedThisPeriod: entitlements.analysisCount + (isPlatformAdmin ? 0 : 1),
        analysesRemaining:
          entitlements.usage.remaining === null
            ? null
            : Math.max(entitlements.usage.remaining - 1, 0),
      },
    });
  } catch (error) {
    if (agentTrace) {
      logAgentTraceCompleted(agentTrace);
    }

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

    if (isContextLengthExceededError(error)) {
      console.error("ANALYSIS CONTEXT BUDGET ERROR:", {
        diagnostics: contextBudgetDiagnostics,
        message: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        {
          ok: false,
          error: "CONTEXT_BUDGET_EXCEEDED",
          message: "Analysis blocked because context could not be reduced safely. Open diagnostics.",
          contextBudget: contextBudgetDiagnostics,
          toolUsageTrace: contextBudgetDiagnostics?.toolUsageTrace ?? [],
        },
        { status: 413 }
      );
    }

    const providerError = classifyRetryableProviderError(error, {
      provider: "openai",
      stage: "analysis",
    });

    if (providerError.retryable) {
      const retryableStatus =
        providerError.status === 429 || providerError.statusCode === 429 ? 429 : 503;
      console.warn("ANALYSIS RETRYABLE PROVIDER ERROR:", {
        provider: providerError.provider,
        stage: providerError.stage,
        retryable: true,
        status: providerError.status,
        statusCode: providerError.statusCode,
        code: providerError.code,
        message: providerError.message,
      });

      return NextResponse.json(
        {
          ok: false,
          retryable: true,
          stage: providerError.stage,
          provider: providerError.provider,
          status: providerError.status,
          statusCode: providerError.statusCode,
          message: "Analysis provider is busy. Please retry shortly.",
        },
        { status: retryableStatus }
      );
    }

    console.error("ANALYSIS ERROR:", {
      provider: providerError.provider,
      stage: providerError.stage,
      retryable: false,
      status: providerError.status,
      statusCode: providerError.statusCode,
      code: providerError.code,
      message: providerError.message,
      error,
    });
    return NextResponse.json(
      { error: "Analysis failed" },
      { status: 500 }
    );
  }
}

function linkedEvidenceToAttachments(linkedEvidence: LinkedEvidence[]): StoredAttachment[] {
  return linkedEvidence
    .filter((doc) => doc.status === "ok" && Boolean(doc.text.trim()))
    .map((doc, index) => ({
      id: `linked-evidence:${index + 1}`,
      filename: doc.title || `Linked supporting document ${index + 1}`,
      type: doc.mimeType || "text/plain",
      text: [
        "Linked supporting document identified in file review.",
        `Source type: ${doc.sourceType}`,
        redactExternalDocumentUrls(doc.text),
      ].join("\n"),
      imageDataUrl: undefined,
      pageCount: undefined,
    }));
}

type MarketPreviewComparableAd = {
  price?: number;
  askingPrice?: number;
  mileage?: number;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  source: string;
  title: string;
  location?: string;
  url?: string;
  dateAccessed: string;
};

type MarketPreviewReport = RepairIntelligenceReport & {
  valuationData?: {
    comparableListings?: MarketPreviewComparableAd[];
  };
  marketPreview?: {
    status: "completed" | "failed";
    comps: MarketPreviewComparableAd[];
    median?: number;
    failureReason?: string;
    dateAccessed: string;
  };
  marketPreviewSearch?: {
    attempted: boolean;
    state: "idle" | "searching" | "completed" | "failed";
    status: "completed" | "provider_not_configured" | "vehicle_identifiers_missing" | "location_missing" | "no_results" | "timeout" | "parsing_failed" | "failed";
    query?: string;
    widenedQuery?: string;
    failureReason?: string;
    dateAccessed: string;
    comparableCount: number;
    validPriceCount: number;
    medianValue?: number;
    rawResultCount?: number;
  };
};

type MarketPreviewSearchInputs = {
  vehicle: VehicleIdentity | null;
  mileage?: number;
  zip?: string;
  state?: string;
};

type MarketPreviewSearchQuery = {
  query: string;
  label: "trim_zip" | "trim_radius_zip" | "model_city" | "cars_site" | "autotrader_site" | "cargurus_site";
};

type MarketPreviewSearchResult = {
  comps: MarketPreviewComparableAd[];
  rawResultCount: number;
  query: string;
  queryLabel: MarketPreviewSearchQuery["label"];
};

const MARKET_PREVIEW_PREFERRED_DOMAINS = [
  "cars.com",
  "autotrader.com",
  "cargurus.com",
  "carfax.com",
  "truecar.com",
] as const;

async function attachMarketPreviewComparables(params: {
  report: RepairIntelligenceReport;
  uploadedAttachments: StoredAttachment[];
  userIntent: string;
  agentTrace?: AgentRetrievalTrace | null;
}): Promise<RepairIntelligenceReport> {
  const dateAccessed = new Date().toISOString().slice(0, 10);
  const inputs = extractMarketPreviewSearchInputs(
    params.report,
    params.uploadedAttachments,
    params.userIntent
  );
  const vehicle = inputs.vehicle;
  const providerConfigured = Boolean(process.env.SERPER_API_KEY?.trim());

  console.info("marketPreview.inputs.extracted", {
    vehicleInputs: {
      year: vehicle?.year,
      make: vehicle?.make,
      model: vehicle?.model,
      trim: vehicle?.trim,
      vin: vehicle?.vin,
      mileage: inputs.mileage,
      ownerZip: inputs.zip,
      state: inputs.state,
    },
    zipSelected: inputs.zip,
    searchRadiusMiles: 150,
    providerConfigured,
  });

  if (!vehicle?.year || !vehicle.make || !vehicle.model) {
    recordMarketPreviewTraceSkipped(
      params.agentTrace,
      "Vehicle identifiers unavailable after estimate links and internal sources were attempted."
    );
    console.info("marketPreview.search.failed", {
      reason: "vehicle_identifiers_missing",
      providerConfigured,
      compCount: 0,
      validPriceCount: 0,
      medianValue: null,
      finalStatus: "failed",
    });
    return {
      ...params.report,
      marketPreviewSearch: {
        attempted: false,
        state: "failed",
        status: "vehicle_identifiers_missing",
        failureReason: "Year, make, and model were not all available for a local comparable search.",
        dateAccessed,
        comparableCount: 0,
        validPriceCount: 0,
        rawResultCount: 0,
      },
      marketPreview: {
        status: "failed",
        comps: [],
        failureReason: "Year, make, and model were not all available for a local comparable search.",
        dateAccessed,
      },
    } as MarketPreviewReport;
  }

  const apiKey = process.env.SERPER_API_KEY?.trim();
  if (!apiKey) {
    recordMarketPreviewTraceSkipped(
      params.agentTrace,
      "Internet search provider unavailable after estimate links and internal sources were attempted."
    );
    console.info("marketPreview.search.failed", {
      reason: "provider_not_configured",
      providerConfigured: false,
      zipSelected: inputs.zip,
      compCount: 0,
      validPriceCount: 0,
      medianValue: null,
      finalStatus: "failed",
    });
    return {
      ...params.report,
      marketPreviewSearch: {
        attempted: true,
        state: "failed",
        status: "provider_not_configured",
        failureReason: "Market Preview unavailable: the live comparable search provider is not configured for this environment.",
        dateAccessed,
        comparableCount: 0,
        validPriceCount: 0,
        rawResultCount: 0,
      },
      marketPreview: {
        status: "failed",
        comps: [],
        failureReason: "Market Preview unavailable: the live comparable search provider is not configured for this environment.",
        dateAccessed,
      },
    } as MarketPreviewReport;
  }

  if (!inputs.zip) {
    recordMarketPreviewTraceSkipped(
      params.agentTrace,
      "Location unavailable after estimate links and internal sources were attempted."
    );
    console.info("marketPreview.search.failed", {
      reason: "location_missing",
      providerConfigured: true,
      vehicle: [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" "),
      compCount: 0,
      validPriceCount: 0,
      medianValue: null,
      finalStatus: "failed",
    });
    return {
      ...params.report,
      marketPreviewSearch: {
        attempted: false,
        state: "failed",
        status: "location_missing",
        failureReason: "Owner or insured ZIP was not available in the uploaded estimate, so a 150-mile local comparable search could not run.",
        dateAccessed,
        comparableCount: 0,
        validPriceCount: 0,
        rawResultCount: 0,
      },
      marketPreview: {
        status: "failed",
        comps: [],
        failureReason: "Owner or insured ZIP was not available in the uploaded estimate, so a 150-mile local comparable search could not run.",
        dateAccessed,
      },
    } as MarketPreviewReport;
  }

  const queries = buildMarketPreviewQueries({ vehicle, zip: inputs.zip, state: inputs.state });
  const baseQuery = queries[0]?.query ?? "";
  const widenedQuery = queries[1]?.query;

  console.info("marketPreview.search.started", {
    query: baseQuery,
    fallbackQueries: queries.slice(1).map((entry) => entry.query),
    providerConfigured: true,
    vehicle: [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" "),
    mileage: inputs.mileage,
    zipSelected: inputs.zip,
    state: inputs.state,
    searchRadiusMiles: 150,
  });
  if (params.agentTrace && areInternalRetrievalPathsResolved(params.agentTrace)) {
    logAgentTraceEvent("web search allowed", params.agentTrace, {
      reason: "Internal sources attempted first",
    });
    logAgentTraceEvent("web search started", params.agentTrace, {
      provider: "market_preview",
    });
  }

  try {
    const searchResult = await runMarketPreviewSearchSequence({
      queries,
      apiKey,
      dateAccessed,
      vehicle,
      fallbackLocation: inputs.zip,
    });
    const selected = dedupeMarketPreviewComparables(searchResult.comps).slice(0, 3);
    const validPrices = selected
      .map((comp) => comp.price ?? comp.askingPrice)
      .filter((price): price is number => typeof price === "number" && Number.isFinite(price) && price > 500)
      .sort((left, right) => left - right);
    const validPriceCount = validPrices.length;
    const medianValue = validPriceCount >= 2 ? computeMarketPreviewMedian(validPrices) : undefined;
    const failedStatus =
      searchResult.comps.length === 0 && searchResult.rawResultCount === 0
        ? "no_results"
        : selected.length === 0 || validPriceCount === 0
          ? "parsing_failed"
          : null;

    if (failedStatus) {
      const failureReason = buildMarketPreviewSearchFailureReason({
        status: failedStatus,
        rawResultCount: searchResult.rawResultCount,
        parsedCompCount: searchResult.comps.length,
        validPriceCount,
        query: searchResult.query,
      });
      console.info("marketPreview.search.failed", {
        reason: failedStatus,
        providerConfigured: true,
        queryUsed: searchResult.query,
        queryLabel: searchResult.queryLabel,
        rawResultCount: searchResult.rawResultCount,
        parsedCompCount: searchResult.comps.length,
        compCount: selected.length,
        validPriceCount,
        medianValue: medianValue ?? null,
        finalStatus: "failed",
      });
      recordMarketPreviewTraceCompleted(params.agentTrace, {
        resultCount: selected.length,
        status: "success",
        reason: "Internal sources attempted first; internet search returned no usable comparable listings.",
      });
      return {
        ...params.report,
        marketPreviewSearch: {
          attempted: true,
          state: "failed",
          status: failedStatus,
          query: baseQuery,
          widenedQuery: searchResult.query !== baseQuery ? searchResult.query : widenedQuery,
          dateAccessed,
          comparableCount: selected.length,
          validPriceCount,
          medianValue,
          rawResultCount: searchResult.rawResultCount,
          failureReason,
        },
        marketPreview: {
          status: "failed",
          comps: selected,
          median: medianValue,
          failureReason,
          dateAccessed,
        },
      } as MarketPreviewReport;
    }

    console.info("marketPreview.search.completed", {
      compCount: selected.length,
      validPriceCount,
      medianValue: medianValue ?? null,
      queryUsed: searchResult.query,
      queryLabel: searchResult.queryLabel,
      providerConfigured: true,
      rawResultCount: searchResult.rawResultCount,
      parsedCompCount: searchResult.comps.length,
      zipSelected: inputs.zip,
      state: inputs.state,
      finalStatus: "completed",
      widened: searchResult.query !== baseQuery,
    });
    recordMarketPreviewTraceCompleted(params.agentTrace, {
      resultCount: selected.length,
      status: "success",
      reason: "Internal sources attempted first.",
    });

    return {
      ...params.report,
      valuationData: {
        ...((params.report as MarketPreviewReport).valuationData ?? {}),
        comparableListings: selected,
      },
      marketPreview: {
        status: "completed",
        comps: selected,
        median: medianValue,
        dateAccessed,
      },
      marketPreviewSearch: {
        attempted: true,
        state: "completed",
        status: "completed",
        query: baseQuery,
        widenedQuery: searchResult.query !== baseQuery ? searchResult.query : widenedQuery,
        dateAccessed,
        comparableCount: selected.length,
        validPriceCount,
        medianValue,
        rawResultCount: searchResult.rawResultCount,
      },
    } as MarketPreviewReport;
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    recordMarketPreviewTraceCompleted(params.agentTrace, {
      resultCount: 0,
      status: "error",
      reason: isTimeout
        ? "Internet search timed out after internal sources were attempted."
        : "Internet search failed after internal sources were attempted.",
    });
    console.info("marketPreview.search.failed", {
      reason: isTimeout ? "timeout" : "failed",
      providerConfigured: true,
      queryUsed: baseQuery,
      rawResultCount: 0,
      parsedCompCount: 0,
      compCount: 0,
      validPriceCount: 0,
      medianValue: null,
      finalStatus: "failed",
      message: error instanceof Error ? error.message : "Unknown market preview search failure",
    });
    return {
      ...params.report,
      marketPreviewSearch: {
        attempted: true,
        state: "failed",
        status: isTimeout ? "timeout" : "failed",
        query: baseQuery,
        dateAccessed,
        comparableCount: 0,
        validPriceCount: 0,
        rawResultCount: 0,
        failureReason: isTimeout
          ? "Market comparable search timed out before usable results were returned."
          : error instanceof Error ? error.message : "Live comparable search failed.",
      },
      marketPreview: {
        status: "failed",
        comps: [],
        failureReason: isTimeout
          ? "Market comparable search timed out before usable results were returned."
          : error instanceof Error ? error.message : "Live comparable search failed.",
        dateAccessed,
      },
    } as MarketPreviewReport;
  }
}

function buildMarketPreviewQueries(params: {
  vehicle: VehicleIdentity;
  zip: string;
  state?: string;
}): MarketPreviewSearchQuery[] {
  const trimIdentity = [
    params.vehicle.year,
    params.vehicle.make,
    params.vehicle.model,
    params.vehicle.trim,
  ].filter(Boolean).join(" ");
  const modelIdentity = [
    params.vehicle.year,
    params.vehicle.make,
    params.vehicle.model,
  ].filter(Boolean).join(" ");
  const cityState = resolveMarketPreviewCityState(params.zip, params.state);

  return [
    { label: "trim_zip", query: `${trimIdentity} for sale ${params.zip}` },
    { label: "trim_radius_zip", query: `${trimIdentity} for sale within 150 miles of ${params.zip}` },
    { label: "model_city", query: `${modelIdentity} for sale near ${cityState}` },
    { label: "cars_site", query: `site:cars.com ${trimIdentity} for sale ${params.zip}` },
    { label: "autotrader_site", query: `site:autotrader.com ${trimIdentity} for sale ${params.zip}` },
    { label: "cargurus_site", query: `site:cargurus.com ${trimIdentity} for sale ${params.zip}` },
  ];
}

function recordMarketPreviewTraceSkipped(
  trace: AgentRetrievalTrace | null | undefined,
  reason: string
) {
  if (!trace || !areInternalRetrievalPathsResolved(trace)) return;

  logAgentTraceEvent("web search allowed", trace, {
    reason: "Internal sources attempted first",
  });
  recordAgentRetrievalStep(trace, {
    order: 3,
    tool: "web_search",
    action: "internet_search",
    resultCount: 0,
    status: "skipped",
    reason,
  });
}

function recordMarketPreviewTraceCompleted(
  trace: AgentRetrievalTrace | null | undefined,
  params: {
    resultCount: number;
    status: "success" | "error";
    reason: string;
  }
) {
  if (!trace || !areInternalRetrievalPathsResolved(trace)) return;

  recordAgentRetrievalStep(trace, {
    order: 3,
    tool: "web_search",
    action: "internet_search",
    resultCount: params.resultCount,
    status: params.status,
    reason: params.reason,
  });
}

function resolveMarketPreviewCityState(zip: string, state?: string): string {
  if (zip === "19380") return "West Chester PA";
  if (zip === "19096") return "Wynnewood PA";
  return state ? `${zip} ${state}` : zip;
}

function buildMarketPreviewSearchFailureReason(params: {
  status: "no_results" | "parsing_failed";
  rawResultCount: number;
  parsedCompCount: number;
  validPriceCount: number;
  query: string;
}): string {
  if (params.status === "no_results") {
    return `Market Preview unavailable: live search returned no organic results for "${params.query}".`;
  }

  if (params.parsedCompCount > 0 && params.validPriceCount === 0) {
    return `Market Preview unavailable: live search returned ${params.rawResultCount} organic result(s) and ${params.parsedCompCount} active vehicle listing(s), but none had a usable asking price after parsing title, snippet, rich snippets, and sitelinks.`;
  }

  return `Market Preview unavailable: live search returned ${params.rawResultCount} organic result(s), but no active vehicle-for-sale listing with a usable asking price remained after filtering parts pages, repair articles, review pages, and inactive auction/history results.`;
}

async function runMarketPreviewSearchSequence(params: {
  queries: MarketPreviewSearchQuery[];
  apiKey: string;
  dateAccessed: string;
  vehicle: VehicleIdentity;
  fallbackLocation?: string;
}): Promise<MarketPreviewSearchResult> {
  let bestResult: MarketPreviewSearchResult | null = null;

  for (const query of params.queries) {
    console.info("marketPreview.serper.query", {
      query: query.query,
      queryLabel: query.label,
      vehicle: [params.vehicle.year, params.vehicle.make, params.vehicle.model, params.vehicle.trim].filter(Boolean).join(" "),
      searchRadiusMiles: 150,
    });
    const result = await runMarketPreviewSearch(
      query,
      params.apiKey,
      params.dateAccessed,
      params.vehicle,
      params.fallbackLocation
    );

    console.info("marketPreview.serper.result", {
      query: query.query,
      queryLabel: query.label,
      rawOrganicResultCount: result.rawResultCount,
      parsedCompCount: result.comps.length,
    });

    if (!bestResult || result.comps.length > bestResult.comps.length) {
      bestResult = result;
    }

    if (result.comps.length >= 3) {
      return result;
    }
  }

  return bestResult ?? {
    comps: [],
    rawResultCount: 0,
    query: params.queries[0]?.query ?? "",
    queryLabel: params.queries[0]?.label ?? "trim_zip",
  };
}

async function runMarketPreviewSearch(
  searchQuery: MarketPreviewSearchQuery,
  apiKey: string,
  dateAccessed: string,
  vehicle: VehicleIdentity,
  fallbackLocation?: string
): Promise<MarketPreviewSearchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({ q: searchQuery.query, num: 10 }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`Market comparable search failed with status ${response.status}.`);
  }

  const payload = await response.json();
  const organic: unknown[] = Array.isArray(payload?.organic) ? payload.organic : [];
  const comps = organic
    .map((item: unknown) => parseMarketPreviewComparable(item, dateAccessed, vehicle, fallbackLocation))
    .filter((item: MarketPreviewComparableAd | null): item is MarketPreviewComparableAd => Boolean(item));
  return {
    comps,
    rawResultCount: organic.length,
    query: searchQuery.query,
    queryLabel: searchQuery.label,
  };
}

function parseMarketPreviewComparable(
  item: unknown,
  dateAccessed: string,
  vehicle: VehicleIdentity,
  fallbackLocation?: string
): MarketPreviewComparableAd | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title : "";
  const link = typeof record.link === "string" ? record.link : undefined;
  const source = extractHostname(link) ?? "web search result";
  const text = collectMarketPreviewResultText(record);
  if (!isLikelyActiveVehicleListing({ text, title, source, url: link, vehicle })) {
    return null;
  }

  const price = extractMarketPreviewPrice(text, source);
  if (typeof price !== "number") return null;

  return {
    price,
    askingPrice: price,
    mileage: extractMileage(text),
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim,
    source,
    title,
    location: extractListingLocation(text) ?? fallbackLocation,
    url: link,
    dateAccessed,
  };
}

function collectMarketPreviewResultText(value: unknown, depth = 0): string {
  if (depth > 4 || value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    return value.map((entry) => collectMarketPreviewResultText(entry, depth + 1)).join(" ");
  }
  if (typeof value !== "object") return "";

  return Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/image|thumbnail|position|cached|favicon/i.test(key))
    .map(([, entry]) => collectMarketPreviewResultText(entry, depth + 1))
    .join(" ");
}

function isLikelyActiveVehicleListing(params: {
  text: string;
  title: string;
  source: string;
  url?: string;
  vehicle: VehicleIdentity;
}): boolean {
  const text = `${params.title} ${params.text} ${params.url ?? ""}`.toLowerCase();
  const preferredDomain = isPreferredMarketPreviewDomain(params.source);
  const dealershipDomain = isLikelyDealershipDomain(params.source);
  const hasVehicle =
    containsNormalizedToken(text, String(params.vehicle.year ?? "")) &&
    containsNormalizedToken(text, params.vehicle.make ?? "") &&
    containsNormalizedToken(text, params.vehicle.model ?? "");
  const hasSaleSignal = /\b(for sale|used|new|inventory|listing|listings|vehicle details|cars for sale|available|stock #?|vin)\b/i.test(text);
  const rejected =
    /\b(parts?|accessor(?:y|ies)|repair|recall|review|reviews|article|news|specs?|forum|manual|warranty|tire|wheel|bumper|door|hood|fender)\b/i.test(text) &&
    !/\b(for sale|inventory|listing|vehicle details|stock #?|vin)\b/i.test(text);
  const auctionHistory =
    /\b(auction|bid history|sold for|sale history|copart|iaai)\b/i.test(text) &&
    !/\b(for sale|available|current bid|buy now|inventory)\b/i.test(text);

  if (rejected || auctionHistory) return false;
  return hasVehicle && hasSaleSignal && (preferredDomain || dealershipDomain || /\b(price|mileage|odometer|\$)\b/i.test(text));
}

function containsNormalizedToken(text: string, token: string): boolean {
  const normalized = token.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized) return true;
  return text.replace(/[^a-z0-9]+/g, " ").includes(normalized);
}

function isPreferredMarketPreviewDomain(source: string): boolean {
  return MARKET_PREVIEW_PREFERRED_DOMAINS.some((domain) => source.toLowerCase().endsWith(domain));
}

function isLikelyDealershipDomain(source: string): boolean {
  return /\b(auto|cars?|jeep|chrysler|dodge|ram|dealer|motors|inventory)\b/i.test(source);
}

function extractHostname(link?: string): string | undefined {
  if (!link) return undefined;
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function dedupeMarketPreviewComparables(comps: MarketPreviewComparableAd[]) {
  const seen = new Set<string>();
  return comps.filter((comp) => {
    const key = `${comp.url ?? ""}|${comp.title}|${comp.price}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractMarketPreviewSearchInputs(
  report: RepairIntelligenceReport,
  attachments: StoredAttachment[],
  userIntent: string
): MarketPreviewSearchInputs {
  const text = [userIntent, report.sourceEstimateText, ...attachments.map((attachment) => attachment.text)].join("\n");
  const structuredVehicle = mergeVehicleIdentity(
    normalizeVehicleIdentity(report.estimateFacts?.vehicle),
    normalizeVehicleIdentity(report.analysis?.estimateFacts?.vehicle),
    normalizeVehicleIdentity(report.analysis?.vehicle),
    normalizeVehicleIdentity(report.vehicle)
  );
  const facts = extractEstimateFacts({ text, vehicle: structuredVehicle });
  const zip = selectOwnerOrInsuredZip(text);

  const vehicle = normalizeMarketPreviewVehicle(
    normalizeVehicleIdentity(
      mergeVehicleIdentity(
        normalizeVehicleIdentity(report.vehicle),
        normalizeVehicleIdentity(report.analysis?.vehicle),
        normalizeVehicleIdentity(report.estimateFacts?.vehicle),
        normalizeVehicleIdentity(report.analysis?.estimateFacts?.vehicle),
        normalizeVehicleIdentity(facts.vehicle)
      )
    ),
    text
  );

  return {
    vehicle,
    mileage:
      report.estimateFacts?.mileage ??
      report.analysis?.estimateFacts?.mileage ??
      facts.mileage ??
      extractMileage(text),
    zip,
    state: extractMarketPreviewState(text, zip),
  };
}

function normalizeMarketPreviewVehicle(
  vehicle: VehicleIdentity | null | undefined,
  text: string
): VehicleIdentity | null {
  const normalized = normalizeVehicleIdentity(vehicle);
  if (!normalized) return null;
  const next: VehicleIdentity = {
    ...normalized,
    vin: normalized.vin ?? extractVinFromTextForMarketPreview(text),
  };

  const model = next.model?.trim();
  const trim = next.trim?.trim();
  if (/^gladiator\s+sport\b/i.test(model ?? "")) {
    next.model = "Gladiator";
    next.trim = trim || model?.replace(/^gladiator\s+/i, "").trim() || "Sport";
  } else if (/^gladiator$/i.test(model ?? "") && !trim) {
    const cccGladiator = text.match(/\b20\d{2}\s+JEEP\s+Gladiator\s+([A-Za-z0-9][A-Za-z0-9 /-]{1,30})/i)?.[1]?.trim();
    if (cccGladiator) {
      next.trim = cccGladiator.replace(/\s+(?:VIN|Mileage|Odometer)\b.*$/i, "").trim();
    }
  }

  return next;
}

function extractVinFromTextForMarketPreview(text: string): string | undefined {
  const vin = text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i)?.[0]?.toUpperCase();
  return vin;
}

function selectOwnerOrInsuredZip(text: string): string | undefined {
  const candidates: Array<{ zip: string; score: number; index: number }> = [];
  const regex = /\b\d{5}(?:-\d{4})?\b/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const zip = match[0].slice(0, 5);
    if (!resolveStateFromZip(zip)) continue;
    const index = match.index;
    const context = text.slice(Math.max(0, index - 180), Math.min(text.length, index + 180)).toLowerCase();
    let score = 10;
    if (/\b(owner|insured|claimant|customer|vehicle owner|policyholder)\b/.test(context)) score += 100;
    if (/\b(repair facility|repair shop|body shop|collision center|appraiser|estimator|supplement|facility)\b/.test(context)) score -= 75;
    if (/\b(zip|postal|address|city|state)\b/.test(context)) score += 10;
    candidates.push({ zip, score, index });
  }

  if (candidates.length === 0) return undefined;
  candidates.sort((left, right) => right.score - left.score || left.index - right.index);
  return candidates[0]?.zip;
}

function extractMarketPreviewState(text: string, zip?: string): string | undefined {
  if (zip) {
    return resolveStateFromZip(zip) ?? undefined;
  }

  return text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/)?.[1];
}

function computeMarketPreviewMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const midpoint = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? values[midpoint]
    : Math.round((values[midpoint - 1] + values[midpoint]) / 2);
}

function extractMarketPreviewPrice(value: string, source: string): number | undefined {
  const currency = extractCurrency(value);
  if (typeof currency === "number") return currency;

  if (!isPreferredMarketPreviewDomain(source) && !isLikelyDealershipDomain(source)) {
    return undefined;
  }

  const candidates = [
    ...value.matchAll(
      /\b(?:price|sale price|internet price|asking price|list price|dealer price|our price)\D{0,32}([1-9]\d{1,2}[,\s]?\d{3}|[1-9]\d{4,5})\b/gi
    ),
  ]
    .map((match) => parseMarketPreviewPriceNumber(match[1]))
    .filter((price): price is number => typeof price === "number" && price >= 5000 && price <= 250000);

  if (candidates[0]) return candidates[0];

  const plainCandidates = [...value.matchAll(/\b([1-9]\d{1,2}[,\s]?\d{3}|[1-9]\d{4,5})\b/g)]
    .map((match) => {
      const index = match.index ?? 0;
      const context = value.slice(Math.max(0, index - 24), Math.min(value.length, index + 36));
      return {
        price: parseMarketPreviewPriceNumber(match[1]),
        context,
      };
    })
    .filter((candidate) =>
      typeof candidate.price === "number" &&
      candidate.price >= 15000 &&
      candidate.price <= 250000 &&
      !/\b(mi|mile|miles|odometer)\b/i.test(candidate.context)
    )
    .map((candidate) => candidate.price);

  return plainCandidates[0];
}

function extractCurrency(value: string): number | undefined {
  const match = value.match(/\$\s*([0-9][0-9,\s]{3,})(?:\.\d{2})?/);
  if (!match) return undefined;
  const parsed = parseMarketPreviewPriceNumber(match[1]);
  return typeof parsed === "number" && parsed >= 5000 && parsed <= 250000 ? parsed : undefined;
}

function parseMarketPreviewPriceNumber(value: string): number | undefined {
  const parsed = Number(value.replace(/[\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractMileage(value: string): number | undefined {
  const match = value.match(/\b([0-9][0-9,]{2,6})\s*(?:mi|mile|miles|odometer)\b/i);
  if (!match) return undefined;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractListingLocation(value: string): string | undefined {
  return value.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?,\s*[A-Z]{2}\b/)?.[0];
}

function applyLinkedEvidenceToReport(params: {
  report: RepairIntelligenceReport;
  uploadedAttachments: StoredAttachment[];
  linkedEvidence: LinkedEvidence[];
  activeCaseId?: string | null;
  previousReport?: RepairIntelligenceReport | null;
  userIntent?: string | null;
  uploadLimitReached?: boolean;
  totalUploadedFileCount?: number;
  reviewProgress?: AnalysisRequestBody["reviewProgress"];
}): RepairIntelligenceReport {
  const evidenceCorpus = buildEvidenceCorpus({
    estimateText: params.report.sourceEstimateText ?? "",
    files: params.uploadedAttachments.map((attachment) => ({
      name: attachment.filename,
      text: attachment.text,
      summary: null,
    })),
    linkedEvidence: params.linkedEvidence,
  });
  const evidenceRegistry = mergeEvidenceRegistry(
    params.previousReport?.evidenceRegistry ?? [],
    buildCaseEvidenceRegistry({
      uploadedAttachments: params.uploadedAttachments,
      linkedEvidence: params.linkedEvidence,
      issueKeys: params.report.issues.map((issue) => issue.id),
    })
  );
  const operationContext = [
    params.report.sourceEstimateText ?? "",
    ...params.uploadedAttachments.map((attachment) => `${attachment.filename}\n${attachment.text}`),
  ].join("\n\n");
  const issues = normalizeIssuesForEstimateOperations(
    augmentIssuesWithEvidenceRegistry(
    mergeIssueAssessments(
      params.previousReport?.issues ?? [],
      params.report.issues,
      evidenceRegistry
    ),
    evidenceRegistry
    ),
    operationContext
  );
  const reassessmentMode = params.activeCaseId ? "active_case_update" : "new_case";
  const reassessmentDelta = buildReassessmentDelta({
    previousReport: params.previousReport ?? null,
    nextIssues: issues,
    nextEvidenceRegistry: evidenceRegistry,
    nextDetermination: params.report.recommendedActions[0] ?? "",
  });
  const uploadedEvidenceCount = evidenceRegistry.filter((item) => item.ingestionState === "uploaded").length;
  const indexedEvidenceCount = evidenceRegistry.filter((item) =>
    ["uploaded", "ingested"].includes(item.ingestionState)
  ).length;
  const visionProcessedEvidenceCount = evidenceRegistry.filter(
    (item) => item.evidenceStatus === "VISIBLE_IN_IMAGES"
  ).length;
  const uploadedFileCount = Math.max(
    params.totalUploadedFileCount ?? 0,
    params.reviewProgress?.uploaded ?? 0,
    params.previousReport?.ingestionMeta?.uploadedFileCount ?? 0,
    uploadedEvidenceCount,
    params.uploadedAttachments.length
  );
  const indexedFileCount = Math.max(
    params.reviewProgress?.indexed ?? 0,
    params.previousReport?.ingestionMeta?.indexedFileCount ?? 0,
    indexedEvidenceCount,
    uploadedFileCount
  );
  const visionProcessedFileCount = Math.max(
    params.reviewProgress?.visionProcessed ?? 0,
    params.previousReport?.ingestionMeta?.visionProcessedFileCount ?? 0,
    visionProcessedEvidenceCount
  );
  const fileReviewLedger = buildFileReviewLedger(params.uploadedAttachments, {
    usedInRepairIntelligenceIds: params.uploadedAttachments.map((attachment) => attachment.id),
  });
  const evidenceCompletenessLedger = resolveEvidenceCompletenessFromLedger({
    ledger: fileReviewLedger,
    evidenceRegistry,
    corpus: [
      params.report.missingProcedures.join("\n"),
      params.report.recommendedActions.join("\n"),
      params.report.issues.map((issue) => `${issue.title} ${issue.finding} ${issue.impact}`).join("\n"),
      params.report.findingReasoning?.map((finding) => `${finding.issue} ${finding.what_proves_it} ${finding.next_action}`).join("\n"),
    ].filter(Boolean).join("\n"),
  });
  const reviewabilityDiagnostics = buildUploadedReviewabilityDiagnostics(params.uploadedAttachments, fileReviewLedger);
  const reviewedFileCount = Math.max(uploadedEvidenceCount, reviewabilityDiagnostics.reviewableFileCount);
  const reviewProgressCounts = normalizeReviewProgressCounts({
    uploadedCount: uploadedFileCount,
    indexedCount: indexedFileCount,
    visionProcessedCount: visionProcessedFileCount,
    reviewedFileCount,
    reviewableFileCount:
      params.reviewProgress?.reviewableFileCount ??
      params.previousReport?.ingestionMeta?.reviewableFileCount ??
      reviewabilityDiagnostics.reviewableFileCount,
    excludedFromReviewCount: reviewabilityDiagnostics.excludedFiles.length,
    excludedFromReviewReasons: reviewabilityDiagnostics.excludedReasons,
    excludedFromReviewFiles: reviewabilityDiagnostics.excludedFiles,
  });
  const totalKnownFileCount = Math.max(
    params.reviewProgress?.totalKnownFiles ?? 0,
    params.previousReport?.ingestionMeta?.totalKnownFileCount ?? 0,
    uploadedFileCount,
    indexedFileCount,
    reviewedFileCount,
    reviewProgressCounts.reviewableFileCount
  );

  const nextReport: RepairIntelligenceReport = {
    ...params.report,
    issues,
    sourceEstimateText: evidenceCorpus || params.report.sourceEstimateText,
    cccWorkfileContext: buildMergedCccWorkfileReportContext(
      params.previousReport?.cccWorkfileContext,
      params.uploadedAttachments
    ),
    linkedEvidence: mergeLinkedEvidence(
      params.previousReport?.linkedEvidence ?? [],
      params.linkedEvidence
    ),
    evidenceRegistry,
    reassessmentDelta,
    ingestionMeta: {
      linkedEvidenceCount: params.linkedEvidence.length,
      linkedEvidenceFetchedAt: new Date().toISOString(),
      activeCaseId: params.activeCaseId ?? undefined,
      active: true,
      reassessedAt: new Date().toISOString(),
      reassessmentMode,
      uploadedFileCount,
      indexedFileCount,
      visionProcessedFileCount,
      reviewedFileCount,
      reviewableFileCount: reviewProgressCounts.reviewableFileCount,
      excludedFromReviewCount: reviewProgressCounts.excludedFromReviewCount,
      excludedFromReviewReasons: reviewProgressCounts.excludedFromReviewReasons,
      excludedFromReviewFiles: reviewProgressCounts.excludedFromReviewFiles,
      fileReviewLedger,
      evidenceCompletenessLedger,
      totalKnownFileCount,
      uploadLimitReached: Boolean(params.uploadLimitReached),
      userIndicatedMoreFiles: userIndicatedMoreFiles(params.userIntent ?? ""),
    },
    evidence: mergeLinkedEvidenceRecords(params.report.evidence, params.linkedEvidence),
  };
  const factualCore = buildSharedFactualCore({
    report: nextReport,
    evidenceRegistry,
    activeCaseId: params.activeCaseId ?? undefined,
    mode: reassessmentMode,
  });
  const artifactRefreshPolicy = buildArtifactRefreshPolicy({
    report: nextReport,
    factualCore,
    delta: reassessmentDelta,
  });

  return {
    ...nextReport,
    factualCore,
    artifactRefreshPolicy,
  };
}

function userIndicatedMoreFiles(value: string): boolean {
  return /\b(more|additional|other|another|rest of|remaining)\s+(files?|documents?|photos?|estimates?|invoices?)\b|\b(can'?t|cannot|unable to|won'?t let me)\s+upload\b|\bupload limit\b|\btoo many files\b/i.test(value);
}

function isContextLengthExceededError(error: unknown) {
  const top = error && typeof error === "object" ? error as Record<string, unknown> : null;
  const nested = top?.error && typeof top.error === "object" ? top.error as Record<string, unknown> : null;
  const code = String(top?.code ?? nested?.code ?? top?.type ?? nested?.type ?? "").toLowerCase();
  const message = String(top?.message ?? nested?.message ?? (error instanceof Error ? error.message : "")).toLowerCase();
  return code.includes("context_length_exceeded") ||
    code.includes("context_length") ||
    /context (?:window|length)|input exceeds|too many tokens|max(?:imum)? context/.test(message);
}

function prioritizeEstimateGapAttachments(
  attachments: StoredAttachment[],
  userIntent: string
): StoredAttachment[] {
  if (!isEstimateGapIntent(userIntent)) return attachments;

  return [...attachments].sort(
    (a, b) => getEstimateGapPriority(a.filename) - getEstimateGapPriority(b.filename)
  );
}

function isEstimateGapIntent(value: string) {
  return /\b(estimate\s*gap|gap\s*analysis|compare|comparison|shop\s+estimate|carrier\s+estimate|supplement|sor)\b/i.test(value);
}

function getEstimateGapPriority(filename: string) {
  if (/^shop\s*21548\.pdf$/i.test(filename.trim())) return 0;
  if (/^sor3\.pdf$/i.test(filename.trim())) return 1;
  if (isEstimateOrRepairSupportPdf(filename, "")) return 2;
  return 3;
}

function buildReviewProgressPayload(
  report: RepairIntelligenceReport,
  artifactIds: string[]
) {
  const uploadedEvidenceCount =
    report.evidenceRegistry?.filter((item) => item.ingestionState === "uploaded").length ?? 0;
  const indexedEvidenceCount =
    report.evidenceRegistry?.filter((item) =>
      ["uploaded", "ingested"].includes(item.ingestionState)
    ).length ?? uploadedEvidenceCount;
  const visionProcessedEvidenceCount =
    report.evidenceRegistry?.filter((item) => item.evidenceStatus === "VISIBLE_IN_IMAGES").length ?? 0;
  const uploaded = Math.max(
    report.ingestionMeta?.uploadedFileCount ?? 0,
    artifactIds.length,
    uploadedEvidenceCount
  );
  const indexed = Math.max(
    report.ingestionMeta?.indexedFileCount ?? 0,
    indexedEvidenceCount,
    uploadedEvidenceCount
  );
  const visionProcessed = Math.max(
    report.ingestionMeta?.visionProcessedFileCount ?? 0,
    visionProcessedEvidenceCount
  );
  const reviewedForDetermination = Math.max(
    report.ingestionMeta?.reviewedFileCount ?? 0,
    uploadedEvidenceCount
  );
  const reviewProgressCounts = normalizeReviewProgressCounts({
    uploadedCount: uploaded,
    indexedCount: indexed,
    visionProcessedCount: visionProcessed,
    reviewedFileCount: reviewedForDetermination,
    reviewableFileCount: report.ingestionMeta?.reviewableFileCount,
    excludedFromReviewCount: report.ingestionMeta?.excludedFromReviewCount,
    excludedFromReviewReasons: report.ingestionMeta?.excludedFromReviewReasons,
    excludedFromReviewFiles: report.ingestionMeta?.excludedFromReviewFiles,
  });
  const totalKnownFiles = Math.max(
    report.ingestionMeta?.totalKnownFileCount ?? 0,
    uploaded,
    indexed,
    reviewedForDetermination,
    reviewProgressCounts.reviewableFileCount
  );

  return {
    uploaded,
    indexed,
    visionProcessed,
    reviewedForDetermination,
    reviewableFileCount: reviewProgressCounts.reviewableFileCount,
    excludedFromReviewCount: reviewProgressCounts.excludedFromReviewCount,
    excludedFromReviewReasons: reviewProgressCounts.excludedFromReviewReasons,
    excludedFromReviewFiles: reviewProgressCounts.excludedFromReviewFiles,
    totalKnownFiles,
  };
}

function buildCaseEvidenceRegistry(params: {
  uploadedAttachments: StoredAttachment[];
  linkedEvidence: LinkedEvidence[];
  issueKeys: string[];
}): CaseEvidenceRegistryItem[] {
  const now = new Date().toISOString();
  const uploaded = params.uploadedAttachments.map((attachment) => {
    const sourceType = classifyUploadedEvidenceSource(attachment);
    const extractedSummary =
      sourceType === "invoice" || sourceType === "sublet_document"
        ? summarizeInvoiceFacts(extractInvoiceFacts(attachment, sourceType))
        : sourceType === "policy_document"
          ? summarizePolicyFacts(extractPolicyFacts(attachment))
        : undefined;

    return {
      id: attachment.id,
      sourceType,
      label: attachment.filename,
      extractedText: attachment.text,
      extractedSummary,
      structuredFacts:
        sourceType === "invoice" || sourceType === "sublet_document"
          ? extractInvoiceFacts(attachment, sourceType)
          : sourceType === "policy_document"
            ? extractPolicyFacts(attachment)
          : undefined,
      ingestionState: "uploaded" as const,
      evidenceStatus: attachment.type.startsWith("image/")
        ? ("VISIBLE_IN_IMAGES" as const)
        : isCccUploadClassification(attachment.classification ?? "text")
          ? ("DOCUMENTED" as const)
        : ("DOCUMENTED" as const),
      relatedIssueKeys: inferEvidenceIssueKeys({
        text: `${attachment.filename}\n${attachment.text}`,
        sourceType,
        issueKeys: params.issueKeys,
      }),
      createdAt: now,
      updatedAt: now,
    };
  });
  const linked = params.linkedEvidence.map((doc, index) => ({
    id: `linked:${index + 1}`,
    sourceType: classifyLinkedEvidenceSource(doc),
    label: doc.title || `Linked supporting document ${index + 1}`,
    extractedText: doc.status === "ok" ? redactExternalDocumentUrls(doc.text) : undefined,
    linkedUrl: undefined,
    ingestionState:
      doc.status === "ok"
        ? ("ingested" as const)
        : doc.status === "blocked"
          ? ("access_limited" as const)
          : doc.status === "skipped"
            ? ("skipped" as const)
            : ("failed" as const),
    evidenceStatus:
      doc.status === "ok"
        ? ("DOCUMENTED" as const)
        : ("REFERENCED_NOT_PRODUCED" as const),
    relatedIssueKeys: inferEvidenceIssueKeys({
      text: `${doc.title ?? ""}\n${doc.text}`,
      sourceType: classifyLinkedEvidenceSource(doc),
      issueKeys: params.issueKeys,
    }),
    createdAt: now,
    updatedAt: now,
  }));

  return [...uploaded, ...linked];
}

function mergeEvidenceRegistry(
  previous: CaseEvidenceRegistryItem[],
  next: CaseEvidenceRegistryItem[]
): CaseEvidenceRegistryItem[] {
  const merged = new Map<string, CaseEvidenceRegistryItem>();

  for (const item of previous) {
    merged.set(item.id, item);
  }

  for (const item of next) {
    const existing = merged.get(item.id);
    if (!existing) {
      merged.set(item.id, item);
      continue;
    }

    merged.set(item.id, {
      ...existing,
      ...item,
      createdAt: existing.createdAt,
      updatedAt: item.updatedAt,
      evidenceStatus: strongestEvidenceStatus(existing.evidenceStatus, item.evidenceStatus),
      relatedIssueKeys: dedupeStrings([
        ...existing.relatedIssueKeys,
        ...item.relatedIssueKeys,
      ]),
      extractedText: item.extractedText ?? existing.extractedText,
      extractedSummary: item.extractedSummary ?? existing.extractedSummary,
      structuredFacts: item.structuredFacts ?? existing.structuredFacts,
      linkedUrl: undefined,
    });
  }

  return [...merged.values()].map((item) => ({
    ...item,
    linkedUrl: undefined,
    extractedText: item.extractedText ? redactExternalDocumentUrls(item.extractedText) : undefined,
    extractedSummary: item.extractedSummary
      ? redactExternalDocumentUrls(item.extractedSummary)
      : undefined,
  }));
}

function mergeIssueAssessments(
  previous: RepairIntelligenceReport["issues"],
  next: RepairIntelligenceReport["issues"],
  evidenceRegistry: CaseEvidenceRegistryItem[]
): RepairIntelligenceReport["issues"] {
  const merged = new Map<string, RepairIntelligenceReport["issues"][number]>();

  for (const issue of previous) {
    merged.set(normalizeIssueKey(issue), issue);
  }

  for (const issue of next) {
    const key = normalizeIssueKey(issue);
    const existing = merged.get(key);
    const relatedEvidenceIds = evidenceRegistry
      .filter((item) => item.relatedIssueKeys.includes(issue.id))
      .map((item) => item.id);

    if (!existing) {
      merged.set(key, {
        ...issue,
        evidenceIds: dedupeStrings([...issue.evidenceIds, ...relatedEvidenceIds]),
      });
      continue;
    }

    const evidenceStatus = strongestEvidenceStatus(
      existing.evidenceStatus,
      issue.evidenceStatus
    );

    merged.set(key, {
      ...existing,
      ...issue,
      severity: strongestSeverity(existing.severity, issue.severity),
      evidenceStatus,
      evidenceIds: dedupeStrings([
        ...existing.evidenceIds,
        ...issue.evidenceIds,
        ...relatedEvidenceIds,
      ]),
      impact:
        evidenceStatus === existing.evidenceStatus && existing.impact
          ? existing.impact
          : issue.impact,
    });
  }

  return [...merged.values()];
}

function augmentIssuesWithEvidenceRegistry(
  issues: RepairIntelligenceReport["issues"],
  evidenceRegistry: CaseEvidenceRegistryItem[]
): RepairIntelligenceReport["issues"] {
  const merged = new Map<string, RepairIntelligenceReport["issues"][number]>();

  for (const issue of issues) {
    merged.set(normalizeText(issue.id), issue);
  }

  for (const item of evidenceRegistry) {
    for (const key of item.relatedIssueKeys) {
      const normalizedKey = normalizeText(key);
      const existing = merged.get(normalizedKey);
      const definition = getEvidenceDerivedIssueDefinition(key, item);
      if (!definition) continue;

      if (existing) {
        merged.set(normalizedKey, {
          ...existing,
          evidenceStatus: strongestEvidenceStatus(
            existing.evidenceStatus,
            definition.evidenceStatus
          ),
          severity: strongestSeverity(existing.severity, definition.severity),
          evidenceIds: dedupeStrings([...existing.evidenceIds, item.id]),
        });
        continue;
      }

      merged.set(normalizedKey, {
        ...definition,
        evidenceIds: [item.id],
      });
    }
  }

  return [...merged.values()];
}

function normalizeIssuesForEstimateOperations(
  issues: RepairIntelligenceReport["issues"],
  estimateText: string
): RepairIntelligenceReport["issues"] {
  if (!estimateText.trim()) {
    return dedupeIssueFamilies(issues.map((issue) => ({
      ...issue,
      basisTier: issue.basisTier ?? issue.evidenceStatus ?? "SUPPORTABLE_BUT_UNCONFIRMED",
    })));
  }

  return dedupeIssueFamilies(
    issues.flatMap((issue) => normalizeIssueForEstimateOperations(issue, estimateText))
  );
}

function normalizeIssueForEstimateOperations(
  issue: RepairIntelligenceReport["issues"][number],
  estimateText: string
): RepairIntelligenceReport["issues"] {
  const issueWithBasis = {
    ...issue,
    basisTier: issue.basisTier ?? issue.evidenceStatus ?? "SUPPORTABLE_BUT_UNCONFIRMED",
  };
  const text = `${issue.id} ${issue.title} ${issue.finding} ${issue.impact} ${issue.missingOperation ?? ""}`;
  const lower = text.toLowerCase();
  const impactZone = deriveImpactZone({ text: estimateText });
  const normalizedImpact = impactZone.primary === "rear"
    ? issue.impact.replace(/\bfront-end damage\b/gi, "rear-area damage")
    : issue.impact;
  const sideImpactWithoutFrontSupport =
    isSideImpactZone(impactZone) &&
    impactZone.confidence !== "low" &&
    !hasFrontSupportZoneEvidence(estimateText);

  if (
    sideImpactWithoutFrontSupport &&
    /(front support|front-end|mounting geometry|hidden mounting|teardown growth)/i.test(text)
  ) {
    return [
      {
        ...issue,
        basisTier: issueWithBasis.basisTier,
        id: issue.id === "FRONT_SUPPORT_HIDDEN_DAMAGE_POTENTIAL"
          ? "SIDE_STRUCTURE_APERTURE_VERIFICATION"
          : issue.id,
        title: "Side Structure / Aperture Fit Verification",
        finding: rewriteAsDocumentationFollowUp(
          issue.finding,
          "The stored estimate and supplement indicate a side-impact repair pattern."
        ),
        impact:
          "The open verification concern should track the documented side structure, aperture, door-shell, quarter, roof-rail, closure, and sealing repair path rather than a generic front-end mounting-geometry assumption.",
        missingOperation: undefined,
        evidenceStatus:
          issue.evidenceStatus === "DOCUMENTED"
            ? issue.evidenceStatus
            : "OPEN_PENDING_FURTHER_DOCUMENTATION",
      },
    ];
  }

  if (
    /(headlamp|headlight|lamp).*\baim|aim.*(headlamp|headlight|lamp)/i.test(text) &&
    (isOperationAlreadyRepresented(estimateText, "headlamp_aim") ||
      isOperationAlreadyRepresented(estimateText, "fog_lamp_aim"))
  ) {
    return [];
  }

  if (/(suspension|wheel[-\s]?area|steering|alignment)/i.test(text)) {
    const represented =
      isOperationAlreadyRepresented(estimateText, "alignment") ||
      isOperationAlreadyRepresented(estimateText, "suspension_steering");
    if (represented && /missing|not represented|absent|does not document/i.test(text)) {
      return [
        {
          ...issue,
          basisTier: issueWithBasis.basisTier,
          title: "Suspension / Alignment Documentation Follow-Up",
          finding: rewriteAsDocumentationFollowUp(issue.finding, "Suspension, steering, or alignment work is represented in the estimate."),
          impact:
            "Suspension, steering, or alignment operations are represented in the estimate; remaining concern is limited to completion documentation or final records if not produced.",
          missingOperation: undefined,
          evidenceStatus: issue.evidenceStatus === "DOCUMENTED"
            ? issue.evidenceStatus
            : "OPEN_PENDING_FURTHER_DOCUMENTATION",
        },
      ];
    }
  }

  if (/(scan|calibration|adas|aiming)/i.test(text)) {
    const scanOrCalibrationRepresented =
      isOperationAlreadyRepresented(estimateText, "scan") ||
      isOperationAlreadyRepresented(estimateText, "calibration") ||
      isOperationAlreadyRepresented(estimateText, "headlamp_aim") ||
      isOperationAlreadyRepresented(estimateText, "fog_lamp_aim");
    if (scanOrCalibrationRepresented && /missing|not represented|absent|does not document/i.test(text)) {
      return [
        {
          ...issue,
          basisTier: issueWithBasis.basisTier,
          title: lower.includes("scan")
            ? "Scan Report Documentation Follow-Up"
            : "Calibration / Aiming Documentation Follow-Up",
          finding: rewriteAsDocumentationFollowUp(issue.finding, "Scan, calibration, or aiming operations are represented in the estimate."),
          impact:
            "The estimate carries scan, calibration, or aiming-related operations; the remaining issue is whether final reports, certificates, or proof of completion were produced.",
          missingOperation: undefined,
          evidenceStatus: "OPEN_PENDING_FURTHER_DOCUMENTATION",
        },
      ];
    }
  }

  if (/(structural|measurement|measure|frame|unibody|pull|rail|apron)/i.test(text)) {
    const snapshot = analyzeEstimateOperations(estimateText);
    if (snapshot.structural_measurement_support && !snapshot.final_structural_measurement_record) {
      return [
        {
          ...issue,
          basisTier: issueWithBasis.basisTier,
          title: "Structural Measurement Documentation Follow-Up",
          finding: rewriteAsDocumentationFollowUp(
            issue.finding,
            "The estimate represents structural setup, pull, measurement, or unibody work."
          ),
          impact:
            "Structural repair and measurement-support operations are represented in the estimate, but a final measurement printout or comparable produced record remains open if it is not included.",
          missingOperation: undefined,
          evidenceStatus: "OPEN_PENDING_FURTHER_DOCUMENTATION",
        },
      ];
    }
  }

  if (issue.evidenceStatus === "VISIBLE_IN_IMAGES") {
    return [
      {
        ...issue,
        basisTier: issueWithBasis.basisTier,
        finding: ensurePhotoCaution(issue.finding),
        impact: ensurePhotoCaution(normalizedImpact),
        missingOperation: undefined,
      },
    ];
  }

  return [
    {
      ...issueWithBasis,
      impact: normalizedImpact,
    },
  ];
}

function rewriteAsDocumentationFollowUp(value: string, prefix: string) {
  const cleaned = value.replace(/\b(missing|absent|not represented|not clearly represented)\b/gi, "open").trim();
  return `${prefix} ${cleaned || "Completion documentation remains open if final records were not produced."}`;
}

function ensurePhotoCaution(value: string) {
  if (/photos? alone|visible[-\s]?condition|not confirmed|remains open/i.test(value)) {
    return value;
  }
  return `${value} This remains a visible-condition concern only; hidden damage or missing operations are not established from photos alone.`;
}

function dedupeIssueFamilies(
  issues: RepairIntelligenceReport["issues"]
): RepairIntelligenceReport["issues"] {
  const merged = new Map<string, RepairIntelligenceReport["issues"][number]>();

  for (const issue of issues) {
    const family = inferIssueFamily(issue);
    const existing = merged.get(family);
    if (!existing) {
      merged.set(family, issue);
      continue;
    }

    merged.set(family, {
      ...existing,
      severity: strongestSeverity(existing.severity, issue.severity),
      evidenceStatus: strongestEvidenceStatus(existing.evidenceStatus, issue.evidenceStatus),
      basisTier: strongestEvidenceStatus(existing.basisTier, issue.basisTier),
      evidenceIds: dedupeStrings([...existing.evidenceIds, ...issue.evidenceIds]),
      impact: pickLongerText(existing.impact, issue.impact),
      finding: pickLongerText(existing.finding, issue.finding),
      missingOperation: existing.missingOperation ?? issue.missingOperation,
    });
  }

  return [...merged.values()];
}

function inferIssueFamily(issue: RepairIntelligenceReport["issues"][number]) {
  const text = normalizeText(`${issue.id} ${issue.title} ${issue.missingOperation ?? ""}`);
  if (/structural|measure|geometry|frame|unibody|pull/.test(text)) return "structural_measurement_geometry";
  if (/front support|apron|upper frame|lower rail|tie bar|lock support/.test(text)) return "front_support_structure";
  if (/suspension|wheel|alignment|steering/.test(text)) return "suspension_alignment";
  if (/scan|calibration|aim|adas/.test(text)) return "scan_calibration_aiming";
  if (/fit sensitive|fit|oem parts|aftermarket/.test(text)) return "oem_fit_parts";
  return normalizeIssueKey(issue);
}

function pickLongerText(left: string, right: string) {
  return right.length > left.length ? right : left;
}

function getEvidenceDerivedIssueDefinition(
  key: string,
  evidence: CaseEvidenceRegistryItem
): RepairIntelligenceReport["issues"][number] | null {
  const isPhoto = evidence.sourceType === "photo";
  const isInvoice = evidence.sourceType === "invoice" || evidence.sourceType === "sublet_document";
  const summaries = {
    invoice:
      evidence.extractedSummary ??
      `${evidence.label}: invoice/vendor evidence is documented in the current case.`,
    photo: summarizeVisibleDamageEvidence(evidence),
  };

  switch (key) {
    case "ELECTRICAL_DAMAGE_DOCUMENTED":
      if (!isInvoice) return null;
      return {
        id: key,
        category: "safety",
        title: "Electrical Damage Documented",
        finding: summaries.invoice,
        impact:
          "Invoice evidence documents electrical, wiring, connector, splice, or harness repair activity that should carry forward in the active case.",
        missingOperation: "Electrical repair documentation",
        evidenceStatus: "DOCUMENTED",
        severity: "medium",
        evidenceIds: [],
      };
    case "REPAIR_COMPLETENESS":
      if (!isInvoice) return null;
      return {
        id: key,
        category: "documentation",
        title: "Repair Completeness Documentation",
        finding: summaries.invoice,
        impact:
          "The invoice supports a performed repair or sublet activity; related completion records should remain tied to the case.",
        missingOperation: "Repair completion support",
        evidenceStatus: "DOCUMENTED",
        severity: "medium",
        evidenceIds: [],
      };
    case "FRONT_SUPPORT_HIDDEN_DAMAGE_POTENTIAL":
      if (!isPhoto) return null;
      return {
        id: key,
        category: "parts",
        title: "Front Support Area Verification",
        finding: summaries.photo,
        impact:
          "Visible front-end damage supports keeping hidden support, absorber, bracket, and mounting-area verification open pending teardown or repair documentation.",
        missingOperation: "Front support verification",
        evidenceStatus: "VISIBLE_IN_IMAGES",
        severity: "high",
        evidenceIds: [],
      };
    case "MOUNTING_GEOMETRY_OPEN_PENDING_FURTHER_DOCUMENTATION":
      if (!isPhoto) return null;
      return {
        id: key,
        category: "safety",
        title: "Mounting Geometry Verification Open",
        finding: summaries.photo,
        impact:
          "Visible mounting, lamp, bumper, or bracket-area disturbance supports an open fit and geometry verification concern, but does not prove hidden damage by itself.",
        missingOperation: "Mounting geometry verification",
        evidenceStatus: "OPEN_PENDING_FURTHER_DOCUMENTATION",
        severity: "high",
        evidenceIds: [],
      };
    case "CALIBRATION_VERIFICATION_OPEN":
      return {
        id: key,
        category: "calibration",
        title: "Calibration Verification Open",
        finding: isInvoice ? summaries.invoice : summaries.photo,
        impact:
          "Disturbed electrical, front-end, lamp, bumper, or sensor-adjacent areas may affect system verification needs; calibration status remains open unless records directly document it.",
        missingOperation: "Calibration verification",
        evidenceStatus: "OPEN_PENDING_FURTHER_DOCUMENTATION",
        severity: "high",
        evidenceIds: [],
      };
    case "SUSPENSION_WHEEL_AREA_VERIFICATION":
      if (!isPhoto) return null;
      return {
        id: key,
        category: "safety",
        title: "Suspension / Wheel-Area Verification",
        finding: summaries.photo,
        impact:
          "Visible wheel-opening or wheel-area involvement supports keeping suspension, steering, or wheel-area verification open pending documentation.",
        missingOperation: "Suspension and wheel-area verification",
        evidenceStatus: "VISIBLE_IN_IMAGES",
        severity: "high",
        evidenceIds: [],
      };
    case "ALIGNMENT_VERIFICATION_OPEN_PENDING_FURTHER_DOCUMENTATION":
      if (!isPhoto) return null;
      return {
        id: key,
        category: "safety",
        title: "Alignment Verification Open",
        finding: summaries.photo,
        impact:
          "Wheel-area involvement can make alignment verification relevant, but completion is not established unless alignment records are provided.",
        missingOperation: "Alignment verification",
        evidenceStatus: "OPEN_PENDING_FURTHER_DOCUMENTATION",
        severity: "medium",
        evidenceIds: [],
      };
    case "FIT_AND_FINISH_VALIDATION":
      if (!isPhoto) return null;
      return {
        id: key,
        category: "parts",
        title: "Fit And Finish Validation",
        finding: summaries.photo,
        impact:
          "Visible panel, lamp, bumper, trim, or mounting-area involvement supports fit validation after repair.",
        missingOperation: "Fit and finish validation",
        evidenceStatus: "VISIBLE_IN_IMAGES",
        severity: "medium",
        evidenceIds: [],
      };
    case "HIDDEN_DAMAGE_POTENTIAL":
      return {
        id: key,
        category: "safety",
        title: "Hidden Damage Potential",
        finding: isInvoice ? summaries.invoice : summaries.photo,
        impact:
          "The current evidence supports an open hidden-damage verification concern, but hidden damage is not confirmed without teardown, measurements, or supporting records.",
        missingOperation: "Hidden damage verification",
        evidenceStatus: isPhoto ? "VISIBLE_IN_IMAGES" : "SUPPORTABLE_BUT_UNCONFIRMED",
        severity: "medium",
        evidenceIds: [],
      };
    default:
      return null;
  }
}

function buildReassessmentDelta(params: {
  previousReport: RepairIntelligenceReport | null;
  nextIssues: RepairIntelligenceReport["issues"];
  nextEvidenceRegistry: CaseEvidenceRegistryItem[];
  nextDetermination: string;
}): ReassessmentDelta {
  const previousEvidenceIds = new Set(
    (params.previousReport?.evidenceRegistry ?? []).map((item) => item.id)
  );
  const previousIssueByKey = new Map(
    (params.previousReport?.issues ?? []).map((issue) => [normalizeIssueKey(issue), issue])
  );
  const addedEvidenceIds = params.nextEvidenceRegistry
    .filter((item) => !previousEvidenceIds.has(item.id))
    .map((item) => item.id);
  const statusChanges: ReassessmentDelta["statusChanges"] = params.nextIssues
    .flatMap((issue) => {
      const previous = previousIssueByKey.get(normalizeIssueKey(issue));
      if (previous?.evidenceStatus === issue.evidenceStatus) return [];

      return [{
        key: issue.id,
        from: previous?.evidenceStatus,
        to: issue.evidenceStatus ?? "OPEN_PENDING_FURTHER_DOCUMENTATION",
      }];
    });
  const newlyDocumented = statusChanges
    .filter((change) => change.to === "DOCUMENTED")
    .map((change) => change.key);
  const stillOpen = params.nextIssues
    .filter((issue) => issue.evidenceStatus !== "DOCUMENTED")
    .map((issue) => issue.id);
  const previousDetermination =
    params.previousReport?.recommendedActions[0] ?? "";
  const determinationChanged =
    Boolean(previousDetermination.trim()) &&
    normalizeText(previousDetermination) !== normalizeText(params.nextDetermination);

  return {
    addedEvidenceIds,
    affectedIssueKeys: dedupeStrings([
      ...statusChanges.map((change) => change.key),
      ...params.nextEvidenceRegistry.flatMap((item) => item.relatedIssueKeys),
    ]),
    statusChanges,
    newlyDocumented,
    stillOpen,
    determinationChanged,
    summary:
      addedEvidenceIds.length === 0 && statusChanges.length === 0
        ? "No material evidence or issue-status change was detected in this reassessment."
        : `${addedEvidenceIds.length} evidence item(s) added and ${statusChanges.length} issue status change(s) detected.`,
  };
}

function buildSharedFactualCore(params: {
  report: RepairIntelligenceReport;
  evidenceRegistry: CaseEvidenceRegistryItem[];
  activeCaseId?: string;
  mode: "new_case" | "active_case_update";
}): SharedFactualCore {
  const report = params.report;
  const vehicleSummary = [
    report.vehicle?.year,
    report.vehicle?.make,
    report.vehicle?.model,
    report.vehicle?.trim,
    report.vehicle?.vin ? `VIN ending ${report.vehicle.vin.slice(-4)}` : "",
  ]
    .filter(Boolean)
    .join(" ") || "Vehicle not fully established";
  const visibleDamageObservations = params.evidenceRegistry
    .filter((item) => item.sourceType === "photo")
    .map(summarizeVisibleDamageEvidence);
  const linkedEvidenceState = params.evidenceRegistry
    .filter((item) => item.sourceType === "procedure_link" || item.ingestionState !== "uploaded")
    .map((item) => `${item.label}: ${item.ingestionState}`);
  const documentedRepairOperations = dedupeStrings([
    ...report.presentProcedures,
    ...params.evidenceRegistry
      .filter((item) => item.sourceType === "invoice" || item.sourceType === "sublet_document")
      .map(summarizeInvoiceEvidence),
  ]);
  const issueAssessments = report.issues.map((issue) => ({
    key: issue.id,
    title: issue.title,
    status: issue.evidenceStatus ?? "OPEN_PENDING_FURTHER_DOCUMENTATION",
    severity: issue.severity,
    summary: issue.impact || issue.finding,
    evidenceIds: issue.evidenceIds,
  }));
  const openIssues = issueAssessments
    .filter((issue) => issue.status !== "DOCUMENTED")
    .map((issue) => issue.title);

  return {
    vehicleSummary,
    currentCaseSummary: buildCurrentCaseSummary({
      mode: params.mode,
      vehicleSummary,
      evidenceRegistry: params.evidenceRegistry,
      visibleDamageObservations,
      documentedRepairOperations,
      unresolvedVerificationNeeds: dedupeStrings([
        ...report.missingProcedures,
        ...report.supplementOpportunities,
      ]),
      fallback:
        report.recommendedActions[0] ??
        "Current case remains under evidence-based review.",
    }),
    visibleDamageObservations,
    documentedRepairOperations,
    evidenceRegistrySummary: params.evidenceRegistry.map(
      (item) => `${item.label}: ${item.sourceType}, ${item.evidenceStatus}`
    ),
    linkedEvidenceState,
    issueAssessments,
    documentedPositives: report.estimateFacts?.documentedHighlights ?? [],
    openIssues,
    unresolvedVerificationNeeds: dedupeStrings([
      ...report.missingProcedures,
      ...report.supplementOpportunities,
    ]),
    currentDetermination:
      report.recommendedActions[0] ??
      "Current determination remains provisional pending further documentation.",
    caseContinuity: {
      activeCaseId: params.activeCaseId,
      mode: params.mode,
      reassessedAt: new Date().toISOString(),
      evidenceCount: params.evidenceRegistry.length,
    },
  };
}

function buildCurrentCaseSummary(params: {
  mode: "new_case" | "active_case_update";
  vehicleSummary: string;
  evidenceRegistry: CaseEvidenceRegistryItem[];
  visibleDamageObservations: string[];
  documentedRepairOperations: string[];
  unresolvedVerificationNeeds: string[];
  fallback: string;
}): string {
  const photoCount = params.evidenceRegistry.filter((item) => item.sourceType === "photo").length;
  const invoiceCount = params.evidenceRegistry.filter(
    (item) => item.sourceType === "invoice" || item.sourceType === "sublet_document"
  ).length;
  const documentCount = params.evidenceRegistry.filter(
    (item) =>
      item.sourceType !== "photo" &&
      item.sourceType !== "invoice" &&
      item.sourceType !== "sublet_document"
  ).length;
  const evidenceParts = [
    photoCount > 0 ? `${photoCount} damage photo${photoCount === 1 ? "" : "s"}` : "",
    invoiceCount > 0 ? `${invoiceCount} repair invoice${invoiceCount === 1 ? "" : "s"}` : "",
    documentCount > 0
      ? `${documentCount} supporting document${documentCount === 1 ? "" : "s"}`
      : "",
  ].filter(Boolean);
  const opening =
    params.mode === "active_case_update"
      ? `Current case now includes ${evidenceParts.join(", ") || "the merged evidence"} for ${params.vehicleSummary}.`
      : `Current case includes ${evidenceParts.join(", ") || "the available evidence"} for ${params.vehicleSummary}.`;
  const visible = params.visibleDamageObservations.slice(0, 2).join(" ");
  const invoice = params.documentedRepairOperations
    .filter((item) => /invoice|connector|electrical|wire|harness|repair/i.test(item))
    .slice(0, 2)
    .join(" ");
  const verificationNeeds = params.unresolvedVerificationNeeds
    .filter((item) =>
      /hidden|mount|bracket|support|geometry|structural|calibration|scan|fit|alignment|wheel|suspension/i.test(
        item
      )
    )
    .slice(0, 4);
  const openState =
    verificationNeeds.length > 0
      ? ` Keep ${verificationNeeds.join(", ")} open pending further documentation.`
      : "";

  return dedupeStrings([opening, visible, invoice, openState.trim(), params.fallback])
    .filter(Boolean)
    .join(" ");
}

function summarizeVisibleDamageEvidence(item: CaseEvidenceRegistryItem): string {
  const sourceText = `${item.label}\n${item.extractedText ?? ""}`;
  const lower = sourceText.toLowerCase();
  const side = inferImpactSide(sourceText);
  const observed = [
    side === "right_front"
      ? "right-front area"
      : "",
    side === "left_front"
      ? "left-front area"
      : "",
    lower.includes("bumper") ? "bumper" : "",
    lower.includes("headlamp") || lower.includes("headlight") ? "headlamp" : "",
    lower.includes("fender") ? "fender" : "",
    lower.includes("mount") || lower.includes("bracket") || lower.includes("support")
      ? "mounting/bracket/support area"
      : "",
    lower.includes("wheel opening") || lower.includes("wheel-opening") || lower.includes("liner")
      ? "wheel-opening trim/liner"
      : "",
    lower.includes("wheel") || lower.includes("suspension") ? "wheel-area" : "",
  ].filter(Boolean);

  if (observed.length === 0) {
    return `${item.label}: photos provide visible-condition evidence only; hidden damage is not confirmed from photos alone.`;
  }

  return `${item.label}: visible photo evidence supports ${dedupeStrings(observed).join(", ")} involvement.`;
}

function summarizeInvoiceEvidence(item: CaseEvidenceRegistryItem): string {
  if (item.extractedSummary) {
    return item.extractedSummary;
  }

  const sourceText = `${item.label}\n${item.extractedText ?? ""}`;
  const lower = sourceText.toLowerCase();
  const observed = [
    lower.includes("connector") ? "connector repair" : "",
    lower.includes("electrical") || lower.includes("wire") || lower.includes("wiring")
      ? "electrical/wiring repair"
      : "",
    lower.includes("harness") ? "harness repair" : "",
    lower.includes("collision") ? "collision-related repair reference" : "",
  ].filter(Boolean);

  if (observed.length === 0) {
    return `${item.label}: repair invoice is documented in the current case.`;
  }

  return `${item.label}: invoice supports ${dedupeStrings(observed).join(", ")}.`;
}

function extractInvoiceFacts(
  attachment: StoredAttachment,
  sourceType: CaseEvidenceSourceType
): Record<string, string | string[] | null> {
  const text = attachment.text || "";
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const vendor =
    findLabeledValue(text, ["vendor", "facility", "repair facility", "from"]) ??
    lines.find((line) => /auto|collision|electric|glass|calibration|diagnostic|repair|tesla/i.test(line)) ??
    lines[0] ??
    null;
  const invoiceNumber = findLabeledValue(text, [
    "invoice #",
    "invoice no",
    "invoice number",
    "inv #",
    "inv no",
  ]);
  const invoiceDate = findLabeledDate(text, ["invoice date", "date"]);
  const dueDate = findLabeledDate(text, ["due date"]);
  const vin = text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i)?.[0]?.toUpperCase() ?? null;
  const vehicle = findVehicleLine(text);
  const billedParty = findLabeledValue(text, ["bill to", "customer", "billed party"]);
  const technician = findLabeledValue(text, ["technician", "tech"]);
  const lineItems = extractInvoiceLineItems(lines);
  const totalAmount =
    findMoneyNearLabel(text, ["total", "amount due", "balance due"]) ??
    lineItems.at(-1)?.match(/\$[\d,]+(?:\.\d{2})?/)?.[0] ??
    null;
  const narrativeNotes = extractRepairNarrative(lines);

  return {
    documentType: sourceType === "sublet_document" ? "Sublet/vendor document" : "Invoice",
    vendor,
    invoiceNumber,
    invoiceDate,
    dueDate,
    vehicle,
    vin,
    billedParty,
    technician,
    lineItems,
    totalAmount,
    narrativeNotes,
  };
}

function summarizeInvoiceFacts(facts: Record<string, string | string[] | null>): string {
  const lineItems = Array.isArray(facts.lineItems) ? facts.lineItems : [];
  const narrativeNotes = Array.isArray(facts.narrativeNotes) ? facts.narrativeNotes : [];
  const supportCategories = dedupeStrings([
    ...lineItems,
    ...narrativeNotes,
  ]).filter((item) =>
    /connector|harness|splice|wire|wiring|electrical|calibration|scan|glass|alignment|sublet|repair/i.test(
      item
    )
  );
  const descriptors = supportCategories.slice(0, 4);
  const vendor = typeof facts.vendor === "string" ? facts.vendor : "Uploaded invoice";
  const invoiceNumber =
    typeof facts.invoiceNumber === "string" && facts.invoiceNumber
      ? ` invoice ${facts.invoiceNumber}`
      : "";
  const total =
    typeof facts.totalAmount === "string" && facts.totalAmount ? ` Total: ${facts.totalAmount}.` : "";

  if (descriptors.length === 0) {
    return `${vendor}${invoiceNumber}: invoice/vendor document is documented in the current case.${total}`;
  }

  return `${vendor}${invoiceNumber}: invoice supports ${descriptors.join("; ")}.${total}`;
}

function findLabeledValue(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`${escaped}\\s*:?\\s*([^\\n\\r]+)`, "i"));
    const value = match?.[1]?.trim();
    if (value) return value.slice(0, 120);
  }

  return null;
}

function findLabeledDate(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(
      new RegExp(`${escaped}\\s*:?\\s*(\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4})`, "i")
    );
    if (match?.[1]) return match[1];
  }

  return null;
}

function findMoneyNearLabel(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(
      new RegExp(`${escaped}[^\\n\\r$]{0,40}(\\$\\s*[\\d,]+(?:\\.\\d{2})?)`, "i")
    );
    if (match?.[1]) return match[1].replace(/\s+/g, "");
  }

  return null;
}

function findVehicleLine(text: string): string | null {
  const labeled = findLabeledValue(text, ["vehicle", "year/make/model", "year make model"]);
  if (labeled) return labeled;

  const match = text.match(/\b(20\d{2}|19\d{2})\s+([A-Z][A-Za-z]+)\s+([A-Z0-9][A-Za-z0-9 -]{1,40})/);
  return match?.[0]?.trim() ?? null;
}

function extractInvoiceLineItems(lines: string[]): string[] {
  return dedupeStrings(
    lines
      .filter((line) =>
        /(connector|harness|splice|wire|wiring|electrical|calibration|scan|glass|alignment|sublet|repair|replace|labor|\$[\d,]+(?:\.\d{2})?)/i.test(
          line
        )
      )
      .map((line) => line.replace(/\s+/g, " ").slice(0, 180))
      .slice(0, 12)
  );
}

function extractRepairNarrative(lines: string[]): string[] {
  return dedupeStrings(
    lines
      .filter((line) =>
        /(damaged|repaired|replaced|spliced|connector|harness|wire|wiring|electrical|collision|calibrat|scan|align|diagnos)/i.test(
          line
        )
      )
      .map((line) => line.replace(/\s+/g, " ").slice(0, 220))
      .slice(0, 8)
  );
}

function buildArtifactRefreshPolicy(params: {
  report: RepairIntelligenceReport;
  factualCore: SharedFactualCore;
  delta: ReassessmentDelta;
}): ArtifactRefreshPolicy {
  const highImpactChanges = findHighImpactStatusChanges(params.report, params.delta);
  const highImpactStillOpen = findIssuesByKeys(
    params.report,
    params.delta.stillOpen.filter((key) =>
      params.delta.affectedIssueKeys.map(normalizeText).includes(normalizeText(key))
    )
  ).filter((issue) => issue.severity === "high");
  const customerFacingSignals = buildCustomerFacingSignals(params.report, params.delta);
  const disputeSignals = dedupeStrings([
    ...highImpactChanges.map((issue) => `${issue.title} changed status`),
    ...highImpactStillOpen.map((issue) => `${issue.title} remains open`),
    ...params.delta.newlyDocumented.map((key) => `${key} became documented`),
  ]);
  const rebuttalSignals = disputeSignals.filter((signal) =>
    /(open|documented|calibration|scan|structural|alignment|support|verification)/i.test(signal)
  );
  const mainSignals = dedupeStrings([
    params.delta.determinationChanged ? "overall determination changed" : "",
    ...highImpactChanges.map((issue) => `${issue.title} status changed`),
    ...params.delta.newlyDocumented.map((key) => `${key} became documented`),
    ...detectVisibleRepairPathSignals(params.factualCore, params.delta),
  ]);
  const anyArtifactRefresh =
    mainSignals.length > 0 ||
    customerFacingSignals.length > 0 ||
    disputeSignals.length > 0 ||
    rebuttalSignals.length > 0;

  return {
    mainReport: {
      shouldRefresh: mainSignals.length > 0,
      reason:
        mainSignals.length > 0
          ? "The main report has material case-level changes worth reflecting."
          : "A concise Case Update is enough; the full main report does not need a rewrite.",
      signals: mainSignals,
    },
    customerReport: {
      shouldRefresh: customerFacingSignals.length > 0,
      reason:
        customerFacingSignals.length > 0
          ? "The customer-facing repair explanation or expectations changed materially."
          : "The customer-facing explanation remains materially stable.",
      signals: customerFacingSignals,
    },
    disputeReport: {
      shouldRefresh: disputeSignals.length > 0,
      reason:
        disputeSignals.length > 0
          ? "Dispute prioritization or documentation status changed."
          : "Dispute priorities did not materially change.",
      signals: disputeSignals,
    },
    rebuttalOutput: {
      shouldRefresh: rebuttalSignals.length > 0,
      reason:
        rebuttalSignals.length > 0
          ? "Carrier-facing asks may need to reflect newly changed support status."
          : "Carrier-facing asks appear materially unchanged.",
      signals: rebuttalSignals,
    },
    chatSummaryOnly: {
      shouldRefresh: !anyArtifactRefresh,
      reason: anyArtifactRefresh
        ? "At least one artifact has a material refresh signal."
        : "No artifact-level material change was detected; a chat/UI delta summary is sufficient.",
      signals: anyArtifactRefresh ? [] : ["no material artifact refresh signal"],
    },
  };
}

function findHighImpactStatusChanges(
  report: RepairIntelligenceReport,
  delta: ReassessmentDelta
) {
  const changedKeys = new Set(delta.statusChanges.map((change) => normalizeText(change.key)));
  return report.issues.filter(
    (issue) =>
      issue.severity === "high" &&
      (changedKeys.has(normalizeText(issue.id)) ||
        changedKeys.has(normalizeIssueKey(issue)))
  );
}

function findIssuesByKeys(report: RepairIntelligenceReport, keys: string[]) {
  const normalizedKeys = new Set(keys.map(normalizeText));
  return report.issues.filter(
    (issue) =>
      normalizedKeys.has(normalizeText(issue.id)) ||
      normalizedKeys.has(normalizeIssueKey(issue))
  );
}

function buildCustomerFacingSignals(
  report: RepairIntelligenceReport,
  delta: ReassessmentDelta
): string[] {
  const changedIssues = findIssuesByKeys(report, [
    ...delta.affectedIssueKeys,
    ...delta.newlyDocumented,
  ]);

  return dedupeStrings(
    changedIssues
      .filter((issue) =>
        issue.severity === "high" &&
        /(damage|structural|safety|suspension|wheel|alignment|fit|drivability|door|glass|trim|sealing|calibration)/i.test(
          `${issue.title} ${issue.impact}`
        )
      )
      .map((issue) => `${issue.title} affects customer-facing repair expectations`)
  );
}

function detectVisibleRepairPathSignals(
  factualCore: SharedFactualCore,
  delta: ReassessmentDelta
): string[] {
  if (delta.addedEvidenceIds.length === 0) return [];

  const visibleDamageChanged = factualCore.visibleDamageObservations.some((item) =>
    delta.addedEvidenceIds.some((id) => item.includes(id))
  );

  return visibleDamageChanged
    ? ["visible repair-path understanding changed"]
    : [];
}

function classifyUploadedEvidenceSource(attachment: StoredAttachment): CaseEvidenceSourceType {
  const text = `${attachment.filename}\n${attachment.type}\n${attachment.text}`.toLowerCase();

  if (attachment.classification === "ccc_awf") return "ccc_awf";
  if (attachment.classification === "ccc_workfile") return "ccc_workfile";
  if (attachment.classification === "ccc_companion_file") return "ccc_companion_file";
  if (attachment.type.startsWith("image/")) return "photo";
  if (isPolicyEvidenceText(text)) return "policy_document";
  if (
    /(sublet|vendor|specialty|calibration sublet|scan sublet|glass|alignment)/i.test(text) &&
    /(invoice|bill|repair order|ro #|statement)/i.test(text)
  ) {
    return "sublet_document";
  }
  if (text.includes("invoice") || text.includes("repair order") || text.includes("ro #")) {
    return "invoice";
  }
  if (/\b(carrier|insurance estimate|insurer estimate)\b/i.test(text)) return "carrier_estimate";
  if (/\b(shop|repair facility|approved repairs?)\b/i.test(text)) return "shop_estimate";
  if (/\b(supplement|supp|sor)\b/i.test(text)) return "supplement";
  if (text.includes("scan")) return "scan_report";
  if (text.includes("calibration")) return "calibration_report";
  if (text.includes("adas")) return "adas_report";
  if (/\b(oem|procedure|repair guidelines?|oem guidelines?|work auth(?:orization)?)\b/i.test(text)) return "oem_documentation";
  return "other_supporting_document";
}

function buildUploadedReviewabilityDiagnostics(
  attachments: StoredAttachment[],
  fileReviewLedger = buildFileReviewLedger(attachments)
): {
  reviewableFileCount: number;
  excludedFiles: ExcludedFromReviewFileDiagnostic[];
  excludedReasons: ExcludedFromReviewReason[];
} {
  const excludedFiles = fileReviewLedger
    .filter((entry) => entry.exclusionReason)
    .map((entry) => ({
      filename: entry.filename,
      detectedType: String(entry.documentType),
      reason: entry.exclusionReason as ExcludedFromReviewReason,
      indexed: entry.indexedStatus === "indexed",
      stage: entry.exclusionStage ?? "reviewability",
      parsed: entry.textExtractionStatus === "extracted" || entry.pdfExtractionStatus === "available",
      supportOnly: entry.usedAsSupportOnly,
      duplicate: entry.isDuplicate,
      duplicateOf: entry.duplicateOf,
      reviewabilityHint: entry.reviewabilityHint,
    } satisfies ExcludedFromReviewFileDiagnostic));
  const reviewableFileCount = fileReviewLedger.filter((entry) => entry.isReviewable).length;

  return {
    reviewableFileCount,
    excludedFiles,
    excludedReasons: [...new Set(excludedFiles.map((file) => file.reason))],
  };
}

function getDeterminationReviewExclusionReason(
  attachment: StoredAttachment,
  detectedType: CaseEvidenceSourceType
): ExcludedFromReviewReason | null {
  if (isPdfAttachment(attachment)) return null;
  if (detectedType === "photo") return null;
  if (attachment.classification === "ccc_awf" || attachment.classification === "ccc_workfile") return null;
  if (attachment.classification === "ccc_companion_file") return "INTERNAL_CONTAINER";
  if (attachment.type.startsWith("video/") || attachment.classification === "video") return "UNSUPPORTED_TYPE";
  if (!attachment.text?.trim() && !attachment.imageDataUrl) return "EMPTY_FILE";
  return null;
}

function isPdfAttachment(attachment: Pick<StoredAttachment, "filename" | "type" | "classification">) {
  return attachment.classification === "pdf" || attachment.type === "application/pdf" || /\.pdf$/i.test(attachment.filename);
}

function isEstimateOrRepairSupportPdf(filename: string, text: string) {
  const haystack = `${filename}\n${text}`;
  return /\.pdf$/i.test(filename) && /\b(shop|sor\d*|supp(?:lement)?|estimate|work auth(?:orization)?|invoice|repair guidelines?|oem guidelines?|approved repairs?)\b/i.test(haystack);
}

function isPolicyEvidenceText(text: string): boolean {
  return /\b(policy|declarations?|endorsement|coverage|collision coverage|comprehensive coverage|appraisal|arbitration|if we cannot agree|duties after loss|payment of loss|financial responsibility|identification card|governing law|laws? of pennsylvania|pennsylvania law)\b/i.test(text);
}

function extractPolicyFacts(attachment: StoredAttachment): Record<string, string | string[] | null> {
  const text = `${attachment.filename}\n${attachment.text}`;
  const facts: Record<string, string | string[] | null> = {
    carrier: extractFirstPolicyMatch(text, /\b(Allstate|State Farm|GEICO|Progressive|Erie|USAA|Nationwide|Liberty Mutual|Travelers|Farmers)\b/i),
    jurisdiction: extractPolicyJurisdiction(text),
    coverage: extractPolicyCoverage(text),
    appraisalOrArbitration: extractPolicyClauseSummary(text, /\b(appraisal|arbitration|if we cannot agree|cannot agree)\b/i),
    dutiesAfterLoss: extractPolicyClauseSummary(text, /\b(duties after loss|cooperat(?:e|ion)|payment of loss|proof of loss|claim)\b/i),
    policyForms: extractPolicyForms(text),
  };

  return facts;
}

function summarizePolicyFacts(facts: Record<string, string | string[] | null>): string {
  const forms = Array.isArray(facts.policyForms) ? facts.policyForms.join(", ") : "";
  return [
    facts.carrier ? `Carrier: ${facts.carrier}.` : null,
    facts.jurisdiction ? `Jurisdiction indicator: ${facts.jurisdiction}.` : null,
    facts.coverage ? `Coverage indicators: ${facts.coverage}.` : null,
    facts.appraisalOrArbitration ? `Dispute-resolution language: ${facts.appraisalOrArbitration}.` : null,
    facts.dutiesAfterLoss ? `Claim duties/payment language: ${facts.dutiesAfterLoss}.` : null,
    forms ? `Forms or endorsements: ${forms}.` : null,
  ].filter(Boolean).join(" ");
}

function extractPolicyJurisdiction(text: string): string | null {
  if (/\b(Pennsylvania|PA)\b/i.test(text)) return "PA";
  const match = text.match(/\blaws? of (?:the Commonwealth of )?([A-Z][a-z]+)\b/);
  return match?.[1] ?? null;
}

function extractPolicyCoverage(text: string): string | null {
  const coverage: string[] = [];
  if (/\bcollision\b/i.test(text)) coverage.push("collision");
  if (/\bcomprehensive\b/i.test(text)) coverage.push("comprehensive");
  return coverage.length ? coverage.join(", ") : null;
}

function extractPolicyForms(text: string): string[] {
  return Array.from(text.matchAll(/\b(?:form|endorsement|notice)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9-]{3,})/gi))
    .map((match) => match[1])
    .filter(Boolean)
    .slice(0, 8);
}

function extractPolicyClauseSummary(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  if (!match?.index) return match ? match[0] : null;
  const start = Math.max(0, match.index - 90);
  const end = Math.min(text.length, match.index + 220);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function extractFirstPolicyMatch(text: string, pattern: RegExp): string | null {
  return text.match(pattern)?.[1] ?? null;
}

function classifyLinkedEvidenceSource(doc: LinkedEvidence): CaseEvidenceSourceType {
  const text = `${doc.title ?? ""}\n${doc.text}`.toLowerCase();

  if (text.includes("adas") || text.includes("calibration")) return "adas_report";
  if (text.includes("scan")) return "scan_report";
  if (text.includes("oem") || text.includes("procedure") || text.includes("position statement")) {
    return "procedure_link";
  }
  return "other_supporting_document";
}

function inferEvidenceIssueKeys(params: {
  text: string;
  sourceType: CaseEvidenceSourceType;
  issueKeys: string[];
}): string[] {
  const lower = params.text.toLowerCase();
  const semanticKeys: string[] = [];

  if (params.sourceType === "invoice" || params.sourceType === "sublet_document") {
    if (/(connector|harness|splice|wire|wiring|electrical)/i.test(params.text)) {
      semanticKeys.push(
        "ELECTRICAL_DAMAGE_DOCUMENTED",
        "REPAIR_COMPLETENESS",
        "HIDDEN_DAMAGE_POTENTIAL",
        "CALIBRATION_VERIFICATION_OPEN"
      );
    }

    if (/(calibration|aiming|initialization|scan|diagnostic)/i.test(params.text)) {
      semanticKeys.push("CALIBRATION_VERIFICATION_OPEN", "POST_REPAIR_SCAN");
    }

    if (/(glass|alignment|mechanical|sublet|vendor)/i.test(params.text)) {
      semanticKeys.push("REPAIR_COMPLETENESS");
    }
  }

  if (params.sourceType === "photo") {
    if (/(front|bumper|headlamp|headlight|wheel opening|lower support|absorber|valance|bracket|mount)/i.test(params.text)) {
      semanticKeys.push(
        "FRONT_SUPPORT_HIDDEN_DAMAGE_POTENTIAL",
        "FIT_AND_FINISH_VALIDATION",
        "MOUNTING_GEOMETRY_OPEN_PENDING_FURTHER_DOCUMENTATION",
        "CALIBRATION_VERIFICATION_OPEN"
      );
    }

    if (/(wheel|suspension|alignment)/i.test(params.text)) {
      semanticKeys.push(
        "SUSPENSION_WHEEL_AREA_VERIFICATION",
        "ALIGNMENT_VERIFICATION_OPEN_PENDING_FURTHER_DOCUMENTATION"
      );
    }
  }

  return dedupeStrings([
    ...semanticKeys,
    ...params.issueKeys.filter((key) => {
      const normalized = key.toLowerCase().replace(/[-_]+/g, " ");
      return normalized
        .split(/\s+/)
        .filter((part) => part.length >= 4)
        .some((part) => lower.includes(part));
    }),
  ]);
}

function mergeLinkedEvidence(
  previous: LinkedEvidence[],
  next: LinkedEvidence[]
): LinkedEvidence[] {
  const merged = new Map<string, LinkedEvidence>();
  for (const item of previous) {
    merged.set(item.url, item);
  }
  for (const item of next) {
    const existing = merged.get(item.url);
    if (!existing || existing.status !== "ok") {
      merged.set(item.url, item);
    }
  }
  return [...merged.values()];
}

function mergeArtifactIds(previous: string[], next: string[]): string[] {
  return dedupeStrings([...previous, ...next]);
}

function normalizeIssueKey(issue: RepairIntelligenceReport["issues"][number]): string {
  return normalizeText(issue.missingOperation || issue.title || issue.id);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function strongestEvidenceStatus(
  left?: IssueEvidenceStatus,
  right?: IssueEvidenceStatus
): IssueEvidenceStatus {
  const rank: Record<IssueEvidenceStatus, number> = {
    DOCUMENTED: 6,
    VISIBLE_IN_IMAGES: 5,
    REFERENCED_NOT_PRODUCED: 4,
    SUPPORTABLE_BUT_UNCONFIRMED: 3,
    OPEN_PENDING_FURTHER_DOCUMENTATION: 2,
    NOT_ESTABLISHED: 1,
  };
  const fallback: IssueEvidenceStatus = "OPEN_PENDING_FURTHER_DOCUMENTATION";
  const leftStatus = left ?? fallback;
  const rightStatus = right ?? fallback;
  return rank[leftStatus] >= rank[rightStatus] ? leftStatus : rightStatus;
}

function strongestSeverity(
  left: RepairIntelligenceReport["issues"][number]["severity"],
  right: RepairIntelligenceReport["issues"][number]["severity"]
) {
  const rank = {
    low: 1,
    medium: 2,
    high: 3,
  };
  return rank[left] >= rank[right] ? left : right;
}

function mergeLinkedEvidenceRecords(
  existing: RepairIntelligenceReport["evidence"],
  linkedEvidence: LinkedEvidence[]
): RepairIntelligenceReport["evidence"] {
  const linked = linkedEvidence
    .map((doc, index) => ({
      id: `linked-${index + 1}`,
      title:
        doc.status === "ok"
          ? doc.title || "Linked document"
          : doc.title || "Referenced linked document",
      snippet:
        doc.status === "ok" && doc.text.trim()
          ? redactExternalDocumentUrls(doc.text).slice(0, 280)
          : `Referenced link detected but not reviewed. Status: ${doc.status}. ${doc.notes ?? ""}`.trim(),
      source: "linked_supporting_document",
      authority: doc.status === "ok" ? ("oem" as const) : ("inferred" as const),
    }));

  const deduped = new Map<string, RepairIntelligenceReport["evidence"][number]>();
  for (const item of [...existing, ...linked]) {
    const key = `${item.title}:${item.source}:${item.snippet}`;
    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  }

  return [...deduped.values()].slice(0, 12);
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
  const response = await generatePrimaryText({
    openai,
    stage: "analysis_drive_refinement",
    temperature: 0.2,
    instructions: `You are a collision repair decision engine.

${NON_BIAS_ACCURACY_DIRECTIVE}

If the user intent includes repairability, total loss, or grading:

You MUST structure your response as:

1. Visible Damage Summary
2. Estimate Scope Summary
3. Physical Repairability (YES / NO / UNCERTAIN)
4. Economic Repairability (based on estimate vs value)
5. Final Determination
6. Grade (A-F with explanation)
7. Required Teardown Confirmation

Rules:
- use OEM support to reinforce or adjust repair, procedure, calibration, structural, and compliance conclusions
- use PA law support only for rebuttal, negotiation, appraisal, aftermarket, valuation, or rights issues when the retrieval lane shows that legal support is relevant
- do not let legal commentary replace the core repair judgment
- do not default to supplement or negotiation framing when the request is about repairability, total loss, or grading
- do not dump documents or overquote excerpts
- keep the narrative concise, natural, and direct
- preserve a professional estimator tone
- keep documented facts, visible conditions, inferences, and unresolved verification needs separate
- return JSON only with this shape:
{
  "narrative": "string",
  "recommendedActions": ["string"]
}`,
    input: [
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

[Linked External-Document Retrieval Mode]
${params.retrieval.request.retrievalMode}

[Retrieved Linked External-Document Support]
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
        reason: `Linked external-document support found in ${result.filename}. ${result.matchReason}`,
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
        ? `OEM support in ${sourceLabel} indicates one-time-use hardware, seals, or clips may already be implicated, but replacement documentation is not shown.`
        : `OEM support in ${sourceLabel} indicates one-time-use hardware, seals, or clips may need to be replaced and documented when disturbed.`;
    case "corrosion_protection_cavity_wax_seam_sealer":
      return partiallyRepresented
        ? `OEM support in ${sourceLabel} adds corrosion-protection, cavity-wax, seam-sealer, or related material-restoration requirements that may already be implicated, but current documentation is not shown.`
        : `OEM support in ${sourceLabel} adds corrosion-protection, cavity-wax, seam-sealer, or related material-restoration requirements that should be carried or documented for the affected repair path.`;
    case "weld_prep_weld_protection":
      return partiallyRepresented
        ? `OEM support in ${sourceLabel} adds weld-prep, weld-protection, joining-material, or restoration-material requirements that may already be implicated, but current documentation is not shown.`
        : `OEM support in ${sourceLabel} adds weld-prep, weld-protection, joining-material, or restoration-material requirements that should be reflected if those joining operations apply.`;
    case "adas_calibration":
      return partiallyRepresented
        ? `OEM support in ${sourceLabel} indicates scan, calibration, alignment, or verification burden may already be partly represented, but current documentation is not shown.`
        : `OEM support in ${sourceLabel} indicates scan, calibration, alignment, or verification burden may need to be added or better documented for the affected system.`;
    case "fit_sensitive_oem_parts":
      return partiallyRepresented
        ? `OEM support in ${sourceLabel} indicates a fit-sensitive repair path, so test-fit, mock-up, or related finish-sensitive documentation may already be implicated, but current documentation is not shown.`
        : `OEM support in ${sourceLabel} indicates a fit-sensitive repair path, so pre-paint test-fit or mock-up documentation may be needed before final finish work.`;
    default:
      return null;
  }
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  const unique = new Set<string>();

  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized) continue;
    unique.add(normalized);
  }

  return [...unique.values()];
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
    ? "Linked external-document knowledge base"
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

function buildCccWorkfilePromptContext(attachments: StoredAttachment[]) {
  const cccArtifacts = attachments.filter((attachment) =>
    isCccUploadClassification(attachment.classification ?? "text")
  );

  if (!cccArtifacts.length) return "";

  return [
    CCC_WORKFILE_DISCLAIMER,
    ...cccArtifacts.map((attachment) => {
      const metadata = attachment.metadata;
      return [
        `- ${attachment.filename}`,
        `classification=${attachment.classification}`,
        `parserStatus=${metadata?.parserStatus ?? "unknown"}`,
        `sha256=${attachment.sha256 ?? metadata?.sha256 ?? "not recorded"}`,
        `sizeBytes=${attachment.sizeBytes ?? metadata?.sizeBytes ?? "unknown"}`,
      ].join("; ");
    }),
  ].join("\n");
}

function buildCccWorkfileReportContext(
  attachments: StoredAttachment[]
): RepairIntelligenceReport["cccWorkfileContext"] | undefined {
  const artifacts = attachments
    .filter((attachment) => isCccUploadClassification(attachment.classification ?? "text"))
    .map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      classification: attachment.classification as "ccc_workfile" | "ccc_awf" | "ccc_companion_file",
      parserStatus: attachment.metadata?.parserStatus,
      sha256: attachment.sha256 ?? attachment.metadata?.sha256,
      sizeBytes: attachment.sizeBytes ?? attachment.metadata?.sizeBytes,
    }));

  return artifacts.length
    ? {
        disclaimer: CCC_WORKFILE_DISCLAIMER,
        artifacts,
      }
    : undefined;
}

function buildMergedCccWorkfileReportContext(
  existing: RepairIntelligenceReport["cccWorkfileContext"] | undefined,
  attachments: StoredAttachment[]
): RepairIntelligenceReport["cccWorkfileContext"] | undefined {
  const next = buildCccWorkfileReportContext(attachments);
  const artifacts = [...(existing?.artifacts ?? []), ...(next?.artifacts ?? [])];
  const deduped = new Map(artifacts.map((artifact) => [artifact.id, artifact]));

  return deduped.size
    ? {
        disclaimer: CCC_WORKFILE_DISCLAIMER,
        artifacts: [...deduped.values()],
      }
    : undefined;
}

async function generateSupplementCandidates(
  text: string,
  report: RepairIntelligenceReport,
  linkedEvidence: LinkedEvidence[] = [],
  cccWorkfileContext = ""
) {
  if (!text.trim() && !cccWorkfileContext.trim()) return [];

  const requiredProcedures = report.requiredProcedures
    .map((entry) => `- ${entry.procedure}`)
    .join("\n");
  const presentProcedures = report.presentProcedures
    .map((entry) => `- ${entry}`)
    .join("\n");
  const missingProcedures = report.missingProcedures
    .map((entry) => `- ${entry}`)
    .join("\n");
  const linkedProcedureSupport = summarizeReferencedProcedureSupport(linkedEvidence);

  const response = await generateSupplementText({
    openai,
    stage: "analysis_supplement_candidates",
    openAiModel: collisionIqModels.supplement,
    temperature: 0.2,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: `You are reviewing a collision repair estimate.

${NON_BIAS_ACCURACY_DIRECTIVE}

Use the vehicle-specific required procedure context below to decide what functions are not clearly represented.

Important:
- Do NOT assume every vehicle has the same ADAS systems
- Do NOT suggest front camera, radar, blind spot, or other ADAS calibrations unless they are supported by the required procedure context
- Treat referenced OEM/procedure documentation as a real support signal for repair-path reasoning, especially for ADAS, calibration, structural verification, alignment, and fit-check operations
- Treat CCC AWF/workfile context as estimate-structure support for comparison, scrubber review, and supplement assistance only
- But explicitly distinguish when the actual linked document was referenced but not retrieved
- Never represent this system as replacing CCC or generating final CCC estimates
- If a function is already represented in the estimate or present-procedure list, do NOT include it
- Only flag items that are truly unclear or absent
- Consolidate duplicate or overlapping issues into one supportable candidate
- Do not frame a supplement candidate as confirmed unless it is directly documented

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

[CCC AWF / Workfile Context]
${cccWorkfileContext || "- None uploaded"}

[Vehicle-Specific Required Procedures From Linked OEM Support]
${requiredProcedures || "- None provided"}

[Referenced OEM/Procedure Support State]
${linkedProcedureSupport}

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

function summarizeReferencedProcedureSupport(linkedEvidence: LinkedEvidence[]) {
  const lines = linkedEvidence
    .filter((doc) => (doc.inferredProcedureSignals?.length ?? 0) > 0)
    .slice(0, 8)
    .map((doc) => {
      const support = (doc.inferredProcedureSignals ?? [])
        .map((signal) => signal.category.replace(/_/g, " "))
        .filter((value, index, list) => list.indexOf(value) === index)
        .join(", ");
      const status =
        doc.status === "ok"
          ? "retrieved and reviewable"
          : "referenced but not retrieved";

      return `- ${doc.title || "Referenced procedure document"}: ${status}${
        support ? `; directional support for ${support}` : ""
      }`;
    });

  return lines.length > 0
    ? lines.join("\n")
    : "- No referenced procedure support signals were detected.";
}
