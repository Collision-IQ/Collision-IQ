import { NextResponse } from "next/server";
import type { UploadedDocument } from "@/lib/sessionStore";

export const runtime = "nodejs";

type ChatRole = "system" | "user" | "assistant";
type ChatMessage = { role: ChatRole; content: string };

type RequestBody = {
  messages?: ChatMessage[];
  documents?: UploadedDocument[];
  workspaceNotes?: string;
};

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

function isChatRole(x: unknown): x is ChatRole {
  return x === "system" || x === "user" || x === "assistant";
}

function normalizeBody(x: unknown): Required<RequestBody> {
  const out: Required<RequestBody> = {
    messages: [],
    documents: [],
    workspaceNotes: "",
  };

  if (!x || typeof x !== "object") return out;
  const b = x as Record<string, unknown>;

  if (Array.isArray(b.messages)) {
    out.messages = b.messages
      .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
      .map((m) => ({
        role: isChatRole(m.role) ? m.role : "user",
        content: typeof m.content === "string" ? m.content : "",
      }))
      .filter((m) => m.content.trim().length > 0);
  }

  if (Array.isArray(b.documents)) {
    out.documents = b.documents
      .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
      .map((d) => ({
        filename: typeof d.filename === "string" ? d.filename : "document",
        type: typeof d.type === "string" ? d.type : "application/octet-stream",
        text: typeof d.text === "string" ? d.text : "",
      }));
  }

  if (typeof b.workspaceNotes === "string") {
    out.workspaceNotes = b.workspaceNotes;
  }

  return out;
}

function buildWorkspaceBlock(
  docs: UploadedDocument[],
  workspaceNotes: string
): ChatMessage | null {
  const notes = workspaceNotes.trim();
  const hasNotes = notes.length > 0;
  const hasDocs = docs.length > 0;

  if (!hasNotes && !hasDocs) return null;

  const docLines = docs
    .map((d, i) => {
      const snippet = d.text.trim().slice(0, 6000); // keep it bounded
      const hasText = snippet.length > 0;
      return [
        `#${i + 1}: ${d.filename} (${d.type})`,
        hasText ? snippet : "[No extracted text — PDF parser may be missing or returned empty text]",
      ].join("\n");
    })
    .join("\n\n---\n\n");

  const content = `
WORKSPACE CONTEXT (uploaded docs + notes). Use this when answering.

Workspace notes:
${hasNotes ? notes : "[none]"}

Uploaded documents:
${hasDocs ? docLines : "[none]"}
`.trim();

  return { role: "system", content };
}

type ResponseStreamEvent =
  | { type: "response.output_text.delta"; delta: string }
  | { type: "response.completed" }
  | { type: string; [k: string]: unknown };

function parseSseFrames(text: string): string[] {
  // frames are separated by blank line
  return text.split("\n\n").filter((x) => x.trim().length > 0);
}

function extractDataLine(frame: string): string | null {
  // handle `data: {...}`
  const lines = frame.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("data:")) return trimmed.slice(5).trim();
  }
  return null;
}

function safeParseEvent(jsonStr: string): ResponseStreamEvent | null {
  try {
    const v: unknown = JSON.parse(jsonStr);
    if (!v || typeof v !== "object") return null;
    return v as ResponseStreamEvent;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = normalizeBody(raw);
  if (body.messages.length === 0) {
    return NextResponse.json({ error: "No messages provided" }, { status: 400 });
  }

  const workspaceBlock = buildWorkspaceBlock(body.documents, body.workspaceNotes);

  const finalMessages: ChatMessage[] = [
    SYSTEM_CONTEXT,
    ...(workspaceBlock ? [workspaceBlock] : []),
    ...body.messages,
  ];

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: true,
      input: finalMessages.map((m) => ({
        role: m.role,
        content: [{ type: "input_text", text: m.content }],
      })),
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const txt = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: "OpenAI request failed", details: txt },
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

          const frames = parseSseFrames(buffer);
          // keep last partial in buffer
          const endsWithBlank = buffer.endsWith("\n\n");
          buffer = endsWithBlank ? "" : frames.pop() ?? "";

          for (const frame of frames) {
            const data = extractDataLine(frame);
            if (!data || data === "[DONE]") continue;

            const evt = safeParseEvent(data);
            if (!evt) continue;

            if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
              controller.enqueue(encoder.encode(evt.delta));
            }

            if (evt.type === "response.completed") {
              controller.close();
              return;
            }
          }
        }
      } catch (e) {
        controller.error(e);
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
