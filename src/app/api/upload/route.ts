// src/app/api/upload/route.ts
import { NextResponse } from "next/server";
import pdfParse from "pdf-parse";

export const runtime = "nodejs";

const MAX_FILE_SIZE_MB = 15;

export async function POST(req: Request) {
  const formData = await req.formData();
  const files = formData.getAll("files") as File[];

  if (!files || files.length === 0) {
    return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
  }

  const results: any[] = [];

  for (const file of files) {
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > MAX_FILE_SIZE_MB) {
      return NextResponse.json(
        { error: `File too large: ${file.name}` },
        { status: 400 }
      );
    }

    if (file.type === "application/pdf") {
      const buffer = Buffer.from(await file.arrayBuffer());
      const parsed = await pdfParse(buffer);

      results.push({
        filename: file.name,
        type: "pdf",
        text: parsed.text.slice(0, 200_000), // safety cap
      });
    } else if (file.type.startsWith("image/")) {
      results.push({
        filename: file.name,
        type: "image",
      });
    } else {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type}` },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ files: results });
}
