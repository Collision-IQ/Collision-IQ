import { NextResponse } from "next/server";
import type { UploadedDocument } from "@/lib/sessionStore";

export const runtime = "nodejs";

async function fileToText(file: File): Promise<string> {
  // If you already have a real extractor (pdf-parse, etc.), use it here.
  // Minimal safe fallback: read as text for text-based files.
  const type = file.type || "";

  if (type.includes("text")) {
    return await file.text();
  }

  // For PDFs or unknown types, return a placeholder so the pipeline doesn't break.
  // Replace this with your PDF extractor.
  return `[[No extractor configured for ${type || "unknown type"}: ${file.name}]]`;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

if (!(file instanceof File)) {
  return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
}

const text = await fileToText(file);

const document: UploadedDocument = {
  filename: file.name,
  type: file.type || "application/octet-stream",
  text,
};

return NextResponse.json({ document });
    } catch (error) {
      console.error("File upload error:", error);
      return NextResponse.json({ error: "File upload failed." }, { status: 500 });
    }
  }
