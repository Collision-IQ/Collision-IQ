import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import { promoteLearningItem } from "@/lib/learning/promotionGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Platform-Admin-only promotion. `approvedBy` is ALWAYS the authenticated
 * admin from the session — it is never accepted from the request body, so
 * model-generated text can never approve itself.
 */
export async function POST(request: NextRequest) {
  try {
    const { user, email, isPlatformAdmin } = await requireCurrentUser();
    if (!isPlatformAdmin) {
      return NextResponse.json({ error: "Platform admin access is required." }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as {
      itemId?: unknown;
      benchmarkRunId?: unknown;
      notes?: unknown;
    } | null;
    const itemId = typeof body?.itemId === "string" ? body.itemId.trim() : "";
    const benchmarkRunId = typeof body?.benchmarkRunId === "string" ? body.benchmarkRunId.trim() : "";
    if (!itemId || !benchmarkRunId) {
      return NextResponse.json({ error: "itemId and benchmarkRunId are required." }, { status: 400 });
    }

    const result = await promoteLearningItem({
      itemId,
      benchmarkRunId,
      approvedBy: email ?? user.email ?? user.id,
      notes: typeof body?.notes === "string" ? body.notes.slice(0, 2000) : undefined,
    });

    return NextResponse.json(result, { status: result.promoted ? 200 : 422 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[learning-promote] failed", { message: error instanceof Error ? error.message : "Unknown" });
    return NextResponse.json({ error: "Promotion failed." }, { status: 500 });
  }
}
