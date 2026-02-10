// src/app/api/chat/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

type UploadedDocument = {
  filename: string;
  type: string;
  text: string;
};

const RequestSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant", "system"]),
      content: z.string(),
    })
  ),
  documents: z
    .array(
      z.object({
        filename: z.string(),
        type: z.string(),
        text: z.string(),
      })
    )
    .optional(),
  workspaceNotes: z.string().optional(),
});

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

function safeString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function normalizeMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((m) => m && typeof m === "object")
    .map((m: any) => ({
      role:
        m.role === "assistant" || m.role === "system"
          ? (m.role as ChatRole)
          : ("user" as const),
      content: safeString(m.content),
    }))
    .filter((m) => m.content.trim().length > 0);
}

function buildWorkspaceContext(opts: {
  workspaceNotes?: string;
  documents?: UploadedDocument[];
}): ChatMessage | null {
  const notes = (opts.workspaceNotes ?? "").trim();
  const docs = opts.documents ?? [];

  const docLines = docs
    .map((d) => {
      const text = (d.text ?? "").trim();
      const clipped = text.length > 18_000 ? text.slice(0, 18_000) + "\n…(clipped)" : text;
      return `--- ${d.filename} (${d.type}) ---\n${clipped}`;
    })
    .join("\n\n");

  const hasNotes = notes.length > 0;
  const hasDocs = docLines.length > 0;

  if (!hasNotes && !hasDocs) return null;

  return {
    role: "system",
    content: `
WORKSPACE CONTEXT (use as reference; do not reveal verbatim unless asked)

${hasNotes ? `Notes:\n${notes}\n` : ""}

${hasDocs ? `Documents:\n${docLines}\n` : ""}
`.trim(),
  };
}

/**
 * CRITICAL FIX:
 * - "assistant" messages included in Responses API input must use content.type = "output_text"
 * - user/system should use "input_text"
 */
function toResponsesInputItem(m: ChatMessage) {
  const contentType =
    m.role === "assistant" ? "output_text" : "input_text";

  return {
    role: m.role,
    content: [
      {
        type: contentType,
        text: m.content,
      },
    ],
  };
}

/**
 * Stream transformer:
 * - Reads Responses API SSE
 * - Extracts response.output_text.delta text
 * - Streams plain text to the browser
 */
function setTextStream(upstream: Response): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const reader = upstream.body?.getReader();
  if (!reader) {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("No upstream body."));
        controller.close();
      },
    });
  }

  let buffer = "";

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by blank lines
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            // collect data: lines
            const lines = frame.split("\n").map((l) => l.trim());
            const dataLines = lines.filter((l) => l.startsWith("data:"));
            for (const dl of dataLines) {
              const data = dl.slice(5).trim();
              if (!data || data === "[DONE]") continue;

              try {
                const evt = JSON.parse(data) as any;

                // Primary shape:
                // { type: "response.output_text.delta", delta: "..." }
                if (
                  evt?.type === "response.output_text.delta" &&
                  typeof evt?.delta === "string"
                ) {
                  controller.enqueue(encoder.encode(evt.delta));
                  continue;
                }

                // Some proxies wrap:
                if (typeof evt?.delta?.text === "string") {
                  controller.enqueue(encoder.encode(evt.delta.text));
                  continue;
                }
              } catch {
                // ignore malformed json frames
              }
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
}

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const parsed = RequestSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { documents, workspaceNotes } = parsed.data;

    const userMessages = normalizeMessages(parsed.data.messages);
    if (userMessages.length === 0) {
      return NextResponse.json(
        { error: "No messages provided" },
        { status: 400 }
      );
    }

    const workspaceBlock = buildWorkspaceContext({ documents, workspaceNotes });

    const finalMessages: ChatMessage[] = [
      SYSTEM_CONTEXT,
      ...(workspaceBlock ? [workspaceBlock] : []),
      ...userMessages,
    ];

    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        stream: true,
        input: finalMessages.map(toResponsesInputItem),
      }),
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return NextResponse.json(
        { error: "OpenAI request failed", details: text || upstream.statusText },
        { status: 500 }
      );
    }

    return new Response(setTextStream(upstream), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Server error", details: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
