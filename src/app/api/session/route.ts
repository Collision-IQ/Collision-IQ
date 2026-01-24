import OpenAI from "openai";
import { NextResponse } from "next/server";
import { getSession, setSession } from "@/lib/sessionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const sessionKey = String(body?.sessionKey ?? "").trim();

    if (!sessionKey) {
      return NextResponse.json({ error: "Missing sessionKey" }, { status: 400 });
    }

    const existing = getSession(sessionKey);
    if (existing) {
      return NextResponse.json({ sessionKey, ...existing });
    }

    // Create a new thread + vector store for this session
    const thread = await openai.beta.threads.create();
    const vectorStore = await openai.vectorStores.create({
      name: `session-${sessionKey}`,
    });

    const state = {
      threadId: thread.id,
      vectorStoreId: vectorStore.id,
      createdAt: Date.now(),
    };

    setSession(sessionKey, state);

    return NextResponse.json({ sessionKey, ...state });
  } catch (err: any) {
    console.error("POST /api/session failed:", err);
    return NextResponse.json(
      { error: "Session create failed", detail: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
