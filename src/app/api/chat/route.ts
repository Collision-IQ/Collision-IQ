import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ChatRole = "user" | "assistant" | "system";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

function normalizeMessages(body: unknown): ChatMessage[] {
  if (
    body &&
    typeof body === "object" &&
    "messages" in body &&
    Array.isArray((body as { messages: unknown }).messages)
  ) {
    return (body as { messages: unknown[] }).messages.filter(
      (m): m is ChatMessage =>
        typeof m === "object" &&
        m !== null &&
        "role" in m &&
        "content" in m
    );
  }
  return [];
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY!;
  const body = await req.json();

  const messages = normalizeMessages(body);

  if (!messages.length) {
    return NextResponse.json({ error: "No messages provided" }, { status: 400 });
  }

  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      stream: true,
      input: messages.map((m) => ({
        role: m.role,
        content: [{ type: "input_text", text: m.content }],
      })),
    }),
  });

  if (!upstream.body) {
    return NextResponse.json({ error: "No stream" }, { status: 500 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
