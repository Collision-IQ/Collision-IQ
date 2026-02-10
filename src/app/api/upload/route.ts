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
    const files = form.getAll("files").filter((v): v is File => v instanceof File);

    if (files.length === 0) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }

    const documents: UploadedDocument[] = [];
    for (const file of files) {
      const text = await fileToText(file);
      documents.push({
        filename: file.name,
        type: file.type || "application/octet-stream",
        text,
      });
    }

    return NextResponse.json({ documents });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upload failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
