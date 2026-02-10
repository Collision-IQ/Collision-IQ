import { NextResponse } from "next/server";
import { ChatMessage, UploadedDocument } from "@/types/chat";

interface ChatBody {
  messages: ChatMessage[];
  documents?: UploadedDocument[];
  workspaceNotes?: string;
}

export async function POST(req: Request) {
  const body = (await req.json()) as ChatBody;

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json(
      { error: "No messages provided" },
      { status: 400 }
    );
  }

  const workspaceContext =
    body.workspaceNotes || (body.documents?.length ?? 0) > 0
      ? {
          role: "system" as const,
          content: `
Workspace Context:
${body.workspaceNotes ?? ""}

Documents:
${body.documents?.map((d) => d.filename).join(", ") ?? ""}
`.trim(),
        }
      : null;

  const finalMessages = [
    {
      role: "system" as const,
      content:
        "You are Collision IQ, an OEM-aware automotive assistant.",
    },
    ...(workspaceContext ? [workspaceContext] : []),
    ...body.messages,
  ];

  const upstream = await fetch(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: finalMessages.map((m) => ({
          role: m.role,
          content: [{ type: "output_text", text: m.content }],
        })),
        stream: true,
      }),
    }
  );

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
