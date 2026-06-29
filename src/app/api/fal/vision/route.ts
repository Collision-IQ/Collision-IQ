import { NextResponse } from "next/server";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";
import {
  FalConfigurationError,
  getFalOpenrouterVisionResult,
  getFalOpenrouterVisionStatus,
  submitFalOpenrouterVision,
} from "@/lib/ai/falOpenrouterVision";

export const runtime = "nodejs";

type SubmitBody = {
  imageUrls?: unknown;
  prompt?: unknown;
  systemPrompt?: unknown;
  model?: unknown;
  reasoning?: unknown;
  temperature?: unknown;
  maxTokens?: unknown;
  webhookUrl?: unknown;
};

function jsonError(
  error: string,
  status: number,
  extra?: Record<string, unknown>
) {
  return NextResponse.json({ error, ...extra }, { status });
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return normalizeNonEmptyString(value) ?? undefined;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return undefined;
}

function normalizeImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeNonEmptyString(item))
    .filter((item): item is string => Boolean(item));
}

async function parseBody(req: Request): Promise<SubmitBody | null> {
  try {
    return (await req.json()) as SubmitBody;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const { user, isPlatformAdmin } = await requireCurrentUser();

    const body = await parseBody(req);
    if (!body) {
      return jsonError("INVALID_JSON", 400);
    }

    const prompt = normalizeNonEmptyString(body.prompt);
    if (!prompt) {
      return jsonError("PROMPT_REQUIRED", 400);
    }

    const imageUrls = normalizeImageUrls(body.imageUrls);
    if (imageUrls.length === 0) {
      return jsonError("IMAGE_URLS_REQUIRED", 400);
    }

    const submit = await submitFalOpenrouterVision(
      {
        imageUrls,
        prompt,
        systemPrompt: normalizeOptionalString(body.systemPrompt),
        model: normalizeOptionalString(body.model),
        reasoning: normalizeOptionalBoolean(body.reasoning),
        temperature: normalizeOptionalNumber(body.temperature),
        maxTokens: normalizeOptionalNumber(body.maxTokens),
      },
      normalizeOptionalString(body.webhookUrl)
    );

    console.info("[fal-vision] submitted", {
      ownerUserId: user.id,
      isPlatformAdmin,
      imageCount: imageUrls.length,
      requestId: submit.requestId,
    });

    return NextResponse.json(submit, { status: 202 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof FalConfigurationError) {
      return jsonError("FAL_NOT_CONFIGURED", 503);
    }

    console.error("[fal-vision] submit failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonError("FAL_VISION_UPSTREAM_ERROR", 502);
  }
}

export async function GET(req: Request) {
  try {
    await requireCurrentUser();

    const url = new URL(req.url);
    const requestId = normalizeNonEmptyString(url.searchParams.get("requestId"));
    if (!requestId) {
      return jsonError("REQUEST_ID_REQUIRED", 400);
    }

    const action = normalizeNonEmptyString(url.searchParams.get("action")) || "status";

    if (action === "status") {
      const includeLogs =
        normalizeOptionalBoolean(url.searchParams.get("logs")) ?? true;
      const status = await getFalOpenrouterVisionStatus(requestId, includeLogs);
      return NextResponse.json(status, { status: 200 });
    }

    if (action === "result") {
      const result = await getFalOpenrouterVisionResult(requestId);
      return NextResponse.json(result, { status: 200 });
    }

    return jsonError("INVALID_ACTION", 400, { allowed: ["status", "result"] });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof FalConfigurationError) {
      return jsonError("FAL_NOT_CONFIGURED", 503);
    }

    console.error("[fal-vision] get failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonError("FAL_VISION_UPSTREAM_ERROR", 502);
  }
}
