import { NextRequest } from "next/server";
import { OpenAI } from "openai";
import { getAssignment } from "@/lib/assignmentStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  context: { params: { id: string } }
): Promise<Response> {
  const { id } = context.params;

  if (!process.env.OPENAI_API_KEY) {
    return new Response(
      JSON.stringify({ error: "Missing OPENAI_API_KEY" }),
      { status: 500 }
    );
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const assignment = getAssignment(id);
  if (!assignment) {
    return new Response(
      JSON.stringify({ error: "Unknown assignmentId" }),
      { status: 404 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const userText = String(body?.message ?? "").trim();

    if (!userText) {
      return new Response(
        JSON.stringify({ error: "Missing message" }),
        { status: 400 }
      );
    }

    // Optional: Add OpenAI logic here to respond to userText

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
