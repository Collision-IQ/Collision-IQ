import Stripe from "stripe";
import { getAppUrl } from "@/lib/auth/config";

const globalForStripe = globalThis as typeof globalThis & {
  stripe?: Stripe;
};

export function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }

  if (!globalForStripe.stripe) {
    globalForStripe.stripe = new Stripe(secretKey);
  }

  return globalForStripe.stripe;
}

export function getStripePriceIds() {
  return {
    starter: process.env.STRIPE_PRICE_STARTER?.trim() || "",
    pro: process.env.STRIPE_PRICE_PRO?.trim() || "",
    team: process.env.STRIPE_PRICE_TEAM?.trim() || "",
  };
}

export function getBillingReturnUrl(path = "/billing") {
  return new URL(path, getAppUrl()).toString();
}
