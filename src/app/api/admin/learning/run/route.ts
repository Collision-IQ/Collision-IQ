import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import { runDailyLearningSprint } from "@/lib/learning/runDailyLearningSprint";
import { runHoldoutBenchmark } from "@/lib/learning/weeklyBenchmark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Platform-Admin-only: run due learning items (daily sprint) or a holdout
 * benchmark run. The learning engine is admin-only during the 90-day
 * qualification period and is entirely separate from user report memory.
 */
export async function POST(request: NextRequest) {
  try {
    const { isPlatformAdmin } = await requireCurrentUser();
    if (!isPlatformAdmin) {
      return NextResponse.json({ error: "Platform admin access is required." }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      kind?: unknown;
      limit?: unknown;
      label?: unknown;
    };
    const limit = Number.isFinite(body.limit) ? Math.min(Math.max(Number(body.limit), 1), 200) : 50;

    if (body.kind === "benchmark" || body.kind === "holdout") {
      const result = await runHoldoutBenchmark({
        kind: "HOLDOUT",
        label: typeof body.label === "string" && body.label.trim() ? body.label.trim() : `holdout-${new Date().toISOString().slice(0, 10)}`,
        limit,
      });
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }

    const result = await runDailyLearningSprint(limit);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[learning-run] failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Learning run failed." }, { status: 500 });
  }
}
