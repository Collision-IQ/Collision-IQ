import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ChatRole = "user" | "assistant";
type ChatMessage = { role: ChatRole; content: string };

type UploadedDocument = {
  filename: string;
  type: string;
  text: string;
};

type RequestBody = {
  messages: ChatMessage[];
  documents?: UploadedDocument[];
  workspaceNotes?: string;
};

function buildWorkspaceContext(docs: UploadedDocument[], notes: string): string {
  const safeNotes = notes.trim();
  const docBlocks = docs
    .map((d, idx) => {
      const trimmed = (d.text ?? "").slice(0, 12000); // keep requests bounded
      return `--- Document ${idx + 1}: ${d.filename} (${d.type}) ---\n${trimmed}`;
    })
    .join("\n\n");

  const parts: string[] = [];
  if (safeNotes) parts.push(`Workspace notes:\n${safeNotes}`);
  if (docBlocks) parts.push(`Uploaded documents:\n${docBlocks}`);

  if (parts.length === 0) return "";
  return parts.join("\n\n");
}

function toResponsesInput(messages: ChatMessage[]) {
  // Responses API expects: input: [{role, content:[{type:"input_text", text:"..."}]}]
  return messages.map((m) => ({
    role: m.role,
    content: [{ type: "input_text" as const, text: m.content }],
  }));
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as unknown;

    if (
      typeof body !== "object" ||
      body === null ||
      !("messages" in body) ||
      !Array.isArray((body as { messages: unknown }).messages)
    ) {
      return NextResponse.json(
        { error: "Invalid request body: missing messages[]" },
        { status: 400 }
      );
    }

    const { messages, documents, workspaceNotes } = body as RequestBody;

    const docs = Array.isArray(documents) ? documents : [];
    const notes = typeof workspaceNotes === "string" ? workspaceNotes : "";

    const workspaceContext = buildWorkspaceContext(docs, notes);

    const systemPreamble =
      "You are Collision IQ, a professional automotive insurance claim assistant for Collision Academy.\n" +
      "You provide educational, neutral, OEM-aligned guidance on:\n" +
      "- Insurance claim handling best practices\n" +
      "- Repair planning and documentation\n" +
      "- Vehicle valuation concepts\n" +
      "- OEM procedure awareness\n" +
      "You do NOT provide legal advice.";

    const finalMessages: ChatMessage[] = [
      {
        role: "assistant",
        content:
          systemPreamble +
          (workspaceContext ? `\n\nWORKSPACE CONTEXT:\n${workspaceContext}` : ""),
      },
      ...messages,
    ];

    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: toResponsesInput(finalMessages),
        stream: true,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => "");
      return NextResponse.json(
        { error: "OpenAI request failed", details: errText },
        { status: 500 }
      );
    }

    // Convert OpenAI SSE -> plain text stream
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

                // Each data line is JSON
                let evt: unknown;
                try {
                  evt = JSON.parse(data) as unknown;
                } catch {
                  continue;
                }

                if (
                  typeof evt === "object" &&
                  evt !== null &&
                  "type" in evt
                ) {
                  const t = (evt as { type: unknown }).type;

                  // Responses API streaming:
                  // { type: "response.output_text.delta", delta: "..." }
                  if (t === "response.output_text.delta") {
                    const delta = (evt as { delta?: unknown }).delta;
                    if (typeof delta === "string" && delta.length > 0) {
                      controller.enqueue(encoder.encode(delta));
                    }
                  }
                }
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
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
