"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import ChatWidget from "@/components/ChatWidget";
import { buildDecisionPanel, type DecisionPanel } from "@/lib/ai/builders/buildDecisionPanel";
import { buildCarrierReport } from "@/lib/ai/builders/carrierPdfBuilder";
import { exportCarrierPDF } from "@/lib/ai/builders/exportPdf";
import type {
  AnalysisFinding,
  AnalysisResult,
  RepairIntelligenceReport,
} from "@/lib/ai/types/analysis";
import { useIsMobile } from "@/hooks/useIsMobile";

const EMPTY_PANEL: DecisionPanel = {
  narrative:
    "Upload an estimate or supporting documents to generate a real repair intelligence read. The panel will switch from placeholder guidance to decision support once the analysis route runs.",
  supplements: [],
};

export default function ChatbotPage() {
  const isMobile = useIsMobile();
  const [desktopRailOpen, setDesktopRailOpen] = useState(false);
  const [attachment, setAttachment] = useState<string | null>(null);
  const [analysisText, setAnalysisText] = useState("");
  const [analysisResult, setAnalysisResult] = useState<RepairIntelligenceReport | null>(null);
  const normalizedResult = useMemo(
    () => (analysisResult ? normalizeReportToAnalysisResult(analysisResult) : null),
    [analysisResult]
  );

  const panel = useMemo(
    () => (normalizedResult ? buildDecisionPanel(normalizedResult) : EMPTY_PANEL),
    [normalizedResult]
  );
  const railOpen = isMobile ? false : desktopRailOpen;

  function handleRailOpenChange(next: boolean) {
    if (isMobile) return;
    setDesktopRailOpen(next);
  }

  if (isMobile === null) return null;

  return (
    <div className="h-screen bg-black text-white flex flex-col">
      <header className="px-6 py-4 border-b border-white/10 bg-black/60 backdrop-blur-md">
        <div className="flex items-center justify-center gap-4 max-w-[1400px] mx-auto">
          <Image
            src="/brand/logos/Logo-grey.png"
            alt="Collision Academy"
            width={150}
            height={40}
            className="opacity-90"
            priority
          />

          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-white to-white/70 bg-clip-text text-transparent">
              Collision-IQ
            </h1>

            <p className="text-xs text-white/50">
              Repair intelligence for estimates, OEM procedures, and damage photos
            </p>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 w-full max-w-[1400px] mx-auto">
        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex-1 min-h-0 flex justify-center">
            <div className="flex flex-col w-full max-w-[900px] min-h-0">
              <ChatWidget
                onAttachmentChange={setAttachment}
                onAnalysisChange={setAnalysisText}
                onAnalysisResultChange={setAnalysisResult}
              />
            </div>
          </div>
        </div>

        {!isMobile && (
          <aside className="w-[360px] border-l border-white/10 bg-black/70 backdrop-blur-xl flex flex-col">
            <RailContent
              attachment={attachment}
              analysisText={analysisText}
              panel={panel}
              normalizedResult={normalizedResult}
              analysisResult={analysisResult}
            />
          </aside>
        )}
      </div>

      {isMobile && !railOpen && (
        <button
          onClick={() => handleRailOpenChange(true)}
          className="fixed bottom-6 right-6 rounded-full bg-orange-500 hover:bg-orange-600 px-5 py-3 text-white shadow-lg z-50"
        >
          Insights
        </button>
      )}

      {isMobile && railOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xl z-50">
          <button
            onClick={() => handleRailOpenChange(false)}
            className="absolute top-4 right-4 text-white text-xl"
          >
            X
          </button>

          <RailContent
            attachment={attachment}
            analysisText={analysisText}
            panel={panel}
            normalizedResult={normalizedResult}
            analysisResult={analysisResult}
          />
        </div>
      )}
    </div>
  );
}

