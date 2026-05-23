import { NextResponse } from "next/server";

export const runtime = "nodejs";

function getMissingEnv() {
  return [
    process.env.ELEVENLABS_API_KEY?.trim() ? null : "ELEVENLABS_API_KEY",
    process.env.ELEVENLABS_VOICE_ID_1?.trim() ? null : "ELEVENLABS_VOICE_ID_1",
    process.env.ELEVENLABS_VOICE_ID_2?.trim() ? null : "ELEVENLABS_VOICE_ID_2",
  ].filter((value): value is string => Boolean(value));
}

export function GET() {
  const missing = getMissingEnv();

  return NextResponse.json({
    configured: missing.length === 0,
    missing,
  });
}
