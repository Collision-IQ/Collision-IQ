import { NextResponse } from "next/server";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";

export const runtime = "nodejs";

const DEFAULT_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";

function normalizeModel(value: string | undefined) {
  return value?.trim() || DEFAULT_TRANSCRIBE_MODEL;
}

export async function POST(req: Request) {
  try {
    const { user, isPlatformAdmin } = await requireCurrentUser();

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json({ error: "Transcription service is not configured." }, { status: 503 });
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Audio file is required." }, { status: 400 });
    }

    if (file.size === 0) {
      return NextResponse.json({ error: "Audio file is empty." }, { status: 400 });
    }

    const model = normalizeModel(process.env.COLLISION_IQ_TRANSCRIBE_MODEL);

    const body = new FormData();
    body.append("file", file);
    body.append("model", model);

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("[transcribe] OpenAI API error", { status: response.status, detail });
      return NextResponse.json({ error: "Transcription failed." }, { status: 500 });
    }

    const json = await response.json() as { text?: string };

    console.info("[transcribe] completed", {
      ownerUserId: user.id,
      isPlatformAdmin,
      sizeBytes: file.size,
      model,
    });

    return NextResponse.json({ text: json.text ?? "" });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[transcribe] transcription failed", error);
    return NextResponse.json({ error: "Transcription failed." }, { status: 500 });
  }
}
