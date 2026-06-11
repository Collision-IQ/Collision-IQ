const PRIMARY_MODEL_FALLBACK = "gpt-5.4";
const HELPER_MODEL_FALLBACK = "gpt-5.4-mini";
const TTS_MODEL_FALLBACK = "gpt-4o-mini-tts";
const ANTHROPIC_MODEL_FALLBACK = "claude-fable-5";
const ANTHROPIC_BASE_URL_FALLBACK = "https://api.anthropic.com";

export type CollisionIqPrimaryProvider = "openai" | "anthropic";

function normalizeModelName(value: string | undefined | null, fallback: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function normalizePrimaryProvider(value: string | undefined | null): CollisionIqPrimaryProvider {
  return value?.trim().toLowerCase() === "anthropic" ? "anthropic" : "openai";
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

export const collisionIqProvider = {
  primary: normalizePrimaryProvider(process.env.COLLISION_IQ_PRIMARY_PROVIDER),
  anthropicBaseUrl: normalizeModelName(
    process.env.ANTHROPIC_BASE_URL,
    ANTHROPIC_BASE_URL_FALLBACK
  ),
} as const;

export const collisionIqModels = {
  primary: resolveOpenAiPrimaryModel(),
  helper: normalizeModelName(
    process.env.COLLISION_IQ_MODEL_HELPER,
    HELPER_MODEL_FALLBACK
  ),
  tts: normalizeModelName(process.env.COLLISION_IQ_MODEL_TTS, TTS_MODEL_FALLBACK),
  anthropicPrimary: normalizeModelName(
    process.env.ANTHROPIC_MODEL_PRIMARY,
    ANTHROPIC_MODEL_FALLBACK
  ),
} as const;

export function getCollisionIqModel(role: keyof typeof collisionIqModels) {
  return collisionIqModels[role];
}