function RailContent({
  attachment,
  analysisText,
  panel,
  normalizedResult,
  analysisResult,
}: {
  attachment: string | null;
  analysisText: string;
  panel: DecisionPanel;
  normalizedResult: AnalysisResult | null;
  analysisResult: RepairIntelligenceReport | null;
}) {
  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 space-y-8">
      <div>
        <div className="text-xs tracking-[0.3em] uppercase text-white/60">
          Decision Support
        </div>

        <div className="text-xl font-semibold mt-1">Analysis</div>

        {attachment && (
          <div className="mt-2 text-xs text-white/40 truncate">
            Latest attachment: {attachment}
          </div>
        )}
      </div>

      <DecisionSection title="What Stands Out" body={panel.narrative} tone="neutral" />

      <section className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="text-[11px] uppercase tracking-[0.2em] text-white/45">
          Supplement Lines
        </div>
        {panel.supplements.length > 0 ? (
          <div className="space-y-3">
            {panel.supplements.map((item, index) => (
              <div key={`${item.title}-${index}`} className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="text-sm font-medium text-white">
                  {item.mappedLabel || item.title}
                </div>
                <div className="mt-1 text-xs text-white/60">{item.category}</div>
                <div className="mt-2 text-sm leading-6 text-white/80">{item.rationale}</div>
                {item.support && (
                  <div className="mt-2 text-xs leading-5 text-white/45">{item.support}</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-white/45">
            No supplement items were generated from the current analysis yet.
          </div>
        )}
      </section>

      {panel.diminishedValue && (
        <DecisionSection
          title="DV Value"
          body={`$${panel.diminishedValue.low} - $${panel.diminishedValue.high}\nConfidence: ${formatLabel(
            panel.diminishedValue.confidence
          )}\n\nReason:\n${panel.diminishedValue.rationale}`}
          tone="green"
        />
      )}

      {panel.negotiationResponse && (
        <DecisionSection
          title="Negotiation Draft"
          body={panel.negotiationResponse}
          tone="neutral"
          mono
        />
      )}

      {panel.appraisal?.triggered && panel.appraisal.reasoning && (
        <DecisionSection
          title="Appraisal Signal"
          body={panel.appraisal.reasoning}
          tone="red"
        />
      )}

      {panel.stateLeverage && panel.stateLeverage.length > 0 && (
        <DecisionSection
          title="State Leverage"
          body={panel.stateLeverage.map((point) => `- ${point}`).join("\n")}
          tone="yellow"
        />
      )}

      {(analysisText || panel.narrative) && (
        <button
          onClick={() =>
            exportReport(normalizedResult, analysisResult, panel, analysisText)
          }
          className="mt-4 w-full rounded-md border border-white/10 bg-white/5 hover:bg-white/10 p-3 text-xs"
        >
          Export PDF
        </button>
      )}
    </div>
  );
}

function exportReport(
  normalizedResult: AnalysisResult | null,
  analysisResult: RepairIntelligenceReport | null,
  panel: DecisionPanel,
  analysisText: string
) {
  const reportText =
    normalizedResult && analysisResult
      ? buildCarrierReport({
          result: normalizedResult,
          meta: {
            vehicle: [
              analysisResult.vehicle?.year,
              analysisResult.vehicle?.make,
              analysisResult.vehicle?.model,
            ]
              .filter(Boolean)
              .join(" "),
            vin: analysisResult.vehicle?.vin,
            year: analysisResult.vehicle?.year,
          },
        })
      : [
          "Narrative",
          panel.narrative,
          panel.supplements.length > 0
            ? `Supplement Items\n\n${panel.supplements
                .map(
                  (item) =>
                    `- ${item.title}\n  Reason: ${item.rationale}${
                      item.mappedLabel ? `\n  Mapped Line: ${item.mappedLabel}` : ""
                    }`
                )
                .join("\n\n")}`
            : "",
          panel.diminishedValue
            ? `Diminished Value\n\n$${panel.diminishedValue.low} - $${panel.diminishedValue.high}\nConfidence: ${formatLabel(
                panel.diminishedValue.confidence
              )}\n\n${panel.diminishedValue.rationale}`
            : "",
          panel.negotiationResponse
            ? `Negotiation Response\n\n${panel.negotiationResponse}`
            : "",
          panel.appraisal?.triggered && panel.appraisal.reasoning
            ? `Appraisal Signal\n\n${panel.appraisal.reasoning}`
            : "",
          panel.stateLeverage && panel.stateLeverage.length > 0
            ? `State Leverage\n\n${panel.stateLeverage
                .map((point) => `- ${point}`)
                .join("\n")}`
            : "",
          analysisText ? `Assistant Analysis\n\n${analysisText}` : "",
        ]
          .filter(Boolean)
          .join("\n\n----------------------------------------\n\n");

  exportCarrierPDF(reportText);
}

function DecisionSection({
  title,
  body,
  tone,
  mono = false,
}: {
  title: string;
  body: string;
  tone: "red" | "yellow" | "green" | "neutral";
  mono?: boolean;
}) {
  const tones = {
    red: "border-red-500/30 bg-red-500/5",
    yellow: "border-yellow-500/30 bg-yellow-500/5",
    green: "border-green-500/30 bg-green-500/5",
    neutral: "border-white/10 bg-white/5",
  };

  return (
    <section className={`rounded-xl border p-4 space-y-3 ${tones[tone]}`}>
      <div className="text-[11px] uppercase tracking-[0.2em] text-white/45">{title}</div>
      <div className={`text-sm leading-6 text-white/85 whitespace-pre-wrap ${mono ? "font-mono text-[12px]" : ""}`}>
        {body}
      </div>
    </section>
  );
}

function formatLabel(value: string) {
  if (!value) return "--";
  return value.charAt(0).toUpperCase() + value.slice(1);
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
