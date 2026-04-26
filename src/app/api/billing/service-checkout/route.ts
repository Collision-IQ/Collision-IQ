/**
 * Lane 2: The Academy — Service Checkout
 *
 * This route handles one-time payment checkout for Academy professional
 * services. It is intentionally separate from /api/billing/checkout
 * (Lane 1 subscriptions) to keep the two lanes clearly distinct.
 *
 * POST body (JSON or form):
 *   serviceType — Academy service type stored in ServicePriceConfig
 *   serviceKey  — legacy alias for serviceType
 *   claimId     — claim identifier to attach to the service case
 */

import { NextResponse } from "next/server";
import { getOrCreateAppUser } from "@/lib/auth/get-or-create-app-user";
import { UnauthorizedError } from "@/lib/auth/require-current-user";
import { BILLING_CATALOG, isBillingPlanKey } from "@/lib/billing/catalog";
import { getBillingReturnUrl, getStripe } from "@/lib/billing/stripe";
import { normalizeClaimId, toStableClaimId } from "@/lib/claims/claimIdentity";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// Only allow keys that belong to the service lane
function isServiceType(serviceType: string): serviceType is keyof typeof BILLING_CATALOG {
  if (!isBillingPlanKey(serviceType)) return false;
  const entry = BILLING_CATALOG[serviceType];
  return "lane" in entry && entry.lane === "service";
}

async function resolveParams(
  req: Request
): Promise<{ serviceType: string | null; claimId: string | null }> {
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as {
      serviceType?: string;
      serviceKey?: string;
      claimId?: string;
    } | null;
    return {
      serviceType: (body?.serviceType ?? body?.serviceKey)?.trim() ?? null,
      claimId: normalizeClaimId(body?.claimId?.trim() ?? null),
    };
  }
  const formData = await req.formData();
  const rawServiceType =
    typeof formData.get("serviceType") === "string"
      ? (formData.get("serviceType") as string)
      : typeof formData.get("serviceKey") === "string"
        ? (formData.get("serviceKey") as string)
        : null;
  return {
    serviceType: rawServiceType?.trim() ?? null,
    claimId: typeof formData.get("claimId") === "string"
      ? normalizeClaimId((formData.get("claimId") as string).trim())
      : null,
  };
}

export async function POST(req: Request) {
  const wantsJson = (req.headers.get("content-type") || "").includes("application/json");

  let dbUser: Awaited<ReturnType<typeof getOrCreateAppUser>>;
  try {
    dbUser = await getOrCreateAppUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      const url = new URL("/sign-in", req.url).toString();
      return wantsJson
        ? NextResponse.json({ url }, { status: 401 })
        : NextResponse.redirect(new URL("/sign-in", req.url));
    }
    throw error;
  }

  const { serviceType, claimId } = await resolveParams(req);

  if (!serviceType || !isServiceType(serviceType)) {
    return NextResponse.json({ error: "Invalid service type" }, { status: 400 });
  }

  const stableClaimId = toStableClaimId(claimId);
  if (!stableClaimId) {
    return NextResponse.json({ error: "Missing or invalid claim id" }, { status: 400 });
  }

  const entry = BILLING_CATALOG[serviceType] as {
    priceId: string;
    mode: string;
    lane: string;
    serviceType: string;
    label: string;
  };

  const dbConfig = await prisma.servicePriceConfig.findUnique({
    where: { serviceType },
  });

  if (dbConfig && !dbConfig.isActive) {
    return NextResponse.json(
      { error: `Inactive Stripe price config for ${serviceType}` },
      { status: 400 }
    );
  }

  // Prefer the DB-configured price ID; fall back to catalog env var.
  const priceId = (dbConfig?.stripePriceId || entry.priceId).trim();

  if (!priceId) {
    return NextResponse.json(
      { error: `Missing Stripe price for ${serviceType}` },
      { status: 500 }
    );
  }

  if (!priceId.startsWith("price_")) {
    return NextResponse.json(
      { error: `Invalid Stripe price id for ${serviceType}` },
      { status: 500 }
    );
  }

  const stripe = getStripe();
  const customerId = await ensureStripeCustomerId(dbUser.id);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: getBillingReturnUrl("/cases?checkout=success"),
    cancel_url: getBillingReturnUrl("/cases?checkout=cancel"),
    metadata: {
      type: "service",
      userId: dbUser.id,
      claimId: stableClaimId,
      serviceType,
    },
  });

  if (wantsJson) {
    return NextResponse.json({ url: session.url });
  }
  return NextResponse.redirect(session.url || getBillingReturnUrl("/the-academy"), 303);
}

async function ensureStripeCustomerId(dbUserId: string): Promise<string> {
  const dbUser = await prisma.user.findUnique({
    where: { id: dbUserId },
    include: {
      subscriptions: { take: 1, orderBy: { createdAt: "desc" } },
    },
  });

  const existing = dbUser?.subscriptions[0]?.stripeCustomerId;
  if (existing) return existing;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    metadata: { userId: dbUserId },
  });

  return customer.id;
}
