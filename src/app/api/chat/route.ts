import { NextResponse } from "next/server";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type UploadedDocument = {
  filename: string;
  type: string;
  text: string;
};

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json(
        { error: "No messages provided" },
        { status: 400 }
      );
    }

    const messages: ChatMessage[] = body.messages;
    const documents: UploadedDocument[] = body.documents ?? [];
    const workspaceNotes: string = body.workspaceNotes ?? "";

    /**
     * LEVEL 4.5 FIX:
     * OpenAI Responses API requires STRING content
     * NOT [{ type: "input_text" }]
     */

    const workspaceContext =
      workspaceNotes || documents.length
        ? {
            role: "system" as const,
            content: `
Workspace Context:

Notes:
${workspaceNotes || "None"}

Documents:
${
  documents.length
    ? documents
        .map(
          (d) => `--- ${d.filename} ---
${d.text.slice(0, 12000)}`
        )
        .join("\n\n")
    : "None"
}
`.trim(),
          }
        : null;

    const finalMessages: ChatMessage[] = [
      {
        role: "system",
        content:
          "You are Collision IQ, an OEM-aware automotive estimator assistant. Always use uploaded documents as context when present.",
      },
      ...(workspaceContext ? [workspaceContext] : []),
      ...messages,
    ];

    /**
     * Responses API expects:
     * input: [{ role, content: STRING }]
     */

    const openaiBody = {
      model: "gpt-4.1-mini",
      stream: true,
      input: finalMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };

    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(openaiBody),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return NextResponse.json(
        { error: "OpenAI request failed", details: text },
        { status: 500 }
      );
    }

    /**
     * STREAM PASSTHROUGH
     */
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Server failure" },
      { status: 500 }
    );
  }
}
