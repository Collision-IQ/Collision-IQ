import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import { runDailyLearningSprint } from "@/lib/learning/runDailyLearningSprint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron entry for the daily learning sprint. Authorized by CRON_SECRET bearer
 * (Vercel Cron) or, as a manual fallback, an authenticated Platform Admin.
 */
async function isAuthorizedCronRequest(request: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const header = request.headers.get("authorization") ?? "";
    if (header === `Bearer ${secret}`) return true;
  }
  try {
    const { isPlatformAdmin } = await requireCurrentUser();
    return isPlatformAdmin;
  } catch (error) {
    if (error instanceof UnauthorizedError) return false;
    throw error;
  }
}

export async function GET(request: NextRequest) {
  try {
    if (!(await isAuthorizedCronRequest(request))) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const result = await runDailyLearningSprint(50);
    console.info("[learning-cron] daily sprint complete", { reviewed: result.reviewed });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[learning-cron] daily sprint failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Daily learning sprint failed." }, { status: 500 });
  }
}
