import { NextResponse } from "next/server";
import { getOrCreateAppUser } from "@/lib/auth/get-or-create-app-user";
import { getBillingReturnUrl, getStripe } from "@/lib/billing/stripe";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const dbUser = await getOrCreateAppUser();
  if (!dbUser) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }

  const subscription = await prisma.subscription.findFirst({
    where: {
      userId: dbUser.id,
      stripeCustomerId: {
        not: null,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!subscription?.stripeCustomerId) {
    return NextResponse.redirect(getBillingReturnUrl("/billing"), 303);
  }

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: getBillingReturnUrl("/billing"),
  });

  return NextResponse.redirect(session.url, 303);
}
