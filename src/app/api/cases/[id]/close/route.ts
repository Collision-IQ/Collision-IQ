import { NextResponse } from "next/server";
import { closeAnalysisReport } from "@/lib/analysisReportStore";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requireCurrentUser();
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "Missing case id" }, { status: 400 });
    }

    const closed = await closeAnalysisReport({
      id,
      ownerUserId: user.id,
    });

    if (!closed) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      caseId: closed.id,
      closedAt: closed.report.ingestionMeta?.closedAt ?? null,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("CASE_CLOSE_ERROR", error);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}
