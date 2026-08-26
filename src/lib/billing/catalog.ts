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
    priceId: process.env.STRIPE_PRICE_RE_KEY_APPRAISAL_ID?.trim() || "",
    mode: "payment",
    lane: "service",
    serviceType: "REKEY_ESTIMATING",
    label: "Rekey Estimating",
  },
  academy_legal_assist: {
    priceId: process.env.STRIPE_PRICE_LEGAL_ASSIST_ID?.trim() || "",
    mode: "payment",
    lane: "service",
    serviceType: "LEGAL_ASSIST",
    label: "Legal Assist",
  },
  academy_acv_review: {
    priceId: process.env.STRIPE_PRICE_ACTUAL_COST_VALUE?.trim() || "",
    mode: "payment",
    lane: "service",
    serviceType: "ACV_REVIEW",
    label: "ACV Review",
  },
  academy_appraisal: {
    priceId: process.env.STRIPE_PRICE_APPRAISAL_ID?.trim() || "",
    mode: "payment",
    lane: "service",
    serviceType: "APPRAISAL",
    label: "Appraisal",
  },
  academy_appraisal_clause: {
    priceId: process.env.STRIPE_RIGHT_TO_APPRAISAL_ID?.trim() || "",
    mode: "payment",
    lane: "service",
    serviceType: "APPRAISAL_CLAUSE",
    label: "Right to Appraisal Clause",
  },
  academy_value_dispute: {
    priceId: process.env.STRIPE_PRICE_VALUE_DISPUTE_ID?.trim() || "",
    mode: "payment",
    lane: "service",
    serviceType: "VALUE_DISPUTE",
    label: "Value Dispute",
  },
  academy_diminished_value: {
    priceId: process.env.STRIPE_PRICE_DIMINISHED_VALUE_ID?.trim() || "",
    mode: "payment",
    lane: "service",
    serviceType: "DIMINISHED_VALUE",
    label: "Diminished Value",
  },
  // Self-service ACV + Diminished Value generator (/diminished-value) —
  // its own product and price, distinct from the human-performed
  // academy_diminished_value service above.
  value_iq: {
    priceId: process.env.STRIPE_VALUE_IQ_PRICE_ID?.trim() || "",
    mode: "payment",
    lane: "service",
    serviceType: "VALUE_IQ",
    label: "Value IQ — ACV + Diminished Value Report",
  },
  // 1-on-1 consult variants for Value IQ users who want professional guidance
  value_iq_consult_dv: {
    priceId: process.env.STRIPE_PRICE_DIMINISHED_VALUE_ID?.trim() || "",
    mode: "payment",
    lane: "service",
    serviceType: "VALUE_IQ_CONSULT_DV",
    label: "1-on-1 Consult — Diminished Value",
  },
  value_iq_consult_vd: {
    priceId: process.env.STRIPE_PRICE_VALUE_DISPUTE_ID?.trim() || "",
    mode: "payment",
    lane: "service",
    serviceType: "VALUE_IQ_CONSULT_VD",
    label: "1-on-1 Consult — Value Dispute",
  },
  // ── Legacy / Technical Systems ────────────────────────────────────────
  executive_onboarding: {
    priceId:
      process.env.STRIPE_PRICE_EXECUTIVE_ONBOARDING?.trim() ||
      process.env.STRIPE_EXECUTIVE_ONBOARDING_PRICE_ID?.trim() ||
      "",
    mode: "payment",
    lane: "legacy",
  },
  virtual_onboarding: {
    priceId:
      process.env.STRIPE_PRICE_VIRTUAL_ONBOARDING?.trim() ||
      process.env.STRIPE_VIRTUAL_ONBOARDING_PRICE_ID?.trim() ||
      "",
    mode: "payment",
    lane: "legacy",
  },
  shop_hub: {
    priceId:
      process.env.STRIPE_PRICE_SHOP_HUB?.trim() ||
      process.env.STRIPE_SHOP_HUB_PRICE_ID?.trim() ||
      "",
    mode: "subscription",
    lane: "subscription",
  },
  shop_flow: {
    priceId:
      process.env.STRIPE_PRICE_SHOP_FLOW?.trim() ||
      process.env.STRIPE_SHOP_FLOW_PRICE_ID?.trim() ||
      "",
    mode: "subscription",
    lane: "subscription",
  },
  parts_app: {
    priceId:
      process.env.STRIPE_PRICE_PARTS_APP?.trim() ||
      process.env.STRIPE_PARTS_APP_PRICE_ID?.trim() ||
      "",
    mode: "subscription",
    lane: "subscription",
  },
} as const;

export type BillingPlanKey = keyof typeof BILLING_CATALOG;

export function isBillingPlanKey(value: string): value is BillingPlanKey {
  return value in BILLING_CATALOG;
}
