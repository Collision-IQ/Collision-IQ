import { NextRequest, NextResponse } from "next/server";
import pdfParse from "pdf-parse";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("file");

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: "No files uploaded" },
        { status: 400 }
      );
    }

    const results: {
      filename: string;
      text: string;
      type: string;
    }[] = [];

    for (const file of files) {
      if (!(file instanceof File)) continue;

      const buffer = Buffer.from(await file.arrayBuffer());

      // PDF parsing
      if (file.type === "application/pdf") {
        const parsed = await pdfParse(buffer);
        results.push({
          filename: file.name,
          text: parsed.text || "",
          type: "pdf",
        });
        continue;
      }

      // Images (Phase 3B: metadata only, no OCR yet)
      if (file.type.startsWith("image/")) {
        results.push({
          filename: file.name,
          text: "",
          type: "image",
        });
        continue;
      }
    }

    return NextResponse.json({ results });
  } catch (err: any) {
    console.error("Upload parse error:", err);
    return NextResponse.json(
      { error: "Failed to process upload" },
      { status: 500 }
    );
  }
}
