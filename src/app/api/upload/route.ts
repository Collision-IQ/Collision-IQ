import { NextResponse } from "next/server";
import mammoth from "mammoth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_MB = 10;
const MAX_TEXT_CHARS = 120_000;

function clampText(s: string, max: number) {
  return s.length > max ? s.slice(0, max) : s;
}

async function parsePdfFromBuffer(input: unknown): Promise<string> {
  // Guard: if you ever pass a filename string again, we’ll see it immediately
  if (typeof input === "string") {
    throw new Error(`BUG: parsePdfFromBuffer received a path string: ${input}`);
  }
  if (!Buffer.isBuffer(input)) {
    throw new Error(`BUG: parsePdfFromBuffer expected Buffer, got ${typeof input}`);
  }

  // pdf-parse@1.1.1
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfParse = require("pdf-parse");
  const parsed = await pdfParse(input);
  return parsed?.text ?? "";
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
    const buffer = Buffer.from(await file.arrayBuffer());

    let text = "";

    if (mime === "application/pdf" || name.toLowerCase().endsWith(".pdf")) {
      text = await parsePdfFromBuffer(buffer); // ✅ ONLY buffer
    } else if (
      mime ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
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
