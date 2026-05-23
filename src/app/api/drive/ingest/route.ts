import { google } from "googleapis";
import { NextResponse } from "next/server";
import { Pool } from "pg";
import { collisionIqModels } from "@/lib/modelConfig";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";

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
  try {
    const { fileId } = await req.json();

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

    const file = await drive.files.get(
      {
        fileId,
        alt: "media",
      },
      { responseType: "arraybuffer" },
    );

    const base64 = Buffer.from(file.data as ArrayBuffer).toString("base64");

    const extraction = await openai.responses.create({
      model: collisionIqModels.primary,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Extract all readable text from this document.",
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

    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: chunks,
    });

    const client = await pool.connect();

    try {
      for (let i = 0; i < chunks.length; i++) {
        await client.query(
          `
          INSERT INTO document_chunks (content, embedding, file_id)
          VALUES ($1, $2, $3)
        `,
          [chunks[i], JSON.stringify(embeddingResponse.data[i].embedding), fileId],
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
