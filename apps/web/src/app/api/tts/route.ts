import { NextResponse } from "next/server";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";

export const runtime = "nodejs";

const MAX_TTS_INPUT_CHARS = 4_000;
const AUDIO_CONTENT_TYPE = "audio/mpeg";
const ELEVENLABS_MODEL_ID = "eleven_flash_v2_5";
const ELEVENLABS_TIMEOUT_MS = 30_000;

type TtsRequestBody = {
  text?: unknown;
};

function normalizeText(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

function jsonError(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

async function parseJsonBody(req: Request): Promise<TtsRequestBody | null> {
  try {
    return (await req.json()) as TtsRequestBody;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const { user, isPlatformAdmin } = await requireCurrentUser();
    const body = await parseJsonBody(req);

    if (!body) {
      return jsonError("Request body must be valid JSON.", "INVALID_JSON", 400);
    }

    const text = normalizeText(body.text);
    if (!text) {
      return jsonError("Text is required.", "TEXT_REQUIRED", 400);
    }

    if (text.length > MAX_TTS_INPUT_CHARS) {
      return NextResponse.json(
        {
          error: `Text must be ${MAX_TTS_INPUT_CHARS} characters or fewer.`,
          code: "TEXT_TOO_LONG",
          maxLength: MAX_TTS_INPUT_CHARS,
        },
        { status: 400 }
      );
    }

    const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
    const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim();

    if (!apiKey || !voiceId) {
      console.error("[tts] ElevenLabs is not configured", {
        hasApiKey: Boolean(apiKey),
        hasVoiceId: Boolean(voiceId),
      });
      return jsonError("Voice generation is not configured.", "TTS_NOT_CONFIGURED", 503);
    }

    const controller = new AbortController();
    const timeout: ReturnType<typeof setTimeout> = setTimeout(
      () => controller.abort(),
      ELEVENLABS_TIMEOUT_MS
    );

    let elevenLabsResponse: Response;
    try {
      elevenLabsResponse = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            Accept: AUDIO_CONTENT_TYPE,
          },
          body: JSON.stringify({
            text,
            model_id: ELEVENLABS_MODEL_ID,
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.8,
            },
          }),
          signal: controller.signal,
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!elevenLabsResponse.ok) {
      console.warn("[tts] ElevenLabs request failed", {
        ownerUserId: user.id,
        isPlatformAdmin,
        status: elevenLabsResponse.status,
      });

      if (elevenLabsResponse.status === 429) {
        return jsonError(
          "Voice generation is temporarily rate limited. Please try again shortly.",
          "TTS_RATE_LIMITED",
          429
        );
      }

      return jsonError(
        "Voice generation failed. Please try again.",
        "TTS_PROVIDER_ERROR",
        502
      );
    }

    const arrayBuffer = await elevenLabsResponse.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      console.warn("[tts] ElevenLabs returned empty audio", {
        ownerUserId: user.id,
        isPlatformAdmin,
      });
      return jsonError("Voice generation returned empty audio.", "TTS_EMPTY_AUDIO", 502);
    }

    console.info("[tts] completed", {
      ownerUserId: user.id,
      isPlatformAdmin,
      provider: "elevenlabs",
      model: ELEVENLABS_MODEL_ID,
      inputLength: text.length,
      audioBytes: arrayBuffer.byteLength,
    });

    return new Response(arrayBuffer, {
      headers: {
        "Content-Type": AUDIO_CONTENT_TYPE,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof Error && error.name === "AbortError") {
      return jsonError("Voice generation timed out. Please try again.", "TTS_TIMEOUT", 504);
    }

    console.error("[tts] generation failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonError("Voice generation failed. Please try again.", "TTS_FAILED", 500);
  }
}
