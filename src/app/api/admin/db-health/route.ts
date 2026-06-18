import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { hasClerkConfig } from "@/lib/auth/config";
import {
  isPlatformAdminEmailList,
  normalizeEmail,
} from "@/lib/auth/platform-admin";
import { checkDatabaseHealth } from "@/lib/database/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!hasClerkConfig()) {
      return NextResponse.json({ error: "Authentication is not configured." }, { status: 401 });
    }

    const state = await auth();
    if (!state.userId) {
      return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
    }

    const clerkUser = await currentUser();
    const emails = [
      clerkUser?.primaryEmailAddress?.emailAddress,
      ...(clerkUser?.emailAddresses ?? []).map((email) => email.emailAddress),
    ]
      .map((email) => normalizeEmail(email))
      .filter(Boolean);

    if (!isPlatformAdminEmailList(emails)) {
      return NextResponse.json({ error: "Platform admin access is required." }, { status: 403 });
    }

    const result = await checkDatabaseHealth();
    return NextResponse.json(
      {
        ok: result.prisma.ok,
        database: result,
      },
      {
        status: result.prisma.ok ? 200 : 503,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error("[db-health] failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Database health check failed." }, { status: 500 });
  }
}
