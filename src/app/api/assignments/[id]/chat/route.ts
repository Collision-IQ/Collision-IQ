import OpenAI from "openai";
import { getAssignment } from "@/lib/assignmentStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let openai: OpenAI | null = null;
function getOpenAI() {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = getAssignment(id);
  if (!a) return new Response(JSON.stringify({ error: "Unknown assignmentId" }), { status: 404 });

  const body = await req.json().catch(() => ({}));
  const userText = String(body?.message ?? "").trim();
  if (!userText) return new Response(JSON.stringify({ error: "Missing message" }), { status: 400 });

  const assistantId = process.env.OPENAI_ASSISTANT_ID;
  if (!assistantId) return new Response(JSON.stringify({ error: "Missing OPENAI_ASSISTANT_ID" }), { status: 500 });

  const openai = getOpenAI();

  // Add user message to thread
  await openai.beta.threads.messages.create(a.threadId, {
    role: "user",
    content: userText,
  });

  // Stream run output as SSE
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // Create run with file_search enabled via vector store on the thread
        // Assistants v2 supports threads/runs and file_search tool :contentReference[oaicite:4]{index=4}
        const runStream = openai.beta.threads.runs.stream(a.threadId, {
          assistant_id: assistantId,
        });

        send("meta", { threadId: a.threadId });

        for await (const event of runStream) {
          // Most useful event: incremental text deltas
          if (event.event === "thread.message.delta") {
            const delta = event.data.delta?.content?.[0];
            const text = delta && "text" in delta ? delta.text?.value : undefined;
            if (text) send("delta", { text });
          }
          if (event.event === "thread.run.completed") send("done", {});
          if (event.event === "thread.run.failed") send("error", { message: "run failed", data: event.data });
        }

        controller.close();
      } catch (err: any) {
        send("error", { message: err?.message ?? String(err) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
