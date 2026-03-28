import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";
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
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Audio file is required." }, { status: 400 });
    }

    if (file.size === 0) {
      return NextResponse.json({ error: "Audio file is empty." }, { status: 400 });
    }

    const model = normalizeModel(process.env.COLLISION_IQ_TRANSCRIBE_MODEL);
    const transcription = await openai.audio.transcriptions.create({
      file,
      model,
    });

    console.info("[transcribe] completed", {
      ownerUserId: user.id,
      isPlatformAdmin,
      sizeBytes: file.size,
      model,
    });

    return NextResponse.json({ text: transcription.text ?? "" });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[transcribe] transcription failed", error);
    return NextResponse.json({ error: "Transcription failed." }, { status: 500 });
  }
}
