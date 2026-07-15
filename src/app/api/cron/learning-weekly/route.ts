import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import { runHoldoutBenchmark } from "@/lib/learning/weeklyBenchmark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron entry for the weekly holdout benchmark + scorecard. Authorized by
 * CRON_SECRET bearer (Vercel Cron) or an authenticated Platform Admin.
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
    const result = await runHoldoutBenchmark({
      kind: "WEEKLY",
      label: `weekly-${new Date().toISOString().slice(0, 10)}`,
      limit: 100,
    });
    console.info("[learning-cron] weekly benchmark complete", {
      runId: result.runId,
      items: result.metrics.itemCount,
      regressions: result.regressions,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[learning-cron] weekly benchmark failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Weekly learning benchmark failed." }, { status: 500 });
  }
}
