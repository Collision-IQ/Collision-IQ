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
import { getStripe } from "@/lib/billing/stripe";
import { normalizeClaimId, toStableClaimId } from "@/lib/claims/claimIdentity";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// Only allow keys that belong to the service lane
function isServiceType(serviceType: string): serviceType is keyof typeof BILLING_CATALOG {
  if (!isBillingPlanKey(serviceType)) return false;
  const entry = BILLING_CATALOG[serviceType];
  return "lane" in entry && entry.lane === "service";
}

function getAppBaseUrl(): string | null {
  const explicitUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL;

  const candidate = explicitUrl
    ? explicitUrl
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : null;

  if (!candidate) return null;

  if (!candidate.startsWith("http://") && !candidate.startsWith("https://")) {
    return null;
  }

  if (
    candidate.startsWith("sk_") ||
    candidate.startsWith("pk_") ||
    candidate.startsWith("whsec_")
  ) {
    return null;
  }

  return candidate.replace(/\/$/, "");
}

async function resolveParams(
  req: Request
): Promise<{
  serviceType: string | null;
  claimId: string | null;
  claimIdProvided: boolean;
  returnUrl: string | null;
  analysisReportId: string | null;
  attachmentIds: string[];
  sourcePage: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
}> {
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as {
      serviceType?: string;
      serviceKey?: string;
      claimId?: string;
      returnUrl?: string;
      analysisReportId?: string;
      attachmentIds?: unknown;
      sourcePage?: string;
      customerName?: string;
      customerEmail?: string;
      customerPhone?: string;
    } | null;
    const rawClaimId = body?.claimId?.trim() ?? null;
    return {
      serviceType: (body?.serviceType ?? body?.serviceKey)?.trim() ?? null,
      claimId: normalizeClaimId(rawClaimId),
      claimIdProvided: Boolean(rawClaimId),
      returnUrl: body?.returnUrl?.trim() ?? null,
      analysisReportId: body?.analysisReportId?.trim() ?? null,
      attachmentIds: normalizeAttachmentIds(body?.attachmentIds),
      sourcePage: body?.sourcePage?.trim() ?? null,
      customerName: body?.customerName?.trim() ?? null,
      customerEmail: body?.customerEmail?.trim() ?? null,
      customerPhone: body?.customerPhone?.trim() ?? null,
    };
  }
  const formData = await req.formData();
  const rawServiceType =
    typeof formData.get("serviceType") === "string"
      ? (formData.get("serviceType") as string)
      : typeof formData.get("serviceKey") === "string"
        ? (formData.get("serviceKey") as string)
        : null;
  const rawClaimId =
    typeof formData.get("claimId") === "string"
      ? (formData.get("claimId") as string).trim()
      : null;
  return {
    serviceType: rawServiceType?.trim() ?? null,
    claimId: normalizeClaimId(rawClaimId),
    claimIdProvided: Boolean(rawClaimId),
    returnUrl: typeof formData.get("returnUrl") === "string"
      ? (formData.get("returnUrl") as string).trim()
      : null,
    analysisReportId: typeof formData.get("analysisReportId") === "string"
      ? (formData.get("analysisReportId") as string).trim()
      : null,
    attachmentIds: normalizeAttachmentIds(formData.get("attachmentIds")),
    sourcePage: typeof formData.get("sourcePage") === "string"
      ? (formData.get("sourcePage") as string).trim()
      : null,
    customerName: typeof formData.get("customerName") === "string"
      ? (formData.get("customerName") as string).trim()
      : null,
    customerEmail: typeof formData.get("customerEmail") === "string"
      ? (formData.get("customerEmail") as string).trim()
      : null,
    customerPhone: typeof formData.get("customerPhone") === "string"
      ? (formData.get("customerPhone") as string).trim()
      : null,
  };
}

function normalizeAttachmentIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

function serializeMetadataList(values: string[]): string {
  return [...new Set(values)].join(",").slice(0, 500);
}

function toMetadataValue(value: string | null | undefined): string {
  return (value ?? "").trim().slice(0, 500);
}

