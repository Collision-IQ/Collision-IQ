import { NextRequest, NextResponse } from "next/server";
import { getOpenAI } from "@/lib/openai";
import { getAssignment } from "@/lib/assignmentStore";

// Optional: prevent static optimization for server-only logic
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json({ error: "Missing assignment ID" }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const assignment = getAssignment(id);
    if (!assignment) {
      return NextResponse.json({ error: "Unknown assignment ID" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const userText = String(body?.message ?? "").trim();

    if (!userText) {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    const openai = getOpenAI();

    // TODO: Add assistant logic here using `openai`
    // e.g., call openai.chat.completions.create(...) with userText

    return NextResponse.json({
      ok: true,
      assignmentId: id,
      // Optionally include a threadId or response text here
      text: userText,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
