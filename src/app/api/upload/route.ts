import { NextResponse } from "next/server";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";
import { isPlatformAdminEmail, maskEmail, normalizeEmail } from "@/lib/auth/platform-admin";
import {
  canUploadFiles as resolveCanUploadFiles,
  getCurrentProductEntitlements,
  getCurrentSubscriptionTierForUser,
  resolveProductTrialActive,
} from "@/lib/billing/productEntitlements";
import {
  FREE_MONTHLY_UPLOAD_LIMIT,
  FREE_UPLOAD_BATCH_MESSAGE,
  FREE_UPLOAD_LIMIT_MESSAGE,
  evaluateFreeUploadRequest,
  getFreeUploadUsageCount,
  isFreeUploadEntitlement,
  recordFreeUploadUsage,
} from "@/lib/billing/freeUploadEntitlements";
import { UsageAccessError, recordUsage } from "@/lib/billing/usage";
import { getUsageCount, incrementUsage } from "@/lib/usage";
import { saveUploadedAttachment } from "@/lib/uploadedAttachmentStore";
import { getAnalysisReport } from "@/lib/analysisReportStore";
import {
  bufferToReusableDataUrl,
  extractPreviewDataFromBuffer,
} from "@/lib/attachments/extractPreviewData";
import {
  isCccUploadClassification,
  parseCccWorkfileArtifact,
  type CccWorkfileMetadata,
  type UploadClassification,
} from "@/lib/ccc/cccWorkfile";
import {
  formatUploadLimitBytes,
  getUploadBatchLimitMessage,
  resolveUploadPlanLimits,
} from "@/lib/uploadSafety/uploadLimits";
import {
  isVideoExtension,
} from "@/lib/uploadSafety/videoSafety";
import {
  isDatabaseUnavailableError,
  sanitizeDatabaseErrorForLog,
} from "@/lib/database/health";
import {
  getUploadExtension,
  isZipUpload,
  prepareUploadFile,
  type PreparedUploadFile,
  type ZipExtractionSummary,
} from "@/lib/uploadSafety/zipSafety";

export const runtime = "nodejs";

const MULTIPART_BODY_OVERHEAD_BYTES = 2 * 1024 * 1024;
const RUNTIME_LIMIT_MESSAGE =
  "This upload is too large for the standard upload route. Large ZIP and video uploads should use the direct storage upload path for your plan.";

type UploadSuccess = {
  attachmentId: string;
  filename: string;
  type: string;
  sizeBytes: number;
  source: "direct_upload" | "zip_extraction";
  sourceArchive?: string;
  classification: UploadClassification;
  metadata?: CccWorkfileMetadata;
  sha256?: string;
  text: string;
  imageDataUrl?: string;
  pageCount?: number;
  hasVision: boolean;
  caseContinuity: {
    activeCaseId: string;
    reportId: string;
    sameCaseFollowUp: boolean;
    attachmentIds: string[];
  } | null;
};

type UploadFailure = {
  filename: string;
  reason: string;
  code?: string;
};

type UploadTelemetry = {
  rawUploadSize: number;
  extractedFileCount: number;
  rejectedFileCount: number;
  extractedTotalSize: number;
  planLimitUsed: {
    plan: string;
    targetMaxUploadBytes: number;
    runtimeMaxUploadBytes: number;
    maxUploadBytes: number;
    maxFilesPerReview: number;
    zipAllowed: boolean;
    maxZipCompressedBytes: number;
    cccWorkfileAllowed: boolean;
    maxExtractedFiles: number;
    maxExtractedTotalBytes: number;
    maxZipNestingDepth: number;
    videoAllowed: boolean;
    maxVideoBytes: number;
    maxVideosPerReview: number;
    videoMaxDurationSeconds: number;
  };
};

function getRuntimeMaxBodyBytes(uploadLimits: ReturnType<typeof resolveUploadPlanLimits>) {
  return Math.max(
    uploadLimits.maxUploadBytes,
    uploadLimits.zipAllowed ? uploadLimits.maxZipCompressedBytes : 0,
    uploadLimits.videoAllowed ? uploadLimits.maxVideoBytes : 0
  ) + MULTIPART_BODY_OVERHEAD_BYTES;
}

