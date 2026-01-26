import { NextRequest } from "next/server";
import { getAssignment } from "@/lib/assignmentStore";
import { OpenAI } from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Now safely use it...
  try {
    const url = new URL(req.url);
    const parts = url.pathname.split("/");
    const assignmentId = parts[parts.indexOf("assignments") + 1];

    if (!assignmentId) {
      return new Response(JSON.stringify({ error: "Missing assignmentId" }), {
        status: 400,
      });
    }

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

    // Optional: Stream logic or assistant calls here...

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err?.message ?? "Server error" }),
      {
        status: 500,
      }
    );
  }
}
