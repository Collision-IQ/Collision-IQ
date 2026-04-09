import { NextRequest } from "next/server";
import { getAssignment } from "@/lib/assignmentStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const url = new URL(req.url);
    const parts = url.pathname.split("/");
    const assignmentId = parts[parts.indexOf("assignments") + 1];

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

    const assignment = getAssignment(assignmentId);
    if (!assignment) {
      return new Response(JSON.stringify({ error: "Unknown assignmentId" }), {
        status: 404,
      });
    }

    const body = (await req.json().catch(() => ({}))) as { message?: unknown };
    const userText = String(body?.message ?? "").trim();

    if (!userText) {
      return new Response(JSON.stringify({ error: "Missing message" }), {
        status: 400,
      });
    }

    // Upload or assistant logic can go here...

    return new Response(JSON.stringify({ success: true }), { status: 200 });

  } catch (err: unknown) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Server error",
      }),
      { status: 500 }
    );
  }
}
