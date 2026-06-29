export type FalVisionSubmitInput = {
  imageUrls: string[];
  prompt: string;
  systemPrompt?: string;
  model?: string;
  reasoning?: boolean;
  temperature?: number;
  maxTokens?: number;
  webhookUrl?: string;
};

export type FalVisionUsage = {
  cost?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens?: number;
};

export type FalVisionResultData = {
  output: string;
  usage?: FalVisionUsage;
};

export type FalVisionSubmitResponse = {
  requestId: string;
};

export type FalVisionResultResponse = {
  requestId: string;
  data: FalVisionResultData;
};

export class FalVisionClientError extends Error {
  code: string;
  status?: number;
  details?: unknown;

  constructor(message: string, options?: { code?: string; status?: number; details?: unknown }) {
    super(message);
    this.name = "FalVisionClientError";
    this.code = options?.code ?? message;
    this.status = options?.status;
    this.details = options?.details;
  }
}

function buildUrl(params: { requestId: string; action: "status" | "result"; logs?: boolean }) {
  const search = new URLSearchParams({
    requestId: params.requestId,
    action: params.action,
  });

  if (params.action === "status" && typeof params.logs === "boolean") {
    search.set("logs", String(params.logs));
  }

  return `/api/fal/vision?${search.toString()}`;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function normalizeSubmitInput(input: FalVisionSubmitInput): FalVisionSubmitInput {
  const imageUrls = input.imageUrls
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);

  const prompt = input.prompt.trim();

  if (!prompt) {
    throw new FalVisionClientError("PROMPT_REQUIRED", { code: "PROMPT_REQUIRED" });
  }

  if (imageUrls.length === 0) {
    throw new FalVisionClientError("IMAGE_URLS_REQUIRED", { code: "IMAGE_URLS_REQUIRED" });
  }

  return {
    ...input,
    prompt,
    imageUrls,
    systemPrompt: input.systemPrompt?.trim() || undefined,
    model: input.model?.trim() || undefined,
    webhookUrl: input.webhookUrl?.trim() || undefined,
  };
}

export async function submitFalVision(
  input: FalVisionSubmitInput,
  signal?: AbortSignal
): Promise<FalVisionSubmitResponse> {
  const body = normalizeSubmitInput(input);

  const response = await fetch("/api/fal/vision", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  const payload = (await parseJson(response)) as
    | FalVisionSubmitResponse
    | { error?: string }
    | null;

  if (!response.ok) {
    const code = payload && "error" in payload && payload.error ? payload.error : `FAL_VISION_HTTP_${response.status}`;
    throw new FalVisionClientError(code, {
      code,
      status: response.status,
      details: payload,
    });
  }

  if (!payload || !("requestId" in payload) || typeof payload.requestId !== "string") {
    throw new FalVisionClientError("FAL_VISION_INVALID_SUBMIT_RESPONSE", {
      code: "FAL_VISION_INVALID_SUBMIT_RESPONSE",
      status: response.status,
      details: payload,
    });
  }

  return payload;
}

export async function getFalVisionStatus(
  requestId: string,
  options?: { logs?: boolean; signal?: AbortSignal }
): Promise<unknown> {
  const normalizedRequestId = requestId.trim();
  if (!normalizedRequestId) {
    throw new FalVisionClientError("REQUEST_ID_REQUIRED", { code: "REQUEST_ID_REQUIRED" });
  }

  const response = await fetch(
    buildUrl({ requestId: normalizedRequestId, action: "status", logs: options?.logs }),
    {
      method: "GET",
      credentials: "same-origin",
      signal: options?.signal,
    }
  );

  const payload = await parseJson(response);

  if (!response.ok) {
    const code =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `FAL_VISION_HTTP_${response.status}`;
    throw new FalVisionClientError(code, {
      code,
      status: response.status,
      details: payload,
    });
  }

  return payload;
}

export async function getFalVisionResult(
  requestId: string,
  signal?: AbortSignal
): Promise<FalVisionResultResponse> {
  const normalizedRequestId = requestId.trim();
  if (!normalizedRequestId) {
    throw new FalVisionClientError("REQUEST_ID_REQUIRED", { code: "REQUEST_ID_REQUIRED" });
  }

  const response = await fetch(buildUrl({ requestId: normalizedRequestId, action: "result" }), {
    method: "GET",
    credentials: "same-origin",
    signal,
  });

  const payload = (await parseJson(response)) as
    | FalVisionResultResponse
    | { error?: string }
    | null;

  if (!response.ok) {
    const code = payload && "error" in payload && payload.error ? payload.error : `FAL_VISION_HTTP_${response.status}`;
    throw new FalVisionClientError(code, {
      code,
      status: response.status,
      details: payload,
    });
  }

  if (
    !payload ||
    !("requestId" in payload) ||
    typeof payload.requestId !== "string" ||
    !("data" in payload) ||
    !payload.data ||
    typeof payload.data !== "object"
  ) {
    throw new FalVisionClientError("FAL_VISION_INVALID_RESULT_RESPONSE", {
      code: "FAL_VISION_INVALID_RESULT_RESPONSE",
      status: response.status,
      details: payload,
    });
  }

  return payload;
}
