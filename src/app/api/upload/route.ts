import { NextResponse } from "next/server";
import type { UploadedDocument } from "@/lib/sessionStore";

export const runtime = "nodejs";

async function extractTextFromFile(file: File): Promise<string> {
  // Text files
  if (file.type.startsWith("text/")) {
    return await file.text();
  }

  // PDFs
  if (
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  ) {
    const buf = Buffer.from(await file.arrayBuffer());

    // pdf-parse (recommended)
    try {
      const mod: unknown = await import("pdf-parse");
      const pdfParse = (mod as { default?: unknown }).default;

      if (typeof pdfParse === "function") {
        const res = (await (pdfParse as (b: Buffer) => Promise<{ text?: string }>)(buf));
        return (res.text ?? "").trim();
      }
    } catch {
      // fallthrough
    }

    return "";
  }

  // Unsupported types (images, etc)
  return "";
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const items = form.getAll("files");

    const files = items.filter((x): x is File => x instanceof File);
    if (files.length === 0) {
      return NextResponse.json(
        { error: "No files provided (field name must be 'files')" },
        { status: 400 }
      );
    }

    const documents: UploadedDocument[] = [];
    for (const file of files) {
      const text = await extractTextFromFile(file);

      documents.push({
        filename: file.name,
        type: file.type || "application/octet-stream",
        text,
      });
    }

    return NextResponse.json({ documents });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}
