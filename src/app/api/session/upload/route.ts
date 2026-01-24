import OpenAI from "openai";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/sessionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  const form = await req.formData();
  const sessionKey = String(form.get("sessionKey") || "");
  const file = form.get("file");

  if (!sessionKey) return NextResponse.json({ error: "Missing sessionKey" }, { status: 400 });
  const s = getSession(sessionKey);
  if (!s) return NextResponse.json({ error: "Unknown sessionKey" }, { status: 404 });

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file field" }, { status: 400 });
  }

  // Upload to OpenAI Files
  const uploaded = await openai.files.create({ file, purpose: "assistants" });

  // Attach to vector store (File Search)
  const vsFile = await openai.vectorStores.files.create(s.vectorStoreId, {
    file_id: uploaded.id,
  });

  return NextResponse.json({
    ok: true,
    fileId: uploaded.id,
    vectorStoreFileId: vsFile.id,
    status: vsFile.status,
    filename: file.name,
  });
}
