// Prisma-backed store for DvValuationRequest rows. All reads are owner-scoped
// (platform admins may read any row); status transitions are centralized here
// so no route can invent a lifecycle step.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DvExtraction, DvIntake, DvRequestStatus, DvResult } from "./types";
import { isDvRequestStatus } from "./types";

export type DvRequestRecord = {
  id: string;
  userId: string;
  status: DvRequestStatus;
  attachmentId: string | null;
  extraction: DvExtraction | null;
  intake: DvIntake | null;
  result: DvResult | null;
  stripeSessionId: string | null;
  paidAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type DvRequestRow = {
  id: string;
  userId: string;
  status: string;
  attachmentId: string | null;
  extraction: Prisma.JsonValue;
  intake: Prisma.JsonValue;
  result: Prisma.JsonValue;
  stripeSessionId: string | null;
  paidAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: DvRequestRow): DvRequestRecord {
  return {
    ...row,
    status: isDvRequestStatus(row.status) ? row.status : "draft",
    extraction: (row.extraction as DvExtraction | null) ?? null,
    intake: (row.intake as DvIntake | null) ?? null,
    result: (row.result as DvResult | null) ?? null,
  };
}

export async function createDvRequest(params: {
  userId: string;
  attachmentId: string | null;
  extraction: DvExtraction;
  intake?: DvIntake | null;
}): Promise<DvRequestRecord> {
  const row = await prisma.dvValuationRequest.create({
    data: {
      userId: params.userId,
      status: "draft",
      attachmentId: params.attachmentId,
      extraction: params.extraction as unknown as Prisma.InputJsonValue,
      intake: (params.intake ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    },
  });
  return toRecord(row);
}

export async function getDvRequest(
  id: string,
  viewer: { userId: string; isPlatformAdmin?: boolean }
): Promise<DvRequestRecord | null> {
  const row = await prisma.dvValuationRequest.findUnique({ where: { id } });
  if (!row) return null;
  if (row.userId !== viewer.userId && !viewer.isPlatformAdmin) return null;
  return toRecord(row);
}

export async function listDvRequests(userId: string): Promise<DvRequestRecord[]> {
  const rows = await prisma.dvValuationRequest.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map(toRecord);
}

/** Intake may change only before generation has produced a result the owner
 *  could already have downloaded. */
export async function updateDvIntake(params: {
  id: string;
  userId: string;
  intake: DvIntake;
}): Promise<DvRequestRecord | null> {
  const existing = await prisma.dvValuationRequest.findUnique({ where: { id: params.id } });
  if (!existing || existing.userId !== params.userId) return null;
  if (existing.status !== "draft" && existing.status !== "paid" && existing.status !== "failed") {
    return null;
  }
  const row = await prisma.dvValuationRequest.update({
    where: { id: params.id },
    data: { intake: params.intake as unknown as Prisma.InputJsonValue },
  });
  return toRecord(row);
}

/**
 * Marks a request paid after the Stripe session has been verified by the
 * caller. Idempotent: re-confirming the same session is a no-op, and the
 * unique constraint on stripeSessionId guarantees one session can never
 * unlock a second request.
 */
export async function markDvRequestPaid(params: {
  id: string;
  stripeSessionId: string;
}): Promise<DvRequestRecord | null> {
  const existing = await prisma.dvValuationRequest.findUnique({ where: { id: params.id } });
  if (!existing) return null;

  if (existing.stripeSessionId === params.stripeSessionId && existing.paidAt) {
    return toRecord(existing);
  }
  if (existing.status !== "draft" && existing.status !== "failed") {
    return toRecord(existing);
  }

  const row = await prisma.dvValuationRequest.update({
    where: { id: params.id },
    data: {
      status: "paid",
      stripeSessionId: params.stripeSessionId,
      paidAt: new Date(),
      errorMessage: null,
    },
  });
  return toRecord(row);
}

/** Atomically claims a paid request for generation; returns null when the
 *  request is not in a runnable state (unpaid, already running, or done). */
export async function claimDvRequestForProcessing(id: string): Promise<DvRequestRecord | null> {
  const updated = await prisma.dvValuationRequest.updateMany({
    where: { id, status: { in: ["paid", "failed"] }, paidAt: { not: null } },
    data: { status: "processing", errorMessage: null },
  });
  if (updated.count === 0) return null;
  const row = await prisma.dvValuationRequest.findUnique({ where: { id } });
  return row ? toRecord(row) : null;
}

export async function markDvRequestReady(params: {
  id: string;
  result: DvResult;
}): Promise<DvRequestRecord | null> {
  const row = await prisma.dvValuationRequest.update({
    where: { id: params.id },
    data: {
      status: "ready",
      result: params.result as unknown as Prisma.InputJsonValue,
      errorMessage: null,
    },
  });
  return toRecord(row);
}

export async function markDvRequestFailed(params: {
  id: string;
  message: string;
}): Promise<void> {
  await prisma.dvValuationRequest.update({
    where: { id: params.id },
    data: { status: "failed", errorMessage: params.message.slice(0, 500) },
  });
}
