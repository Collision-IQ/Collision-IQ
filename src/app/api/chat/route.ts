import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Strict message type used by ChatWidget
 */
type ChatRole = "system" | "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

/**
 * System instruction injected automatically
 */
const SYSTEM_CONTEXT: ChatMessage = {
  role: "system",
  content: `
You are Collision IQ, a professional automotive insurance claim assistant for Collision Academy.

You provide educational, neutral, OEM-aligned guidance on:
- Insurance claim handling best practices
- Repair planning and documentation
- Vehicle valuation concepts (total loss, diminished value)
- OEM procedure awareness and safety considerations

You do NOT provide legal advice.
State laws and policy language vary.
Ask for the user's state, insurer, and claim type when relevant.
`.trim(),
};

/**
 * Validate incoming payload safely (NO "any")
 */
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
        "content" in m &&
        (m as { role?: unknown }).role !== undefined &&
        typeof (m as { content?: unknown }).content === "string"
    );
  }

  return [];
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing OPENAI_API_KEY" },
      { status: 500 }
    );
  }

  let body: unknown;

  try {
    body = await req.json();
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

  /**
   * Combine system + history
   */
  const messages: ChatMessage[] = [
    SYSTEM_CONTEXT,
    ...userMessages,
  ];

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  /**
   * 🚀 2025 RESPONSES API (Streaming)
   */
  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: true,
      input: messages.map((m) => ({
        role: m.role,
        content: [
          {
            type: "input_text",
            text: m.content,
          },
        ],
      })),
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const txt = await upstream.text();
    return NextResponse.json(
      { error: "OpenAI request failed", details: txt },
      { status: 500 }
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  /**
   * Stream transformer
   */
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

            const jsonStr = part.replace(/^data:\s*/, "").trim();

            if (jsonStr === "[DONE]") {
              controller.close();
              return;
            }

            try {
              const json = JSON.parse(jsonStr);

              /**
               * 2025 streaming delta format
               */
              const delta =
                json?.output?.[0]?.content?.[0]?.text ??
                json?.delta ??
                "";

              if (delta) {
                controller.enqueue(encoder.encode(delta));
              }
            } catch {
              // ignore malformed chunks
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
