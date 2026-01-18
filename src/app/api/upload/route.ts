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
    const buf = Buffer.from(await file.arrayBuffer());

    let text = "";

    if (mime === "application/pdf" || name.toLowerCase().endsWith(".pdf")) {
  const mod: any = await import("pdf-parse");

  // Robust export resolution across CJS/ESM/Turbopack variations
  const pdfParse =
    (typeof mod?.default === "function" && mod.default) ||
    (typeof mod === "function" && mod) ||
    (typeof mod?.pdfParse === "function" && mod.pdfParse) ||
    (typeof mod?.PDFParse === "function" && mod.PDFParse) ||
    (typeof mod?.default?.pdfParse === "function" && mod.default.pdfParse) ||
    (typeof mod?.default?.PDFParse === "function" && mod.default.PDFParse);

  if (!pdfParse) {
    // Helpful error message so we can see what exports exist
    throw new Error(
      `pdf-parse export mismatch. keys=${Object.keys(mod || {}).join(",")} defaultKeys=${Object.keys(mod?.default || {}).join(",")}`
    );
  }

  const parsed = await pdfParse(buf);
  text = parsed?.text ?? "";
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
