import { embedText } from "@/lib/rag/embed";
import { NextResponse } from "next/server";
import { requirePlatformAdminResponse } from "@/lib/auth/requirePlatformAdminResponse";

export const runtime = "nodejs";

export async function GET() {
  const denied = await requirePlatformAdminResponse();
  if (denied) return denied;

  const text =
    "Honda OEM procedures require pre- and post-repair scanning for ADAS vehicles.";

  const embedding = await embedText(text);

  return NextResponse.json({
    text,
    embeddingLength: embedding.length,
    embedding,
  });
}