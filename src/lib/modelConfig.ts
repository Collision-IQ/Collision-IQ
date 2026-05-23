const PRIMARY_MODEL_FALLBACK = "gpt-5.4";
const HELPER_MODEL_FALLBACK = "gpt-5.4-mini";
const TTS_MODEL_FALLBACK = "gpt-4o-mini-tts";

function normalizeModelName(value: string | undefined | null, fallback: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

export const collisionIqModels = {
  primary: normalizeModelName(
    process.env.COLLISION_IQ_MODEL_PRIMARY,
    normalizeModelName(process.env.COLLISION_IQ_MODEL, PRIMARY_MODEL_FALLBACK)
  ),
  helper: normalizeModelName(
    process.env.COLLISION_IQ_MODEL_HELPER,
    HELPER_MODEL_FALLBACK
  ),
  tts: normalizeModelName(process.env.COLLISION_IQ_MODEL_TTS, TTS_MODEL_FALLBACK),
} as const;

export function getCollisionIqModel(role: keyof typeof collisionIqModels) {
  return collisionIqModels[role];
}
