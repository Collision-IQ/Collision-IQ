export type BillingPlan = "none" | "starter" | "trial" | "pro" | "team";

export const PLAN_CAPS = {
  // None = chat only. No document-backed analysis, uploads, or exports.
  none: 0,

  // Free = chat only. No document-backed analysis.
  starter: 0,

  // Trial = full-feature temporary access for first-time signed-in users.
  // Match Pro capacity during the 30-day window.
  trial: 200,

  // Paid Pro
  pro: 200,

  // Team / enterprise capacity
  team: 1000,
} as const;

export const PRO_TRIAL_DAYS = 30;

export const ENTERPRISE_AVAILABLE = false;

export function getPlanAnalysisCap(plan: BillingPlan) {
  return PLAN_CAPS[plan];
}
