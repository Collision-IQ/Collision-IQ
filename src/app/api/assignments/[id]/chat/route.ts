import { NextRequest } from "next/server";
import { getAssignment } from "@/lib/assignmentStore";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<Response> {
  const assignmentId = params.id;

  if (!assignmentId) {
    return new Response(JSON.stringify({ error: "Missing assignmentId" }), {
      status: 400,
    });
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

  const assignment = getAssignment(assignmentId);

  if (!assignment) {
    return new Response(JSON.stringify({ error: "Unknown assignmentId" }), {
      status: 404,
    });
  }

  const body = await req.json().catch(() => ({}));
  const userText = String(body?.message ?? "").trim();

  if (!userText) {
    return new Response(JSON.stringify({ error: "Missing message" }), {
      status: 400,
    });
  }

  // Add your assistant logic here (e.g. OpenAI thread call)

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
  });
}
