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
  if (value === "starter") return "starter";
  if (value === "team") return "team";
  return "pro";
}

async function getCheckoutRequestData(req: Request) {
  const contentType = req.headers.get("content-type") || "";
  const expectsJson =
    contentType.includes("application/json") ||
    req.headers.get("x-requested-with") === "XMLHttpRequest";

  if (contentType.includes("application/json")) {
    const body = (await req.json()) as { plan?: string; userId?: string } | null;
    return {
      expectsJson: true,
      plan: normalizePlan(body?.plan ?? null),
      requestUserId: body?.userId ?? null,
      requestBody: body,
    };
  }

  const formData = await req.formData();
  return {
    expectsJson,
    plan: normalizePlan(formData.get("plan")),
    requestUserId: typeof formData.get("userId") === "string" ? String(formData.get("userId")) : null,
    requestBody: Object.fromEntries(formData.entries()),
  };
}

export async function POST(req: Request) {
  try {
    console.log("create-checkout-session route hit");

    const access = await getCurrentEntitlements();
    const dbUser = await getOrCreateAppUser();

    if (!access.isAuthenticated || !dbUser) {
      return NextResponse.redirect(new URL("/sign-in", req.url));
    }

    const { expectsJson, plan, requestBody } = await getCheckoutRequestData(req);
    console.log("request body:", requestBody);

    const stripe = getStripe();
    const priceIds = getStripePriceIds();
    const priceId =
      plan === "starter" ? priceIds.starter : plan === "team" ? priceIds.team : priceIds.pro;
    console.log("selected priceId:", priceId);

    if (!priceId) {
      return NextResponse.json({ error: `Missing Stripe price for ${plan}` }, { status: 500 });
    }

    const customerId = await ensureStripeCustomerId(dbUser.id);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer: customerId,
      client_reference_id: dbUser.id,
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

    console.log("checkout session created:", session.id);
    console.log("checkout session url:", session.url);

    if (expectsJson) {
      return NextResponse.json({ url: session.url });
    }

    return NextResponse.redirect(session.url || getBillingReturnUrl("/billing"), 303);
  } catch (err) {
    console.error("STRIPE ERROR:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown Stripe error" },
      { status: 500 }
    );
  }
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
