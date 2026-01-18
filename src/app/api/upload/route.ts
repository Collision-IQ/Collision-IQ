import { NextResponse } from "next/server";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_MB = 10;

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing file field" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      return NextResponse.json(
        { error: `File too large (max ${MAX_FILE_MB}MB)` },
        { status: 413 }
      );
    }

    const name = file.name.toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());

    let text = "";

    if (file.type === "application/pdf" || name.endsWith(".pdf")) {
      const parsed = await pdfParse(buffer);
      text = parsed.text || "";
    } else if (
      file.type ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      name.endsWith(".docx")
    ) {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value || "";
    } else {
      return NextResponse.json(
        { error: "Unsupported file type" },
        { status: 415 }
      );
    }

    return NextResponse.json({
      success: true,
      filename: file.name,
      characters: text.length,
      preview: text.slice(0, 1000),
    });
  } catch (err: any) {
    console.error("Upload error:", err);
    return NextResponse.json(
      { error: "Upload failed", detail: err.message },
      { status: 500 }
    );
  }
}
