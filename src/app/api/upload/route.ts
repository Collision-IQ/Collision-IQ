import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_MB = 10;
const MAX_TEXT_CHARS = 120_000;

function clamp(text: string, max: number) {
  return text.length > max ? text.slice(0, max) : text;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

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

    const mime = file.type || "";
    const buffer = Buffer.from(await file.arrayBuffer());

    let text = "";

    if (mime === "application/pdf") {
      // pdf-parse 1.1.1 – CommonJS safe import
      const pdfParse = (await import("pdf-parse")).default;
      const parsed = await pdfParse(buffer);
      text = parsed.text || "";
    } else {
      // Plain text fallback
      text = buffer.toString("utf8");
    }

    text = clamp(text, MAX_TEXT_CHARS);

    return NextResponse.json({
      ok: true,
      name: file.name,
      chars: text.length,
      text,
    });
  } catch (err: any) {
    console.error("Upload failed:", err);
    return NextResponse.json(
      {
        error: "Upload failed",
        detail: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}
