import { NextResponse } from "next/server";
import { getSession } from "@/lib/sessionStore";
import { getOpenAI } from "@/lib/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const sessionKey = String(form.get("sessionKey") ?? "").trim();
    const file = form.get("file");

    if (!sessionKey) {
      return NextResponse.json({ error: "Missing sessionKey" }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const session = getSession(sessionKey);
    if (!session) {
      return NextResponse.json(
        { error: "Unknown sessionKey. Call POST /api/session first." },
        { status: 400 }
      );
    }

    const openai = getOpenAI();

    // Upload file to OpenAI
    const uploaded = await openai.files.create({
      file,
      purpose: "assistants",
    });

    // ✅ NEW: attach to top-level vector store
    await openai.vectorStores.files.create(session.vectorStoreId, {
      file_id: uploaded.id,
    });

    return NextResponse.json({
      ok: true,
      sessionKey,
      fileId: uploaded.id,
      filename: file.name,
      status: "attached",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Upload failed", detail: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
