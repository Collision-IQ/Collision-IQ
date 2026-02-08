import { NextResponse } from 'next/server';
import { parseForm } from '@/lib/parseForm';
import { extractTextFromFile } from '@/lib/extractText';

export async function POST(req: Request) {
  try {
    const { files } = await parseForm(req);
    const uploaded = Array.isArray(files) ? files : [files];

    const documents = [];

    for (const file of uploaded) {
      if (!file.mimetype) {
        throw new Error(`Missing mimetype for file: ${file.originalFilename}`);
      }

      const text = await extractTextFromFile(
        file.filepath,
        file.mimetype
      );

      documents.push({
        filename: file.originalFilename,
        type: file.mimetype,
        text,
      });
    }

    return NextResponse.json({
  documents,
});
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: (error as Error).message || "Upload failed" },
      { status: 500 }
    );
  }
}
