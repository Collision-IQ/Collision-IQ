import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ChatRole = "system" | "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type UploadedDocument = {
  filename: string;
  type: string;
  text: string;
};

type RequestBody = {
  messages?: unknown;
  workspaceNotes?: unknown;
  documents?: unknown;
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
State laws, policy language, and insurer practices vary.
When relevant, ask for the user's state, insurer, and claim type.
`.trim(),
};

function isChatRole(v: unknown): v is ChatRole {
  return v === "system" || v === "user" || v === "assistant";
}

function normalizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  const out: ChatMessage[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if (!isChatRole(role)) continue;
    if (typeof content !== "string" || !content.trim()) continue;
    out.push({ role, content });
  }
  return out;
}

function normalizeDocuments(value: unknown): UploadedDocument[] {
  if (!Array.isArray(value)) return [];
  const out: UploadedDocument[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const filename = (item as { filename?: unknown }).filename;
    const type = (item as { type?: unknown }).type;
    const text = (item as { text?: unknown }).text;

    if (typeof filename !== "string" || !filename.trim()) continue;
    if (typeof type !== "string" || !type.trim()) continue;
    if (typeof text !== "string" || !text.trim()) continue;

    out.push({ filename, type, text });
  }
  return out;
}

function buildWorkspaceSystemMessage(
  workspaceNotes: string,
  documents: UploadedDocument[]
): ChatMessage | null {
  const notes = workspaceNotes.trim();
  const hasNotes = notes.length > 0;
  const hasDocs = documents.length > 0;

  if (!hasNotes && !hasDocs) return null;

  const docBlock = hasDocs
    ? documents
        .map((d, idx) => {
          const safeText = d.text.length > 12000 ? d.text.slice(0, 12000) + "\n…(truncated)" : d.text;
          return `--- Document ${idx + 1}: ${d.filename} (${d.type}) ---\n${safeText}`;
        })
        .join("\n\n")
    : "";

  const content = `
WORKSPACE CONTEXT (use this before answering):
${hasNotes ? `Notes:\n${notes}\n` : ""}${hasDocs ? `Documents:\n${docBlock}\n` : ""}

Instructions:
- Use provided workspace notes and documents when relevant.
- If documents are ambiguous, ask 1–2 clarifying questions.
- Cite which document (by filename) you relied on when you reference it.
`.trim();

  return { role: "system", content };
}

/**
 * Streams OpenAI Responses API SSE -> plain text stream
 * We extract:
 * - response.output_text.delta
 * - response.output_text.done (optional)
 */
function textStreamFromOpenAIResponse(upstream: Response): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const body = upstream.body;
      if (!body) {
        controller.close();
        return;
      }

      const reader = body.getReader();
      let buffer = "";

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE frames separated by blank line
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const lines = frame.split("\n");
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;

              const data = trimmed.slice(5).trim();
              if (!data || data === "[DONE]") continue;

              let evt: unknown;
              try {
                evt = JSON.parse(data) as unknown;
              } catch {
                continue;
              }

              // Minimal safe extraction without `any`
              const t = extractDeltaText(evt);
              if (t) controller.enqueue(encoder.encode(t));
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

function extractDeltaText(evt: unknown): string {
  if (!evt || typeof evt !== "object") return "";

  const type = (evt as { type?: unknown }).type;
  if (type === "response.output_text.delta") {
    const delta = (evt as { delta?: unknown }).delta;
    return typeof delta === "string" ? delta : "";
  }

  // Some proxies/SDKs may wrap:
  // { type: "...delta", delta: { text: "..." } }
  if (type === "response.output_text.delta") {
    const deltaObj = (evt as { delta?: unknown }).delta;
    if (deltaObj && typeof deltaObj === "object") {
      const text = (deltaObj as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    }
  }

  return "";
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  let bodyJson: unknown;
  try {
    bodyJson = (await req.json()) as unknown;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = (bodyJson ?? {}) as RequestBody;

  const userMessages = normalizeMessages(body.messages);
  if (!userMessages.length) {
    return NextResponse.json({ error: "No messages provided" }, { status: 400 });
  }

  const workspaceNotes = typeof body.workspaceNotes === "string" ? body.workspaceNotes : "";
  const documents = normalizeDocuments(body.documents);

  const workspaceMsg = buildWorkspaceSystemMessage(workspaceNotes, documents);

  const finalMessages: ChatMessage[] = [
    SYSTEM_CONTEXT,
    ...(workspaceMsg ? [workspaceMsg] : []),
    ...userMessages,
  ];

  // Map to Responses API "input" format
  const input = finalMessages.map((m) => ({
    role: m.role,
    content: [{ type: "input_text" as const, text: m.content }],
  }));

  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input,
      stream: true,
      temperature: 0.2,
    }),
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: "OpenAI request failed", details: text || `HTTP ${upstream.status}` },
      { status: 500 }
    );
  }

  const stream = textStreamFromOpenAIResponse(upstream);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
