import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let openai: OpenAI | null = null;
function getOpenAI() {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

// Simple in-memory mapping: assignmentId -> threadId
// NOTE: This is fine for dev/testing. On serverless it may reset between invocations.
// If you need persistence later, store this in DB/Redis keyed by assignmentId.
const threadsByAssignment = new Map<string, string>();

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function extractTextFromMessage(msg: any): string {
  // OpenAI Assistants message content is typically an array of parts.
  // We try to pull all "text" parts safely.
  const parts = msg?.content ?? [];
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p) => p?.text?.value)
    .filter(Boolean)
    .join("\n");
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest) {
  try {
    mustEnv("OPENAI_API_KEY");
    const assistantId = mustEnv("OPENAI_ASSISTANT_ID");

    const body = await req.json().catch(() => ({}));
    const assignmentId = String(body?.assignmentId ?? "").trim();
    if (!assignmentId) {
      return NextResponse.json({ error: "Missing assignment id" }, { status: 400 });
    }

    const message = String(body?.message ?? "").trim();

    if (!message) {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    const openai = getOpenAI();

    // Create or reuse a thread for this assignment
    let threadId = threadsByAssignment.get(assignmentId);
    if (!threadId) {
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
      threadsByAssignment.set(assignmentId, threadId);
    }

    // Add user message
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    });

    // Start a run
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    });

    // Poll until complete (simple + reliable for production builds)
    // You can swap this for streaming later.
    let status = run.status;
    let tries = 0;

    while (
      status !== "completed" &&
      status !== "failed" &&
      status !== "cancelled" &&
      status !== "expired" &&
      tries < 45
    ) {
      tries += 1;
      await sleep(700);
      const latest = await openai.beta.threads.runs.retrieve(run.id, { thread_id: threadId });
      status = latest.status;
    }

    if (status !== "completed") {
      return NextResponse.json(
        { error: "Run did not complete", status },
        { status: 500 }
      );
    }

    // Fetch latest messages and return the most recent assistant text
    const list = await openai.beta.threads.messages.list(threadId, { limit: 10 });
    const latestAssistant = list.data.find((m) => m.role === "assistant");

    const text = latestAssistant ? extractTextFromMessage(latestAssistant) : "";

    return NextResponse.json({
      ok: true,
      assignmentId,
      threadId,
      text,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
