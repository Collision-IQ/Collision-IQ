import OpenAI from "openai";
import { NextResponse } from "next/server";
import { saveAnalysisReport } from "@/lib/analysisReportStore";
import { buildDecisionPanelHybrid } from "@/lib/ai/builders/buildDecisionPanel";
import { normalizeReportToAnalysisResult } from "@/lib/ai/builders/normalizeReportToAnalysisResult";
import { runRepairAnalysis } from "@/lib/ai/orchestrator/analysisOrchestrator";
import type {
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
