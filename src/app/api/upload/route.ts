import OpenAI from "openai";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/sessionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function GET(request: Request) {
  // handle GET
}

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const form = await request.formData();
    const sessionKey = String(form.get("sessionKey") ?? "").trim();
    const file = form.get("file");

    if (!sessionKey) {
      return NextResponse.json({ error: "Missing sessionKey" }, { status: 400 });
    }

    const s = getSession(sessionKey);
    if (!s) {
      return NextResponse.json({ error: "Unknown sessionKey. Call POST /api/session first." }, { status: 404 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file field" }, { status: 400 });
    }

    // 1) Upload file to OpenAI
    const uploaded = await openai.files.create({
      file,
      purpose: "assistants",
    });

    // 2) Attach file to vector store (enables file_search retrieval)
    const vsFile = await openai.vectorStores.files.create(s.vectorStoreId, {
      file_id: uploaded.id,
    });

    return NextResponse.json({
      ok: true,
      sessionKey,
      filename: file.name,
      fileId: uploaded.id,
      vectorStoreId: s.vectorStoreId,
      vectorStoreFileId: vsFile.id,
      status: vsFile.status, // often "in_progress" then "completed"
    });
  } catch (err: any) {
    console.error("POST /api/session/upload failed:", err);
    return NextResponse.json(
      { error: "Upload failed", detail: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
