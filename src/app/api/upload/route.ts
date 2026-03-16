import { NextResponse } from "next/server";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import { saveUploadedAttachment } from "@/lib/uploadedAttachmentStore";

export const runtime = "nodejs";

async function extractPDF(buffer: Buffer): Promise<string> {
  const result = await pdfParse(buffer);
  const text = result.text || "";

  console.log("PDF TEXT LENGTH:", text.length);

  return text;
}

async function fileToText(file: File): Promise<string> {
  const type = file.type || "";
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (type.includes("text")) {
    return buffer.toString("utf8");
  }

  if (type === "application/pdf") {
    return extractPDF(buffer);
  }

  if (
    type ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || "";
  }

  return `[[Unsupported file type for text extraction: ${type || "unknown type"}: ${file.name}]]`;
}

async function fileToDataUrl(file: File): Promise<string | undefined> {
  const type = file.type || "";

  if (!type.startsWith("image/")) return undefined;

  const buffer = Buffer.from(await file.arrayBuffer());
  return `data:${type};base64,${buffer.toString("base64")}`;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();

    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "No file received" },
        { status: 400 }
      );
    }

    const text = await fileToText(file);
    const imageDataUrl = await fileToDataUrl(file);
    const stored = saveUploadedAttachment({
      filename: file.name,
      type: file.type,
      text,
      imageDataUrl,
    });

    return NextResponse.json({
      attachmentId: stored.id,
      filename: stored.filename,
      type: stored.type,
      text: stored.text,
      imageDataUrl: stored.imageDataUrl,
      hasVision: Boolean(stored.imageDataUrl),
    });
  } catch (error) {
    console.error("UPLOAD ERROR:", error);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 }
    );
  }
}
