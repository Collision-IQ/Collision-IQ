export type BillingPlan = "starter" | "trial" | "pro" | "team";

export const PLAN_CAPS = {
  starter: 40,
  trial: 30,
  pro: 200,
  team: 1000,
} as const;

export const PRO_TRIAL_DAYS = 30;

export function getPlanAnalysisCap(plan: BillingPlan) {
  return PLAN_CAPS[plan];
}
