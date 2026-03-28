import { NextResponse } from "next/server";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import { saveUploadedAttachment } from "@/lib/uploadedAttachmentStore";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";

export const runtime = "nodejs";

async function extractPDF(buffer: Buffer): Promise<{
  text: string;
  pageCount?: number;
}> {
  const result = await pdfParse(buffer);
  const text = result.text || "";

  console.log("PDF TEXT LENGTH:", text.length);

  return {
    text,
    pageCount: typeof result.numpages === "number" ? result.numpages : undefined,
  };
}

async function extractFilePreviewData(file: File): Promise<{
  text: string;
  pageCount?: number;
}> {
  const type = file.type || "";
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (type.includes("text")) {
    return { text: buffer.toString("utf8") };
  }

  if (type === "application/pdf") {
    return extractPDF(buffer);
  }

  if (
    type ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value || "" };
  }

  return {
    text: `[[Unsupported file type for text extraction: ${type || "unknown type"}: ${file.name}]]`,
  };
}

async function fileToDataUrl(file: File): Promise<string | undefined> {
  const type = file.type || "";

  if (!type.startsWith("image/")) return undefined;

  const buffer = Buffer.from(await file.arrayBuffer());
  return `data:${type};base64,${buffer.toString("base64")}`;
}

export async function POST(req: Request) {
  try {
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

    const previewData = await extractFilePreviewData(file);
    const imageDataUrl = await fileToDataUrl(file);
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
