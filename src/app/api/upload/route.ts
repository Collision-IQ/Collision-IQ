import { NextResponse } from "next/server";
import mammoth from "mammoth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_MB = 10;
const MAX_TEXT_CHARS = 120_000;

function clampText(s: string, max: number) {
  return s.length > max ? s.slice(0, max) : s;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file field" }, { status: 400 });
    }

    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      return NextResponse.json(
        { error: `File too large (max ${MAX_FILE_MB}MB)` },
        { status: 413 }
      );
    }

    const name = file.name || "uploaded";
    const mime = file.type || "";

    // ✅ single source of truth
    const buffer = Buffer.from(await file.arrayBuffer());

    let text = "";

    if (mime === "application/pdf" || name.toLowerCase().endsWith(".pdf")) {
      // pdf-parse@1.1.1
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pdfParse = require("pdf-parse");

      // ✅ debug guard: proves we're not passing undefined
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error(`Invalid PDF buffer. isBuffer=${Buffer.isBuffer(buffer)} len=${buffer?.length}`);
      }

      const parsed = await pdfParse(buffer); // ✅ always buffer
      text = parsed?.text ?? "";
    } else if (
      mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      name.toLowerCase().endsWith(".docx")
    ) {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value || "";
    } else if (
      mime.startsWith("text/") ||
      name.toLowerCase().endsWith(".txt") ||
      name.toLowerCase().endsWith(".md")
    ) {
      text = buffer.toString("utf8");
    } else {
      return NextResponse.json(
        { error: "Unsupported file type (pdf, docx, txt, md supported)" },
        { status: 415 }
      );
    }

    text = clampText(text.trim(), MAX_TEXT_CHARS);

    return NextResponse.json({
      ok: true,
      filename: name,
      mime,
      chars: text.length,
      preview: text.slice(0, 800),
    });
  } catch (err: any) {
    console.error("Upload failed:", err);
    return NextResponse.json(
      { error: "Upload failed", detail: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
