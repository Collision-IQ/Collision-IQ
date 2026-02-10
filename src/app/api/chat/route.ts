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

function buildWorkspaceContext(notes?: string, docs?: UploadedDocument[]) {
  const safeNotes = (notes ?? "").trim();
  const safeDocs = Array.isArray(docs) ? docs : [];

  // Bound doc context to avoid massive prompts
  const maxCharsPerDoc = 6000;
  const maxDocs = 5;

  const docBlock =
    safeDocs.length > 0
      ? safeDocs.slice(0, maxDocs).map((d, idx) => {
          const excerpt = (d.text ?? "").slice(0, maxCharsPerDoc);
          return `Document ${idx + 1}: ${d.filename}\n---\n${excerpt}\n`;
        }).join("\n")
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
      return NextResponse.json({ error: "No messages provided" }, { status: 400 });
    }

    const workspaceContext = buildWorkspaceContext(body.workspaceNotes, body.documents);

    const systemInstructions =
      "You are Collision IQ, an OEM-aware automotive assistant. " +
      "Use uploaded documents and workspace notes as authoritative context when available. " +
      "If documents are missing relevant info, ask a concise follow-up question.";

    const input = [
      // System/developer style instruction (as an input message)
      {
        role: "system",
        content: [
          {
            type: "input_text" as const,
            text: systemInstructions + (workspaceContext ? `\n\n${workspaceContext}` : ""),
          },
        ],
      },

      // Conversation history
      ...body.messages.map((m) => ({
        role: m.role,
        content: [
          {
            // ✅ CRITICAL FIX:
            // user -> input_text
            // assistant -> output_text
            type:
              m.role === "user"
                ? ("input_text" as const)
                : ("output_text" as const),
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

    // Pass-through SSE stream
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Chat route failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
