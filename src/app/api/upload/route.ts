import { NextResponse } from "next/server";
import { parseForm } from "@/lib/parseForm";
import { extractTextFromFile } from "@/lib/extract-text";

export const runtime = "nodejs";

type UploadedDocument = {
  filename: string;
  type: string;
  text: string;
};

type ParsedFile = {
  filepath: string;
  mimetype?: string | null;
  originalFilename?: string | null;
};

type ParsedForm = {
  files: ParsedFile | ParsedFile[];
};

export async function POST(req: Request) {
  try {
    const parsed = (await parseForm(req)) as unknown;

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("files" in parsed)
    ) {
      throw new Error("Upload parse failed: missing files");
    }

    const { files } = parsed as ParsedForm;

    const uploaded: ParsedFile[] = Array.isArray(files) ? files : [files];

    const documents: UploadedDocument[] = [];

    for (const file of uploaded) {
      if (!file.mimetype) {
        throw new Error(
          `Missing mimetype for file: ${file.originalFilename ?? "unknown"}`
        );
      }

      const text = await extractTextFromFile(file.filepath, file.mimetype);

      documents.push({
        filename: file.originalFilename ?? "uploaded-file",
        type: file.mimetype,
        text,
      });
    }

    return NextResponse.json({ documents });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 }
    );
  }
}
