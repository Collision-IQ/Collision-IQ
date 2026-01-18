import { NextResponse } from "next/server";
import mammoth from "mammoth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_MB = 10;
const MAX_TEXT_CHARS = 120_000;

function clampText(s: string, max: number) {
  return s.length > max ? s.slice(0, max) : s;
}

async function parsePdf(buf: Buffer): Promise<string> {
  const mod: any = await import("pdf-parse");

  // Try the common shapes across CJS/ESM/bundlers:
  const candidates = [
    mod,
    mod?.default,
    mod?.pdfParse,
    mod?.PDFParse,
    mod?.default?.pdfParse,
    mod?.default?.PDFParse,
  ];

  const fn = candidates.find((c) => typeof c === "function");

  if (!fn) {
    throw new Error(
      `pdf-parse export mismatch. keys=${Object.keys(mod || {}).join(",")} defaultKeys=${Object.keys(mod?.default || {}).join(",")}`
    );
  }

  const parsed = await fn(buf);
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
    const buf = Buffer.from(await file.arrayBuffer());

    let text = "";

    if (mime === "application/pdf" || name.toLowerCase().endsWith(".pdf")) {
      text = await parsePdf(buf);
    } else if (
      mime ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      name.toLowerCase().endsWith(".docx")
    ) {
      const result = await mammoth.extractRawText({ buffer: buf });
      text = result.value || "";
    } else if (
      mime.startsWith("text/") ||
      name.toLowerCase().endsWith(".txt") ||
      name.toLowerCase().endsWith(".md")
    ) {
      text = buf.toString("utf8");
    } else {
      return NextResponse.json(
        { error: "Unsupported file type (pdf, docx, txt, md supported)" },
        { status: 415 }
      );
    }

    text = clampText(text.trim(), MAX_TEXT_CHARS);

    return NextResponse.json({
      name,
      mime,
      chars: text.length,
      text,
    });
  } catch (err: any) {
    console.error("Upload failed:", err);
    return NextResponse.json(
      { error: "Upload failed", detail: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
