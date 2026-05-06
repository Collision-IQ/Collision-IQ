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
import { getUsageCount, incrementUsage } from "@/lib/usage";
import { saveUploadedAttachment } from "@/lib/uploadedAttachmentStore";
import { getAnalysisReport } from "@/lib/analysisReportStore";
import {
  extractPreviewDataFromFile,
  fileToReusableDataUrl,
} from "@/lib/attachments/extractPreviewData";

export const runtime = "nodejs";

const MAX_UPLOAD_BATCH_FILES = 6;
const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;

type UploadSuccess = {
  attachmentId: string;
  filename: string;
  type: string;
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

function formatLimitBytes(bytes: number) {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

function getFailureStatus(failedUploads: UploadFailure[]) {
  if (failedUploads.some((failure) => failure.code === "UPLOAD_QUOTA_REACHED")) {
    return 403;
  }

  if (failedUploads.some((failure) => failure.code === "FILE_TOO_LARGE")) {
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

export async function POST(req: Request) {
  try {
    const { user, isPlatformAdmin } = await requireCurrentUser();
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
      trialActive,
      subscriptionTier,
      isPlatformAdmin: effectiveIsAdmin,
    });
    const canUploadFiles = resolveCanUploadFiles(entitlements);

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

    const formData = await req.formData();
    const files = getUploadFiles(formData);
    const activeCaseId = String(formData.get("activeCaseId") ?? "").trim() || null;

    if (!files.length) {
      return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
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

    if (!effectiveIsAdmin && entitlements.uploadCap !== null) {
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
      totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      fileCount: files.length,
      maxFileCount: MAX_UPLOAD_BATCH_FILES,
      maxFileBytes: MAX_UPLOAD_FILE_BYTES,
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
        uploadCap: entitlements.uploadCap,
        maxUploadsPerReview: entitlements.maxUploadsPerReview,
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

    for (const [index, file] of files.entries()) {
      if (index >= MAX_UPLOAD_BATCH_FILES) {
        failedUploads.push({
          filename: file.name,
          reason: `Only ${MAX_UPLOAD_BATCH_FILES} files can be uploaded at a time.`,
          code: "MAX_FILES_REACHED",
        });
        console.info("[upload] file rejected", {
          filename: file.name,
          code: "MAX_FILES_REACHED",
          fileIndex: index,
          maxFileCount: MAX_UPLOAD_BATCH_FILES,
          ownerUserId: user.id,
        });
        continue;
      }

      if (file.size > MAX_UPLOAD_FILE_BYTES) {
        failedUploads.push({
          filename: file.name,
          reason: `File exceeds ${formatLimitBytes(MAX_UPLOAD_FILE_BYTES)} limit (${formatLimitBytes(file.size)}).`,
          code: "FILE_TOO_LARGE",
        });
        console.info("[upload] file rejected", {
          filename: file.name,
          code: "FILE_TOO_LARGE",
          sizeBytes: file.size,
          maxFileBytes: MAX_UPLOAD_FILE_BYTES,
          ownerUserId: user.id,
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
        const previewData = await extractPreviewDataFromFile(file);
        const imageDataUrl = await fileToReusableDataUrl(file);
        const stored = await saveUploadedAttachment({
          ownerUserId: user.id,
          filename: file.name,
          type: file.type,
          text: previewData.text,
          imageDataUrl,
          pageCount: previewData.pageCount,
        });

        const caseContinuity = activeCase
          ? {
              activeCaseId: activeCase.id,
              reportId: activeCase.id,
              sameCaseFollowUp: true,
              attachmentIds: [stored.id],
            }
          : activeCaseId
            ? {
                activeCaseId,
                reportId: activeCaseId,
                sameCaseFollowUp: false,
                attachmentIds: [stored.id],
              }
            : null;

        successfulUploads.push({
          attachmentId: stored.id,
          filename: stored.filename,
          type: stored.type,
          text: stored.text,
          imageDataUrl: stored.imageDataUrl,
          pageCount: stored.pageCount,
          hasVision: Boolean(stored.imageDataUrl),
          caseContinuity,
        });

        console.info("[upload] attachment stored", {
          attachmentId: stored.id,
          filename: stored.filename,
          mimeType: stored.type || "unknown",
          textLength: stored.text.length,
          pageCount: stored.pageCount ?? null,
          hasImageDataUrl: Boolean(stored.imageDataUrl),
          ownerUserId: user.id,
          activeCaseId,
          sameCaseFollowUp: Boolean(activeCase),
        });

        if (activeCase) {
          console.info("[upload] returned same-case continuity", {
            activeCaseId: activeCase.id,
            reportId: activeCase.id,
            attachmentIds: [stored.id],
            sameCaseFollowUp: true,
          });
        }

        if (!effectiveIsAdmin) {
          try {
            await recordUsage({
              userId: user.id,
              kind: "FILE_UPLOAD",
              metadataJson: {
                source: "upload",
                fileName: file.name,
                fileSize: file.size,
                attachmentId: stored.id,
              },
            });
          } catch (error) {
            console.error("[upload] usage tracking failed (non-blocking)", {
              phase: "recordUsage",
              userId: user.id,
              fileName: file.name,
              error,
            });
          }

          try {
            await incrementUsage(user.id, "FILE_UPLOAD");
          } catch (error) {
            console.error("[upload] usage tracking failed (non-blocking)", {
              phase: "incrementUsage",
              userId: user.id,
              fileName: file.name,
              error,
            });
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
        failedUploads.push({
          filename: file.name,
          reason: error instanceof Error ? error.message : "Upload processing failed.",
          code: "FILE_PROCESSING_FAILED",
        });
      }
    }

    if (!successfulUploads.length) {
      return NextResponse.json(
        {
          error: failedUploads[0]?.reason ?? "No files could be uploaded.",
          code: failedUploads[0]?.code ?? "UPLOAD_FAILED",
          limits: {
            maxFiles: MAX_UPLOAD_BATCH_FILES,
            maxFileBytes: MAX_UPLOAD_FILE_BYTES,
          },
          usage: {
            uploadCount: uploadsUsed,
            uploadCap: entitlements.uploadCap,
            plan: entitlements.plan,
            billingPlan: entitlements.billingPlan,
          },
          successfulUploads,
          failedUploads,
          documents: [],
        },
        { status: getFailureStatus(failedUploads) }
      );
    }

    const firstUpload = successfulUploads[0];
    const responseBody = {
      ...firstUpload,
      limits: {
        maxFiles: MAX_UPLOAD_BATCH_FILES,
        maxFileBytes: MAX_UPLOAD_FILE_BYTES,
      },
      usage: {
        uploadCount: uploadsUsed + successfulUploads.length,
        uploadCap: entitlements.uploadCap,
        plan: entitlements.plan,
        billingPlan: entitlements.billingPlan,
      },
      successfulUploads,
      failedUploads,
      documents: successfulUploads.map((upload) => ({
        filename: upload.filename,
        type: upload.type,
        text: upload.text,
        pageCount: upload.pageCount,
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

    console.error("UPLOAD ERROR:", error);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}
