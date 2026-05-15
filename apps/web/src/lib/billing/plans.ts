export type BillingPlan = "none" | "starter" | "trial" | "pro" | "team";

export const PLAN_CAPS = {
  // None = chat only. No document-backed analysis, uploads, or exports.
  none: 0,

  // Starter = paid subscription. Basic upload + export, limited analysis capacity.
  starter: 10,

  // Trial kept for any grandfathered TRIALING subscriptions.
  trial: 200,

  // Paid Pro — full feature access, instant on subscribe.
  pro: 200,

  // Team / enterprise capacity
  team: 1000,
} as const;

export const PRO_TRIAL_DAYS = 30;

export const ENTERPRISE_AVAILABLE = false;

export function getPlanAnalysisCap(plan: BillingPlan) {
  return PLAN_CAPS[plan];
}
