// src/app/api/assignments/[id]/chat/route.ts

import { NextRequest } from "next/server";
import { openai } from "@/lib/openai";
import { getAssignment } from "@/lib/assignmentStore";
import {
  buildOpenAiResponsesRequest,
  collisionIqModels,
  logCollisionIqModelDiagnostic,
} from "@/lib/modelConfig";

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

    const body = (await req.json().catch(() => ({}))) as { message?: unknown };
    const userText = String(body?.message ?? "").trim();

    if (!userText) {
      return new Response(
        JSON.stringify({ error: "Missing message" }),
        { status: 400 }
      );
    }

    // ✅ OpenAI call using chat completions (non-streaming)
    const client = openai;
    logCollisionIqModelDiagnostic({
      stage: "assignment_chat",
      provider: "openai",
      role: "helper",
      model: collisionIqModels.helper,
    });
    const completion = await client.responses.create(buildOpenAiResponsesRequest({
      model: collisionIqModels.helper,
      instructions:
        "You are a helpful assistant for Collision Academy, providing policyholder and auto repair support.",
      input: [
        {
          role: "user" as const,
          content: [
            {
              type: "input_text" as const,
              text: userText,
            },
          ],
        },
      ],
    }));

    const reply = completion.output_text ?? "";

    return new Response(
      JSON.stringify({
        ok: true,
        assignmentId: id,
        message: reply,
      }),
      { status: 200 }
    );
  } catch (err: unknown) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Server error",
      }),
      { status: 500 }
    );
  }
}