function resolveSafeReturnUrl(params: {
  rawReturnUrl: string | null;
  appBaseUrl: string;
  requestUrl: string;
}): string | null {
  if (!params.rawReturnUrl) return null;

  try {
    const appOrigin = new URL(params.appBaseUrl).origin;
    const requestOrigin = new URL(params.requestUrl).origin;
    const candidate = new URL(params.rawReturnUrl, requestOrigin);
    const allowedOrigins = new Set([appOrigin, requestOrigin]);

    if (!allowedOrigins.has(candidate.origin)) return null;
    if (candidate.protocol !== "http:" && candidate.protocol !== "https:") return null;

    return candidate.toString();
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  console.log("DB + URL check", {
    dbHost: process.env.DATABASE_URL?.match(/@([^/?]+)/)?.[1],
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    env: process.env.VERCEL_ENV,
  });
  console.log("FINAL DB CHECK:", {
    DATABASE_URL: process.env.DATABASE_URL?.includes("raspy-heart"),
    DIRECT_URL: process.env.DIRECT_URL?.includes("raspy-heart"),
  });

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

  const {
    serviceType,
    claimId,
    claimIdProvided,
    returnUrl,
    analysisReportId,
    attachmentIds,
    sourcePage,
    customerName,
    customerEmail,
    customerPhone,
  } = await resolveParams(req);

  if (!serviceType) {
    return NextResponse.json({ error: "Missing service type" }, { status: 400 });
  }

  if (!isServiceType(serviceType)) {
    return NextResponse.json({ error: "Invalid service type" }, { status: 400 });
  }

  const stableClaimId = claimId ? toStableClaimId(claimId) : null;
  const isCaseTiedCheckout =
    claimIdProvided || Boolean(analysisReportId) || attachmentIds.length > 0;

  if (isCaseTiedCheckout && !stableClaimId) {
    return NextResponse.json(
      { error: "Missing or invalid claim id for case-tied service checkout." },
      { status: 400 }
    );
  }

  const appBaseUrl = getAppBaseUrl();

  if (!appBaseUrl) {
    console.error("Invalid checkout return URL config", {
      hasNextPublicAppUrl: Boolean(process.env.NEXT_PUBLIC_APP_URL),
      hasAppBaseUrl: Boolean(process.env.APP_BASE_URL),
      hasVercelUrl: Boolean(process.env.VERCEL_URL),
    });

    return NextResponse.json(
      { error: "Invalid checkout return URL configuration." },
      { status: 500 }
    );
  }

  const successUrl = new URL("/service-cases", appBaseUrl);
  successUrl.searchParams.set("checkout", "success");
  successUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");

  const cancelUrl =
    resolveSafeReturnUrl({
      rawReturnUrl: returnUrl,
      appBaseUrl,
      requestUrl: req.url,
    }) ?? new URL("/the-academy?checkout=cancelled", appBaseUrl).toString();

  const academyUrl = new URL("/the-academy", appBaseUrl);

  const stripe = getStripe();

  let session;
  let stripePriceIdForLog: string | undefined;
  try {
    const servicePriceConfig = await prisma.servicePriceConfig.findUnique({
      where: { serviceType },
    });

    if (!servicePriceConfig) {
      return NextResponse.json(
        { error: `No price config found for ${serviceType}` },
        { status: 400 }
      );
    }

    if (!servicePriceConfig.isActive) {
      return NextResponse.json(
        { error: `Inactive Stripe price config for ${serviceType}` },
        { status: 400 }
      );
    }

    const stripePriceId = servicePriceConfig.stripePriceId.trim();
    stripePriceIdForLog = stripePriceId;

    if (!stripePriceId || !stripePriceId.startsWith("price_")) {
      return NextResponse.json(
        { error: `Invalid Stripe price ID for ${serviceType}. Expected price_*.` },
        { status: 400 }
      );
    }

    const customerId = await ensureStripeCustomerId(dbUser.id);
    const checkoutMetadata = {
      type: "service",
      checkoutScope: stableClaimId ? "case" : "public",
      userId: dbUser.id,
      claimId: stableClaimId ?? "",
      serviceType,
      analysisReportId: analysisReportId ?? stableClaimId ?? "",
      attachmentIds: serializeMetadataList(attachmentIds),
      sourcePage: toMetadataValue(
        sourcePage ?? (stableClaimId ? "collision-iq-case" : "the-academy")
      ),
      customerName: toMetadataValue(customerName),
      customerEmail: toMetadataValue(customerEmail),
      customerPhone: toMetadataValue(customerPhone),
    };

    console.info("[service-checkout] creating Stripe Checkout session", {
      userId: dbUser.id,
      serviceType,
      claimId: stableClaimId,
      checkoutScope: checkoutMetadata.checkoutScope,
      analysisReportId: checkoutMetadata.analysisReportId,
      attachmentCount: attachmentIds.length,
      cancelUrl,
    });

    session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      line_items: [
        {
          price: servicePriceConfig.stripePriceId,
          quantity: 1,
        },
      ],
      allow_promotion_codes: true,
      success_url: successUrl.toString(),
      cancel_url: cancelUrl,
      metadata: checkoutMetadata,
    });

    console.info("[service-checkout] Stripe Checkout session created", {
      sessionId: session.id,
      userId: dbUser.id,
      serviceType,
      metadata: checkoutMetadata,
    });
  } catch (error) {
    const stripeError = error as {
      message?: string;
      type?: string;
      code?: string;
      param?: string;
    };

    console.error("Service checkout failed:", {
      message: stripeError.message,
      type: stripeError.type,
      code: stripeError.code,
      param: stripeError.param,
      serviceType,
      stripePriceId: stripePriceIdForLog,
    });

    return NextResponse.json(
      { error: stripeError.message ?? "Checkout could not be started." },
      { status: 500 }
    );
  }

  if (wantsJson) {
    return NextResponse.json({ url: session.url });
  }
  return NextResponse.redirect(session.url || academyUrl.toString(), 303);
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
