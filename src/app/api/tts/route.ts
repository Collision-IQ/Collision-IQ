import { NextResponse } from "next/server";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";

export const runtime = "nodejs";

const MAX_TTS_INPUT_CHARS = 4_000;
const AUDIO_CONTENT_TYPE = "audio/mpeg";
const ELEVENLABS_MODEL_ID = "eleven_v3";
const ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128";
const ELEVENLABS_TIMEOUT_MS = 30_000;

type TtsRequestBody = {
  text?: unknown;
  voice?: unknown;
  voiceId?: unknown;
};

function normalizeText(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

function normalizeVoiceId(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;

  const voiceId = value.trim();
  return voiceId.length > 0 ? voiceId : null;
}

function resolveVoiceId(body: TtsRequestBody): { voiceId: string | null; label: string } | null {
  const requestedVoiceId = normalizeVoiceId(body.voiceId);

  if (requestedVoiceId === undefined) {
    return null;
  }

  if (requestedVoiceId) {
    return {
      voiceId: requestedVoiceId,
      label: "custom",
    };
  }

  const voice = body.voice === undefined ? "primary" : body.voice;

  if (voice !== "primary" && voice !== "secondary") {
    return null;
  }

  return {
    label: voice,
    voiceId:
      voice === "secondary"
        ? process.env.ELEVENLABS_VOICE_ID_SECOND?.trim() || null
        : process.env.ELEVENLABS_VOICE_ID?.trim() || null,
  };
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
    const requestedVoice = body.voice === "secondary" ? "secondary" : "primary";
    const resolvedVoice = resolveVoiceId(body);

    console.log("[tts] voice selection", {
      requestedVoice,
      resolvedVoice: requestedVoice,
      hasPrimary: !!process.env.ELEVENLABS_VOICE_ID,
      hasSecondary: !!process.env.ELEVENLABS_VOICE_ID_SECOND,
    });

    if (!resolvedVoice) {
      return jsonError(
        'Voice must be "primary", "secondary", or a string voiceId.',
        "UNSUPPORTED_VOICE",
        400
      );
    }

    const voiceId = resolvedVoice.voiceId;

    if (!apiKey || !voiceId) {
      console.error("[tts] ElevenLabs is not configured", {
        hasApiKey: Boolean(apiKey),
        hasVoiceId: Boolean(voiceId),
        voice: resolvedVoice.label,
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
            output_format: ELEVENLABS_OUTPUT_FORMAT,
            voice_settings: {
              stability: 0.65,
              similarity_boost: 0.9,
              style: 0.2,
              use_speaker_boost: true,
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
