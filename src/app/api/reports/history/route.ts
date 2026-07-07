import { NextResponse } from "next/server";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";
import {
  canUseReportMemory,
  REPORT_MEMORY_REQUIRED_MESSAGE,
} from "@/lib/billing/proFeatures";
import { listAnalysisReportSummaries } from "@/lib/analysisReportStore";

export const runtime = "nodejs";

/**
 * Per-user report history (Report Memory). Scoped strictly to the signed-in
 * user's own reports (ownerUserId = user.id, no shop scope), so one user can
 * never read another user's analyses. Requires authentication, and report
 * memory is a Starter/Pro/Team/Admin capability — free plans get 403.
 */
export async function GET() {
  try {
    const { user, isPlatformAdmin } = await requireCurrentUser();
    const entitlements = await getCurrentEntitlements({ isPlatformAdmin });
    if (!canUseReportMemory(entitlements)) {
      return NextResponse.json(
        { ok: false, error: REPORT_MEMORY_REQUIRED_MESSAGE },
        { status: 403 }
      );
    }
    const reports = await listAnalysisReportSummaries(
      { ownerUserId: user.id },
      { limit: 50 }
    );
    return NextResponse.json({ ok: true, reports }, { status: 200 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[reports-history] failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ ok: false, error: "HISTORY_UNAVAILABLE" }, { status: 502 });
  }
}
