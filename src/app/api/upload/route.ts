import { NextResponse } from "next/server";
import { saveUploadedAttachment } from "@/lib/uploadedAttachmentStore";

export const runtime = "nodejs";

async function fileToText(file: File): Promise<string> {
  const type = file.type || "";

  if (type.includes("text")) {
    return await file.text();
  }

  // Placeholder for PDFs/images
  return `[[No extractor configured for ${type || "unknown type"}: ${file.name}]]`;
}

async function fileToDataUrl(file: File): Promise<string | undefined> {
  const type = file.type || "";

  if (!type.startsWith("image/")) return undefined;

  const bytes = Buffer.from(await file.arrayBuffer());
  return `data:${type};base64,${bytes.toString("base64")}`;
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
