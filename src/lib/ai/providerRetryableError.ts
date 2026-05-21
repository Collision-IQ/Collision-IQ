type RetryableProviderErrorOptions = {
  provider?: string;
  stage?: string;
};

export type RetryableProviderErrorDetails = {
  retryable: boolean;
  provider: string;
  stage: string;
  status: number | null;
  statusCode: number | null;
  code: string | null;
  message: string;
};

const RETRYABLE_PROVIDER_MESSAGE_PATTERN =
  /(rate\s*limit|too\s*many\s*requests|quota|overloaded|temporar(?:y|ily)\s*unavailable|capacity)/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isRetryableProviderMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  return RETRYABLE_PROVIDER_MESSAGE_PATTERN.test(message);
}

export function classifyRetryableProviderError(
  error: unknown,
  options: RetryableProviderErrorOptions = {}
): RetryableProviderErrorDetails {
  const fallbackProvider = options.provider ?? "upstream_provider";
  const fallbackStage = options.stage ?? "analysis";

  const top = asRecord(error);
  const nestedError = asRecord(top?.error);

  const status = asNumber(top?.status) ?? asNumber(top?.statusCode);
  const nestedStatus = asNumber(nestedError?.status) ?? asNumber(nestedError?.statusCode);
  const resolvedStatus = status ?? nestedStatus;
  const statusCode = asNumber(top?.statusCode) ?? asNumber(nestedError?.statusCode) ?? resolvedStatus;

  const code =
    asString(top?.code) ??
    asString(nestedError?.code) ??
    asString(top?.type) ??
    asString(nestedError?.type) ??
    null;

  const message =
    asString(top?.message) ??
    asString(nestedError?.message) ??
    (error instanceof Error ? error.message : null) ??
    "Unknown provider error";

  const provider =
    asString(top?.provider) ??
    asString(nestedError?.provider) ??
    fallbackProvider;

  const stage =
    asString(top?.stage) ??
    asString(nestedError?.stage) ??
    fallbackStage;

  const normalizedCode = (code ?? "").toLowerCase();
  const retryable =
    resolvedStatus === 429 ||
    statusCode === 429 ||
    normalizedCode.includes("rate") ||
    normalizedCode.includes("quota") ||
    normalizedCode.includes("overload") ||
    isRetryableProviderMessage(message);

  return {
    retryable,
    provider,
    stage,
    status: resolvedStatus,
    statusCode,
    code,
    message,
  };
}