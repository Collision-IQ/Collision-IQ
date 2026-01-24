import OpenAI from "openai";
import { getSession } from "@/lib/sessionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  const { sessionKey, message } = await req.json();

  if (!sessionKey || !message) {
    return new Response(JSON.stringify({ error: "Missing sessionKey or message" }), { status: 400 });
  }

  const s = getSession(sessionKey);
  if (!s) return new Response(JSON.stringify({ error: "Unknown sessionKey" }), { status: 404 });

  const assistantId = process.env.OPENAI_ASSISTANT_ID;
  if (!assistantId) return new Response(JSON.stringify({ error: "Missing OPENAI_ASSISTANT_ID" }), { status: 500 });

  await openai.beta.threads.messages.create(s.threadId, {
    role: "user",
    content: String(message),
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const runStream = openai.beta.threads.runs.stream(s.threadId, {
          assistant_id: assistantId,
        });

        for await (const event of runStream) {
          if (event.event === "thread.message.delta") {
            const delta = event.data.delta?.content?.[0];
            const text = delta && "text" in delta ? delta.text?.value : undefined;
            if (text) send("delta", { text });
          }
          if (event.event === "thread.run.completed") send("done", {});
          if (event.event === "thread.run.failed") send("error", { event });
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
