import { del } from "@vercel/blob";
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
import { UsageAccessError, recordUsage } from "@/lib/billing/usage";
import { incrementUsage } from "@/lib/usage";
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
import { isDatabaseUnavailableError, sanitizeDatabaseErrorForLog } from "@/lib/database/health";
import { saveUploadedAttachment } from "@/lib/uploadedAttachmentStore";
import {
  formatUploadLimitBytes,
  getUploadBatchLimitMessage,
  resolveUploadPlanLimits,
} from "@/lib/uploadSafety/uploadLimits";
import {
  getUploadExtension,
  isZipUpload,
  prepareUploadFile,
  type PreparedUploadFile,
  type ZipExtractionSummary,
} from "@/lib/uploadSafety/zipSafety";
import { validateDirectUploadCandidate } from "@/lib/uploadSafety/directUploadRouting";
import { isVideoExtension } from "@/lib/uploadSafety/videoSafety";

export const runtime = "nodejs";

type FinalizeRequest = {
  url?: string;
  downloadUrl?: string;
  pathname?: string;
  filename?: string;
  contentType?: string;
  sizeBytes?: number;
  activeCaseId?: string | null;
};

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

function getFailureStatus(failedUploads: UploadFailure[]) {
  if (failedUploads.some((failure) => failure.code === "FILE_TOO_LARGE" || failure.code === "ZIP_TOO_LARGE")) {
    return 413;
  }
  if (failedUploads.some((failure) => failure.code === "UPLOAD_QUOTA_REACHED")) {
    return 403;
  }
  return 400;
}

async function resolveUploadContext() {
  const { user, verifiedEmails, isPlatformAdmin } = await requireCurrentUser();
  const normalizedEmail = normalizeEmail(user.email);
  const isEnvAdmin = isPlatformAdminEmail(normalizedEmail);
  const effectiveIsAdmin = isPlatformAdmin || isEnvAdmin;
  const subscriptionTier = await getCurrentSubscriptionTierForUser(user.id);
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

  return {
    user,
    normalizedEmail,
    entitlements,
    effectiveIsAdmin,
    uploadLimits: resolveUploadPlanLimits(entitlements),
    canUploadFiles: resolveCanUploadFiles(entitlements),
  };
}

