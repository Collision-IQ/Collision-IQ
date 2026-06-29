export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import {
  submitFalImageGeneration,
  getFalImageGenerationStatus,
  getFalImageGenerationResult,
  FalImageConfigurationError,
  FalImageValidationError,
  FalImageUpstreamError,
} from "@/lib/ai/falImageGeneration";

export async function POST(req: Request) {
  try {
    await requireCurrentUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { ok: false, error: "AUTH_REQUIRED", message: "Authentication required." },
        { status: 401 }
      );
    }
    throw error;
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "INVALID_JSON", message: "Request body is not valid JSON." }, { status: 400 });
  }

  try {
    const result = await submitFalImageGeneration(body as never);
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    if (error instanceof FalImageValidationError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: 400 });
    }
    if (error instanceof FalImageConfigurationError) {
      return NextResponse.json({ error: "FAL_NOT_CONFIGURED", message: error.message }, { status: 503 });
    }
    console.error("[fal/image/generate] upstream error", error);
    const upstreamError = error instanceof FalImageUpstreamError ? error : null;
    return NextResponse.json(
      {
        error: "FAL_IMAGE_UPSTREAM_ERROR",
        message: upstreamError?.message ?? "Image generation request failed.",
      },
      { status: 502 }
    );
  }
}

export async function GET(req: Request) {
  try {
    await requireCurrentUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { ok: false, error: "AUTH_REQUIRED", message: "Authentication required." },
        { status: 401 }
      );
    }
    throw error;
  }

  const { searchParams } = new URL(req.url);
  const requestId = searchParams.get("requestId")?.trim() ?? "";
  if (!requestId) {
    return NextResponse.json({ error: "REQUEST_ID_REQUIRED", message: "requestId is required." }, { status: 400 });
  }

  const action = searchParams.get("action") ?? "status";
  if (action !== "status" && action !== "result") {
    return NextResponse.json({ error: "INVALID_ACTION", message: "action must be 'status' or 'result'." }, { status: 400 });
  }

  try {
    if (action === "result") {
      const result = await getFalImageGenerationResult(requestId);
      return NextResponse.json(result, { status: 200 });
    }
    const status = await getFalImageGenerationStatus(requestId);
    return NextResponse.json(status, { status: 200 });
  } catch (error) {
    if (error instanceof FalImageConfigurationError) {
      return NextResponse.json({ error: "FAL_NOT_CONFIGURED", message: error.message }, { status: 503 });
    }
    console.error("[fal/image/generate] upstream error on GET", error);
    const upstreamError = error instanceof FalImageUpstreamError ? error : null;
    return NextResponse.json(
      {
        error: "FAL_IMAGE_UPSTREAM_ERROR",
        message: upstreamError?.message ?? "Image generation status/result request failed.",
      },
      { status: 502 }
    );
  }
}
