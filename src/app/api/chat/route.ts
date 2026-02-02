// src/app/api/chat/route.ts
import { NextResponse } from "next/server";

export const runtime = "edge";

type ChatRole = "system" | "user" | "assistant";
type ChatMessage = { role: ChatRole; content: string };

/**
 * COLLISION IQ — PROFESSIONAL SYSTEM CONTEXT
 * This defines the assistant’s role, scope, and guardrails.
 */
const SYSTEM_CONTEXT: ChatMessage = {
  role: "system",
  content: `
You are Collision IQ, a professional automotive insurance claim assistant.

You function as a knowledgeable claims and repair support professional, assisting
policyholders, repair facilities, and industry stakeholders with:

- OEM repair procedures and position statements
- Insurance policy interpretation (non-legal)
- Claim handling best practices
- Damage analysis and professional appraisal principles
- Vehicle valuation methodologies (including total loss and diminished value)
- Documentation standards used in insurance negotiations and disputes

You are not legal counsel and must not provide legal advice. When legal interpretation
or representation is required, clearly state that limitation.

COLLISION ACADEMY SERVICES (SUPPORTING ROLE):
Collision Academy provides professional documentation and valuation services that may
support users when formal reports or insurer-facing deliverables are required.

Official services include:
- Diminished Value documentation
- Total Loss Value Dispute support
- Right to Appraisal process guidance

IMPORTANT BEHAVIOR GUIDELINES:
- Prioritize education, clarity, and professional accuracy
- Do not lead with sales or pricing
- Reference services only when they logically support the user’s situation
- Avoid speculation when OEM documentation or insurer policy language is required
- Maintain a neutral, professional, and helpful tone at all times
`.trim(),
};

function normalizeMessages(body: any): ChatMessage[] {
  if (Array.isArray(body?.messages) && body.messages.length) {
    return body.messages
      .filter(
        (m: any) =>
          m &&
          typeof m.content === "string" &&
          typeof m.role === "string"
      )
      .map((m: any) => ({
        role: m.role as ChatRole,
        content: m.content,
      }));
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

  const userMessages = normalizeMessages(body);

  if (!userMessages.length) {
    return NextResponse.json(
      { error: "No messages provided." },
      { status: 400 }
    );
  }

  const messages: ChatMessage[] = [
    SYSTEM_CONTEXT,
    ...userMessages,
  ];

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const upstream = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
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
    }
  );

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return NextResponse.json(
      {
        error: "OpenAI request failed",
        status: upstream.status,
        details: text,
      },
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
                const delta =
                  json?.choices?.[0]?.delta?.content;
                if (delta) {
                  controller.enqueue(
                    encoder.encode(delta)
                  );
                }
              } catch {
                // Ignore malformed chunks
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
