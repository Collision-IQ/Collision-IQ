import OpenAI from "openai";
import { getAssignment } from "@/lib/assignmentStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: Request) {
  try {
    // Extract assignmentId from URL
    const url = new URL(request.url);
    const parts = url.pathname.split("/");
    const assignmentId = parts[parts.indexOf("assignments") + 1];

    if (!assignmentId) {
      return new Response(
        JSON.stringify({ error: "Missing assignmentId" }),
        { status: 400 }
      );
    }

    const assignment = getAssignment(assignmentId);
    if (!assignment) {
      return new Response(
        JSON.stringify({ error: "Unknown assignmentId" }),
        { status: 404 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const userText = String(body?.message ?? "").trim();
    if (!userText) {
      return new Response(
        JSON.stringify({ error: "Missing message" }),
        { status: 400 }
      );
    }

    const assistantId = process.env.OPENAI_ASSISTANT_ID;
    if (!assistantId) {
      return new Response(
        JSON.stringify({ error: "Missing OPENAI_ASSISTANT_ID" }),
        { status: 500 }
      );
    }

    // Add user message to thread
    await openai.beta.threads.messages.create(assignment.threadId, {
      role: "user",
      content: userText,
    });

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
            )
          );
        };

        try {
          const runStream = openai.beta.threads.runs.stream(
            assignment.threadId,
            { assistant_id: assistantId }
          );

          send("meta", { threadId: assignment.threadId });

          for await (const event of runStream) {
            if (event.event === "thread.message.delta") {
              const delta = event.data.delta?.content?.[0];
              const text =
                delta && "text" in delta ? delta.text?.value : undefined;
              if (text) send("delta", { text });
            }

            if (event.event === "thread.run.completed") {
              send("done", {});
            }

            if (event.event === "thread.run.failed") {
              send("error", { message: "Run failed" });
            }
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
    return new Response(
      JSON.stringify({ error: err?.message ?? "Server error" }),
      { status: 500 }
    );
  }
}
