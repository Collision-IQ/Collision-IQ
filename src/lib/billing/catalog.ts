export const BILLING_CATALOG = {
  // ── Lane 1: Collision IQ SaaS ────────────────────────────────────────
  starter: {
    priceId:
      process.env.STRIPE_STARTER_PRICE_ID?.trim() ||
      process.env.STRIPE_PRICE_STARTER?.trim() ||
      "",
    mode: "subscription",
    lane: "subscription",
  },
  pro: {
    priceId:
      process.env.STRIPE_PRO_PRICE_ID?.trim() ||
      process.env.STRIPE_PRICE_PRO?.trim() ||
      "",
    mode: "subscription",
    lane: "subscription",
  },
  // ── Lane 2: The Academy — Professional Services ──────────────────────
  academy_rekey_estimating: {
    priceId: process.env.STRIPE_ACADEMY_REKEY_PRICE_ID?.trim() || "",
    mode: "payment",
    lane: "service",
    serviceType: "REKEY_ESTIMATING",
    label: "Rekey Estimating",
  },
  academy_legal_assist: {
    priceId: process.env.STRIPE_ACADEMY_LEGAL_PRICE_ID?.trim() || "",
    mode: "payment",
    lane: "service",
    serviceType: "LEGAL_ASSIST",
    label: "Legal Assist",
  },
  academy_acv_review: {
    priceId: process.env.STRIPE_ACADEMY_ACV_PRICE_ID?.trim() || "",
    mode: "payment",
    lane: "service",
    serviceType: "ACV_REVIEW",
    label: "ACV Review",
  },
  academy_appraisal: {
    priceId: process.env.STRIPE_ACADEMY_APPRAISAL_PRICE_ID?.trim() || "",
    mode: "payment",
    lane: "service",
    serviceType: "APPRAISAL",
    label: "Appraisal",
  },
  academy_appraisal_clause: {
    priceId: process.env.STRIPE_ACADEMY_APPRAISAL_CLAUSE_PRICE_ID?.trim() || "",
    mode: "payment",
    lane: "service",
    serviceType: "APPRAISAL_CLAUSE",
    label: "Right to Appraisal Clause",
  },
  academy_value_dispute: {
    priceId: process.env.STRIPE_ACADEMY_VALUE_DISPUTE_PRICE_ID?.trim() || "",
    mode: "payment",
    lane: "service",
    serviceType: "VALUE_DISPUTE",
    label: "Value Dispute",
  },
  academy_diminished_value: {
    priceId: process.env.STRIPE_ACADEMY_DV_PRICE_ID?.trim() || "",
    mode: "payment",
    lane: "service",
    serviceType: "DIMINISHED_VALUE",
    label: "Diminished Value",
  },
  // ── Legacy / Technical Systems ────────────────────────────────────────
  executive_onboarding: {
    priceId: process.env.STRIPE_EXECUTIVE_ONBOARDING_PRICE_ID?.trim() || "",
    mode: "payment",
    lane: "legacy",
  },
  virtual_onboarding: {
    priceId: process.env.STRIPE_VIRTUAL_ONBOARDING_PRICE_ID?.trim() || "",
    mode: "payment",
    lane: "legacy",
  },
  shop_hub: {
    priceId: process.env.STRIPE_SHOP_HUB_PRICE_ID?.trim() || "",
    mode: "subscription",
    lane: "subscription",
  },
  shop_flow: {
    priceId: process.env.STRIPE_SHOP_FLOW_PRICE_ID?.trim() || "",
    mode: "subscription",
    lane: "subscription",
  },
  parts_app: {
    priceId: process.env.STRIPE_PARTS_APP_PRICE_ID?.trim() || "",
    mode: "subscription",
    lane: "subscription",
  },
} as const;

export type BillingPlanKey = keyof typeof BILLING_CATALOG;

export function isBillingPlanKey(value: string): value is BillingPlanKey {
  return value in BILLING_CATALOG;
}
