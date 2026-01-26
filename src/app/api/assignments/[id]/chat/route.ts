import { NextRequest } from "next/server";
import { getOpenAI } from "@/lib/openai";
import { getAssignment } from "@/lib/assignmentStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { id } = await context.params;

    if (!process.env.OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing OPENAI_API_KEY" }),
        { status: 500 }
      );
    }

    const assignment = getAssignment(id);
    if (!assignment) {
      return new Response(
        JSON.stringify({ error: "Unknown assignmentId" }),
        { status: 404 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const userText = String(body?.message ?? "").trim();

    if (!userText) {
      return new Response(
        JSON.stringify({ error: "Missing message" }),
        { status: 400 }
      );
    }

    // 🧠 Optional: Add OpenAI assistant logic here
    const openai = getOpenAI();
    // const thread = await openai.beta.threads.create();
    // const completion = await openai.chat.completions.create({ ... });

    return new Response(
      JSON.stringify({
        ok: true,
        assignmentId: id,
        // threadId: thread.id, // ← include if you implement this
        text: userText,
      }),
      { status: 200 }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err?.message ?? "Server error" }),
      { status: 500 }
    );
  }
}
