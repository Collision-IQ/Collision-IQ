import OpenAI from "openai";
import { NextResponse } from "next/server";
import { saveAnalysisReport } from "@/lib/analysisReportStore";
import { buildDecisionPanelHybrid } from "@/lib/ai/builders/buildDecisionPanel";
import { runRepairAnalysis } from "@/lib/ai/orchestrator/analysisOrchestrator";
import type {
  AnalysisFinding,
  AnalysisResult,
  RepairIntelligenceReport,
} from "@/lib/ai/types/analysis";

export const runtime = "nodejs";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

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
    const analysis = normalizeReportToAnalysisResult(report);
    const supplementCandidates = await generateSupplementCandidates(
      analysis.rawEstimateText ?? "",
      report
    );
    const panel = await buildDecisionPanelHybrid({
      result: analysis,
      supplementCandidates,
      supplementContext: {
        requiredProcedures: report.requiredProcedures.map((entry) => entry.procedure),
        presentProcedures: report.presentProcedures,
        missingProcedures: report.missingProcedures,
      },
    });

    const stored = saveAnalysisReport({
      artifactIds,
      report,
    });

    return NextResponse.json({
      reportId: stored.id,
      createdAt: stored.createdAt,
      report: stored.report,
      panel,
    });
  } catch (error) {
    console.error("ANALYSIS ERROR:", error);
    return NextResponse.json(
      { error: "Analysis failed" },
      { status: 500 }
    );
  }
}

async function generateSupplementCandidates(
  text: string,
  report: RepairIntelligenceReport
) {
  if (!text.trim()) return [];

  const requiredProcedures = report.requiredProcedures
    .map((entry) => `- ${entry.procedure}`)
    .join("\n");
  const presentProcedures = report.presentProcedures
    .map((entry) => `- ${entry}`)
    .join("\n");
  const missingProcedures = report.missingProcedures
    .map((entry) => `- ${entry}`)
    .join("\n");

  const response = await openai.responses.create({
    model: "gpt-4o",
    temperature: 0.2,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: `You are reviewing a collision repair estimate.

Use the vehicle-specific required procedure context below to decide what functions are not clearly represented.

Important:
- Do NOT assume every vehicle has the same ADAS systems
- Do NOT suggest front camera, radar, blind spot, or other ADAS calibrations unless they are supported by the required procedure context
- If a function is already represented in the estimate or present-procedure list, do NOT include it
- Only flag items that are truly unclear or absent

Return JSON only:
[
  {
    "title": "",
    "reason": ""
  }
]`,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `[Estimate Text]
${text}

[Vehicle-Specific Required Procedures From Drive/OEM]
${requiredProcedures || "- None provided"}

[Procedures Already Represented]
${presentProcedures || "- None documented"}

[Procedures Already Identified As Missing]
${missingProcedures || "- None identified"}`,
          },
        ],
      },
    ],
  });

  try {
    const output =
      "output_text" in response && typeof response.output_text === "string"
        ? response.output_text
        : "[]";
    return JSON.parse(output) as Array<{ title: string; reason: string }>;
  } catch {
    return [];
  }
}

function normalizeReportToAnalysisResult(
  report: RepairIntelligenceReport
): AnalysisResult {
  if (report.analysis) {
    return report.analysis;
  }

  const findings: AnalysisFinding[] = [
    ...report.issues.map((issue, index) => {
      const bucket: AnalysisFinding["bucket"] =
        issue.category === "parts"
          ? "parts"
          : issue.category === "calibration" || issue.category === "scan"
            ? "adas"
            : issue.category === "safety"
              ? "critical"
              : "compliance";
      const status: AnalysisFinding["status"] = issue.missingOperation
        ? "not_detected"
        : "unclear";

      return {
        id: issue.id || `report-issue-${index + 1}`,
        bucket,
        category: issue.category,
        title: issue.title,
        detail: issue.impact || issue.finding,
        severity: issue.severity,
        status,
        evidence: [],
      };
    }),
    ...report.missingProcedures.map((procedure, index) => ({
      id: `report-missing-${index + 1}`,
      bucket: "supplement" as const,
      category: "missing_procedure",
      title: procedure,
      detail: "This function is not clearly represented in the current estimate.",
      severity: "medium" as const,
      status: "not_detected" as const,
      evidence: [],
    })),
  ];

  return {
    mode: "single-document-review",
    parserStatus: "ok",
    summary: {
      riskScore: report.summary.riskScore,
      confidence: report.summary.confidence,
      criticalIssues: report.summary.criticalIssues,
      evidenceQuality: report.summary.evidenceQuality,
    },
    findings,
    supplements: findings.filter((finding) => finding.bucket === "supplement"),
    evidence: report.evidence.map((entry) => ({
      source: entry.source,
      quote: entry.snippet,
    })),
    operations: [],
    rawEstimateText: report.evidence.map((entry) => entry.snippet).join("\n"),
    narrative:
      report.recommendedActions[0] ||
      "The estimate needs clearer repair support before it can be treated as fully defended.",
  };
}
