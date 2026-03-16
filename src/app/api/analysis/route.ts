import { NextResponse } from "next/server";
import { saveAnalysisReport } from "@/lib/analysisReportStore";
import { runRepairAnalysis } from "@/lib/ai/orchestrator/analysisOrchestrator";

export const runtime = "nodejs";

type AnalysisRequestBody = {
  artifactIds?: string[];
  sessionContext?: {
    vehicleMake?: string | null;
    system?: string | null;
    component?: string | null;
    procedure?: string | null;
  } | null;
  userIntent?: string | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AnalysisRequestBody;
    const artifactIds = body.artifactIds ?? [];

    if (!artifactIds.length) {
      return NextResponse.json(
        { error: "artifactIds are required" },
        { status: 400 }
      );
    }

    const report = await runRepairAnalysis({
      artifactIds,
      sessionContext: body.sessionContext ?? null,
      userIntent: body.userIntent ?? null,
    });

    const stored = saveAnalysisReport({
      artifactIds,
      report,
    });

    return NextResponse.json({
      reportId: stored.id,
      createdAt: stored.createdAt,
      report: stored.report,
    });
  } catch (error) {
    console.error("ANALYSIS ERROR:", error);
    return NextResponse.json(
      { error: "Analysis failed" },
      { status: 500 }
    );
  }
}
