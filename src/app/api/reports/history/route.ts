import { NextResponse } from "next/server";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";
import { listAnalysisReportSummaries } from "@/lib/analysisReportStore";

export const runtime = "nodejs";

/**
 * Per-user report history. Scoped strictly to the signed-in user's own reports
 * (ownerUserId = user.id, no shop scope), so one user can never read another
 * user's analyses. Requires authentication — no guest access.
 */
export async function GET() {
  try {
    const { user } = await requireCurrentUser();
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
