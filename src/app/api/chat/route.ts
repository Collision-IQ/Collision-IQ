import { NextResponse } from "next/server";
import type { UploadedDocument } from "@/lib/sessionStore";

export const runtime = "nodejs";

type ChatRole = "user" | "assistant";
type ChatMessage = { role: ChatRole; content: string };

type ChatRequestBody = {
  messages: ChatMessage[];
  documents?: UploadedDocument[];
  workspaceNotes?: string;
};

// --- Responses API input message shapes ---
type InputTextPart = { type: "input_text"; text: string };
type OutputTextPart = { type: "output_text"; text: string };

type InputMessage =
  | { role: "system"; content: InputTextPart[] }
  | { role: "user"; content: InputTextPart[] }
  | { role: "assistant"; content: OutputTextPart[] };

function buildWorkspaceContext(notes?: string, docs?: UploadedDocument[]) {
  const safeNotes = (notes ?? "").trim();
  const safeDocs = Array.isArray(docs) ? docs : [];

  // Bound doc context so prompts don’t explode
  const maxCharsPerDoc = 6000;
  const maxDocs = 5;

  const docBlock =
    safeDocs.length > 0
      ? safeDocs
          .slice(0, maxDocs)
          .map((d, idx) => {
            const filename = d.filename ?? `Document_${idx + 1}`;
            const excerpt = (d.text ?? "").slice(0, maxCharsPerDoc);
            return `Document ${idx + 1}: ${filename}\n---\n${excerpt}\n`;
          })
          .join("\n")
      : "";

  const parts: string[] = [];
  if (safeNotes) parts.push(`Workspace Notes:\n${safeNotes}`);
  if (docBlock) parts.push(`Documents:\n${docBlock}`);

  return parts.length ? parts.join("\n\n") : "";
}

function toInputMessage(m: ChatMessage): InputMessage {
  if (m.role === "user") {
    return {
      role: "user",
      content: [{ type: "input_text", text: m.content }],
    };
  }
  // assistant history MUST be output_text in Responses API
  return {
    role: "assistant",
    content: [{ type: "output_text", text: m.content }],
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<ChatRequestBody>;

    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length === 0) {
      return NextResponse.json(
        { error: "No messages provided" },
        { status: 400 }
      );
    }

    // Basic shape validation (prevents weird runtime crashes)
    for (const m of messages) {
      if (
        !m ||
        (m.role !== "user" && m.role !== "assistant") ||
        typeof m.content !== "string"
      ) {
        return NextResponse.json(
          { error: "Invalid message format" },
          { status: 400 }
        );
      }
    }

    const workspaceContext = buildWorkspaceContext(
      body.workspaceNotes,
      body.documents
    );

    const systemInstructions = `
You are Collision IQ — an OEM-aware automotive repair analyst.

When documents are provided:
- Extract repair operations
- Identify missing OEM procedures
- Suggest supplement opportunities
- Reference OEM-aligned repair strategy

If an image is uploaded:
- Analyze visible damage
- Infer likely repair workflow
- Suggest inspection or repair steps

Always respond as a professional collision repair expert.
`.trim();

    const systemText =
      systemInstructions +
      (workspaceContext ? `\n\n${workspaceContext}` : "");

    const input: InputMessage[] = [
      {
        role: "system",
        content: [{ type: "input_text", text: systemText }],
      },
      ...messages.map(toInputMessage),
    ];

    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        input,
        stream: true,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const txt = await upstream.text().catch(() => "");
      return NextResponse.json(
        { error: "OpenAI request failed", details: txt || upstream.statusText },
        { status: 500 }
      );
 
      }

    // We stream back ONLY assistant text deltas as plain text chunks
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstream.body!.getReader();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // SSE frames are separated by blank lines
            const frames = buffer.split("\n\n");
            buffer = frames.pop() ?? "";

            for (const frame of frames) {
              // each frame may contain multiple lines, we want the data line
              const dataLine = frame
                .split("\n")
                .find((l) => l.startsWith("data: "));
              if (!dataLine) continue;

              const data = dataLine.slice("data: ".length).trim();
              if (!data || data === "[DONE]") continue;

              try {
                const evt = JSON.parse(data);

                if (evt.type === "response.output_text.delta") {
                  const text =
                    typeof evt.delta === "string"
                      ? evt.delta
                      : evt.delta?.text;

                  if (text) {
                    controller.enqueue(encoder.encode(text));
                  }
                }
              } catch {
                // ignore malformed JSON chunks
              }
            }
          }
        } finally {
          controller.close();
          reader.releaseLock();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Chat route failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
