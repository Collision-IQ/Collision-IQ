import { NextResponse } from "next/server";
import { setAssignment } from "@/lib/assignmentStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Assignments previously provisioned an OpenAI Assistants thread + vector store.
// Assignment chat now runs statelessly through Claude (see
// src/app/api/assignments/[id]/chat/route.ts), so we only need a stable id.
export async function POST() {
  const assignmentId = crypto.randomUUID();
  const threadId = `claude-${assignmentId}`;
  setAssignment(assignmentId, { threadId, vectorStoreId: "" });

  return NextResponse.json({ assignmentId, threadId, vectorStoreId: "" });
}
