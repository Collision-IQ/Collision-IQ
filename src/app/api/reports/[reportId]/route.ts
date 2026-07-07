import { NextResponse } from "next/server";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";
import {
  canUseProIntegrations,
  canUseReportMemory,
  REPORT_MEMORY_REQUIRED_MESSAGE,
} from "@/lib/billing/proFeatures";
import { getAnalysisReport } from "@/lib/analysisReportStore";
import { getUploadedAttachments } from "@/lib/uploadedAttachmentStore";
import { buildReportMemoryDetail, REPORT_MEMORY_OPEN_ERROR } from "@/lib/reports/reportMemory";

// Report Memory detail endpoint. Access is enforced server-side:
// - Auth required; free/basic plans have no report memory (403).
// - Reports resolve ONLY within the signed-in user's owner scope, so another
//   user's report id can never be opened by changing the URL (404).
// - Missing source attachments never block opening the saved report.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ reportId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { user, isPlatformAdmin } = await requireCurrentUser();
    const entitlements = await getCurrentEntitlements({ isPlatformAdmin });
    if (!canUseReportMemory(entitlements)) {
      return NextResponse.json(
        { ok: false, error: REPORT_MEMORY_REQUIRED_MESSAGE },
        { status: 403 }
      );
    }

    const { reportId } = await context.params;
    if (!reportId?.trim()) {
      return NextResponse.json({ ok: false, error: "A report id is required." }, { status: 400 });
    }

    // Owner-scoped lookup — resolves only the caller's own reports.
    const stored = await getAnalysisReport(reportId.trim(), { ownerUserId: user.id });
    if (!stored) {
      return NextResponse.json({ ok: false, error: "Report not found." }, { status: 404 });
    }

    // Attachment availability is best-effort: retrieval failure or deleted
    // files degrade to "unavailable" markers, never a failed open.
    const availableAttachments = await getUploadedAttachments(stored.artifactIds ?? [], {
      ownerUserId: user.id,
    })
      .then((attachments) =>
        attachments.map((attachment) => ({
          id: attachment.id,
          filename: attachment.filename,
          type: attachment.type,
        }))
      )
      .catch(() => []);

    const detail = buildReportMemoryDetail({
      stored,
      ownerUserId: user.id,
      availableAttachments,
      presentation: canUseProIntegrations(entitlements) ? "pro" : "customer",
      canExport: Boolean(entitlements.canUseBasicExports),
    });

    return NextResponse.json(
      { ok: true, detail },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[report-memory] open failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ ok: false, error: REPORT_MEMORY_OPEN_ERROR }, { status: 500 });
  }
}
