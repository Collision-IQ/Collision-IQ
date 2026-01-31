// src/app/api/chat/route.ts
import { NextResponse } from "next/server";

export const runtime = "edge";

type ChatRole = "system" | "user" | "assistant";
type ChatMessage = { role: ChatRole; content: string };

function normalizeMessages(body: any): ChatMessage[] {
  // Accept either:
  //  - { messages: [{role, content}, ...] }
  //  - { message: "..." }  (legacy/single message)
  if (Array.isArray(body?.messages) && body.messages.length) {
    return body.messages
      .filter((m: any) => m && typeof m.content === "string" && typeof m.role === "string")
      .map((m: any) => ({ role: m.role, content: m.content })) as ChatMessage[];
  }

  if (typeof body?.message === "string" && body.message.trim()) {
    return [{ role: "user", content: body.message.trim() }];
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

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const messages = normalizeMessages(body);

  if (!messages.length) {
    return NextResponse.json(
      { error: "No messages provided. Send { messages: [...] } or { message: string }." },
      { status: 400 }
    );
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  // OpenAI Chat Completions streaming (SSE)
  const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      stream: true,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: "OpenAI request failed", status: upstream.status, details: text },
      { status: 500 }
    );
  }

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

          // SSE events are separated by double newlines
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const part of parts) {
            const lines = part.split("\n").map((l) => l.trim());
            for (const line of lines) {
              if (!line.startsWith("data:")) continue;

              const data = line.replace(/^data:\s*/, "");
              if (data === "[DONE]") {
                controller.close();
                return;
              }

              try {
                const json = JSON.parse(data);
                const delta: string | undefined =
                  json?.choices?.[0]?.delta?.content;

                if (delta) {
                  controller.enqueue(encoder.encode(delta));
                }
              } catch {
                // Ignore malformed JSON chunks
              }
            }
          }
        }
      } catch (err) {
        controller.error(err);
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
