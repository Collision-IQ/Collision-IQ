import { fal } from "@fal-ai/client";

const FAL_OPENROUTER_VISION_MODEL_FALLBACK = "google/gemini-2.5-flash";
const FAL_OPENROUTER_VISION_QUEUE = "openrouter/router/vision";
const MAX_IMAGES = 10;

export type FalOpenrouterVisionSubmitInput = {
  imageUrls: string[];
  prompt: string;
  systemPrompt?: string;
  model?: string;
  reasoning?: boolean;
  temperature?: number;
  maxTokens?: number;
};

export type FalOpenrouterVisionUsage = {
  cost?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens?: number;
};

export type FalOpenrouterVisionResult = {
  output: string;
  usage?: FalOpenrouterVisionUsage;
};

export class FalConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FalConfigurationError";
  }
}

export class FalValidationError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "FalValidationError";
    this.code = code;
  }
}

export class FalUpstreamError extends Error {
  statusCode?: number;
  details?: unknown;
  constructor(message: string, options?: { statusCode?: number; details?: unknown }) {
    super(message);
    this.name = "FalUpstreamError";
    this.statusCode = options?.statusCode;
    this.details = options?.details;
  }
}

let configuredKey: string | null = null;

function normalizeModel(value: string | undefined): string {
  return (
    value?.trim() ||
    process.env.FAL_OPENROUTER_VISION_MODEL?.trim() ||
    FAL_OPENROUTER_VISION_MODEL_FALLBACK
  );
}

function getFalApiKey(): string {
  const key = process.env.FAL_KEY?.trim();
  if (!key) {
    throw new FalConfigurationError("FAL_KEY is not configured.");
  }
  return key;
}

function configureFalClient(): void {
  const key = getFalApiKey();
  if (key !== configuredKey) {
    fal.config({ credentials: key });
    configuredKey = key;
  }
}

function validateInput(input: FalOpenrouterVisionSubmitInput): void {
  if (!input.prompt?.trim()) {
    throw new FalValidationError("prompt must be a non-empty string", "PROMPT_REQUIRED");
  }

  const urls = (input.imageUrls ?? []).filter(
    (u): u is string => typeof u === "string" && u.trim().length > 0
  );

  if (urls.length === 0) {
    throw new FalValidationError(
      "imageUrls must contain at least one non-empty string",
      "IMAGE_URLS_REQUIRED"
    );
  }

  if (urls.length > MAX_IMAGES) {
    throw new FalValidationError(
      `imageUrls may contain at most ${MAX_IMAGES} items`,
      "TOO_MANY_IMAGES"
    );
  }
}

function toFalInput(input: FalOpenrouterVisionSubmitInput) {
  return {
    image_urls: input.imageUrls.filter((u) => u.trim()),
    prompt: input.prompt.trim(),
    system_prompt: input.systemPrompt,
    model: normalizeModel(input.model),
    reasoning: input.reasoning,
    temperature: input.temperature,
    max_tokens: input.maxTokens,
  };
}

function wrapUpstreamError(error: unknown, context: string): never {
  const rec = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
  const statusCode =
    typeof rec?.status === "number" ? rec.status : undefined;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : `fal upstream error (${context})`;
  throw new FalUpstreamError(message, { statusCode, details: error });
}

export async function submitFalOpenrouterVision(
  input: FalOpenrouterVisionSubmitInput,
  webhookUrl?: string
): Promise<{ requestId: string }> {
  validateInput(input);
  configureFalClient();

  try {
    const response = await fal.queue.submit(FAL_OPENROUTER_VISION_QUEUE, {
      input: toFalInput(input) as never,
      webhookUrl,
    });
    return { requestId: response.request_id };
  } catch (error) {
    if (error instanceof FalConfigurationError || error instanceof FalValidationError) throw error;
    wrapUpstreamError(error, "submit");
  }
}

export async function getFalOpenrouterVisionStatus(
  requestId: string,
  logs = true
): Promise<unknown> {
  configureFalClient();
  try {
    return await fal.queue.status(FAL_OPENROUTER_VISION_QUEUE, { requestId, logs });
  } catch (error) {
    if (error instanceof FalConfigurationError) throw error;
    wrapUpstreamError(error, "status");
  }
}

export async function getFalOpenrouterVisionResult(
  requestId: string
): Promise<{ requestId: string; data: FalOpenrouterVisionResult }> {
  configureFalClient();
  try {
    const response = await fal.queue.result(FAL_OPENROUTER_VISION_QUEUE, {
      requestId,
    });

    const data = response.data as Record<string, unknown>;
    if (typeof data?.output !== "string") {
      throw new FalUpstreamError("Unexpected result shape: output is not a string", {
        details: response.data,
      });
    }

    return {
      requestId: response.requestId,
      data: response.data as FalOpenrouterVisionResult,
    };
  } catch (error) {
    if (error instanceof FalConfigurationError || error instanceof FalUpstreamError) throw error;
    wrapUpstreamError(error, "result");
  }
}
