import { NextRequest } from "next/server";
import { getAssignment } from "@/lib/assignmentStore";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  // ✅ Next.js 16: params MUST be awaited
  const { id } = await context.params;

  if (!id) {
    return new Response(
      JSON.stringify({ error: "Missing assignmentId" }),
      { status: 400 }
    );
  }

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

    // ✅ Assistant / OpenAI logic can go here

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