function getFailureStatus(failedUploads: UploadFailure[]) {
  if (failedUploads.some((failure) => failure.code === "UPLOAD_QUOTA_REACHED")) {
    return 403;
  }

  if (failedUploads.some((failure) => failure.code === "FILE_TOO_LARGE" || failure.code === "ZIP_TOO_LARGE")) {
    return 413;
  }

  return 400;
}

function getUploadFiles(formData: FormData): File[] {
  const candidates = [
    ...formData.getAll("file"),
    ...formData.getAll("files"),
  ];

  return candidates.filter((value): value is File => value instanceof File);
}

function getContentLength(req: Request) {
  const raw = req.headers.get("content-length");
  if (!raw) return null;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function readUploadFormData(req: Request, params: {
  runtimeMaxBodyBytes: number;
  planMaxUploadBytes: number;
}) {
  const contentLength = getContentLength(req);
  if (contentLength !== null && contentLength > params.runtimeMaxBodyBytes) {
    return {
      error: NextResponse.json(
        {
          error: RUNTIME_LIMIT_MESSAGE,
          code: "RUNTIME_BODY_LIMIT_EXCEEDED",
          runtimeMaxBodyBytes: params.runtimeMaxBodyBytes,
          planMaxUploadBytes: params.planMaxUploadBytes,
          temporaryPlatformLimit: true,
        },
        { status: 413 }
      ),
    };
  }

  try {
    return { formData: await req.formData() };
  } catch (error) {
    console.info("[upload] multipart body parse failed", {
      code: "UPLOAD_BODY_PARSE_FAILED",
      contentLength,
      runtimeMaxBodyBytes: params.runtimeMaxBodyBytes,
      planMaxUploadBytes: params.planMaxUploadBytes,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      error: NextResponse.json(
        {
          error:
            "Upload body could not be read by the standard upload route. Retry with the direct large-file upload path, or upload a smaller file.",
          code: "UPLOAD_BODY_PARSE_FAILED",
          runtimeMaxBodyBytes: params.runtimeMaxBodyBytes,
          planMaxUploadBytes: params.planMaxUploadBytes,
          temporaryPlatformLimit: true,
        },
        { status: 413 }
      ),
    };
  }
}

function buildUploadTelemetry(params: {
  rawUploadSize: number;
  zipSummaries: ZipExtractionSummary[];
  failedUploads: UploadFailure[];
  uploadLimits: ReturnType<typeof resolveUploadPlanLimits>;
}): UploadTelemetry {
  return {
    rawUploadSize: params.rawUploadSize,
    extractedFileCount: params.zipSummaries.reduce(
      (sum, summary) => sum + summary.acceptedFiles,
      0
    ),
    rejectedFileCount: params.failedUploads.length,
    extractedTotalSize: params.zipSummaries.reduce(
      (sum, summary) => sum + summary.extractedBytes,
      0
    ),
    planLimitUsed: {
      plan: params.uploadLimits.plan,
      targetMaxUploadBytes: params.uploadLimits.maxUploadBytes,
      runtimeMaxUploadBytes: getRuntimeMaxBodyBytes(params.uploadLimits),
      maxUploadBytes: params.uploadLimits.maxUploadBytes,
      maxFilesPerReview: params.uploadLimits.maxFilesPerReview,
      zipAllowed: params.uploadLimits.zipAllowed,
      maxZipCompressedBytes: params.uploadLimits.maxZipCompressedBytes,
      cccWorkfileAllowed: params.uploadLimits.cccWorkfileAllowed,
      maxExtractedFiles: params.uploadLimits.maxExtractedFiles,
      maxExtractedTotalBytes: params.uploadLimits.maxExtractedTotalBytes,
      maxZipNestingDepth: params.uploadLimits.maxZipNestingDepth,
      videoAllowed: params.uploadLimits.videoAllowed,
      maxVideoBytes: params.uploadLimits.maxVideoBytes,
      maxVideosPerReview: params.uploadLimits.maxVideosPerReview,
      videoMaxDurationSeconds: params.uploadLimits.videoMaxDurationSeconds,
    },
  };
}

export async function POST(req: Request) {
  let _debugStep = "requireCurrentUser";
  try {
    // _debugStep tracks where a throw occurred for debug logging
    const { user, verifiedEmails, isPlatformAdmin } = await requireCurrentUser();
    _debugStep = "subscriptionTier";
    const normalizedEmail = normalizeEmail(user.email);
    const isEnvAdmin = isPlatformAdminEmail(normalizedEmail);
    const effectiveIsAdmin = isPlatformAdmin || isEnvAdmin;
    const subscriptionTier = await getCurrentSubscriptionTierForUser(user.id);
    _debugStep = "entitlements";
    const trialActive = resolveProductTrialActive({
      activeSubscriptionId: subscriptionTier ? "active-subscription" : null,
      activeSubscriptionStatus:
        subscriptionTier === "trial" ? "TRIALING" : subscriptionTier ? "ACTIVE" : null,
      createdAt: user.createdAt,
      plan: subscriptionTier ?? "pro",
    });
    const entitlements = await getCurrentProductEntitlements({
      userEmail: normalizedEmail,
      userEmails: verifiedEmails,
      trialActive,
      subscriptionTier,
      isPlatformAdmin: effectiveIsAdmin,
    });
    const canUploadFiles = resolveCanUploadFiles(entitlements);
    const uploadLimits = resolveUploadPlanLimits(entitlements);
    _debugStep = "formData";
    const isFreeUploadPlan = isFreeUploadEntitlement({
      ...entitlements,
      isPlatformAdmin: effectiveIsAdmin,
    });
    // Multipart is parsed once here; the ZIP itself is never sent through chat JSON.
    const runtimeMaxUploadBytes = getRuntimeMaxBodyBytes(uploadLimits);

    if (!canUploadFiles) {
      console.info("[upload] request rejected", {
        userId: user.id,
        email: maskEmail(normalizedEmail),
        plan: entitlements.plan,
        trialActive: entitlements.trialActive,
        isAdmin: effectiveIsAdmin,
        canUploadFiles,
        maxUploadsPerReview: entitlements.maxUploadsPerReview,
      });
      return NextResponse.json(
        {
          error: "Uploads are not included in your current plan.",
          code: "UNAUTHORIZED",
          successfulUploads: [],
          failedUploads: [],
          documents: [],
        },
        { status: 403 }
      );
    }

    const parsedBody = await readUploadFormData(req, {
      runtimeMaxBodyBytes: runtimeMaxUploadBytes,
      planMaxUploadBytes: uploadLimits.maxUploadBytes,
    });
    if (parsedBody.error) {
      return parsedBody.error;
    }

    const formData = parsedBody.formData;
    const files = getUploadFiles(formData);
    const activeCaseId = String(formData.get("activeCaseId") ?? "").trim() || null;
    const rawUploadSize = files.reduce((sum, file) => sum + file.size, 0);

    if (!files.length) {
      return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
    }

    let freeUploadsUsed: number | null = null;

    if (isFreeUploadPlan) {
      const freeFileInputs = files.map((file) => ({
        filename: file.name,
        type: file.type,
      }));

      const preUsageFreeRequest = evaluateFreeUploadRequest({
        files: freeFileInputs,
        used: 0,
      });

      if (preUsageFreeRequest.code === "FREE_UPLOAD_BATCH_LIMIT") {
        return NextResponse.json(
          {
            error: FREE_UPLOAD_BATCH_MESSAGE,
            code: "FREE_UPLOAD_BATCH_LIMIT",
            successfulUploads: [],
            failedUploads: files.map((file) => ({
              filename: file.name,
              reason: FREE_UPLOAD_BATCH_MESSAGE,
              code: "FREE_UPLOAD_BATCH_LIMIT",
            })),
            documents: [],
          },
          { status: 400 }
        );
      }

      const freeFile = files[0];
      if (preUsageFreeRequest.code === "FREE_UPLOAD_FILE_TYPE_LIMIT") {
        return NextResponse.json(
          {
            error: preUsageFreeRequest.message,
            code: preUsageFreeRequest.code,
            successfulUploads: [],
            failedUploads: [
              {
                filename: freeFile.name,
                reason: preUsageFreeRequest.message,
                code: preUsageFreeRequest.code,
              },
            ],
            documents: [],
          },
          { status: 400 }
        );
      }

      try {
        freeUploadsUsed = await getFreeUploadUsageCount({ userId: user.id });
      } catch (error) {
        console.error("[upload] free monthly usage read failed", {
          userId: user.id,
          error,
        });
        return NextResponse.json(
          {
            error: "Upload usage could not be verified. Please try again in a moment.",
            code: "UPLOAD_USAGE_UNAVAILABLE",
            successfulUploads: [],
            failedUploads: [],
            documents: [],
          },
          { status: 503 }
        );
      }

      const freeQuota = evaluateFreeUploadRequest({
        files: freeFileInputs,
        used: freeUploadsUsed,
      });

      if (!freeQuota.allowed && freeQuota.code === "FREE_MONTHLY_UPLOAD_LIMIT_REACHED") {
        return NextResponse.json(
          {
            error: FREE_UPLOAD_LIMIT_MESSAGE,
            code: "FREE_MONTHLY_UPLOAD_LIMIT_REACHED",
            successfulUploads: [],
            failedUploads: [
              {
                filename: freeFile.name,
                reason: FREE_UPLOAD_LIMIT_MESSAGE,
                code: "FREE_MONTHLY_UPLOAD_LIMIT_REACHED",
              },
            ],
            usage: {
              uploadCount: freeUploadsUsed,
              uploadCap: FREE_MONTHLY_UPLOAD_LIMIT,
              plan: entitlements.plan,
              billingPlan: entitlements.billingPlan,
            },
            documents: [],
          },
          { status: 403 }
        );
      }
    }

    const activeCase = activeCaseId
      ? await getAnalysisReport(activeCaseId, { ownerUserId: user.id })
      : null;

    if (activeCaseId) {
      console.info("[upload] resolved active case for follow-up upload", {
        activeCaseId,
        hasActiveCase: Boolean(activeCase),
        ownerUserId: user.id,
      });
    }

    const successfulUploads: UploadSuccess[] = [];
    const failedUploads: UploadFailure[] = [];
    let uploadsUsed = entitlements.uploadCount;
    if (freeUploadsUsed !== null) {
      uploadsUsed = freeUploadsUsed;
    }

    if (!isFreeUploadPlan && !effectiveIsAdmin && entitlements.uploadCap !== null) {
      try {
        uploadsUsed = await getUsageCount(user.id, "FILE_UPLOAD");
      } catch (error) {
        console.error("[upload] usage read failed during processing (non-blocking)", {
          userId: user.id,
          error,
        });
      }
    }

    console.info("[upload] accepted", {
      totalBytes: rawUploadSize,
      fileCount: files.length,
      maxFileCount: uploadLimits.maxFilesPerReview,
      maxFileBytes: uploadLimits.maxUploadBytes,
      runtimeMaxFileBytes: runtimeMaxUploadBytes,
      ownerUserId: user.id,
      activeCaseId,
      sameCaseFollowUp: Boolean(activeCase),
      entitlement: {
        plan: entitlements.plan,
        billingPlan: entitlements.billingPlan,
        subscriptionStatus: entitlements.subscriptionStatus,
        canUpload: entitlements.canUpload,
        canUploadFiles,
        uploadCount: uploadsUsed,
        uploadCap: isFreeUploadPlan ? FREE_MONTHLY_UPLOAD_LIMIT : entitlements.uploadCap,
        freeRollingUploadCount: freeUploadsUsed,
        maxUploadsPerReview: entitlements.maxUploadsPerReview,
        uploadLimits,
        usageStatus: entitlements.usageStatus,
        trialActive: entitlements.trialActive,
        isPlatformAdmin,
        isEnvAdmin,
        effectiveIsAdmin,
      },
      files: files.map((file, index) => ({
        index,
        filename: file.name,
        mimeType: file.type || "unknown",
        sizeBytes: file.size,
      })),
    });

    const zipSummaries: ZipExtractionSummary[] = [];

    for (const [index, file] of files.entries()) {
      const maxFilesPerReview = uploadLimits.maxFilesPerReview;
      if (index >= maxFilesPerReview) {
        failedUploads.push({
          filename: file.name,
          reason: getUploadBatchLimitMessage(uploadLimits),
          code: "MAX_FILES_REACHED",
        });
        console.info("[upload] file rejected", {
          filename: file.name,
          code: "MAX_FILES_REACHED",
          fileIndex: index,
          maxFileCount: maxFilesPerReview,
          ownerUserId: user.id,
        });
        continue;
      }

      const isZip = isZipUpload(file);
      const isVideo = isVideoExtension(getUploadExtension(file.name));
      const maxFileBytes = isZip
        ? uploadLimits.maxZipCompressedBytes
        : isVideo
          ? uploadLimits.maxVideoBytes
          : uploadLimits.maxUploadBytes;

      if (file.size > maxFileBytes) {
        failedUploads.push({
          filename: file.name,
          reason: isZip
            ? `ZIP archive exceeds ${formatUploadLimitBytes(uploadLimits.maxZipCompressedBytes)} plan limit.`
            : `File exceeds ${formatUploadLimitBytes(maxFileBytes)} limit (${formatUploadLimitBytes(file.size)}).`,
          code: isZip ? "ZIP_TOO_LARGE" : "FILE_TOO_LARGE",
        });
        console.info("[upload] file rejected", {
          filename: file.name,
          code: isZip ? "ZIP_TOO_LARGE" : "FILE_TOO_LARGE",
          sizeBytes: file.size,
          maxFileBytes,
          runtimeMaxFileBytes: runtimeMaxUploadBytes,
          ownerUserId: user.id,
        });
        continue;
      }

      if (file.size > runtimeMaxUploadBytes) {
        failedUploads.push({
          filename: file.name,
          reason: RUNTIME_LIMIT_MESSAGE,
          code: "RUNTIME_BODY_LIMIT_EXCEEDED",
        });
        console.info("[upload] file rejected", {
          filename: file.name,
          code: "RUNTIME_BODY_LIMIT_EXCEEDED",
          sizeBytes: file.size,
          runtimeMaxFileBytes: runtimeMaxUploadBytes,
          planMaxFileBytes: maxFileBytes,
          ownerUserId: user.id,
        });
        continue;
      }

      if (isZip && !uploadLimits.zipAllowed) {
        failedUploads.push({
          filename: file.name,
          reason: "ZIP uploads are not included in your current plan. Upgrade to Starter, Pro, or Admin to upload ZIP archives.",
          code: "ZIP_DISALLOWED_TYPE",
        });
        continue;
      }

      if (isVideo && !uploadLimits.videoAllowed) {
        failedUploads.push({
          filename: file.name,
          reason: "Video uploads are available on Pro and Admin plans.",
          code: "VIDEO_PLAN_REQUIRED",
        });
        continue;
      }

      if (
        !effectiveIsAdmin &&
        entitlements.uploadCap !== null &&
        uploadsUsed + successfulUploads.length >= entitlements.uploadCap
      ) {
        failedUploads.push({
          filename: file.name,
          reason: "Upload quota reached for your plan.",
          code: "UPLOAD_QUOTA_REACHED",
        });
        console.info("[upload] file rejected", {
          filename: file.name,
          code: "UPLOAD_QUOTA_REACHED",
          uploadCount: uploadsUsed,
          uploadCap: entitlements.uploadCap,
          successfulInRequest: successfulUploads.length,
          ownerUserId: user.id,
          plan: entitlements.plan,
          billingPlan: entitlements.billingPlan,
        });
        continue;
      }

      try {
        const prepared = await prepareUploadFile(file, uploadLimits);
        zipSummaries.push(...prepared.zipSummaries);
        failedUploads.push(...prepared.rejectedFiles);

        if (isZip) {
          for (const summary of prepared.zipSummaries) {
            console.info("[upload] zip extraction", {
              archive: summary.archive,
              sizeBytes: file.size,
              entryCount: summary.entryCount,
              totalUncompressedSize: summary.extractedBytes,
              acceptedEntries: summary.acceptedEntries,
              acceptedEntryCount: summary.acceptedFiles,
              rejectedEntries: summary.rejectedEntries,
              ownerUserId: user.id,
            });
          }
        }

        for (const preparedFile of prepared.files) {
          if (
            !effectiveIsAdmin &&
            entitlements.uploadCap !== null &&
            uploadsUsed + successfulUploads.length >= entitlements.uploadCap
          ) {
            failedUploads.push({
              filename: preparedFile.filename,
              reason: "Upload quota reached for your plan.",
              code: "UPLOAD_QUOTA_REACHED",
            });
            continue;
          }

          const storedUpload = await processPreparedUpload({
            file: preparedFile,
            ownerUserId: user.id,
            activeCaseId,
            activeCase,
            maxImageDataUrlBytes: uploadLimits.maxUploadBytes,
          });

          if (isFreeUploadPlan) {
            await recordFreeUploadUsage({
              userId: user.id,
              metadataJson: {
                source: "free_upload",
                fileName: preparedFile.filename,
                fileSize: preparedFile.buffer.byteLength,
                classification: preparedFile.classification,
                attachmentId: storedUpload.attachmentId,
              },
            });
          }

          successfulUploads.push(storedUpload);

          console.info("[upload] attachment stored", {
            attachmentId: storedUpload.attachmentId,
            filename: storedUpload.filename,
            mimeType: storedUpload.type || "unknown",
            textLength: storedUpload.text.length,
            pageCount: storedUpload.pageCount ?? null,
            hasImageDataUrl: Boolean(storedUpload.imageDataUrl),
            ownerUserId: user.id,
            activeCaseId,
            sameCaseFollowUp: Boolean(activeCase),
            sourceArchive: preparedFile.sourceArchive ?? null,
            classification: preparedFile.classification,
          });

          if (activeCase) {
            console.info("[upload] returned same-case continuity", {
              activeCaseId: activeCase.id,
              reportId: activeCase.id,
              attachmentIds: [storedUpload.attachmentId],
              sameCaseFollowUp: true,
            });
          }

          if (!effectiveIsAdmin && !isFreeUploadPlan) {
            try {
              await recordUsage({
                userId: user.id,
                kind: "FILE_UPLOAD",
                metadataJson: {
                  source: preparedFile.sourceArchive ? "zip_upload" : "upload",
                  fileName: preparedFile.filename,
                  fileSize: preparedFile.buffer.byteLength,
                  classification: preparedFile.classification,
                  attachmentId: storedUpload.attachmentId,
                  sourceArchive: preparedFile.sourceArchive,
                },
              });
            } catch (error) {
              console.error("[upload] usage tracking failed (non-blocking)", {
                phase: "recordUsage",
                userId: user.id,
                fileName: preparedFile.filename,
                error,
              });
            }

            try {
              await incrementUsage(user.id, "FILE_UPLOAD");
            } catch (error) {
              console.error("[upload] usage tracking failed (non-blocking)", {
                phase: "incrementUsage",
                userId: user.id,
                fileName: preparedFile.filename,
                error,
              });
            }
          }
        }
      } catch (error) {
        console.error("[upload] file processing failed", {
          filename: file.name,
          mimeType: file.type || "unknown",
          sizeBytes: file.size,
          ownerUserId: user.id,
          error,
        });
        const zipProcessingFailed = isZip;
        failedUploads.push({
          filename: file.name,
          reason: zipProcessingFailed
            ? "ZIP could not be extracted safely. Check that it is not corrupted, encrypted, or too large."
            : error instanceof Error
              ? error.message
              : "Upload processing failed.",
          code: zipProcessingFailed ? "ZIP_CORRUPT" : "FILE_PROCESSING_FAILED",
        });
      }
    }

    if (!successfulUploads.length) {
      const telemetry = buildUploadTelemetry({
        rawUploadSize,
        zipSummaries,
        failedUploads,
        uploadLimits,
      });
      console.info("[upload] completed", {
        ownerUserId: user.id,
        successfulCount: successfulUploads.length,
        ...telemetry,
      });

      return NextResponse.json(
        {
          error: failedUploads[0]?.code ?? failedUploads[0]?.reason ?? "No files could be uploaded.",
          message: failedUploads[0]?.reason ?? "No files could be uploaded.",
          code: failedUploads[0]?.code ?? "UPLOAD_FAILED",
          limits: {
            maxFiles: uploadLimits.maxFilesPerReview,
            maxFileBytes: uploadLimits.maxUploadBytes,
            runtimeMaxFileBytes: runtimeMaxUploadBytes,
            temporaryPlatformLimit: false,
            zipAllowed: uploadLimits.zipAllowed,
            maxZipCompressedBytes: uploadLimits.maxZipCompressedBytes,
            maxExtractedFiles: uploadLimits.maxExtractedFiles,
            maxExtractedTotalBytes: uploadLimits.maxExtractedTotalBytes,
            maxZipNestingDepth: uploadLimits.maxZipNestingDepth,
            videoAllowed: uploadLimits.videoAllowed,
            maxVideoBytes: uploadLimits.maxVideoBytes,
            maxVideosPerReview: uploadLimits.maxVideosPerReview,
            videoMaxDurationSeconds: uploadLimits.videoMaxDurationSeconds,
            cccWorkfileAllowed: uploadLimits.cccWorkfileAllowed,
          },
          zipSummaries,
          telemetry,
          usage: {
          uploadCount: uploadsUsed,
          uploadCap: isFreeUploadPlan ? FREE_MONTHLY_UPLOAD_LIMIT : entitlements.uploadCap,
          plan: entitlements.plan,
          billingPlan: entitlements.billingPlan,
        },
          successfulUploads,
          failedUploads,
          files: [],
          documents: [],
        },
        { status: getFailureStatus(failedUploads) }
      );
    }

    const firstUpload = successfulUploads[0];
    const telemetry = buildUploadTelemetry({
      rawUploadSize,
      zipSummaries,
      failedUploads,
      uploadLimits,
    });
    console.info("[upload] completed", {
      ownerUserId: user.id,
      successfulCount: successfulUploads.length,
      ...telemetry,
    });

    const responseBody = {
      ...firstUpload,
      limits: {
        maxFiles: uploadLimits.maxFilesPerReview,
        maxFileBytes: uploadLimits.maxUploadBytes,
        runtimeMaxFileBytes: runtimeMaxUploadBytes,
        temporaryPlatformLimit: false,
        zipAllowed: uploadLimits.zipAllowed,
        maxZipCompressedBytes: uploadLimits.maxZipCompressedBytes,
        cccWorkfileAllowed: uploadLimits.cccWorkfileAllowed,
        maxExtractedFiles: uploadLimits.maxExtractedFiles,
        maxExtractedTotalBytes: uploadLimits.maxExtractedTotalBytes,
        maxZipNestingDepth: uploadLimits.maxZipNestingDepth,
        videoAllowed: uploadLimits.videoAllowed,
        maxVideoBytes: uploadLimits.maxVideoBytes,
        maxVideosPerReview: uploadLimits.maxVideosPerReview,
        videoMaxDurationSeconds: uploadLimits.videoMaxDurationSeconds,
      },
      zipSummaries,
      telemetry,
      usage: {
        uploadCount: uploadsUsed + successfulUploads.length,
        uploadCap: isFreeUploadPlan ? FREE_MONTHLY_UPLOAD_LIMIT : entitlements.uploadCap,
        plan: entitlements.plan,
        billingPlan: entitlements.billingPlan,
      },
      successfulUploads,
      files: successfulUploads.map((upload) => ({
        id: upload.attachmentId,
        name: upload.filename,
        size: upload.sizeBytes,
        type: upload.type,
      })),
      failedUploads,
      documents: successfulUploads.map((upload) => ({
        filename: upload.filename,
        type: upload.type,
        sizeBytes: upload.sizeBytes,
        source: upload.source,
        sourceArchive: upload.sourceArchive,
        classification: upload.classification,
        metadata: upload.metadata,
        sha256: upload.sha256,
        text: upload.text,
        pageCount: upload.pageCount,
        imageDataUrl: upload.imageDataUrl,
        attachmentId: upload.attachmentId,
      })),
    };

    return NextResponse.json(responseBody, {
      status: failedUploads.length ? 207 : 200,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof UsageAccessError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }

    if (isDatabaseUnavailableError(error)) {
      console.error("[upload] database unavailable", {
        step: _debugStep,
        error: sanitizeDatabaseErrorForLog(error),
      });
      return NextResponse.json(
        {
          error: "Database temporarily unavailable. Please retry shortly.",
          code: "DATABASE_UNAVAILABLE",
        },
        { status: 503 }
      );
    }

    const _errName = error instanceof Error ? error.name : typeof error;
    const _errMsg = error instanceof Error ? error.message : String(error);
    const _errStack = error instanceof Error ? (error.stack ?? "").slice(0, 800) : "";
    console.error("[upload] fatal", { step: _debugStep, errorName: _errName, errorMessage: _errMsg, stack: _errStack });
    return NextResponse.json({
      error: "SERVER_ERROR",
    }, { status: 500 });
  }
}

async function processPreparedUpload(params: {
  file: PreparedUploadFile;
  ownerUserId: string;
  activeCaseId: string | null;
  activeCase: Awaited<ReturnType<typeof getAnalysisReport>>;
  maxImageDataUrlBytes: number;
}): Promise<UploadSuccess> {
  const cccParsed = isCccUploadClassification(params.file.classification)
    ? parseCccWorkfileArtifact({
        filename: params.file.filename,
        mimeType: params.file.type,
        buffer: params.file.buffer,
        classification: params.file.classification,
      })
    : null;
  const previewData = cccParsed
    ? { text: cccParsed.text }
    : await extractPreviewDataFromBuffer({
        buffer: params.file.buffer,
        mimeType: params.file.type,
        filename: params.file.filename,
      });
  const imageDataUrl = bufferToReusableDataUrl({
    buffer: params.file.buffer,
    mimeType: params.file.type,
    maxBytes: params.file.classification === "image"
      ? params.maxImageDataUrlBytes
      : undefined,
  });

  const stored = await saveUploadedAttachment({
    ownerUserId: params.ownerUserId,
    filename: params.file.filename,
    type: params.file.type,
    text: previewData.text,
    imageDataUrl,
    pageCount: previewData.pageCount,
    classification: params.file.classification,
    sizeBytes: params.file.sizeBytes,
    sha256: cccParsed?.metadata.sha256,
    metadata: cccParsed?.metadata,
    source: params.file.source,
    sourceArchive: params.file.sourceArchive,
  });

  const caseContinuity = params.activeCase
    ? {
        activeCaseId: params.activeCase.id,
        reportId: params.activeCase.id,
        sameCaseFollowUp: true,
        attachmentIds: [stored.id],
      }
    : params.activeCaseId
      ? {
          activeCaseId: params.activeCaseId,
          reportId: params.activeCaseId,
          sameCaseFollowUp: false,
          attachmentIds: [stored.id],
        }
      : null;

  return {
    attachmentId: stored.id,
    filename: stored.filename,
    type: stored.type,
    sizeBytes: params.file.sizeBytes,
    source: params.file.source,
    sourceArchive: params.file.sourceArchive,
    classification: params.file.classification,
    metadata: cccParsed?.metadata,
    sha256: cccParsed?.metadata.sha256,
    text: stored.text,
    imageDataUrl: stored.imageDataUrl,
    pageCount: stored.pageCount,
    hasVision: params.file.classification === "image" && Boolean(stored.imageDataUrl),
    caseContinuity,
  };
}
