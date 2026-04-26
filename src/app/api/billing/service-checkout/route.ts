/**
 * Lane 2: The Academy — Service Checkout
 *
 * This route handles one-time payment checkout for Academy professional
 * services. It is intentionally separate from /api/billing/checkout
 * (Lane 1 subscriptions) to keep the two lanes clearly distinct.
 *
 * POST body (JSON or form):
 *   serviceKey  — BillingPlanKey for an Academy service (e.g. "academy_rekey_estimating")
 *   claimId?    — optional claim identifier to attach to the service case
 */

import { NextResponse } from "next/server";
import { getOrCreateAppUser } from "@/lib/auth/get-or-create-app-user";
import { UnauthorizedError } from "@/lib/auth/require-current-user";
import { BILLING_CATALOG, isBillingPlanKey } from "@/lib/billing/catalog";
import { getBillingReturnUrl, getStripe } from "@/lib/billing/stripe";
import { normalizeClaimId, toStableClaimId } from "@/lib/claims/claimIdentity";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const METADATA_SERVICE_TYPE_BY_CATALOG_KEY: Record<string, string> = {
  academy_rekey_estimating: "rekey_estimating",
  academy_legal_assist: "legal_assist",
  academy_acv_review: "acv_review",
  academy_appraisal: "appraisal",
  academy_appraisal_clause: "appraisal_clause",
  academy_value_dispute: "value_dispute",
  academy_diminished_value: "diminished_value",
};

// Only allow keys that belong to the service lane
function isServiceKey(key: string): boolean {
  if (!isBillingPlanKey(key)) return false;
  const entry = BILLING_CATALOG[key];
  return "lane" in entry && entry.lane === "service";
}

async function resolveParams(
  req: Request
): Promise<{ serviceKey: string | null; claimId: string | null }> {
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as {
      serviceKey?: string;
      claimId?: string;
    } | null;
    return {
      serviceKey: body?.serviceKey?.trim() ?? null,
      claimId: normalizeClaimId(body?.claimId?.trim() ?? null),
    };
  }
  const formData = await req.formData();
  return {
    serviceKey: typeof formData.get("serviceKey") === "string"
      ? (formData.get("serviceKey") as string).trim()
      : null,
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

  const { serviceKey, claimId } = await resolveParams(req);

  if (!serviceKey || !isServiceKey(serviceKey)) {
    return NextResponse.json({ error: "Invalid service key" }, { status: 400 });
  }

  const entry = BILLING_CATALOG[serviceKey as keyof typeof BILLING_CATALOG] as {
    priceId: string;
    mode: string;
    lane: string;
    serviceType: string;
    label: string;
  };

  if (!entry.priceId) {
    return NextResponse.json(
      { error: `Missing Stripe price for ${serviceKey}` },
      { status: 500 }
    );
  }

  const stripe = getStripe();
  const customerId = await ensureStripeCustomerId(dbUser.id);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [{ price: entry.priceId, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: getBillingReturnUrl("/cases?checkout=success"),
    cancel_url: getBillingReturnUrl("/the-academy?checkout=cancelled"),
    metadata: {
      type: "service",
      serviceType: METADATA_SERVICE_TYPE_BY_CATALOG_KEY[serviceKey] || "",
      claimId: toStableClaimId(claimId) ?? "",
      userId: dbUser.id,
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
