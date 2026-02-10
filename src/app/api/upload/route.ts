// src/app/api/upload/route.ts
import { NextResponse } from "next/server";

// These are the helpers you appeared to already have in your repo.
// If your paths differ, adjust imports to match your project.
import { parseForm } from "@/lib/parseForm";
import { extractTextFromFile } from "@/lib/extractText";

export const runtime = "nodejs";

type UploadedDocument = {
  filename: string;
  type: string;
  text: string;
};

export async function POST(req: Request) {
  try {
    const { files } = await parseForm(req);

    const uploaded = Array.isArray(files) ? files : files ? [files] : [];
    if (uploaded.length === 0) {
      return NextResponse.json({ documents: [] as UploadedDocument[] });
    }

    const documents: UploadedDocument[] = [];

    for (const file of uploaded) {
      if (!file.mimetype) continue;

      const text = await extractTextFromFile(file.filepath, file.mimetype);

      documents.push({
        filename: file.originalFilename ?? "uploaded-file",
        type: file.mimetype,
        text: String(text ?? ""),
      });
    }

    return NextResponse.json({ documents });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Upload failed", details: String(error?.message ?? error) },
      { status: 500 }
    );
  }
}
