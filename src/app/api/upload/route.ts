import { NextResponse } from "next/server";
import { saveUploadedAttachment } from "@/lib/uploadedAttachmentStore";
import {
  extractPreviewDataFromFile,
  fileToReusableDataUrl,
} from "@/lib/attachments/extractPreviewData";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    console.info("[upload] env check", {
      cwd: process.cwd(),
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
      pid: process.pid,
      nodeEnv: process.env.NODE_ENV,
    });

    const { user } = await requireCurrentUser();
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file received" }, { status: 400 });
    }

    console.info("[upload] accepted", {
      filename: file.name,
      mimeType: file.type || "unknown",
      sizeBytes: file.size,
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

    console.error("UPLOAD ERROR:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
