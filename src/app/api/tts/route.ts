import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";
import { collisionIqModels } from "@/lib/modelConfig";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";

export const runtime = "nodejs";

const DEFAULT_VOICE = "nova";
const MAX_TTS_INPUT_CHARS = 4096;
const AUDIO_CONTENT_TYPE = "audio/mpeg";
const DEFAULT_TTS_INSTRUCTIONS =
  "Female voice. Warm, confident, quick-witted, conversational, and natural. Subtle Northeast energy. Smart, grounded, expressive, and slightly dry in tone. Brisk pacing with clear articulation. Sounds like a sharp, street-smart professional explaining something clearly under pressure. Avoid parody, caricature, or celebrity imitation.";
const DEFAULT_TTS_SPEED = 1.06;

type TtsRequestBody = {
  text?: unknown;
  voice?: unknown;
  model?: unknown;
  style?: unknown;
  instructions?: unknown;
};

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function POST(req: Request) {
  try {
    const { user, isPlatformAdmin } = await requireCurrentUser();
    const body = (await req.json()) as TtsRequestBody;
    const text = normalizeOptionalString(body.text);

    if (!text) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    const voice = normalizeOptionalString(body.voice) ?? DEFAULT_VOICE;
    const model = normalizeOptionalString(body.model) ?? collisionIqModels.tts;
    const instructions =
      normalizeOptionalString(body.instructions) ??
      normalizeOptionalString(body.style) ??
      DEFAULT_TTS_INSTRUCTIONS;
    const input = text.slice(0, MAX_TTS_INPUT_CHARS);

    const response = await openai.audio.speech.create({
      model,
      voice,
      input,
      instructions,
      speed: DEFAULT_TTS_SPEED,
      response_format: "mp3",
    });

    const arrayBuffer = await response.arrayBuffer();

    console.info("[tts] completed", {
      ownerUserId: user.id,
      isPlatformAdmin,
      model,
      voice,
      hasInstructions: Boolean(instructions),
      speed: DEFAULT_TTS_SPEED,
      inputLength: input.length,
    });

    return new Response(Buffer.from(arrayBuffer), {
      headers: {
        "Content-Type": AUDIO_CONTENT_TYPE,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[tts] generation failed", error);
    return NextResponse.json({ error: "TTS failed" }, { status: 500 });
  }
}
