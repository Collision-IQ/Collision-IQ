export const BILLING_CATALOG = {
  starter: {
    priceId:
      process.env.STRIPE_STARTER_PRICE_ID?.trim() ||
      process.env.STRIPE_PRICE_STARTER?.trim() ||
      "",
    mode: "subscription",
  },
  pro: {
    priceId:
      process.env.STRIPE_PRO_PRICE_ID?.trim() ||
      process.env.STRIPE_PRICE_PRO?.trim() ||
      "",
    mode: "subscription",
    trialDays: 30,
  },
  executive_onboarding: {
    priceId: process.env.STRIPE_EXECUTIVE_ONBOARDING_PRICE_ID?.trim() || "",
    mode: "payment",
  },
  virtual_onboarding: {
    priceId: process.env.STRIPE_VIRTUAL_ONBOARDING_PRICE_ID?.trim() || "",
    mode: "payment",
  },
  shop_hub: {
    priceId: process.env.STRIPE_SHOP_HUB_PRICE_ID?.trim() || "",
    mode: "subscription",
  },
  shop_flow: {
    priceId: process.env.STRIPE_SHOP_FLOW_PRICE_ID?.trim() || "",
    mode: "subscription",
  },
  parts_app: {
    priceId: process.env.STRIPE_PARTS_APP_PRICE_ID?.trim() || "",
    mode: "subscription",
  },
} as const;

export type BillingPlanKey = keyof typeof BILLING_CATALOG;

export function isBillingPlanKey(value: string): value is BillingPlanKey {
  return value in BILLING_CATALOG;
}
