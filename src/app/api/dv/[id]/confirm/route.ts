// Verifies a completed Stripe Checkout session and marks the DV request paid.
//
// The client returns from Stripe with a session id; nothing about that id is
// trusted. The session is retrieved from Stripe server-side and must (a) be
// paid, (b) name this exact request in its metadata, and (c) belong to the
// signed-in user. The webhook independently records the AcademyServiceCase for
// the human review queue — this route only unlocks generation.

import { NextResponse } from "next/server";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import { getStripe } from "@/lib/billing/stripe";
import { getDvRequest, markDvRequestPaid } from "@/lib/dv/store";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let viewer: Awaited<ReturnType<typeof requireCurrentUser>>;
  try {
    viewer = await requireCurrentUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }
    throw error;
  }

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { sessionId?: string } | null;
  const sessionId = body?.sessionId?.trim();
  if (!sessionId || !sessionId.startsWith("cs_")) {
    return NextResponse.json({ error: "Missing checkout session id" }, { status: 400 });
  }

  const request = await getDvRequest(id, {
    userId: viewer.user.id,
    isPlatformAdmin: viewer.isPlatformAdmin,
  });
  if (!request) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (request.paidAt) {
    return NextResponse.json({ request });
  }

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId).catch(() => null);
  if (!session) {
    return NextResponse.json({ error: "Checkout session not found" }, { status: 404 });
  }

  if (session.payment_status !== "paid") {
    return NextResponse.json(
      { error: "Payment has not completed for this checkout session." },
      { status: 402 }
    );
  }
  if (session.metadata?.dvRequestId !== id) {
    return NextResponse.json(
      { error: "Checkout session does not belong to this request." },
      { status: 403 }
    );
  }
  if (session.metadata?.userId && session.metadata.userId !== request.userId) {
    return NextResponse.json(
      { error: "Checkout session does not belong to this account." },
      { status: 403 }
    );
  }

  const updated = await markDvRequestPaid({ id, stripeSessionId: session.id });
  if (!updated) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  return NextResponse.json({ request: updated });
}
