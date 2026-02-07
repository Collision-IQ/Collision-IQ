import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ChatRole = "system" | "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type RequestBody = {
  messages?: unknown;
};

const SYSTEM_CONTEXT: ChatMessage = {
  role: "system",
  content: `
You are Collision IQ, a professional automotive insurance claim assistant for Collision Academy.

You provide educational, neutral, OEM-aligned guidance on:
- Insurance claim handling best practices
- Repair planning and documentation
- Vehicle valuation concepts
- OEM procedure awareness

You do NOT provide legal advice.
`.trim(),
};

/**
 * SAFE normalizer
 * Prevents 400 errors + bad input
 */
function normalizeMessages(body: RequestBody): ChatMessage[] {
  if (!Array.isArray(body?.messages)) return [];

  return body.messages
    .filter(
      (m): m is { role: unknown; content: unknown } =>
        typeof m === "object" &&
        m !== null &&
        "role" in m &&
        "content" in m
    )
    .map((m) => ({
      role:
        m.role === "assistant" || m.role === "system"
          ? (m.role as ChatRole)
          : "user",
      content: typeof m.content === "string" ? m.content : "",
    }))
    .filter((m) => m.content.length > 0);
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing OPENAI_API_KEY" },
      { status: 500 }
    );
  }

  let body: RequestBody;

  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const userMessages = normalizeMessages(body);

  if (!userMessages.length) {
    return NextResponse.json(
      { error: "No messages provided" },
      { status: 400 }
    );
  }

  const messages: ChatMessage[] = [
    SYSTEM_CONTEXT,
    ...userMessages,
  ];

  const upstream = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages,
        stream: true,
        temperature: 0.2,
      }),
    }
  );

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    return NextResponse.json(
      { error: "OpenAI request failed", details: text },
      { status: 500 }
    );
  }

  /**
   * 🚀 CLEAN TEXT STREAM (NOT RAW SSE)
   * This is the FINAL FIX
   */
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = "";

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const part of parts) {
            if (!part.startsWith("data:")) continue;

            const data = part.replace(/^data:\s*/, "");

            if (data === "[DONE]") {
              controller.close();
              return;
            }

            try {
              const json = JSON.parse(data);
              const delta =
                json?.choices?.[0]?.delta?.content ?? "";

              if (delta) {
                controller.enqueue(
                  encoder.encode(delta)
                );
              }
            } catch {
              // ignore bad chunks
            }
          }
        }
      } catch (err) {
        controller.error(err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
