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

async function resolvePlan(req: Request): Promise<BillingPlanKey | null> {
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as { plan?: string } | null;
    const plan = body?.plan?.trim();
    return plan && isBillingPlanKey(plan) ? plan : null;
  }

  const formData = await req.formData();
  const value = formData.get("plan");
  const plan = typeof value === "string" ? value.trim() : "";
  return plan && isBillingPlanKey(plan) ? plan : null;
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

  const plan = await resolvePlan(req);
  if (!plan) {
    return NextResponse.json({ error: "Plan not available" }, { status: 400 });
  }

  const stripe = getStripe();
  const catalogEntry = BILLING_CATALOG[plan];
  const priceId = catalogEntry.priceId;

  if (!priceId) {
    return NextResponse.json({ error: `Missing Stripe price for ${plan}` }, { status: 500 });
  }

  const customerId = await ensureStripeCustomerId(dbUser.id);
  const session = await stripe.checkout.sessions.create({
    mode: catalogEntry.mode,
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    subscription_data:
      catalogEntry.mode === "subscription" && plan === "pro"
        ? {
            trial_period_days:
              "trialDays" in catalogEntry ? catalogEntry.trialDays : undefined,
          }
        : undefined,
    success_url: getBillingReturnUrl("/billing?checkout=success"),
    cancel_url: getBillingReturnUrl("/billing?checkout=cancelled"),
    metadata: {
      dbUserId: dbUser.id,
      plan,
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
