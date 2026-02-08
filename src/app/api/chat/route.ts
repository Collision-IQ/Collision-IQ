import { NextResponse } from "next/server";

type ChatRole = "user" | "assistant" | "system";

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
  messages?: ChatMessage[];
  documents?: UploadedDocument[];
  workspaceNotes?: string;
};

const SYSTEM_CONTEXT: ChatMessage = {
  role: "system",
  content:
    "You are Collision IQ, an OEM-aligned automotive claims assistant. Provide structured educational analysis.",
};

export async function POST(req: Request) {
  const body = (await req.json()) as RequestBody;

  const messages = body.messages ?? [];

  if (!messages.length) {
    return NextResponse.json({ error: "No messages provided" }, { status: 400 });
  }

  const workspaceContext =
    body.workspaceNotes || body.documents?.length
      ? {
          role: "system" as const,
          content: `
Workspace Context:
Notes: ${body.workspaceNotes ?? ""}
Documents:
${(body.documents ?? []).map((d) => d.filename).join("\n")}
`,
        }
      : null;

  const finalMessages = [
    SYSTEM_CONTEXT,
    ...(workspaceContext ? [workspaceContext] : []),
    ...messages,
  ];

  const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: finalMessages,
      stream: true,
    }),
  });

  return new Response(upstream.body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
