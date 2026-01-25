import { NextRequest } from "next/server";
import OpenAI from "openai";
import { requireSession } from "../../../lib/sessionStore";

export const runtime = "nodejs";

const openai = new OpenAI();

function sse(event: string, data: any) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const safeClose = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };

      try {
        // 🔹 Flush headers immediately
        controller.enqueue(
          encoder.encode(sse("status", { ready: true }))
        );

        const { sessionKey, message } = await req.json();

        if (!sessionKey || !message) {
          controller.enqueue(
            encoder.encode(
              sse("error", { message: "Missing sessionKey or message" })
            )
          );
          safeClose();
          return;
        }

        // ✅ Use your existing session store
        const session = requireSession(sessionKey);

        // 🔹 Attach user message
        await openai.beta.threads.messages.create(session.threadId, {
          role: "user",
          content: message,
        });

        // 🔹 Abort OpenAI run if client disconnects
        const abortController = new AbortController();
        req.signal.addEventListener("abort", () => {
          abortController.abort();
        });

        // 🔹 Start streaming run
        const runner = openai.beta.threads.runs.stream(
          session.threadId,
          {
            assistant_id: process.env.OPENAI_ASSISTANT_ID!,
          },
          {
            signal: abortController.signal,
          }
        );

        // 🔹 Immediate heartbeat so UI feels alive
        controller.enqueue(
          encoder.encode(sse("delta", { text: " " }))
        );

        runner.on("textDelta", (delta) => {
          controller.enqueue(
            encoder.encode(sse("delta", { text: delta.value }))
          );
        });

        runner.on("error", (err) => {
          controller.enqueue(
            encoder.encode(
              sse("error", { message: err?.message ?? "Run failed" })
            )
          );
          safeClose();
        });

        runner.on("end", () => {
          controller.enqueue(
            encoder.encode(sse("done", { ok: true }))
          );
          safeClose();
        });
      } catch (err: any) {
        controller.enqueue(
          encoder.encode(
            sse("error", { message: err?.message ?? "Server error" })
          )
        );
        safeClose();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