function buildTelemetry(params: {
  rawUploadSize: number;
  zipSummaries: ZipExtractionSummary[];
  failedUploads: UploadFailure[];
  uploadLimits: ReturnType<typeof resolveUploadPlanLimits>;
}) {
  const zipSummary = params.zipSummaries[0] ?? null;
  return {
    rawUploadSize: params.rawUploadSize,
    compressedSizeBytes: zipSummary?.compressedSizeBytes ?? params.rawUploadSize,
    extractedSizeBytes: zipSummary?.extractedSizeBytes ?? 0,
    totalEntries: zipSummary?.totalEntries ?? 1,
    acceptedEntries: zipSummary?.acceptedEntries ?? [],
    rejectedEntries: zipSummary?.rejectedEntries ?? params.failedUploads,
    extractedFileCount: params.zipSummaries.reduce((sum, summary) => sum + summary.acceptedFiles, 0),
    rejectedFileCount: params.failedUploads.length,
    extractedTotalSize: params.zipSummaries.reduce((sum, summary) => sum + summary.extractedBytes, 0),
    planLimitExceeded: params.failedUploads.some((failure) =>
      ["FILE_TOO_LARGE", "ZIP_TOO_LARGE", "ZIP_TOO_MANY_ENTRIES", "MAX_FILES_REACHED"].includes(failure.code ?? "")
    ),
    planLimitUsed: {
      plan: params.uploadLimits.plan,
      maxUploadBytes: params.uploadLimits.maxUploadBytes,
      maxFilesPerReview: params.uploadLimits.maxFilesPerReview,
      zipAllowed: params.uploadLimits.zipAllowed,
      maxZipCompressedBytes: params.uploadLimits.maxZipCompressedBytes,
      maxExtractedFiles: params.uploadLimits.maxExtractedFiles,
      maxExtractedTotalBytes: params.uploadLimits.maxExtractedTotalBytes,
      videoAllowed: params.uploadLimits.videoAllowed,
      maxVideoBytes: params.uploadLimits.maxVideoBytes,
      maxVideosPerReview: params.uploadLimits.maxVideosPerReview,
      videoMaxDurationSeconds: params.uploadLimits.videoMaxDurationSeconds,
    },
  };
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
    maxBytes: params.file.classification === "image" ? params.maxImageDataUrlBytes : undefined,
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

export async function POST(req: Request) {
  let blobUrlForCleanup: string | null = null;
  try {
    const payload = (await req.json()) as FinalizeRequest;
    const blobUrl = payload.downloadUrl || payload.url;
    const filename = payload.filename || payload.pathname?.split("/").pop() || "upload";
    const contentType = payload.contentType || "application/octet-stream";
    const sizeBytes = Number.isFinite(payload.sizeBytes) ? Number(payload.sizeBytes) : 0;
    blobUrlForCleanup = payload.url || null;

    if (!blobUrl) {
      return NextResponse.json({ error: "Missing uploaded blob URL.", code: "DIRECT_UPLOAD_MISSING_BLOB" }, { status: 400 });
    }

    const context = await resolveUploadContext();
    if (!context.canUploadFiles) {
      return NextResponse.json(
        { error: "Uploads are not included in your current plan.", code: "UNAUTHORIZED" },
        { status: 403 }
      );
    }

    const rejection = validateDirectUploadCandidate(
      { name: filename, type: contentType, size: sizeBytes },
      context.uploadLimits
    );
    if (rejection) {
      return NextResponse.json(
        {
          error: rejection.reason,
          code: rejection.code,
          failedUploads: [rejection],
          successfulUploads: [],
          documents: [],
        },
        { status: rejection.code === "ZIP_TOO_LARGE" || rejection.code === "FILE_TOO_LARGE" ? 413 : 400 }
      );
    }

    console.info("[upload-direct] finalize started", {
      uploadMode: "direct-storage",
      filename,
      sizeBytes,
      plan: context.uploadLimits.plan,
      zipDetected: isZipUpload({ name: filename, type: contentType }),
      videoDetected: isVideoExtension(getUploadExtension(filename)),
      activeCaseId: payload.activeCaseId ?? null,
      ownerUserId: context.user.id,
    });

    const blobResponse = await fetch(blobUrl);
    if (!blobResponse.ok) {
      return NextResponse.json(
        { error: "Uploaded file could not be retrieved from storage.", code: "DIRECT_UPLOAD_RETRIEVE_FAILED" },
        { status: 502 }
      );
    }

    const buffer = Buffer.from(await blobResponse.arrayBuffer());
    const file = new File([buffer], filename, { type: contentType });
    const activeCaseId = typeof payload.activeCaseId === "string" && payload.activeCaseId.trim()
      ? payload.activeCaseId.trim()
      : null;
    const activeCase = activeCaseId
      ? await getAnalysisReport(activeCaseId, { ownerUserId: context.user.id })
      : null;
    const successfulUploads: UploadSuccess[] = [];
    const failedUploads: UploadFailure[] = [];
    const zipSummaries: ZipExtractionSummary[] = [];

    const prepared = await prepareUploadFile(file, context.uploadLimits);
    zipSummaries.push(...prepared.zipSummaries);
    failedUploads.push(...prepared.rejectedFiles);

    for (const [index, preparedFile] of prepared.files.entries()) {
      if (index >= context.uploadLimits.maxFilesPerReview) {
        failedUploads.push({
          filename: preparedFile.filename,
          reason: getUploadBatchLimitMessage(context.uploadLimits),
          code: "MAX_FILES_REACHED",
        });
        continue;
      }

      const storedUpload = await processPreparedUpload({
        file: preparedFile,
        ownerUserId: context.user.id,
        activeCaseId,
        activeCase,
        maxImageDataUrlBytes: context.uploadLimits.maxUploadBytes,
      });
      successfulUploads.push(storedUpload);

      if (!context.effectiveIsAdmin) {
        try {
          await recordUsage({
            userId: context.user.id,
            kind: "FILE_UPLOAD",
            metadataJson: {
              source: preparedFile.sourceArchive ? "zip_upload_direct_storage" : "direct_storage_upload",
              fileName: preparedFile.filename,
              fileSize: preparedFile.buffer.byteLength,
              classification: preparedFile.classification,
              attachmentId: storedUpload.attachmentId,
              sourceArchive: preparedFile.sourceArchive,
            },
          });
          await incrementUsage(context.user.id, "FILE_UPLOAD");
        } catch (error) {
          console.error("[upload-direct] usage tracking failed (non-blocking)", {
            ownerUserId: context.user.id,
            filename: preparedFile.filename,
            error,
          });
        }
      }
    }

    const telemetry = buildTelemetry({
      rawUploadSize: buffer.byteLength,
      zipSummaries,
      failedUploads,
      uploadLimits: context.uploadLimits,
    });

    console.info("[upload-direct] finalize completed", {
      uploadMode: "direct-storage",
      ownerUserId: context.user.id,
      email: maskEmail(context.normalizedEmail),
      filename,
      successfulCount: successfulUploads.length,
      failedCount: failedUploads.length,
      ...telemetry,
    });

    if (!successfulUploads.length) {
      return NextResponse.json(
        {
          error: failedUploads[0]?.code ?? "UPLOAD_FAILED",
          message: failedUploads[0]?.reason ?? "No files could be uploaded.",
          code: failedUploads[0]?.code ?? "UPLOAD_FAILED",
          zipSummaries,
          telemetry,
          successfulUploads,
          failedUploads,
          documents: [],
        },
        { status: getFailureStatus(failedUploads) }
      );
    }

    const firstUpload = successfulUploads[0];
    return NextResponse.json(
      {
        ...firstUpload,
        zipSummaries,
        telemetry,
        successfulUploads,
        failedUploads,
        files: successfulUploads.map((upload) => ({
          id: upload.attachmentId,
          name: upload.filename,
          size: upload.sizeBytes,
          type: upload.type,
        })),
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
      },
      { status: failedUploads.length ? 207 : 200 }
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof UsageAccessError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (isDatabaseUnavailableError(error)) {
      console.error("[upload-direct] database unavailable", {
        error: sanitizeDatabaseErrorForLog(error),
      });
      return NextResponse.json(
        { error: "Database temporarily unavailable. Please retry shortly.", code: "DATABASE_UNAVAILABLE" },
        { status: 503 }
      );
    }

    console.error("[upload-direct] finalize failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "SERVER_ERROR", code: "DIRECT_UPLOAD_FINALIZE_FAILED" }, { status: 500 });
  } finally {
    if (blobUrlForCleanup) {
      del(blobUrlForCleanup).catch((error) => {
        console.warn("[upload-direct] blob cleanup failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }
}
