import { NextResponse } from "next/server";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";
import { UsageAccessError, recordUsage } from "@/lib/billing/usage";
import { getUsageCount, incrementUsage } from "@/lib/usage";
import { saveUploadedAttachment } from "@/lib/uploadedAttachmentStore";
import {
  extractPreviewDataFromFile,
  fileToReusableDataUrl,
} from "@/lib/attachments/extractPreviewData";

export const runtime = "nodejs";

const MAX_UPLOAD_FILE_BYTES = 20 * 1024 * 1024;
const MAX_UPLOAD_TOTAL_BYTES = 75 * 1024 * 1024;

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
    const entitlements = await getCurrentEntitlements();

    if (!isPlatformAdmin && !entitlements.canUpload) {
      return NextResponse.json(
        { error: "UPLOAD_NOT_INCLUDED_IN_PLAN" },
        { status: 403 }
      );
    }

    if (!isPlatformAdmin && entitlements.uploadCap !== null) {
      const uploadsUsed = await getUsageCount(user.id, "FILE_UPLOAD");

      if (uploadsUsed >= entitlements.uploadCap) {
        return NextResponse.json(
          { error: "UPLOAD_LIMIT_REACHED" },
          { status: 403 }
        );
      }
    }

    const formData = await req.formData();
    const files = getUploadFiles(formData);

    if (!files.length) {
      return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
    }

    let totalBytes = 0;
    for (const file of files) {
      totalBytes += file.size;

      if (file.size > MAX_UPLOAD_FILE_BYTES) {
        return NextResponse.json(
          {
            error: `File \"${file.name}\" exceeds 20MB limit`,
            code: "FILE_TOO_LARGE",
          },
          { status: 413 }
        );
      }
    }

    if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) {
      return NextResponse.json(
        {
          error: "Total upload exceeds 75MB limit",
          code: "UPLOAD_TOO_LARGE",
        },
        { status: 413 }
      );
    }

    const file = files[0];

    console.info("[upload] accepted", {
      filename: file.name,
      mimeType: file.type || "unknown",
      sizeBytes: file.size,
      totalBytes,
      fileCount: files.length,
      isImage: file.type.startsWith("image/"),
      ownerUserId: user.id,
    });

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

    console.info("[upload] attachment stored", {
      attachmentId: stored.id,
      filename: stored.filename,
      mimeType: stored.type || "unknown",
      textLength: stored.text.length,
      pageCount: stored.pageCount ?? null,
      hasImageDataUrl: Boolean(stored.imageDataUrl),
      ownerUserId: user.id,
    });

    if (!isPlatformAdmin) {
      await recordUsage({
        userId: user.id,
        kind: "FILE_UPLOAD",
        metadataJson: {
          attachmentId: stored.id,
          filename: stored.filename,
        },
      });
      await incrementUsage(user.id, "FILE_UPLOAD");
    }

    return NextResponse.json({
      attachmentId: stored.id,
      filename: stored.filename,
      type: stored.type,
      text: stored.text,
      imageDataUrl: stored.imageDataUrl,
      pageCount: stored.pageCount,
      hasVision: Boolean(stored.imageDataUrl),
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
