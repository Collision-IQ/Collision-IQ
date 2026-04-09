import { NextResponse } from "next/server";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";
import { getOrCreateAppUser } from "@/lib/auth/get-or-create-app-user";
import {
  getBillingReturnUrl,
  getProTrialDays,
  getStripe,
  getStripePriceIds,
} from "@/lib/billing/stripe";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function normalizePlan(value: FormDataEntryValue | null) {
  return value === "team" ? "team" : "pro";
}

export async function POST(req: Request) {
  const access = await getCurrentEntitlements();
  const dbUser = await getOrCreateAppUser();

  if (!access.isAuthenticated || !dbUser) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }

  const formData = await req.formData();
  const plan = normalizePlan(formData.get("plan"));
  const stripe = getStripe();
  const priceIds = getStripePriceIds();
  const priceId = plan === "team" ? priceIds.team : priceIds.pro;

  if (!priceId) {
    return NextResponse.json({ error: `Missing Stripe price for ${plan}` }, { status: 500 });
  }

  const customerId = await ensureStripeCustomerId(dbUser.id);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    subscription_data:
      plan === "pro"
        ? {
            trial_period_days: getProTrialDays(),
          }
        : undefined,
    success_url: getBillingReturnUrl("/billing?checkout=success"),
    cancel_url: getBillingReturnUrl("/billing?checkout=cancelled"),
    metadata: {
      dbUserId: dbUser.id,
      plan,
    },
  });

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
      dbUserId,
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
