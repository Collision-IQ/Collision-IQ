"use client";

import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { formatAssistantMessage } from "@/components/chatWidget/speechUtils";
import { resolveFinancialView } from "@/components/chatbot/financialView";
import type { InsightKey } from "@/components/chatbot/insightSync";
import type { ExportModel } from "@/lib/ai/builders/buildExportModel";
import type { AnalysisResult, RepairIntelligenceReport } from "@/lib/ai/types/analysis";
import type { WorkspaceData } from "@/types/workspaceTypes";
import AnalysisSectionCard from "@/components/AnalysisSectionCard";

type AttachmentTrayItem = {
  attachmentId: string;
  filename: string;
  hasVision?: boolean;
};

type Props = {
  analysisText: string;
  renderModel: ExportModel;
  normalizedResult: AnalysisResult | null;
  analysisResult: RepairIntelligenceReport | null;
  workspaceData: WorkspaceData | null;
  attachments: AttachmentTrayItem[];
  hasResolvedAnalysis: boolean;
  activeInsightKey: InsightKey | null;
  onActiveInsightChange: (key: InsightKey | null) => void;
  onCenterScrollRequest?: (scrollTo: (key: InsightKey) => void) => void;
  canRenderExports?: boolean;
  onContinueChat?: () => void;
  onRequestEndAnalysis?: () => void;
  onConfirmEndAnalysis?: () => void;
  onCancelEndAnalysis?: () => void;
  endAnalysisConfirming?: boolean;
};

type SectionData = {
  insightKey: InsightKey;
  title: string;
  eyebrow: string;
  summary: string;
  defaultExpanded?: boolean;
  bullets: string[];
  prose?: string;
};

