import OpenAI from "openai";
import { NextResponse } from "next/server";
import { getSession, setSession } from "@/lib/sessionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  const { sessionKey } = await req.json();

  if (!sessionKey) {
    return NextResponse.json({ error: "Missing sessionKey" }, { status: 400 });
  }

  const existing = getSession(sessionKey);
  if (existing) return NextResponse.json({ sessionKey, ...existing });

  const thread = await openai.beta.threads.create();
  const vectorStore = await openai.vectorStores.create({ name: `session-${sessionKey}` });

  setSession(sessionKey, { threadId: thread.id, vectorStoreId: vectorStore.id });

  return NextResponse.json({ sessionKey, threadId: thread.id, vectorStoreId: vectorStore.id });
}
