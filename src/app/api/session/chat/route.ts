import { NextRequest } from "next/server";
import OpenAI from "openai";
import { requireSession } from "@/lib/sessionStore";

export const runtime = "nodejs";

const openai = new OpenAI();

function sse(event: string, data: any) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamRun(params: {
  sessionKey: string | null;
  message: string | null;
  req: NextRequest;
}) {
  const { sessionKey, message, req } = params;
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      let closed = false;
      const safeClose = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };

      try {
        // Flush headers / confirm connection immediately
        controller.enqueue(encoder.encode(sse("status", { ready: true })));

        if (!sessionKey || !message) {
          controller.enqueue(
            encoder.encode(sse("error", { message: "Missing sessionKey or message" }))
          );
          safeClose();
          return;
        }

        let session;
        try {
          session = requireSession(sessionKey);
        } catch {
          controller.enqueue(
            encoder.encode(
              sse("error", {
                message:
                  "Session not initialized. Call POST /api/session first (from /widget/page.tsx) before chatting.",
              })
            )
          );
          safeClose();
          return;
        }

        // Attach user message to thread
        await openai.beta.threads.messages.create(session.threadId, {
          role: "user",
          content: message,
        });

        // Abort OpenAI run if client disconnects
        const abortController = new AbortController();
        req.signal.addEventListener("abort", () => abortController.abort());

        const runner = openai.beta.threads.runs.stream(
          session.threadId,
          { assistant_id: process.env.OPENAI_ASSISTANT_ID! },
          { signal: abortController.signal }
        );

        // Heartbeat so UI feels alive immediately
        controller.enqueue(encoder.encode(sse("delta", { text: " " })));

        runner.on("textDelta", (delta) => {
          controller.enqueue(encoder.encode(sse("delta", { text: delta.value })));
        });

        runner.on("error", (err: any) => {
          controller.enqueue(
            encoder.encode(sse("error", { message: err?.message ?? "Run failed" }))
          );
          safeClose();
        });

        runner.on("end", () => {
          controller.enqueue(encoder.encode(sse("done", { ok: true })));
          safeClose();
        });
      } catch (err: any) {
        controller.enqueue(
          encoder.encode(sse("error", { message: err?.message ?? "Server error" }))
        );
        safeClose();
      }
    },
  });
}

// ✅ SSE via GET (EventSource)
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sessionKey = url.searchParams.get("sessionKey");
  const message = url.searchParams.get("message");

  const stream = streamRun({ sessionKey, message, req });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

// ✅ Keep POST for any fetch-based clients
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const sessionKey = body?.sessionKey ?? null;
  const message = body?.message ?? null;

  const stream = streamRun({ sessionKey, message, req });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
