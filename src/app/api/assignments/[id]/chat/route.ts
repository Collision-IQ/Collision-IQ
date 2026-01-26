import { NextRequest } from "next/server";
import { getAssignment } from "@/lib/assignmentStore";
import { OpenAI } from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> } // 👈 Promise-wrapped params for Next.js 15+
): Promise<Response> {
  try {
    // Await the dynamic segment (e.g. /api/assignments/[id]/chat)
    const { id } = await context.params;

    // Load assignment
    const assignment = getAssignment(id);
    if (!assignment) {
      return new Response(
        JSON.stringify({ error: "Unknown assignment" }),
        { status: 404 }
      );
    }

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const userText = String(body?.message ?? "").trim();

    if (!userText) {
      return new Response(
        JSON.stringify({ error: "Missing message" }),
        { status: 400 }
      );
    }

    // Ensure API key is available
    if (!process.env.OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing OPENAI_API_KEY" }),
        { status: 500 }
      );
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // 🔧 Your assistant logic using OpenAI would go here...

    return new Response(
      JSON.stringify({ ok: true, assignmentId: id }),
      { status: 200 }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err?.message ?? "Server error" }),
      { status: 500 }
    );
  }
}
