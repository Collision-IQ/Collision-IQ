// Minimal centralized Pro/Admin feature gate for integration features
// (CCC Secure Share Import, Scan IQ). Deliberately additive — it reads the
// already-resolved entitlements plan and does not alter the auth model.

export type ProFeatureEntitlements = {
  plan: "admin" | "none" | "free" | "starter" | "trial" | "pro" | "team";
  isPlatformAdmin?: boolean;
};

/**
 * Pro-only integrations: Pro, Team, active Pro trial, and Admin qualify.
 * (An expired trial is already downgraded by entitlement resolution upstream,
 * so a resolved plan of "trial" means the Pro trial is active.)
 */
export function canUseProIntegrations(entitlements: ProFeatureEntitlements): boolean {
  if (entitlements.isPlatformAdmin) return true;
  return (
    entitlements.plan === "admin" ||
    entitlements.plan === "pro" ||
    entitlements.plan === "team" ||
    entitlements.plan === "trial"
  );
}

export const PRO_FEATURE_REQUIRED_MESSAGE =
  "This feature is available on Pro and Team plans.";
