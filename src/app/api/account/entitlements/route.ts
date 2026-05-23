import { NextResponse } from "next/server";
import { UnauthorizedError, requireCurrentUser } from "@/lib/auth/require-current-user";
import {
  getCurrentEntitlements,
  toAccountEntitlements,
} from "@/lib/billing/entitlements";
import { buildAnonymousAccess } from "@/lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { user, verifiedEmails, isPlatformAdmin } = await requireCurrentUser();
    const entitlements = await getCurrentEntitlements({
      userEmail: user.email,
      userEmails: verifiedEmails,
      isPlatformAdmin,
    });
    return NextResponse.json(entitlements);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(toAccountEntitlements(buildAnonymousAccess()));
    }

    throw error;
  }
}
