import { NextResponse } from "next/server";
import { Pool } from "pg";
import { embedText } from "@/lib/rag/embed";

export const runtime = "nodejs";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function POST(req: Request) {
  try {
    const { query } = await req.json();

    const queryVector = await embedText(String(query ?? ""));
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
