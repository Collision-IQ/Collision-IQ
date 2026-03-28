import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";

const DEFAULT_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";

function normalizeModel(value: string | undefined) {
  return value?.trim() || DEFAULT_TRANSCRIBE_MODEL;
}

export async function POST(req: Request) {
  try {
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

    return NextResponse.json({ text: transcription.text ?? "" });
  } catch (error) {
    console.error("[transcribe] transcription failed", error);
    return NextResponse.json({ error: "Transcription failed." }, { status: 500 });
  }
}
