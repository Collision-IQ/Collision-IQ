import OpenAI from "openai";
import { getSession, setSession } from "@/lib/sessionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return Response.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const sessionKey = String(body?.sessionKey ?? "").trim();
    if (!sessionKey) return Response.json({ error: "Missing sessionKey" }, { status: 400 });

    const existing = getSession(sessionKey);
    if (existing) {
      return Response.json({
        status: "ok",
        sessionKey,
        threadId: existing.threadId,
        vectorStoreId: existing.vectorStoreId,
      });
    }

    const vectorStore = await (openai.beta as any).vectorStores.create({
      name: `collision-${sessionKey}`,
    });

    const thread = await openai.beta.threads.create({
      tool_resources: {
        file_search: { vector_store_ids: [vectorStore.id] },
      },
    });

    setSession({
      sessionKey,
      threadId: thread.id,
      vectorStoreId: vectorStore.id,
      createdAt: Date.now(),
    });

    return Response.json({
      status: "created",
      sessionKey,
      threadId: thread.id,
      vectorStoreId: vectorStore.id,
    });
  } catch (err: any) {
    console.error("POST /api/session failed:", err);
    return Response.json({ error: "Session failed", detail: err?.message ?? String(err) }, { status: 500 });
  }
}
