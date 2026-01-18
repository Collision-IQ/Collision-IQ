// src/app/api/chat/route.ts
import OpenAI from "openai";
import { NextResponse } from "next/server";

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type ClientMessage = {
  role: "user" | "assistant";
  content: string;
};

const SYSTEM_PROMPT = `
You are Collision-IQ, the official assistant for Collision Academy.

You provide documentation-first guidance for OEM-compliant repairs and claim strategy.
You are NOT an attorney. You do NOT provide legal advice. You do not guarantee outcomes.
Ask for missing details (state, carrier, vehicle year/make/model, goal, estimate/supplement).
Prefer bullet points, checklists, and next steps.
`.trim();

function normalizeMessages(raw: unknown): ClientMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m: any) => m?.role && typeof m?.content === "string")
    .map((m: any) => ({ role: m.role, content: String(m.content).trim() }))
    .filter(
      (m: ClientMessage) =>
        (m.role === "user" || m.role === "assistant") && m.content.length > 0
    )
    .slice(-12);
}

function clampText(text: string, maxChars: number) {
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY" },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const messages = normalizeMessages((body as any).messages);

    const last = messages[messages.length - 1];
    if (!last || last.role !== "user") {
      return NextResponse.json(
        { error: "Missing user message." },
        { status: 400 }
      );
    }

    // Guardrails: keep pasted content from exploding tokens
    const MAX_MSG_CHARS = 60_000;
    const boundedMessages = messages.map((m) => ({
      ...m,
      content: clampText(m.content, MAX_MSG_CHARS),
    }));

    // Use Responses API (same as your original file), but WITHOUT MCP/tooling.
    const input = [
      { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
      ...boundedMessages.map((m) => ({
        role: m.role,
        content: [{ type: "input_text", text: m.content }],
      })),
    ];

    const resp = await openai.responses.create({
      model: MODEL,
      input: input as any,
      temperature: 0.2,
      max_output_tokens: 750,
    });

    return NextResponse.json(
      { reply: (resp as any).output_text ?? "" },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("POST /api/chat failed:", err);
    return NextResponse.json(
      { error: "Chat request failed.", detail: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
