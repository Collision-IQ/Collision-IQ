/**
 * Academy Service Cases
 *
 * Creates and manages AcademyServiceCase records for paid Academy Checkout
 * sessions. Stripe can retry webhook events, so creation is idempotent by
 * Checkout Session ID.
 */

import type Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { getAnalysisReport } from "@/lib/analysisReportStore";
import { prisma } from "@/lib/prisma";

export type CreateServiceCaseParams = {
  userId?: string | null;
  serviceType: string;
  claimId?: string | null;
  stripeSessionId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeEventId?: string | null;
  attachmentIds?: string[];
  reviewSnapshot?: Prisma.InputJsonValue | null;
  checkoutMetadata?: Prisma.InputJsonValue | null;
  intakeNotes?: string | null;
  internalNotes?: string | null;
  lastUpdate?: string | null;
};

export type ServiceCheckoutResult =
  | { ok: true; created: true; serviceCaseId: string }
  | { ok: true; created: false; serviceCaseId: string; reason: "duplicate_session" }
  | { ok: true; created: false; serviceCaseId: null; reason: "payment_not_paid" }
  | { ok: false; error: string };

function getStripePaymentIntentId(session: Stripe.Checkout.Session): string | null {
  return typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id ?? null;
}

function parseAttachmentIds(value: string | undefined): string[] {
  if (!value) return [];

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toCheckoutMetadataJson(
  metadata: Stripe.Metadata | null
): Prisma.InputJsonObject | null {
  if (!metadata) return null;

  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, value ?? null])
  ) as Prisma.InputJsonObject;
}

async function buildReviewSnapshot(params: {
  analysisReportId: string | null;
  userId: string | null;
}): Promise<{
  attachmentIds: string[];
  snapshot: Prisma.InputJsonValue | null;
}> {
  if (!params.analysisReportId || !params.userId) {
    return { attachmentIds: [], snapshot: null };
  }

  const report = await getAnalysisReport(params.analysisReportId, {
    ownerUserId: params.userId,
  });

  if (!report) {
    return { attachmentIds: [], snapshot: null };
  }

  return {
    attachmentIds: report.artifactIds,
    snapshot: {
      analysisReportId: report.id,
      createdAt: report.createdAt,
      attachmentIds: report.artifactIds,
      linkedEvidence: report.linkedEvidence ?? [],
      ingestionMeta: report.ingestionMeta ?? null,
      report: report.report,
    } as unknown as Prisma.InputJsonObject,
  };
}

export async function createServiceCase(
  params: CreateServiceCaseParams
): Promise<{ id: string; serviceType: string; status: string; created: boolean }> {
  const existing = params.stripeSessionId
    ? await prisma.academyServiceCase.findUnique({
        where: { stripeSessionId: params.stripeSessionId },
        select: { id: true, serviceType: true, status: true },
      })
    : null;

  if (existing) {
    return { ...existing, created: false };
  }

  try {
    const serviceCase = await prisma.academyServiceCase.create({
      data: {
        userId: params.userId,
        serviceType: params.serviceType,
        claimId: params.claimId ?? null,
        stripeSessionId: params.stripeSessionId ?? null,
        stripePaymentIntentId: params.stripePaymentIntentId ?? null,
        stripeEventId: params.stripeEventId ?? null,
        attachmentIds: (params.attachmentIds ?? []) as Prisma.InputJsonValue,
        reviewSnapshot: params.reviewSnapshot ?? Prisma.JsonNull,
        checkoutMetadata: params.checkoutMetadata ?? Prisma.JsonNull,
        intakeNotes: params.intakeNotes ?? null,
        internalNotes: params.internalNotes ?? null,
        lastUpdate: params.lastUpdate ?? null,
        status: "PENDING_INTAKE",
      },
      select: {
        id: true,
        serviceType: true,
        status: true,
      },
    });

    return { ...serviceCase, created: true };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      params.stripeSessionId
    ) {
      const existing = await prisma.academyServiceCase.findUnique({
        where: { stripeSessionId: params.stripeSessionId },
        select: { id: true, serviceType: true, status: true },
      });

      if (existing) {
        return { ...existing, created: false };
      }
    }

    throw error;
  }
}

export async function createServiceCaseFromCheckoutSession(params: {
  session: Stripe.Checkout.Session;
  eventId: string;
}): Promise<ServiceCheckoutResult> {
  const { session, eventId } = params;
  const metadata = session.metadata ?? {};
  const claimId = metadata.claimId?.trim();
  const serviceType = metadata.serviceType?.trim();
  const userId = metadata.userId?.trim() || metadata.dbUserId?.trim() || null;
  const analysisReportId = metadata.analysisReportId?.trim() || null;

  console.info("[stripe-webhook] service checkout metadata", {
    eventId,
    sessionId: session.id,
    paymentStatus: session.payment_status,
    metadata,
  });

  if (session.payment_status !== "paid") {
    console.info("[stripe-webhook] service checkout not paid; skipping case creation", {
      eventId,
      sessionId: session.id,
      paymentStatus: session.payment_status,
    });
    return { ok: true, created: false, serviceCaseId: null, reason: "payment_not_paid" };
  }

  if (!claimId || !serviceType || !userId) {
    return {
      ok: false,
      error: "Missing required service checkout metadata",
    };
  }

  const existing = await prisma.academyServiceCase.findUnique({
    where: { stripeSessionId: session.id },
    select: { id: true },
  });

  if (existing) {
    console.info("[stripe-webhook] duplicate service checkout session skipped", {
      eventId,
      sessionId: session.id,
      serviceCaseId: existing.id,
    });
    return {
      ok: true,
      created: false,
      serviceCaseId: existing.id,
      reason: "duplicate_session",
    };
  }

  const reportContext = await buildReviewSnapshot({
    analysisReportId,
    userId,
  });
  const metadataAttachmentIds = parseAttachmentIds(metadata.attachmentIds);
  const attachmentIds = [
    ...new Set([...metadataAttachmentIds, ...reportContext.attachmentIds]),
  ];

  const serviceCase = await createServiceCase({
    userId,
    claimId,
    serviceType,
    stripeSessionId: session.id,
    stripePaymentIntentId: getStripePaymentIntentId(session),
    stripeEventId: eventId,
    attachmentIds,
    reviewSnapshot: reportContext.snapshot,
    checkoutMetadata: toCheckoutMetadataJson(session.metadata),
    lastUpdate: "Payment received. Service case pending review.",
  });

  if (!serviceCase.created) {
    console.info("[stripe-webhook] duplicate service checkout session skipped", {
      eventId,
      sessionId: session.id,
      serviceCaseId: serviceCase.id,
    });
    return {
      ok: true,
      created: false,
      serviceCaseId: serviceCase.id,
      reason: "duplicate_session",
    };
  }

  console.info("[stripe-webhook] service case created", {
    eventId,
    sessionId: session.id,
    serviceCaseId: serviceCase.id,
    attachmentCount: attachmentIds.length,
    hasReviewSnapshot: Boolean(reportContext.snapshot),
  });

  return { ok: true, created: true, serviceCaseId: serviceCase.id };
}

/**
 * Look up active service cases for a user.
 */
export async function getUserServiceCases(userId: string) {
  return prisma.academyServiceCase.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      serviceType: true,
      status: true,
      claimId: true,
      stripeSessionId: true,
      stripePaymentIntentId: true,
      attachmentIds: true,
      reviewSnapshot: true,
      lastUpdate: true,
      createdAt: true,
    },
  });
}
