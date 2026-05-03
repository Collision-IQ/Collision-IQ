import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const caseId = url.searchParams.get("caseId")?.trim() || null;
  const limit = coerceLimit(url.searchParams.get("limit"));

  const sends = await prisma.reportSend.findMany({
    where: caseId ? { caseId } : undefined,
    orderBy: { sentAt: "desc" },
    take: limit,
    select: {
      id: true,
      caseId: true,
      reportType: true,
      destinationType: true,
      recipient: true,
      subject: true,
      resendId: true,
      status: true,
      sentAt: true,
      deliveredAt: true,
      bouncedAt: true,
      failedAt: true,
      openedAt: true,
    },
  });

  return NextResponse.json({
    ok: true,
    sends: sends.map((send) => ({
      ...send,
      sentAt: send.sentAt.toISOString(),
      deliveredAt: send.deliveredAt?.toISOString() ?? null,
      bouncedAt: send.bouncedAt?.toISOString() ?? null,
      failedAt: send.failedAt?.toISOString() ?? null,
      openedAt: send.openedAt?.toISOString() ?? null,
    })),
  });
}

function coerceLimit(value: string | null): number {
  const parsed = value ? Number.parseInt(value, 10) : 25;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 25;
  }
  return Math.min(parsed, 100);
}
