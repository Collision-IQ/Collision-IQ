import { NextResponse } from "next/server";
import OpenAI from "openai";
import { Pool } from "pg";

export const runtime = "nodejs";

const openai = new OpenAI();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function POST(req: Request) {
  try {
    const { query } = await req.json();

    const embedding = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: query,
    });

    const queryVector = embedding.data[0].embedding;
    const client = await pool.connect();

    const result = await client.query(
      `
      SELECT content,
             file_id,
             embedding <-> $1 AS distance
      FROM document_chunks
      ORDER BY embedding <-> $1
      LIMIT 5
      `,
      [JSON.stringify(queryVector)],
    );

    client.release();

    return NextResponse.json({
      success: true,
      matches: result.rows,
    });
  } catch (err: unknown) {
    console.error("SEARCH ERROR:", err);

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
