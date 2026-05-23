import { NextResponse } from "next/server";
import {
  runCollisionIqPrompt,
  type RunCollisionIqPromptArgs,
} from "@/lib/ai/openaiPromptRunner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: Record<string, unknown>;

  try {
    const parsedBody: unknown = await request.json();
    if (!isPlainObject(parsedBody)) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    body = parsedBody;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const userRequest = coerceText(body.user_request);
  if (!userRequest) {
    return NextResponse.json({ error: "user_request is required." }, { status: 400 });
  }

  try {
    const outputText = await runCollisionIqPrompt({
      user_request: userRequest,
      case_context: coerceText(body.case_context),
      uploaded_documents: coerceText(body.uploaded_documents),
      applicability_instruction: coerceText(body.applicability_instruction),
      carrier_estimate_text: coerceText(body.carrier_estimate_text),
      shop_estimate_text: coerceText(body.shop_estimate_text),
      scrubber_findings: coerceText(body.scrubber_findings),
      audience: coerceAudience(body.audience),
      annotation_mode: coerceAnnotationMode(body.annotation_mode),
    });

    return NextResponse.json({ output_text: outputText });
  } catch (error) {
    console.error("[annotated-estimate-prompt] failed", {
      annotation_mode: body.annotation_mode,
      audience: body.audience,
      message: error instanceof Error ? error.message : "Unknown prompt failure",
    });

    return NextResponse.json({ output_text: "" });
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceText(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 24000) : "";
}

function coerceAudience(value: unknown): RunCollisionIqPromptArgs["audience"] {
  return value === "customer" || value === "estimator" || value === "admin"
    ? value
    : "estimator";
}

function coerceAnnotationMode(value: unknown): RunCollisionIqPromptArgs["annotation_mode"] {
  return value === "annotated_estimate_review" ||
    value === "estimator_change_request_list" ||
    value === "repair_intelligence_summary"
    ? value
    : "annotated_estimate_review";
}
