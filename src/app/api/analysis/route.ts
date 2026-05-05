import { NextResponse } from "next/server";
import {
  getAnalysisReport,
  saveAnalysisReport,
  updateAnalysisReport,
} from "@/lib/analysisReportStore";
import {
  getUploadedAttachments,
  type StoredAttachment,
} from "@/lib/uploadedAttachmentStore";
import { buildEvidenceCorpus } from "@/lib/analysis/buildEvidenceCorpus";
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
import { collisionIqModels } from "@/lib/modelConfig";
import { openai } from "@/lib/openai";
import { buildWorkspaceDataFromReport } from "@/lib/workspace/buildWorkspaceData";
import { buildLinkedEvidence, type LinkedEvidence } from "@/lib/ingest/fetchLinkedEvidence";
import { redactExternalDocumentUrls } from "@/lib/externalDocuments";
import {
  buildPolicyLegalCitationSnapshotData,
  persistPolicyLegalCitationSnapshot,
} from "@/lib/policyLegal/audit";
import { prisma } from "@/lib/prisma";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";
import {
  UsageAccessError,
  recordCompletedAnalysisUsage,
} from "@/lib/billing/usage";
import { MAX_UPLOAD_BATCH_FILES } from "@/components/chatWidget/attachmentUtils";

export const runtime = "nodejs";

const SUPPLEMENT_MODEL =
  process.env.COLLISION_IQ_SUPPLEMENT_MODEL?.trim() ||
  process.env.COLLISION_IQ_MODEL_PRIMARY?.trim() ||
  process.env.COLLISION_IQ_MODEL?.trim() ||
  collisionIqModels.helper;

type AnalysisRequestBody = {
  artifactIds?: string[];
  activeCaseId?: string | null;
  claimZip?: string | null;
  claimState?: string | null;
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

function assertAnalysisAllowedForEntitlements(
  entitlements: Awaited<ReturnType<typeof getCurrentEntitlements>>,
  isPlatformAdmin: boolean
) {
  if (isPlatformAdmin) {
    return;
  }

  if (!entitlements.featureFlags.uploads) {
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
  try {
    const { user, isPlatformAdmin } = await requireCurrentUser();
    const entitlements = await getCurrentEntitlements();
    const body = (await req.json()) as AnalysisRequestBody;
    const artifactIds = body.artifactIds ?? [];

    if (!artifactIds.length) {
      return NextResponse.json(
        { error: "artifactIds are required" },
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
      userIntent: body.userIntent ?? null,
    });
    const attachmentFilesForLinks = normalizedAttachments.map((attachment) => ({
      name: attachment.filename,
      text: attachment.text,
      summary: null,
    }));
    const linkedEvidence = await buildLinkedEvidence({
      estimateText: normalizedAttachments.map((attachment) => attachment.text).join("\n\n"),
      files: attachmentFilesForLinks,
    });
    const linkedEvidenceAttachments = linkedEvidenceToAttachments(linkedEvidence);
    const preloadedAttachments = [
      ...normalizedAttachments,
      ...linkedEvidenceAttachments,
    ];

    const retrievalAttempted = true;
    let retrievalCompleted = false;
    let retrievalMatchCount = 0;
    let refinedWithRetrieval = false;
    let report = await runRepairAnalysis({
      artifactIds,
      preloadedAttachments,
      sessionContext: body.sessionContext ?? null,
      userIntent: body.userIntent ?? null,
      claimZip: body.claimZip ?? null,
      claimState: body.claimState ?? null,
      policyContext: {
        active_case_id: body.activeCaseId ?? null,
      },
    });
    report = applyLinkedEvidenceToReport({
      report,
      uploadedAttachments: normalizedAttachments,
      linkedEvidence,
      activeCaseId: body.activeCaseId ?? null,
      previousReport: existingCase?.report ?? null,
      userIntent: body.userIntent ?? null,
      uploadLimitReached: artifactIds.length >= MAX_UPLOAD_BATCH_FILES,
      totalUploadedFileCount: mergeArtifactIds(existingCase?.artifactIds ?? [], artifactIds).length,
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
      report,
      linkedEvidence
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

    if (stored.report.policyLegalReview) {
      const snapshotData = buildPolicyLegalCitationSnapshotData({
        caseId: stored.id,
        claimId: null,
        review: stored.report.policyLegalReview,
        generatedAt: new Date(),
      });

      await persistPolicyLegalCitationSnapshot({
        data: snapshotData,
        createSnapshot: (data) =>
          prisma.policyLegalReviewSnapshot.create({
            data,
          }),
      });
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

    const workspaceData = buildWorkspaceDataFromReport(stored.report);

    return NextResponse.json({
      reportId: stored.id,
      createdAt: stored.createdAt,
      report: stored.report,
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

function applyLinkedEvidenceToReport(params: {
  report: RepairIntelligenceReport;
  uploadedAttachments: StoredAttachment[];
  linkedEvidence: LinkedEvidence[];
  activeCaseId?: string | null;
  previousReport?: RepairIntelligenceReport | null;
  userIntent?: string | null;
  uploadLimitReached?: boolean;
  totalUploadedFileCount?: number;
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

  const nextReport: RepairIntelligenceReport = {
    ...params.report,
    issues,
    sourceEstimateText: evidenceCorpus || params.report.sourceEstimateText,
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
      uploadedFileCount: params.totalUploadedFileCount ?? params.uploadedAttachments.length,
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
          : undefined,
      ingestionState: "uploaded" as const,
      evidenceStatus: attachment.type.startsWith("image/")
        ? ("VISIBLE_IN_IMAGES" as const)
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

  if (attachment.type.startsWith("image/")) return "photo";
  if (
    /(sublet|vendor|specialty|calibration sublet|scan sublet|glass|alignment)/i.test(text) &&
    /(invoice|bill|repair order|ro #|statement)/i.test(text)
  ) {
    return "sublet_document";
  }
  if (text.includes("invoice") || text.includes("repair order") || text.includes("ro #")) {
    return "invoice";
  }
  if (text.includes("carrier") || text.includes("insurance estimate")) return "carrier_estimate";
  if (text.includes("shop") || text.includes("repair facility")) return "shop_estimate";
  if (text.includes("supplement")) return "supplement";
  if (text.includes("scan")) return "scan_report";
  if (text.includes("calibration")) return "calibration_report";
  if (text.includes("adas")) return "adas_report";
  if (text.includes("oem") || text.includes("procedure")) return "oem_documentation";
  return "other_supporting_document";
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
  const response = await openai.responses.create({
    model: collisionIqModels.primary,
    temperature: 0.2,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: `You are a collision repair decision engine.

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

async function generateSupplementCandidates(
  text: string,
  report: RepairIntelligenceReport,
  linkedEvidence: LinkedEvidence[] = []
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
  const linkedProcedureSupport = summarizeReferencedProcedureSupport(linkedEvidence);

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

${NON_BIAS_ACCURACY_DIRECTIVE}

Use the vehicle-specific required procedure context below to decide what functions are not clearly represented.

Important:
- Do NOT assume every vehicle has the same ADAS systems
- Do NOT suggest front camera, radar, blind spot, or other ADAS calibrations unless they are supported by the required procedure context
- Treat referenced OEM/procedure documentation as a real support signal for repair-path reasoning, especially for ADAS, calibration, structural verification, alignment, and fit-check operations
- But explicitly distinguish when the actual linked document was referenced but not retrieved
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
