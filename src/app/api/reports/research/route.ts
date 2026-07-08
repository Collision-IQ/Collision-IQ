import { NextRequest, NextResponse } from "next/server";
import {
  buildExportResearchSnapshot,
  persistExportResearchAuditSnapshot,
  type ResearchableExportType,
} from "@/lib/ai/exportResearch";
import type { RepairIntelligenceReport } from "@/lib/ai/types/analysis";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import { getAnalysisReport } from "@/lib/analysisReportStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Authority research + retrieval; raise above the short Vercel default to avoid timeouts.
export const maxDuration = 800;

const RESEARCHABLE_TYPES: ResearchableExportType[] = [
  "policy_rights_review",
  "estimate_scrubber",
  "doi_complaint_packet",
  "oem_contradiction_detection",
  "repair_intelligence",
];

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireCurrentUser();
    const body = (await request.json().catch(() => null)) as {
      reportType?: unknown;
      caseId?: unknown;
      report?: unknown;
    } | null;
    const reportType = coerceReportType(body?.reportType);
    if (!reportType) {
      return NextResponse.json({ error: "Unsupported research report type." }, { status: 400 });
    }

    const caseId = typeof body?.caseId === "string" && body.caseId.trim() ? body.caseId.trim() : null;
    const stored = caseId
      ? await getAnalysisReport(caseId, { ownerUserId: user.id })
      : null;
    const report = stored?.report ?? coerceReport(body?.report);
    if (!report) {
      return NextResponse.json({ error: "Report context is required for export research." }, { status: 400 });
    }

    const snapshot = await buildExportResearchSnapshot({
      reportType,
      report,
      caseId,
    });

    await persistExportResearchAuditSnapshot({
      caseId,
      snapshot,
    }).catch((error) => {
      console.warn("[export-research] audit persistence failed", {
        reportType,
        caseId,
        message: error instanceof Error ? error.message : "Unknown persistence error",
      });
    });

    return NextResponse.json({ snapshot }, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[export-research] failed", {
      message: error instanceof Error ? error.message : "Unknown export research error",
    });
    return NextResponse.json({ error: "Export research failed." }, { status: 500 });
  }
}

function coerceReportType(value: unknown): ResearchableExportType | null {
  return typeof value === "string" && RESEARCHABLE_TYPES.includes(value as ResearchableExportType)
    ? (value as ResearchableExportType)
    : null;
}

function coerceReport(value: unknown): RepairIntelligenceReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<RepairIntelligenceReport>;
  if (!candidate.summary || !Array.isArray(candidate.issues)) {
    return null;
  }

  return candidate as RepairIntelligenceReport;
}
