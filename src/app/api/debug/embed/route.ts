import { embedText } from "@/lib/rag/embed";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const text =
    "Honda OEM procedures require pre- and post-repair scanning for ADAS vehicles.";

  const embedding = await embedText(text);

  return NextResponse.json({
    text,
    embeddingLength: embedding.length,
    embedding,
  });
}