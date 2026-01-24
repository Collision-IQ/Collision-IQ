import OpenAI from "openai";
import { NextResponse } from "next/server";
import { setAssignment } from "@/lib/assignmentStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST() {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
  }

  const thread = await openai.beta.threads.create();
  const vectorStore = await openai.vectorStores.create({
    name: `assignment-${thread.id}`,
  });

  const assignmentId = crypto.randomUUID();
  setAssignment(assignmentId, { threadId: thread.id, vectorStoreId: vectorStore.id });

  return NextResponse.json({ assignmentId, threadId: thread.id, vectorStoreId: vectorStore.id });
}
