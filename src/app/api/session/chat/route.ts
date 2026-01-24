import OpenAI from "openai";
import { getSession } from "@/lib/sessionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  const assistantId = process.env.OPENAI_ASSISTANT_ID;

  try {
    if (!process.env.OPENAI_API_KEY) {
      return Response.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }
    if (!assistantId) {
      return Response.json({ error: "Missing OPENAI_ASSISTANT_ID" }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const sessionKey = String(body?.sessionKey ?? "").trim();
    const message = String(body?.message ?? "").trim();

    if (!sessionKey || !message) {
      return Response.json({ error: "Missing sessionKey or message" }, { status: 400 });
    }

    const s = getSession(sessionKey);
    if (!s) {
      return Response.json({ error: "Unknown sessionKey. Call POST /api/session first." }, { status: 404 });
    }

    await openai.beta.threads.messages.create(s.threadId, {
      role: "user",
      content: message,
    });

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: any) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        try {
          send("meta", { sessionKey, threadId: s.threadId, vectorStoreId: s.vectorStoreId });

          const runStream = await openai.beta.threads.runs.stream(s.threadId, {
            assistant_id: assistantId,
          });

          for await (const event of runStream) {
            if (event.event === "thread.message.delta") {
              const delta = event.data.delta?.content?.[0];
              const text = delta && "text" in delta ? (delta as any).text?.value : undefined;
              if (text) send("delta", { text });
            }

            if (event.event === "thread.run.failed") send("error", { message: "run_failed" });
            if (event.event === "thread.run.completed") send("done", {});
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
  } catch (err: any) {
    console.error("POST /api/session/chat failed:", err);
    return Response.json({ error: "Chat failed", detail: err?.message ?? String(err) }, { status: 500 });
  }
}
