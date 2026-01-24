import OpenAI from "openai";
import { getSession } from "@/lib/sessionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_FILE_MB = 20;

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return Response.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const form = await req.formData();
    const sessionKey = String(form.get("sessionKey") ?? "").trim();
    const file = form.get("file");

    if (!sessionKey) return Response.json({ error: "Missing sessionKey" }, { status: 400 });
    if (!(file instanceof File)) return Response.json({ error: "Missing file" }, { status: 400 });

    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      return Response.json({ error: `File too large (max ${MAX_FILE_MB}MB)` }, { status: 413 });
    }

    const s = getSession(sessionKey);
    if (!s) {
      return Response.json({ error: "Unknown sessionKey. Call POST /api/session first." }, { status: 404 });
    }

    // Upload file to OpenAI Files (Assistants/File Search)
    const uploaded = await openai.files.create({
      file,
      purpose: "assistants",
    });

    // Attach file to vector store for retrieval
    await openai.vectorStores.files.create(s.vectorStoreId, {
      file_id: uploaded.id,
    } as any);

    return Response.json({
      status: "attached",
      sessionKey,
      filename: file.name,
      fileId: uploaded.id,
      vectorStoreId: s.vectorStoreId,
    });
  } catch (err: any) {
    console.error("POST /api/session/upload failed:", err);
    return Response.json({ error: "Upload failed", detail: err?.message ?? String(err) }, { status: 500 });
  }
}
