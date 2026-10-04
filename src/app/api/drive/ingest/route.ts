import { google } from "googleapis";
import { NextResponse } from "next/server";
import { getDriveAuth } from "@/lib/drive/auth";
import { Pool } from "pg";
import {
  collisionIqModels,
  logCollisionIqModelDiagnostic,
} from "@/lib/modelConfig";
import { generatePrimaryText } from "@/lib/ai/providerTextGeneration";
import { embedTexts } from "@/lib/rag/embed";
import { requirePlatformAdminResponse } from "@/lib/auth/requirePlatformAdminResponse";

export const runtime = "nodejs";
export const maxDuration = 300;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

function cleanText(text: string) {
  return text.replace(/\n+/g, "\n").replace(/\*\*/g, "").trim();
}

function chunkText(text: string, size = 500) {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

export async function POST(req: Request) {
  const denied = await requirePlatformAdminResponse();
  if (denied) return denied;

  try {
    const { fileId } = await req.json();

    // The service account (domain-wide delegation) every other Drive path uses;
    // the old personal OAuth refresh token (GOOGLE_REFRESH_TOKEN) is revoked.
    const driveAuth = await getDriveAuth();

const drive = google.drive({
      version: "v3",
      auth: driveAuth,
    });

    const file = await drive.files.get(
      {
        fileId,
        alt: "media",
        supportsAllDrives: true,
      },
      { responseType: "arraybuffer" },
    );

    const base64 = Buffer.from(file.data as ArrayBuffer).toString("base64");

    logCollisionIqModelDiagnostic({
      stage: "drive_ingest_text_extraction",
      provider: "anthropic",
      role: "anthropicPrimary",
      model: collisionIqModels.anthropicPrimary,
    });
    const extraction = await generatePrimaryText({
      stage: "drive_ingest_text_extraction",
      effort: "low",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Extract all readable text from this document. Return only the extracted text.",
            },
            {
              type: "input_file",
              file_data: `data:application/pdf;base64,${base64}`,
              filename: "doc.pdf",
            },
          ],
        },
      ],
    });

    const rawText = extraction.output_text ?? "";
    const cleaned = cleanText(rawText);
    const chunks = chunkText(cleaned);

    const embeddings = await embedTexts(chunks);

    const client = await pool.connect();

    try {
      for (let i = 0; i < chunks.length; i++) {
        await client.query(
          `
          INSERT INTO document_chunks (content, embedding, file_id)
          VALUES ($1, $2, $3)
        `,
          [chunks[i], JSON.stringify(embeddings[i]), fileId],
        );
      }
    } finally {
      client.release();
    }

    return NextResponse.json({
      success: true,
      chunks: chunks.length,
    });
  } catch (err: unknown) {
    console.error("INGEST ERROR:", err);

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
