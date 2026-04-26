/**
 * Academy Service Cases
 *
 * Creates and manages AcademyServiceCase records.
 * This is Lane 2 (The Academy — professional services).
 * It is intentionally separate from Lane 1 (Collision IQ SaaS subscriptions).
 *
 * Trigger: `checkout.session.completed` where `metadata.lane === "service"`
 * Result:  A new AcademyServiceCase in PENDING_INTAKE status, ready for
 *          human fulfillment workflow.
 */

import { prisma } from "@/lib/prisma";
import type { AcademyServiceType } from "@prisma/client";

export type { AcademyServiceType };

export type CreateServiceCaseParams = {
  userId: string;
  serviceType: AcademyServiceType;
  claimId?: string | null;
  stripeSessionId?: string | null;
  stripePaymentIntentId?: string | null;
  amountPaid?: number | null;
  notes?: string | null;
};

/**
 * Create a new service case after a successful Academy checkout.
 * The case starts in PENDING_INTAKE and is handed off to the
 * human fulfillment workflow from there.
 */
export async function createServiceCase(
  params: CreateServiceCaseParams
): Promise<{ id: string; serviceType: AcademyServiceType; status: string }> {
  const existing = params.stripeSessionId
    ? await prisma.academyServiceCase.findUnique({
        where: { stripeSessionId: params.stripeSessionId },
        select: { id: true, serviceType: true, status: true },
      })
    : null;

  if (existing) {
    return existing;
  }

  const serviceCase = await prisma.academyServiceCase.create({
    data: {
      userId: params.userId,
      serviceType: params.serviceType,
      claimId: params.claimId ?? null,
      stripeSessionId: params.stripeSessionId ?? null,
      stripePaymentIntentId: params.stripePaymentIntentId ?? null,
      amountPaid: params.amountPaid ?? null,
      notes: params.notes ?? null,
      status: "PENDING_INTAKE",
    },
    select: {
      id: true,
      serviceType: true,
      status: true,
    },
  });

  return serviceCase;
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
      createdAt: true,
    },
  });
}
