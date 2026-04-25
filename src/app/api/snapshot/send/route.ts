import { NextResponse } from "next/server";
import type { CollisionSnapshot } from "@/lib/ai/builders/collisionSnapshot";
import {
  buildSnapshotSendSafeEvent,
  type SnapshotDestinationType,
} from "@/lib/ai/builders/snapshotShare";
import { requireCurrentUser } from "@/lib/auth/require-current-user";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";
import { canAccessFeature } from "@/lib/featureAccess";

type SnapshotSendRequest = {
  destinationType?: SnapshotDestinationType;
  recipientEmail?: string;
  subject?: string;
  message?: string;
  snapshot?: CollisionSnapshot;
  pdfBase64?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const { isPlatformAdmin } = await requireCurrentUser();
  const entitlements = await getCurrentEntitlements();
  if (!isPlatformAdmin && !canAccessFeature(entitlements.plan, "snapshot_export")) {
    return NextResponse.json({ error: "SNAPSHOT_EXPORT_NOT_INCLUDED_IN_PLAN" }, { status: 403 });
  }

  let body: SnapshotSendRequest;

  try {
    body = (await request.json()) as SnapshotSendRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (
    (body.destinationType !== "customer" && body.destinationType !== "carrier") ||
    !body.recipientEmail ||
    !EMAIL_PATTERN.test(body.recipientEmail) ||
    !body.subject?.trim() ||
    !body.message?.trim() ||
    !body.snapshot
  ) {
    return NextResponse.json({ error: "Snapshot send request is incomplete." }, { status: 400 });
  }

  console.info("[snapshot_send_attempt]", buildSnapshotSendSafeEvent({
    snapshot: body.snapshot,
    destinationType: body.destinationType,
    hasPdf: Boolean(body.pdfBase64),
  }));

  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.SNAPSHOT_FROM_EMAIL || process.env.RESEND_FROM_EMAIL;

  if (!resendApiKey || !fromEmail) {
    return NextResponse.json({
      ok: true,
      deliveryMode: "manual",
      message: "Email provider is not configured. Download the PDF and send manually.",
    });
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [body.recipientEmail],
      subject: body.subject,
      text: body.message,
      attachments: body.pdfBase64
        ? [
            {
              filename: "collision-snapshot.pdf",
              content: body.pdfBase64,
            },
          ]
        : undefined,
    }),
  });

  if (!response.ok) {
    return NextResponse.json({ error: "Email send failed." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, deliveryMode: "email" });
}
