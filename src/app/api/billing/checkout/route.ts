import { NextResponse } from "next/server";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";
import { getOrCreateAppUser } from "@/lib/auth/get-or-create-app-user";
import { UnauthorizedError } from "@/lib/auth/require-current-user";
import { BILLING_CATALOG, isBillingPlanKey, type BillingPlanKey } from "@/lib/billing/catalog";
import {
  getBillingReturnUrl,
  getStripe,
} from "@/lib/billing/stripe";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type CheckoutPayload = {
  plan: BillingPlanKey | null;
  claimId: string | null;
  foundingPilot: boolean;
};

/**
 * Founding Shop Pilot: Pro at $99/month for the first 3 billing months, then
 * the standard $200/month. Implemented as a Stripe promotion code (coupon
 * `founding-shop-pilot`, $101 off, repeating 3 months, 10 redemptions, Pro
 * product only) on the regular Pro price — NOT a separate price — so the
 * webhook's price→plan lookup always resolves the subscription to PRO and
 * Stripe itself returns it to $200 with no code involved at day 90.
 */
const FOUNDING_PILOT_PROMO_CODE = "FOUNDINGSHOP";
const FOUNDING_PILOT_ALIASES = new Set(["founding-pilot", "founding_pilot"]);

const CHECKOUT_PLAN_ALIASES: Record<string, BillingPlanKey> = {
  "executive-onboarding": "executive_onboarding",
  "virtual-onboarding": "virtual_onboarding",
  "shop-hub": "shop_hub",
  "shop-flow": "shop_flow",
  "parts-app": "parts_app",
};

function resolveBillingPlanKey(value: string | undefined): BillingPlanKey | null {
  const plan = value?.trim();
  if (!plan) return null;
  if (isBillingPlanKey(plan)) return plan;
  return CHECKOUT_PLAN_ALIASES[plan] ?? null;
}

async function resolveCheckoutPayload(req: Request): Promise<CheckoutPayload> {
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as { plan?: string; claimId?: string } | null;
    const foundingPilot = FOUNDING_PILOT_ALIASES.has(body?.plan?.trim() ?? "");
    return {
      plan: foundingPilot ? "pro" : resolveBillingPlanKey(body?.plan),
      claimId: body?.claimId?.trim() || null,
      foundingPilot,
    };
  }

  const formData = await req.formData();
  const value = formData.get("plan");
  const claimIdValue = formData.get("claimId");

  const rawPlan = typeof value === "string" ? value : undefined;
  const foundingPilot = FOUNDING_PILOT_ALIASES.has(rawPlan?.trim() ?? "");
  return {
    plan: foundingPilot ? "pro" : resolveBillingPlanKey(rawPlan),
    claimId: typeof claimIdValue === "string" ? claimIdValue.trim() || null : null,
    foundingPilot,
  };
}

function expectsJson(req: Request) {
  const contentType = req.headers.get("content-type") || "";
  return contentType.includes("application/json");
}

export async function POST(req: Request) {
  const wantsJson = expectsJson(req);
  let access;
  let dbUser;

  try {
    access = await getCurrentEntitlements();
    dbUser = await getOrCreateAppUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      const signInUrl = new URL("/sign-in", req.url).toString();
      if (wantsJson) {
        return NextResponse.json({ url: signInUrl }, { status: 401 });
      }
      return NextResponse.redirect(new URL("/sign-in", req.url));
    }

    throw error;
  }

  if (!access.isAuthenticated || !dbUser) {
    const signInUrl = new URL("/sign-in", req.url).toString();
    if (wantsJson) {
      return NextResponse.json({ url: signInUrl }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }

  const { plan, claimId, foundingPilot } = await resolveCheckoutPayload(req);
  if (!plan) {
    return NextResponse.json({ error: "Plan not available" }, { status: 400 });
  }

  const stripe = getStripe();
  const catalogEntry = BILLING_CATALOG[plan];
  const priceId = catalogEntry.priceId;

  if (!priceId) {
    return NextResponse.json({ error: "This checkout price is not configured yet." }, { status: 500 });
  }

  // Stripe rejects `discounts` alongside `allow_promotion_codes`, so the pilot
  // pre-applies its code and every other checkout keeps the code field.
  let pilotPromotionCodeId: string | null = null;
  if (foundingPilot) {
    const promo = await stripe.promotionCodes.list({
      code: FOUNDING_PILOT_PROMO_CODE,
      active: true,
      limit: 1,
    });
    pilotPromotionCodeId = promo.data[0]?.id ?? null;
    if (!pilotPromotionCodeId) {
      // All 10 spots redeemed (Stripe deactivates the code) — never silently
      // send a pilot click to a full-price checkout.
      const fullUrl = getBillingReturnUrl("/billing?offer=founding-pilot&pilot=full");
      if (wantsJson) {
        return NextResponse.json({ url: fullUrl, error: "The Founding Shop Pilot is full." }, { status: 409 });
      }
      return NextResponse.redirect(fullUrl, 303);
    }
  }

  const customerId = await ensureStripeCustomerId(dbUser.id);
  const session = await stripe.checkout.sessions.create({
    mode: catalogEntry.mode,
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    ...(pilotPromotionCodeId
      ? { discounts: [{ promotion_code: pilotPromotionCodeId }] }
      : { allow_promotion_codes: true }),
    success_url: getBillingReturnUrl("/billing?checkout=success"),
    cancel_url: getBillingReturnUrl("/billing?checkout=cancelled"),
    metadata: {
      type: catalogEntry.mode,
      plan,
      offer: foundingPilot ? "founding_pilot" : "",
      claimId: claimId ?? "",
      userId: dbUser.id,
    },
  });

  if (wantsJson) {
    return NextResponse.json({ url: session.url });
  }

  return NextResponse.redirect(session.url || getBillingReturnUrl("/billing"), 303);
}

async function ensureStripeCustomerId(dbUserId: string) {
  const dbUser = await prisma.user.findUnique({
    where: { id: dbUserId },
    include: {
      subscriptions: {
        take: 1,
        orderBy: { createdAt: "desc" },
      },
    },
  });

  const existingCustomerId = dbUser?.subscriptions[0]?.stripeCustomerId;
  if (existingCustomerId) {
    return existingCustomerId;
  }

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: dbUser?.email || undefined,
    name: [dbUser?.firstName, dbUser?.lastName].filter(Boolean).join(" ") || undefined,
    metadata: {
      userId: dbUserId,
    },
  });

  await prisma.subscription.create({
    data: {
      userId: dbUserId,
      stripeCustomerId: customer.id,
      plan: "STARTER",
      status: "INCOMPLETE",
    },
  });

  return customer.id;
}
