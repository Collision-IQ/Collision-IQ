type TrialUserLike = {
  trialStartedAt?: Date | string | null;
  createdAt?: Date | string | null;
};

const TRIAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export function resolveEntitlements(user: TrialUserLike) {
  const now = Date.now();
  const trialStartRaw = user?.trialStartedAt ?? user?.createdAt ?? null;
  const trialStart = trialStartRaw ? new Date(trialStartRaw) : null;
  const trialActive =
    Boolean(trialStart) &&
    !Number.isNaN(trialStart!.getTime()) &&
    now < trialStart!.getTime() + TRIAL_DURATION_MS;

  return {
    isAuthenticated: true,
    trialActive,
    canUpload: true,
    canUseBasicExports: true,
    canUseRebuttalEmail: trialActive,
    canUseSupplementLines: trialActive,
    canUseNegotiationDraft: trialActive,
  };
}