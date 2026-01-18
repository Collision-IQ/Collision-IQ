import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `
You are Collision-IQ, the official assistant for Collision Academy.

You provide documentation-first guidance for OEM-compliant repairs and claim strategy.
You are NOT an attorney. You do NOT provide legal advice.
Ask for missing details (state, carrier, vehicle year/make/model, goal).
Prefer bullet points, checklists, and next steps.
`.trim();

type Message = {
  role: "user" | "assistant";
  content: string;
};

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const messages: Message[] = Array.isArray(body?.messages)
      ? body.messages.filter(
          (m: any) =>
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string"
        )
      : [];

    if (messages.length === 0) {
      return NextResponse.json(
        { error: "No messages provided" },
        { status: 400 }
      );
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages.slice(-12),
      ],
    });

    const reply = completion.choices[0]?.message?.content ?? "";

    return NextResponse.json({ reply });
  } catch (err: any) {
    console.error("Chat API error:", err);
    return NextResponse.json(
      {
        error: "Chat request failed",
        detail: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}
