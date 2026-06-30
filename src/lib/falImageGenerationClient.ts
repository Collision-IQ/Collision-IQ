// Browser client for the FAL image generation queue routes.
// Relative URLs only — never a localhost/API_BASE_URL in browser code.

export type FalImageSize =
  | "square_hd"
  | "square"
  | "portrait_4_3"
  | "portrait_16_9"
  | "landscape_4_3"
  | "landscape_16_9"
  | { width: number; height: number };

export type FalImageGenerationSubmitInput = {
  prompt: string;
  imageSize?: FalImageSize;
  numImages?: number;
  seed?: number;
  acceleration?: "none" | "regular";
  enablePromptExpansion?: boolean;
  enableSafetyChecker?: boolean;
  outputFormat?: "png" | "jpeg";
  syncMode?: boolean;
};

export type FalGeneratedImage = {
  url?: string;
  width?: number;
  height?: number;
  content_type?: string;
};

export type FalImageGenerationResultData = {
  images?: FalGeneratedImage[];
  seed?: number;
};

export type FalImageGenerationSubmitResponse = {
  requestId: string;
};

export type FalImageGenerationResultResponse = {
  requestId: string;
  data: FalImageGenerationResultData;
};

export class FalImageGenerationClientError extends Error {
  code: string;
  status?: number;
  details?: unknown;

  constructor(message: string, options?: { code?: string; status?: number; details?: unknown }) {
    super(message);
    this.name = "FalImageGenerationClientError";
    this.code = options?.code ?? message;
    this.status = options?.status;
    this.details = options?.details;
  }
}

function buildUrl(params: { requestId: string; action: "status" | "result"; logs?: boolean }) {
  const search = new URLSearchParams({ requestId: params.requestId, action: params.action });
  if (params.action === "status" && typeof params.logs === "boolean") {
    search.set("logs", String(params.logs));
  }
  return `/api/fal/image/generate?${search.toString()}`;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorCode(payload: unknown, status: number): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof (payload as { error?: unknown }).error === "string"
  ) {
    return (payload as { error: string }).error;
  }
  return `FAL_IMAGE_HTTP_${status}`;
}

export async function submitFalImageGeneration(
  input: FalImageGenerationSubmitInput,
  signal?: AbortSignal
): Promise<FalImageGenerationSubmitResponse> {
  const prompt = input.prompt?.trim();
  if (!prompt) {
    throw new FalImageGenerationClientError("PROMPT_REQUIRED", { code: "PROMPT_REQUIRED" });
  }

  const response = await fetch("/api/fal/image/generate", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, prompt }),
    signal,
  });

  const payload = (await parseJson(response)) as
    | FalImageGenerationSubmitResponse
    | { error?: string }
    | null;

  if (!response.ok) {
    const code = errorCode(payload, response.status);
    throw new FalImageGenerationClientError(code, { code, status: response.status, details: payload });
  }

  if (!payload || !("requestId" in payload) || typeof payload.requestId !== "string") {
    throw new FalImageGenerationClientError("FAL_IMAGE_INVALID_SUBMIT_RESPONSE", {
      code: "FAL_IMAGE_INVALID_SUBMIT_RESPONSE",
      status: response.status,
      details: payload,
    });
  }

  return payload;
}

export async function getFalImageGenerationStatus(
  requestId: string,
  options?: { logs?: boolean; signal?: AbortSignal }
): Promise<unknown> {
  const normalizedRequestId = requestId.trim();
  if (!normalizedRequestId) {
    throw new FalImageGenerationClientError("REQUEST_ID_REQUIRED", { code: "REQUEST_ID_REQUIRED" });
  }

  const response = await fetch(
    buildUrl({ requestId: normalizedRequestId, action: "status", logs: options?.logs }),
    { method: "GET", credentials: "same-origin", signal: options?.signal }
  );

  const payload = await parseJson(response);

  if (!response.ok) {
    const code = errorCode(payload, response.status);
    throw new FalImageGenerationClientError(code, { code, status: response.status, details: payload });
  }

  return payload;
}

export async function getFalImageGenerationResult(
  requestId: string,
  signal?: AbortSignal
): Promise<FalImageGenerationResultResponse> {
  const normalizedRequestId = requestId.trim();
  if (!normalizedRequestId) {
    throw new FalImageGenerationClientError("REQUEST_ID_REQUIRED", { code: "REQUEST_ID_REQUIRED" });
  }

  const response = await fetch(buildUrl({ requestId: normalizedRequestId, action: "result" }), {
    method: "GET",
    credentials: "same-origin",
    signal,
  });

  const payload = (await parseJson(response)) as
    | FalImageGenerationResultResponse
    | { error?: string }
    | null;

  if (!response.ok) {
    const code = errorCode(payload, response.status);
    throw new FalImageGenerationClientError(code, { code, status: response.status, details: payload });
  }

  if (
    !payload ||
    !("requestId" in payload) ||
    typeof payload.requestId !== "string" ||
    !("data" in payload) ||
    !payload.data ||
    typeof payload.data !== "object"
  ) {
    throw new FalImageGenerationClientError("FAL_IMAGE_INVALID_RESULT_RESPONSE", {
      code: "FAL_IMAGE_INVALID_RESULT_RESPONSE",
      status: response.status,
      details: payload,
    });
  }

  return payload;
}

/** Pull the first usable image URL out of a result payload. */
export function firstImageUrl(result: FalImageGenerationResultResponse): string | null {
  const images = result.data?.images ?? [];
  for (const image of images) {
    if (typeof image?.url === "string" && image.url.trim()) {
      return image.url.trim();
    }
  }
  return null;
}
