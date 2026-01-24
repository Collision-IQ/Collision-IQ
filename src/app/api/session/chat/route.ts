import OpenAI from "openai";
import { requireSession } from "@/lib/sessionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function sse(event: string, data: any) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const body = await req.json().catch(() => ({}));
        const sessionKey = String(body?.sessionKey ?? "").trim();
        const message = String(body?.message ?? "").trim();

        if (!sessionKey) throw new Error("Missing sessionKey");
        if (!message) throw new Error("Missing message");

        const assistantId = process.env.OPENAI_ASSISTANT_ID;
        if (!assistantId) throw new Error("Missing env OPENAI_ASSISTANT_ID");

        const session = requireSession(sessionKey);

        await openai.beta.threads.messages.create(session.threadId, {
          role: "user",
          content: message,
        });

        controller.enqueue(encoder.encode(sse("status", { message: "running" })));

        // ✅ Stream run WITHOUT tool_resources (thread already has it)
        const runner = openai.beta.threads.runs.stream(session.threadId, {
          assistant_id: assistantId,
        });

        runner.on("textDelta", (delta) => {
          const text = delta?.value ?? "";
          if (text) controller.enqueue(encoder.encode(sse("delta", { text })));
        });

        runner.on("error", (e: any) => {
          controller.enqueue(
            encoder.encode(sse("error", { message: e?.message ?? String(e) }))
          );
        });

        runner.on("end", () => {
          controller.enqueue(encoder.encode(sse("done", { ok: true })));
          controller.close();
        });
      } catch (err: any) {
        controller.enqueue(encoder.encode(sse("error", { message: err?.message ?? String(err) })));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
