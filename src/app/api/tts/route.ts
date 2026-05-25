import { NextResponse } from "next/server";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";

export const runtime = "nodejs";

const MAX_TTS_INPUT_CHARS = 4_000;
const AUDIO_CONTENT_TYPE = "audio/mpeg";
const ELEVENLABS_MODEL_ID =
  process.env.ELEVENLABS_MODEL_ID?.trim() || "eleven_turbo_v2_5";
const ELEVENLABS_OUTPUT_FORMAT =
  process.env.ELEVENLABS_OUTPUT_FORMAT?.trim() || "mp3_44100_128";

const VOICES = {
  voice_1:
    process.env.ELEVENLABS_VOICE_ID_1?.trim() ||
    process.env.ELEVENLABS_VOICE_ID?.trim(),

  voice_2:
    process.env.ELEVENLABS_VOICE_ID_2?.trim() ||
    process.env.ELEVENLABS_VOICE_ID_SECOND?.trim(),
} as const;

type TtsVoiceSymbol = keyof typeof VOICES;

type TtsRequestBody = {
  messageId?: unknown;
  text?: unknown;
  voice?: unknown;
};

function normalizeText(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

function normalizeMessageId(value: unknown) {
  if (typeof value !== "string") return null;
  const messageId = value.trim();
  return messageId.length > 0 ? messageId : null;
}

function isTtsVoiceSymbol(value: unknown): value is TtsVoiceSymbol {
  return value === "voice_1" || value === "voice_2";
}

function jsonError(error: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

function getMissingEnv() {
  return [
    process.env.ELEVENLABS_API_KEY?.trim() ? null : "ELEVENLABS_API_KEY",
    VOICES.voice_1 ? null : "ELEVENLABS_VOICE_ID_1 or ELEVENLABS_VOICE_ID",
    VOICES.voice_2
      ? null
      : "ELEVENLABS_VOICE_ID_2 or ELEVENLABS_VOICE_ID_SECOND",
  ].filter((value): value is string => Boolean(value));
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
      return jsonError("INVALID_JSON", 400);
    }

    const missing = getMissingEnv();
    if (missing.length > 0) {
      console.error("[tts] ElevenLabs env missing", {
        missing,
        ownerUserId: user.id,
        isPlatformAdmin,
      });
      return jsonError("TTS_NOT_CONFIGURED", 500, { missing });
    }

    const messageId = normalizeMessageId(body.messageId);
    if (!messageId) {
      return jsonError("MESSAGE_ID_REQUIRED", 400);
    }

    const text = normalizeText(body.text);
    if (!text) {
      return jsonError("TEXT_REQUIRED", 400);
    }

    if (text.length > MAX_TTS_INPUT_CHARS) {
      return jsonError("TEXT_TOO_LONG", 400, { maxLength: MAX_TTS_INPUT_CHARS });
    }

    if (!isTtsVoiceSymbol(body.voice)) {
      return jsonError("TTS_UNKNOWN_VOICE", 400);
    }

    const voice = body.voice;
    const voiceId = VOICES[voice];

    if (!voiceId) {
      return jsonError("TTS_NOT_CONFIGURED", 500, {
        missing: [`ELEVENLABS_VOICE_ID_${voice === "voice_1" ? "1" : "2"}`],
      });
    }

    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
        voiceId
      )}/stream?output_format=${encodeURIComponent(ELEVENLABS_OUTPUT_FORMAT)}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY!.trim(),
          "Content-Type": "application/json",
          Accept: AUDIO_CONTENT_TYPE,
        },
        body: JSON.stringify({
          text,
          model_id: ELEVENLABS_MODEL_ID,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      }
    );

    if (!upstream.ok || !upstream.body) {
      const upstreamBody = await upstream.text().catch(() => "");
      console.warn("[tts] ElevenLabs upstream failed", {
        ownerUserId: user.id,
        isPlatformAdmin,
        messageId,
        voice,
        voiceId,
        upstreamStatus: upstream.status,
      });
      return jsonError("TTS_UPSTREAM_ERROR", 502, {
        upstreamStatus: upstream.status,
        upstreamBody: upstreamBody.slice(0, 500),
      });
    }

    console.info("[tts] ElevenLabs stream", {
      ownerUserId: user.id,
      isPlatformAdmin,
      messageId,
      voice,
      voiceId,
      model: ELEVENLABS_MODEL_ID,
    });

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": AUDIO_CONTENT_TYPE,
        "Cache-Control": "no-store",
        "X-TTS-Provider": "elevenlabs",
        "X-TTS-Voice-Symbol": voice,
        "X-TTS-Voice-Id": voiceId,
        "X-TTS-Model": ELEVENLABS_MODEL_ID,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[tts] generation failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonError("TTS_UPSTREAM_ERROR", 502);
  }
}
