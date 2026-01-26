import OpenAI from "openai";
import { NextResponse } from "next/server";
import { getAssignment } from "@/lib/assignmentStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let openai: OpenAI | null = null;
function getOpenAI() {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = getAssignment(id);
  if (!a) return NextResponse.json({ error: "Unknown assignmentId" }, { status: 404 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file field" }, { status: 400 });
  }

  const openai = getOpenAI();

  // 1) Upload to OpenAI Files
  const uploaded = await openai.files.create({
    file,
    purpose: "assistants",
  });

  // 2) Attach file to vector store (for file_search)
  // API ref: POST /v1/vector_stores/{vector_store_id}/files with { file_id } :contentReference[oaicite:3]{index=3}
  const vsFile = await openai.vectorStores.files.create(a.vectorStoreId, {
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
