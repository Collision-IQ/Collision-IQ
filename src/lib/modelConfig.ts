const PRIMARY_MODEL_FALLBACK = "gpt-5.5";
const HELPER_MODEL_FALLBACK = "gpt-5.5";
const TTS_MODEL_FALLBACK = "gpt-4o-mini-tts";
const ANTHROPIC_MODEL_FALLBACK = "claude-fable-5";
const ANTHROPIC_BASE_URL_FALLBACK = "https://api.anthropic.com";
const OPENCLAW_GATEWAY_URL_FALLBACK = "http://127.0.0.1:18789";
const OPENCLAW_MODEL_FALLBACK = "openclaw/default";
const OPENCLAW_TIMEOUT_MS_FALLBACK = 180000;
const STALE_OPENAI_MODEL_PATTERN = new RegExp(`\\bgpt-${"5\\.4"}(?:-(?:mini|nano))?\\b`, "i");
const LOCAL_OPENCLAW_HOST_PATTERN = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i;

export type CollisionIqPrimaryProvider = "openai" | "anthropic" | "openclaw";
export type CollisionIqModelRole = "primary" | "helper" | "supplement" | "tts" | "anthropicPrimary" | "openclawPrimary";

export type CollisionIqModelDiagnostic = {
  stage: string;
  provider: CollisionIqPrimaryProvider;
  model: string;
  reasoningEffort: string | null;
  fallbackUsed: boolean;
  keyPresent: boolean;
  envKey: string | null;
};

type OpenAiResponsesRequest = Record<string, unknown> & {
  model?: string;
  temperature?: unknown;
  top_p?: unknown;
};

function normalizeModelName(value: string | undefined | null, fallback: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function normalizePrimaryProvider(value: string | undefined | null): CollisionIqPrimaryProvider {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "anthropic") return "anthropic";
  if (normalized === "openclaw") return "openclaw";
  return "openai";
}

function isAnthropicModelName(value: string) {
  return /^claude(?:[-_]|$)/i.test(value);
}

function resolveOpenAiPrimaryModel() {
  const configured = normalizeModelName(
    process.env.COLLISION_IQ_MODEL_PRIMARY,
    normalizeModelName(process.env.COLLISION_IQ_MODEL, PRIMARY_MODEL_FALLBACK)
  );
  if (isAnthropicModelName(configured)) {
    console.warn("[model-config] Ignoring Anthropic primary model on OpenAI provider", {
      configuredModel: configured,
      fallbackModel: PRIMARY_MODEL_FALLBACK,
    });
    return PRIMARY_MODEL_FALLBACK;
  }
  return configured;
}

function resolveOpenAiHelperModel() {
  return normalizeModelName(process.env.COLLISION_IQ_MODEL_HELPER, HELPER_MODEL_FALLBACK);
}

function resolveOpenAiSupplementModel() {
  return normalizeModelName(process.env.COLLISION_IQ_SUPPLEMENT_MODEL, resolveOpenAiHelperModel());
}

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function hasExplicitReachableOpenClawService() {
  const url = process.env.OPENCLAW_GATEWAY_URL?.trim();
  return Boolean(url && !LOCAL_OPENCLAW_HOST_PATTERN.test(url));
}

function resolvePrimaryProvider() {
  const requested = normalizePrimaryProvider(process.env.COLLISION_IQ_PRIMARY_PROVIDER);
  if (requested !== "openclaw") return requested;
  if (!isProductionRuntime()) return requested;
  if (hasExplicitReachableOpenClawService()) return requested;
  console.warn("[model-config] Production OpenClaw provider ignored because no reachable non-local OpenClaw service is configured.", {
    requestedProvider: requested,
    resolvedProvider: "openai",
    openclawGatewayConfigured: Boolean(process.env.OPENCLAW_GATEWAY_URL?.trim()),
  });
  return "openai";
}

function isStaleOpenAiModel(model: string) {
  return STALE_OPENAI_MODEL_PATTERN.test(model);
}

export function supportsOpenAiResponsesSamplingParameters(model: string) {
  return !/^gpt-5\.5(?:-|$)/i.test(model.trim());
}

export function buildOpenAiResponsesRequest<TRequest extends OpenAiResponsesRequest>(
  request: TRequest
): TRequest {
  const model = typeof request.model === "string" ? request.model : "";
  if (supportsOpenAiResponsesSamplingParameters(model)) return request;

  const {
    temperature: _temperature,
    top_p: _topP,
    ...safeRequest
  } = request;
  return safeRequest as TRequest;
}

function warnIfStaleOpenAiModel(role: string, model: string) {
  if (!isStaleOpenAiModel(model)) return;
  console.warn("[model-config] Stale OpenAI model configured for production stage.", {
    role,
    model,
    expectedDefault: PRIMARY_MODEL_FALLBACK,
  });
}

