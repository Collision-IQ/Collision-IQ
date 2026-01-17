import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function buildPrompt(messages: ChatMessage[]) {
  const system = `
You are Collision-IQ, a documentation-first assistant for Collision Academy.

Audience: policyholders and repair centers.
Goal: help users demand safe, OEM-compliant repairs using OEM procedures and insurance claim documentation strategy.
Constraints:
- Provide informational guidance and documentation strategy — NOT legal advice.
- If key details are missing, ask concise follow-ups (state, insurer, vehicle year/make/model, claim status, estimate/supplement, shop/DRP, injuries?).
- Be action-oriented: checklists, next steps, what to request in writing, what photos/docs to gather.
Tone: minimal, premium, calm, professional.
`.trim();

  const history = messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");

  return `${system}\n\nConversation:\n${history}\n\nASSISTANT:`;
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY. Add it to your root .env and restart dev server." },
        { status: 500 }
      );
    }

    const body = (await req.json().catch(() => null)) as { messages?: ChatMessage[] } | null;
    const messages = Array.isArray(body?.messages) ? body!.messages : [];

    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content?.trim();
    if (!lastUser) {
      return NextResponse.json({ error: "Missing user message." }, { status: 400 });
    }

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const prompt = buildPrompt(messages);

    const response = await client.responses.create({
      model,
      input: prompt,
      // You can tune these later:
      temperature: 0.4,
      max_output_tokens: 700,
    });

    return NextResponse.json({
      text: response.output_text ?? "",
    });
  } catch (err: any) {
    // Log server-side for debugging
    console.error("POST /api/chat failed:", err);

    const message =
      typeof err?.message === "string" ? err.message : "Unknown error";

    return NextResponse.json(
      { error: "Chat request failed.", detail: message },
      { status: 500 }
    );
  }
}
