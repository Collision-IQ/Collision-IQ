import { NextResponse } from "next/server";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import { getLearningDashboardMetrics } from "@/lib/learning/dashboardMetrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Platform-Admin-only weekly metrics / mastery dashboard payload. */
export async function GET() {
  try {
    const { isPlatformAdmin } = await requireCurrentUser();
    if (!isPlatformAdmin) {
      return NextResponse.json({ error: "Platform admin access is required." }, { status: 403 });
    }
    const metrics = await getLearningDashboardMetrics();
    return NextResponse.json(metrics, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[learning-metrics] failed", { message: error instanceof Error ? error.message : "Unknown" });
    return NextResponse.json({ error: "Learning metrics failed." }, { status: 500 });
  }
}