function resolveConfiguredModelKey(role: CollisionIqModelRole): string | null {
  switch (role) {
    case "primary":
      if (process.env.COLLISION_IQ_MODEL_PRIMARY?.trim()) return "COLLISION_IQ_MODEL_PRIMARY";
      if (process.env.COLLISION_IQ_MODEL?.trim()) return "COLLISION_IQ_MODEL";
      return null;
    case "helper":
      return process.env.COLLISION_IQ_MODEL_HELPER?.trim() ? "COLLISION_IQ_MODEL_HELPER" : null;
    case "supplement":
      if (process.env.COLLISION_IQ_SUPPLEMENT_MODEL?.trim()) return "COLLISION_IQ_SUPPLEMENT_MODEL";
      return process.env.COLLISION_IQ_MODEL_HELPER?.trim() ? "COLLISION_IQ_MODEL_HELPER" : null;
    case "tts":
      return process.env.COLLISION_IQ_MODEL_TTS?.trim() ? "COLLISION_IQ_MODEL_TTS" : null;
    case "anthropicPrimary":
      return process.env.ANTHROPIC_MODEL_PRIMARY?.trim() ? "ANTHROPIC_MODEL_PRIMARY" : null;
    case "openclawPrimary":
      return process.env.OPENCLAW_MODEL?.trim() ? "OPENCLAW_MODEL" : null;
  }
}

function resolveKeyPresence(provider: CollisionIqPrimaryProvider) {
  if (provider === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  if (provider === "openclaw") return hasExplicitReachableOpenClawService();
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function normalizePositiveInteger(value: string | undefined | null, fallback: number) {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const collisionIqProvider = {
  primary: resolvePrimaryProvider(),
  anthropicBaseUrl: normalizeModelName(
    process.env.ANTHROPIC_BASE_URL,
    ANTHROPIC_BASE_URL_FALLBACK
  ),
  openclawGatewayUrl: normalizeModelName(
    process.env.OPENCLAW_GATEWAY_URL,
    OPENCLAW_GATEWAY_URL_FALLBACK
  ),
  openclawTimeoutMs: normalizePositiveInteger(
    process.env.OPENCLAW_TIMEOUT_MS,
    OPENCLAW_TIMEOUT_MS_FALLBACK
  ),
} as const;

export const collisionIqModels = {
  primary: resolveOpenAiPrimaryModel(),
  helper: resolveOpenAiHelperModel(),
  supplement: resolveOpenAiSupplementModel(),
  tts: normalizeModelName(process.env.COLLISION_IQ_MODEL_TTS, TTS_MODEL_FALLBACK),
  anthropicPrimary: normalizeModelName(
    process.env.ANTHROPIC_MODEL_PRIMARY,
    ANTHROPIC_MODEL_FALLBACK
  ),
  openclawPrimary: normalizeModelName(
    process.env.OPENCLAW_MODEL,
    OPENCLAW_MODEL_FALLBACK
  ),
} as const;

warnIfStaleOpenAiModel("primary", collisionIqModels.primary);
warnIfStaleOpenAiModel("helper", collisionIqModels.helper);
warnIfStaleOpenAiModel("supplement", collisionIqModels.supplement);

export function getCollisionIqModel(role: keyof typeof collisionIqModels) {
  return collisionIqModels[role];
}

export function getCollisionIqModelDiagnostic(params: {
  stage: string;
  provider?: CollisionIqPrimaryProvider;
  role?: CollisionIqModelRole;
  model?: string;
  reasoningEffort?: string | null;
}): CollisionIqModelDiagnostic {
  const role = params.role ?? "primary";
  const provider = params.provider ?? collisionIqProvider.primary;
  const model = params.model ?? collisionIqModels[role];
  const envKey = resolveConfiguredModelKey(role);
  return {
    stage: params.stage,
    provider,
    model,
    reasoningEffort: params.reasoningEffort ?? null,
    fallbackUsed: envKey === null,
    keyPresent: resolveKeyPresence(provider),
    envKey,
  };
}

export function logCollisionIqModelDiagnostic(params: Parameters<typeof getCollisionIqModelDiagnostic>[0]) {
  const diagnostic = getCollisionIqModelDiagnostic(params);
  console.info("[provider-routing] selected text generation provider", diagnostic);
  if (diagnostic.provider === "openai" && isStaleOpenAiModel(diagnostic.model)) {
    console.warn("[provider-routing] stale OpenAI model selected", {
      stage: diagnostic.stage,
      provider: diagnostic.provider,
      model: diagnostic.model,
      fallbackUsed: diagnostic.fallbackUsed,
    });
  }
  return diagnostic;
}

export function getCollisionIqModelStartupDiagnostics() {
  return [
    getCollisionIqModelDiagnostic({ stage: "startup_primary", provider: "openai", role: "primary" }),
    getCollisionIqModelDiagnostic({ stage: "startup_helper", provider: "openai", role: "helper" }),
    getCollisionIqModelDiagnostic({ stage: "startup_supplement", provider: "openai", role: "supplement" }),
  ];
}
