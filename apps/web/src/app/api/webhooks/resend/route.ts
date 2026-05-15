import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResendWebhookPayload = {
  type?: unknown;
  event?: unknown;
  data?: unknown;
};

type DeliveryStatus = "sent" | "delivered" | "bounced" | "failed" | "opened";

const EVENT_STATUS: Record<string, DeliveryStatus> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.failed": "failed",
  "email.opened": "opened",
};

export async function POST(request: Request) {
  // TODO: Verify Resend webhook signatures once RESEND_WEBHOOK_SECRET is configured.
  let payload: ResendWebhookPayload;

  try {
    payload = (await request.json()) as ResendWebhookPayload;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const eventType = coerceText(payload.type) || coerceText(payload.event);
  const resendId = extractResendEmailId(payload);
  const status = EVENT_STATUS[eventType];

  console.info("[resend_webhook_event]", {
    type: eventType || "unknown",
    resend_id: resendId,
    status: status ?? null,
  });

  if (!resendId || !status) {
    if (resendId && !status) {
      console.info("[resend_webhook_unmatched]", {
        resend_id: resendId,
        reason: "unsupported_event",
        type: eventType || "unknown",
      });
    }
    return NextResponse.json({ ok: true });
  }

  const now = new Date();
  const timestampField = resolveTimestampField(status);
  const updated = await prisma.reportSend.updateMany({
    where: { resendId },
    data: {
      status,
      rawEvent: payload as Prisma.InputJsonValue,
      ...(timestampField ? { [timestampField]: now } : {}),
    },
  });

  if (updated.count === 0) {
    console.info("[resend_webhook_unmatched]", {
      resend_id: resendId,
      type: eventType,
    });
  }

  return NextResponse.json({ ok: true });
}

function coerceText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function extractResendEmailId(payload: ResendWebhookPayload): string | null {
  const data = payload.data && typeof payload.data === "object"
    ? (payload.data as Record<string, unknown>)
    : {};

  return (
    coerceText(data.email_id) ||
    coerceText(data.emailId) ||
    coerceText(data.id) ||
    coerceText(data.email?.valueOf?.()) ||
    null
  );
}

function resolveTimestampField(status: DeliveryStatus) {
  switch (status) {
    case "delivered":
      return "deliveredAt";
    case "bounced":
      return "bouncedAt";
    case "failed":
      return "failedAt";
    case "opened":
      return "openedAt";
    case "sent":
      return null;
  }
}
