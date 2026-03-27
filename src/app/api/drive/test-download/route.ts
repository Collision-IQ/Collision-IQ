import { google } from "googleapis";
import { NextResponse } from "next/server";
import { embedTexts } from "@/lib/rag/embed";
import { upsertChunks } from "@/lib/rag/upsert";
import { collisionIqModels } from "@/lib/modelConfig";
import { openai } from "@/lib/openai";

function chunkText(text: string, size = 500) {
  const chunks: string[] = [];

  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }

  return chunks;
}

export async function GET() {
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );

    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    });

    const drive = google.drive({
      version: "v3",
      auth: oauth2Client,
    });
    const fileId = "1xoFF0VuqR_mCXgH9QkcI5xifWlTCmY7N";
    const metadata = await drive.files.get({
      fileId,
      fields: "id, name, modifiedTime",
      supportsAllDrives: true,
    });

    const response = await drive.files.get(
      {
        fileId,
        alt: "media",
        supportsAllDrives: true,
      },
      { responseType: "arraybuffer" },
    );

    const base64 = Buffer.from(response.data as ArrayBuffer).toString("base64");

    const result = await openai.responses.create({
      model: collisionIqModels.primary,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Extract all readable text from this PDF document.",
            },
            {
              type: "input_file",
              file_data: `data:application/pdf;base64,${base64}`,
              filename: "document.pdf",
            },
          ],
        },
      ],
    });

    const extractedText = result.output_text ?? "";
    const cleanText = extractedText
      .replace(/\n+/g, "\n")
      .replace(/\*\*/g, "")
      .trim();

    const chunks = chunkText(cleanText);
    const embeddings = await embedTexts(chunks);

    await upsertChunks({
      sourceType: "google",
      driveFileId: fileId,
      drivePath: metadata.data.name ?? "document.pdf",
      modifiedTime: metadata.data.modifiedTime ?? new Date().toISOString(),
      chunks: chunks.map((chunk, index) => ({
        content: chunk,
        embedding: embeddings[index] ?? [],
        chunkIndex: index,
        docType: "oem_doc",
      })),
    });

    return NextResponse.json({
      success: true,
      text: cleanText,
      chunks: chunks.length,
      embedded: embeddings.length,
      fileId,
    });
  } catch (err: unknown) {
    console.error("OPENAI PDF ERROR:", err);

    const message = err instanceof Error ? err.message : "Unknown error";

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 },
    );
  }
}