function formatLabel(value: string | undefined | null): string {
  if (!value) return "Pending";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function dedupe(items: Array<string | undefined | null>) {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const normalized = item?.replace(/\s+/g, " ").trim();
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

export default function StructuredAnalysisCanvas({
  analysisText,
  renderModel,
  normalizedResult,
  analysisResult,
  workspaceData,
  attachments,
  hasResolvedAnalysis,
  activeInsightKey,
  onActiveInsightChange,
  onCenterScrollRequest,
  canRenderExports = false,
  onContinueChat,
  onRequestEndAnalysis,
  onConfirmEndAnalysis,
  onCancelEndAnalysis,
  endAnalysisConfirming = false,
}: Props) {
  const centerSectionRefs = useRef<Partial<Record<InsightKey, HTMLDivElement | null>>>({});

  function scrollToCenterSection(key: InsightKey) {
    const node = centerSectionRefs.current[key];
    if (!node) return;

    node.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  useEffect(() => {
    onCenterScrollRequest?.(scrollToCenterSection);
  }, [onCenterScrollRequest]);

  if (!hasResolvedAnalysis) {
    return null;
  }

  const supportBullets = dedupe([
    ...renderModel.reportFields.presentStrengths,
    ...renderModel.disputeIntelligenceReport.positives,
    ...(analysisResult?.presentProcedures ?? []),
  ]).slice(0, 6);

  const missingBullets = dedupe([
    ...renderModel.disputeIntelligenceReport.supportGaps,
    ...(workspaceData?.keyIssues ?? []),
    ...(analysisResult?.missingProcedures ?? []),
    ...renderModel.supplementItems.slice(0, 5).map((item) => `${item.title}: ${item.rationale}`),
  ]).slice(0, 6);

  const nextMoveBullets = dedupe([
    ...renderModel.disputeIntelligenceReport.nextMoves,
    ...(analysisResult?.recommendedActions ?? []),
    ...renderModel.negotiationPlaybook.suggestedSequence,
  ]).slice(0, 6);
  const financialView = resolveFinancialView({
    renderModel,
    normalizedResult,
    workspaceData,
  });

  const executiveBullets = dedupe([
    renderModel.positionStatement,
    renderModel.disputeIntelligenceReport.summary,
  ]).slice(0, 4);

  const sections: SectionData[] = [
    {
      insightKey: "executive_summary",
      title: "Executive Summary",
      eyebrow: "Case Read",
      summary: "Fast read of the current position, exposure, and repair posture.",
      defaultExpanded: true,
      bullets: executiveBullets,
      prose: renderModel.repairPosition,
    },
    {
      insightKey: "support_strengths",
      title: "What Supports the Repair Path",
      eyebrow: "Support",
      summary: "The strongest facts already supporting the current estimate or repair direction.",
      bullets: supportBullets,
    },
    {
      insightKey: "support_gaps",
      title: "What Looks Missing or Underwritten",
      eyebrow: "Exposure",
      summary: "The main omissions, support gaps, or underwritten items worth pressing on.",
      bullets: missingBullets,
    },
    {
      insightKey: "financial_view",
      title: "Financial / Valuation View",
      eyebrow: "Financial View",
      summary: "Directional total-loss, gap, or valuation posture from the current material.",
      bullets: financialView.kind === "unavailable" ? [] : financialView.bullets,
      prose: financialView.kind === "unavailable" ? financialView.narrative : financialView.narrative,
    },
    {
      insightKey: "next_moves",
      title: "Recommended Next Moves",
      eyebrow: "Next Moves",
      summary: "The clearest actions to strengthen support, negotiation posture, and outputs.",
      bullets: nextMoveBullets,
      prose: "Formal exports and carrier-ready outputs remain available in the right rail.",
    },
  ].filter((section) => section.bullets.length > 0 || section.prose);

  const caseLabel =
    renderModel.vehicle.label || renderModel.reportFields.vehicleLabel || "Vehicle still being resolved";
  const latestFile = attachments[attachments.length - 1]?.filename ?? "No attachment yet";
  const issueCount =
    analysisResult?.issues.length ??
    normalizedResult?.findings.length ??
    renderModel.supplementItems.length;
  const focusModeActive = activeInsightKey !== null;

  return (
    <div className="mt-3 space-y-3">
      <section className="rounded-[24px] border border-white/8 bg-gradient-to-br from-[#C65A2A]/10 via-white/[0.035] to-black/25 p-4 shadow-[0_18px_44px_rgba(0,0,0,0.2)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-orange-200/72">
              Active Case
            </div>
            <div className="mt-1 text-[1.08rem] font-semibold tracking-[-0.02em] text-white/88">
              {caseLabel}
            </div>
            <div className="mt-1 text-[13px] leading-5 text-white/55">
              Latest file: {latestFile}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric
              label="Risk"
              value={formatLabel(workspaceData?.riskLevel ?? analysisResult?.summary.riskScore)}
            />
            <Metric
              label="Confidence"
              value={formatLabel(workspaceData?.confidence ?? analysisResult?.summary.confidence)}
            />
            <Metric
              label="Critical"
              value={String(
                analysisResult?.summary.criticalIssues ?? normalizedResult?.summary.criticalIssues ?? 0
              )}
            />
            <Metric label="Issues" value={String(issueCount)} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-4">
          <div className="text-[12px] leading-5 text-white/52">
            Continue the current review or intentionally clear this case before starting a new one.
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onContinueChat}
              className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-medium text-white/76 transition hover:bg-white/10 hover:text-white"
            >
              Continue Review
            </button>

            {endAnalysisConfirming ? (
              <>
                <button
                  type="button"
                  onClick={onConfirmEndAnalysis}
                  className="rounded-xl border border-orange-400/20 bg-[#C65A2A]/14 px-3.5 py-2 text-xs font-medium text-orange-100 transition hover:bg-[#C65A2A]/22"
                >
                  Confirm End Analysis
                </button>
                <button
                  type="button"
                  onClick={onCancelEndAnalysis}
                  className="rounded-xl border border-white/8 bg-black/22 px-3.5 py-2 text-xs text-white/62 transition hover:bg-black/30 hover:text-white/82"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onRequestEndAnalysis}
                className="rounded-xl border border-red-500/18 bg-red-500/8 px-3.5 py-2 text-xs font-medium text-red-200/82 transition hover:bg-red-500/14 hover:text-red-100"
              >
                End Analysis
              </button>
            )}
          </div>
        </div>

        {endAnalysisConfirming ? (
          <div className="mt-3 rounded-2xl border border-red-500/16 bg-black/20 px-3.5 py-3 text-[12px] leading-5 text-white/58">
            This clears the current transcript, uploaded files, structured analysis, and rail state for this browser session.
          </div>
        ) : null}
      </section>

      <div className="space-y-3">
        {sections.map((section) => (
          <div
            key={section.title}
            ref={(node) => {
              if (node && !centerSectionRefs.current[section.insightKey]) {
                centerSectionRefs.current[section.insightKey] = node;
              }
            }}
          >
            <AnalysisSectionCard
              title={section.title}
              eyebrow={section.eyebrow}
              summary={section.summary}
              defaultExpanded={section.defaultExpanded}
              active={activeInsightKey === section.insightKey}
              dimmed={focusModeActive && activeInsightKey !== section.insightKey}
              forceExpanded={activeInsightKey === section.insightKey}
              onInteract={() => onActiveInsightChange(section.insightKey)}
              onClearFocus={() => onActiveInsightChange(null)}
            >
              <div className="space-y-3">
                {section.prose ? (
                  <div className="rounded-2xl bg-black/18 px-3.5 py-3 text-[13px] leading-6 text-white/70">
                    {section.prose}
                  </div>
                ) : null}

                {section.bullets.length > 0 ? (
                  <div className="space-y-2">
                    {section.bullets.map((bullet) => (
                      <div
                        key={bullet}
                        className="flex gap-2 rounded-2xl border border-white/6 bg-black/18 px-3.5 py-3 text-[13px] leading-5 text-white/70"
                      >
                        <span className="pt-[1px] text-orange-200/85">&bull;</span>
                        <span>{bullet}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </AnalysisSectionCard>
          </div>
        ))}
      </div>

      {analysisText.trim() ? (
        <AnalysisSectionCard
          title="Full Analysis Transcript"
          eyebrow="Transcript"
          summary="The complete assistant analysis remains available here for detailed review."
          dimmed={focusModeActive}
        >
          <div className="analysis-report rounded-[20px] border border-white/7 bg-black/22 px-4 py-4 text-[14px] leading-[1.75] text-white/82">
            <ReactMarkdown
              components={{
                h2: ({ children }) => (
                  <div className="mb-2 mt-5 text-[1.02rem] font-semibold tracking-[-0.02em] text-[#D27A51]">
                    {children}
                  </div>
                ),
                h3: ({ children }) => (
                  <div className="mb-1 mt-4 text-[14px] font-medium text-[#D27A51]">
                    {children}
                  </div>
                ),
                p: ({ children }) => <p className="mt-2 leading-[1.75] text-white/82">{children}</p>,
                ul: ({ children }) => (
                  <ul className="mt-2 ml-5 list-disc space-y-1.5 text-white/68">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="mt-2 ml-5 list-decimal space-y-1.5 text-white/68">{children}</ol>
                ),
                strong: ({ children }) => <span className="font-semibold text-white">{children}</span>,
              }}
            >
              {formatAssistantMessage(analysisText)}
            </ReactMarkdown>
          </div>
        </AnalysisSectionCard>
      ) : null}

      {canRenderExports ? (
        <div
          ref={(node) => {
            centerSectionRefs.current.exports = node;
          }}
        >
          <AnalysisSectionCard
            title="Ready Outputs"
            eyebrow="Outputs"
            summary="Carrier-ready reports remain available in the right rail when you're ready to export."
            active={activeInsightKey === "exports"}
            dimmed={focusModeActive && activeInsightKey !== "exports"}
            forceExpanded={activeInsightKey === "exports"}
            onInteract={() => onActiveInsightChange("exports")}
            onClearFocus={() => onActiveInsightChange(null)}
          >
            <div className="rounded-2xl border border-white/6 bg-black/18 px-3.5 py-3 text-[13px] leading-5 text-white/70">
              Use the rail to generate the Collision Repair Intelligence Report, Dispute Intelligence
              Report, or rebuttal output.
            </div>
          </AnalysisSectionCard>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[84px] rounded-2xl border border-white/8 bg-black/20 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.16em] text-white/40">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white/86">{value}</div>
    </div>
  );
}
