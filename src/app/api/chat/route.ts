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

function buildWorkspaceContext(
  notes?: string,
  docs?: UploadedDocument[]
) {
  const safeNotes = (notes ?? "").trim();
  const safeDocs = Array.isArray(docs) ? docs : [];

  const maxCharsPerDoc = 6000;
  const maxDocs = 5;

  const docBlock =
    safeDocs.length > 0
      ? safeDocs
          .slice(0, maxDocs)
          .map((d, idx) => {
            const excerpt = (d.text ?? "").slice(0, maxCharsPerDoc);
            return `Document ${idx + 1}: ${d.filename}\n---\n${excerpt}\n`;
          })
          .join("\n")
      : "";

  const parts: string[] = [];

  if (safeNotes) parts.push(`Workspace Notes:\n${safeNotes}`);
  if (docBlock) parts.push(`Documents:\n${docBlock}`);

  return parts.length ? parts.join("\n\n") : "";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ChatRequestBody;

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json(
        { error: "No messages provided" },
        { status: 400 }
      );
    }

    const workspaceContext = buildWorkspaceContext(
      body.workspaceNotes,
      body.documents
    );

    const systemInstructions = `
You are Collision IQ — an OEM-aware automotive repair analyst.

When documents or images are provided:
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

    /**
     * 🔥 CRITICAL LEVEL-5 FIX
     * ALL history = input_text
     * NEVER output_text inside input[]
     */
    const input = [
      {
        role: "system",
        content: [
          {
            type: "input_text" as const,
            text:
              systemInstructions +
              (workspaceContext ? "\n\n" + workspaceContext : ""),
          },
        ],
      },

      ...body.messages.map((m) => ({
        role: m.role,
        content: [
          {
            type: "input_text" as const,
            text: m.content,
          },
        ],
      })),
    ];

    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
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

    /**
     * ✅ LEVEL-5 HARDENED STREAM PARSER
     * Handles ALL text delta variants
     */
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body!.getReader();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const line = part.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;

            const json = line.replace("data: ", "");

            try {
              const parsed = JSON.parse(json);

              /**
               * 🔥 PRO STREAM SUPPORT
               */
              if (
                parsed.type === "response.output_text.delta" ||
                parsed.type === "response.delta"
              ) {
                const text =
                  parsed.delta ??
                  parsed.output_text?.delta ??
                  parsed.output?.[0]?.content?.[0]?.text ??
                  "";

                if (text) {
                  controller.enqueue(encoder.encode(text));
                }
              }
            } catch {}
          }
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Chat route failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
