import { NextResponse } from "next/server";

export const runtime = "edge";

type ChatRole = "system" | "user" | "assistant";
type ChatMessage = { role: ChatRole; content: string };

type UploadedDocument = {
  filename: string;
  type: string;
  text: string;
};

type RequestBody = {
  messages: ChatMessage[];
  workspaceNotes?: string;
  documents?: UploadedDocument[];
};

const SYSTEM_CONTEXT: ChatMessage = {
  role: "system",
  content: [
    "You are Collision IQ, a professional automotive insurance claim assistant for Collision Academy.",
    "",
    "You provide educational, neutral, OEM-aligned guidance on:",
    "- Insurance claim handling best practices",
    "- Repair planning and documentation",
    "- Vehicle valuation concepts",
    "- OEM procedure awareness",
    "",
    "You do NOT provide legal advice.",
  ].join("\n"),
};

function buildWorkspaceBlock(body: RequestBody): ChatMessage | null {
  const notes = (body.workspaceNotes ?? "").trim();
  const docs = Array.isArray(body.documents) ? body.documents : [];

  if (!notes && docs.length === 0) return null;

  // Keep this short to avoid blowing token limits.
  const docLines = docs.slice(0, 6).map((d) => {
    const excerpt = (d.text ?? "").replace(/\s+/g, " ").slice(0, 600);
    return `- ${d.filename}\n  Excerpt: ${excerpt}${excerpt.length === 600 ? "…" : ""}`;
  });

  const content = [
    "WORKSPACE CONTEXT (use this as reference material, do not repeat verbatim unless asked):",
    notes ? `\nNotes:\n${notes}` : "",
    docs.length ? `\nDocuments:\n${docLines.join("\n")}` : "",
  ].join("\n");

  return { role: "system", content };
}

function normalizeMessages(body: RequestBody): ChatMessage[] {
  if (!Array.isArray(body.messages)) return [];
  return body.messages
    .filter((m): m is ChatMessage => !!m && typeof m.content === "string" && typeof m.role === "string")
    .map((m) => ({
      role: (m.role === "assistant" || m.role === "system" ? m.role : "user") as ChatRole,
      content: m.content,
    }))
    .filter((m) => m.content.trim().length > 0);
}

// Convert OpenAI SSE -> plain text stream
function sseToTextStream(upstream: Response): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body?.getReader();
      if (!reader) {
        controller.close();
        return;
      }

      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Split by SSE frame boundary
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const lines = frame.split("\n");
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;

              const data = trimmed.slice(5).trim();
              if (!data || data === "[DONE]") continue;

              // Chat Completions stream payload is JSON
              let json: unknown;
              try {
                json = JSON.parse(data) as unknown;
              } catch {
                continue;
              }

              const delta =
                typeof json === "object" &&
                json !== null &&
                "choices" in json &&
                Array.isArray((json as { choices?: unknown }).choices)
                  ? ((json as { choices: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content ?? "")
                  : "";

              if (delta) controller.enqueue(encoder.encode(delta));
            }
          }
        }
      } finally {
        controller.close();
      }
    },
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RequestBody;

    const userMessages = normalizeMessages(body);
    if (userMessages.length === 0) {
      return NextResponse.json({ error: "No messages provided" }, { status: 400 });
    }

    const workspaceBlock = buildWorkspaceBlock(body);

    const finalMessages: ChatMessage[] = [
      SYSTEM_CONTEXT,
      ...(workspaceBlock ? [workspaceBlock] : []),
      ...userMessages,
    ];

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    // IMPORTANT: Chat Completions expects `messages`
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        stream: true,
        temperature: 0.2,
        messages: finalMessages,
      }),
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return NextResponse.json(
        { error: "Upstream error", detail: text || upstream.statusText },
        { status: 500 }
      );
    }

    // Return plain text stream to client
    return new Response(sseToTextStream(upstream), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
