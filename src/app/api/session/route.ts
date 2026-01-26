import { NextResponse } from "next/server";
import { getSession, setSession } from "@/lib/sessionStore";
import { getOpenAI } from "@/lib/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    mustEnv("OPENAI_API_KEY");
    mustEnv("OPENAI_ASSISTANT_ID");

    const body = await req.json().catch(() => ({}));
    const sessionKey = String(body?.sessionKey ?? "").trim();
    if (!sessionKey) {
      return NextResponse.json({ error: "Missing sessionKey" }, { status: 400 });
    }

    const existing = getSession(sessionKey);
    if (existing) {
      return NextResponse.json({
        ok: true,
        sessionKey,
        threadId: existing.threadId,
        vectorStoreId: existing.vectorStoreId,
        reused: true,
      });
    }

    const openai = getOpenAI();

    // ✅ NEW: vector stores are top-level
    const vs = await openai.vectorStores.create({
      name: `collision-session:${sessionKey}`,
    });

    // ✅ Attach vector store to the thread at creation time
    const thread = await openai.beta.threads.create({
      tool_resources: {
        file_search: { vector_store_ids: [vs.id] },
      },
    });

    const rec = {
      sessionKey,
      threadId: thread.id,
      vectorStoreId: vs.id,
      createdAt: Date.now(),
    };

    setSession(rec);

    return NextResponse.json({
      ok: true,
      sessionKey,
      threadId: rec.threadId,
      vectorStoreId: rec.vectorStoreId,
      reused: false,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Session failed", detail: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
