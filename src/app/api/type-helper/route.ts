import { NextRequest, NextResponse } from "next/server";
import { generateClaudeMessage } from "@/lib/anthropic";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import {
  normalizeCorrectedText,
  protectedTokensPreserved,
  TYPE_HELPER_MAX_CHARS,
  TYPE_HELPER_SYSTEM_PROMPT,
} from "@/lib/ai/typeHelper";

// Type Helper ("Fix typos"): corrects the user's UNSENT composer draft only.
// Scope guardrails: no uploaded-file access, no report analysis, no web search,
// no MOTOR sandbox / citation sources, and the draft is never stored. The
// shared Claude helper never passes temperature (rejected by current models);
// determinism comes from thinking:false + low effort + a strict prompt.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    await requireCurrentUser();

    const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
    const text = typeof body?.text === "string" ? body.text : "";

    if (!text.trim()) {
      return NextResponse.json({ error: "Text is required." }, { status: 400 });
    }
    if (text.length > TYPE_HELPER_MAX_CHARS) {
      return NextResponse.json(
        { error: `Text must be under ${TYPE_HELPER_MAX_CHARS} characters.` },
        { status: 413 }
      );
    }

    const result = await generateClaudeMessage({
      system: TYPE_HELPER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }],
      thinking: false,
      effort: "low",
      maxTokens: 4000,
    });

    const correctedText = normalizeCorrectedText(result.text);

    // Guardrail: if the model altered any protected string (VIN, dollar amount,
    // labor hours, part/claim number, acronym, bare number), return the original
    // draft unchanged instead of a corrupted correction.
    if (!correctedText || !protectedTokensPreserved(text, correctedText)) {
      return NextResponse.json({ correctedText: text }, { headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({ correctedText }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[type-helper] failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Couldn't check that right now." }, { status: 502 });
  }
}
