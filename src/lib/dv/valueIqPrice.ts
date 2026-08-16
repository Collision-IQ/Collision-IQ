// The appraisal fee demanded on the letter is the fee the customer actually
// paid for the Value IQ report — an indirect loss recovered in the demand.
// It therefore follows the live Stripe price for the value_iq service, never
// a hardcoded constant (the price changed once already and reports kept
// demanding the old amount).

import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/billing/stripe";

const FALLBACK_FEE = 350;
const CACHE_TTL_MS = 10 * 60 * 1000;

let cached: { fee: number; at: number } | null = null;

export async function getValueIqFee(): Promise<number> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.fee;
  }
  try {
    const config = await prisma.servicePriceConfig.findUnique({
      where: { serviceType: "value_iq" },
    });
    if (!config?.stripePriceId?.startsWith("price_")) return FALLBACK_FEE;
    const price = await getStripe().prices.retrieve(config.stripePriceId.trim());
    const fee = typeof price.unit_amount === "number" ? price.unit_amount / 100 : null;
    if (fee && fee > 0) {
      cached = { fee, at: Date.now() };
      return fee;
    }
    return FALLBACK_FEE;
  } catch {
    return cached?.fee ?? FALLBACK_FEE;
  }
}
