import Stripe from "stripe";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/billing/stripe";

export const runtime = "nodejs";

const PLAN_BY_PRICE_LOOKUP: Record<string, "STARTER" | "PRO" | "TEAM"> = {
  [process.env.STRIPE_PRICE_PRO?.trim() || ""]: "PRO",
  [process.env.STRIPE_PRICE_TEAM?.trim() || ""]: "TEAM",
};

export async function POST(req: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return NextResponse.json({ error: "Missing STRIPE_WEBHOOK_SECRET" }, { status: 500 });
  }

  const payload = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid Stripe webhook" },
      { status: 400 }
    );
  }

  if (
    event.type === "checkout.session.completed" ||
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    await syncSubscriptionFromStripeEvent(event);
  }

  return NextResponse.json({ received: true });
}

async function syncSubscriptionFromStripeEvent(event: Stripe.Event) {
  const stripe = getStripe();
  let subscriptionId: string | null = null;
  let customerId: string | null = null;
  let dbUserId: string | null = null;

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    subscriptionId =
      typeof session.subscription === "string" ? session.subscription : session.subscription?.id || null;
    customerId =
      typeof session.customer === "string" ? session.customer : session.customer?.id || null;
    dbUserId = session.metadata?.dbUserId || null;
  } else {
    const subscription = event.data.object as Stripe.Subscription;
    subscriptionId = subscription.id;
    customerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer?.id || null;
  }

  if (!subscriptionId || !customerId) {
    return;
  }

  const subscription = (await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price"],
  })) as Stripe.Subscription;
  const billingPeriod = subscription as Stripe.Subscription & {
    current_period_start?: number;
    current_period_end?: number;
  };
  const priceId = subscription.items.data[0]?.price?.id || null;
  const plan = PLAN_BY_PRICE_LOOKUP[priceId || ""] || "STARTER";

  let resolvedUserId = dbUserId;
  if (!resolvedUserId) {
    const existing = await prisma.subscription.findFirst({
      where: {
        stripeCustomerId: customerId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    resolvedUserId = existing?.userId || null;
  }

  await prisma.subscription.upsert({
    where: {
      stripeSubscriptionId: subscription.id,
    },
    update: {
      stripeCustomerId: customerId,
      stripePriceId: priceId,
      plan,
      status: normalizeStripeStatus(subscription.status),
      currentPeriodStart: billingPeriod.current_period_start
        ? new Date(billingPeriod.current_period_start * 1000)
        : null,
      currentPeriodEnd: billingPeriod.current_period_end
        ? new Date(billingPeriod.current_period_end * 1000)
        : null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    },
    create: {
      userId: resolvedUserId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      plan,
      status: normalizeStripeStatus(subscription.status),
      currentPeriodStart: billingPeriod.current_period_start
        ? new Date(billingPeriod.current_period_start * 1000)
        : null,
      currentPeriodEnd: billingPeriod.current_period_end
        ? new Date(billingPeriod.current_period_end * 1000)
        : null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    },
  });
}

function normalizeStripeStatus(status: Stripe.Subscription.Status) {
  switch (status) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    case "unpaid":
      return "UNPAID";
    case "paused":
      return "PAUSED";
    case "incomplete_expired":
      return "INCOMPLETE_EXPIRED";
    default:
      return "INCOMPLETE";
  }
}
