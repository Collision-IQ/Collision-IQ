"use client";

import { useEffect, useRef } from "react";
import {
  type EvidenceLink,
  type EvidenceLinkModel,
  getEvidenceTargetById,
  findEvidenceLinkForSectionItem,
} from "@/components/chatbot/evidenceLinks";
import type { InsightKey } from "@/components/chatbot/insightSync";
import DeterminationCard from "@/components/DeterminationCard";
import type { ExportModel } from "@/lib/ai/builders/buildExportModel";
import AnalysisSectionCard from "@/components/AnalysisSectionCard";
import {
  sanitizeUserFacingEvidenceText,
  summarizeUserFacingSupport,
} from "@/lib/ui/presentationText";
import { buildCompactAttachmentSummary } from "@/components/chatWidget/attachmentUtils";

type AttachmentTrayItem = {
  attachmentId: string;
  filename: string;
  hasVision?: boolean;
  mime?: string;
  source?: string;
};

type Props = {
  renderModel: ExportModel;
  attachments: AttachmentTrayItem[];
  hasResolvedAnalysis: boolean;
  activeInsightKey: InsightKey | null;
  onActiveInsightChange: (key: InsightKey | null) => void;
  onCenterScrollRequest?: (scrollTo: (key: InsightKey) => void) => void;
  canRenderExports?: boolean;
  canUseFullReportExports?: boolean;
  evidenceModel?: EvidenceLinkModel | null;
  activeEvidenceTargetId?: string | null;
  onEvidenceSelect?: (link: EvidenceLink) => void;
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
    const normalized = sanitizeUserFacingEvidenceText(item)?.replace(/\s+/g, " ").trim();
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function buildSectionPreview(section: SectionData): string {
  const segments = dedupe([
    section.prose,
    ...section.bullets,
  ]).slice(0, 2);

  return segments.join(" ");
}

export default function StructuredAnalysisCanvas({
  renderModel,
  attachments,
  hasResolvedAnalysis,
  activeInsightKey,
  onActiveInsightChange,
  onCenterScrollRequest,
  canRenderExports = false,
  canUseFullReportExports = false,
  evidenceModel,
  activeEvidenceTargetId,
  onEvidenceSelect,
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
    `Adjusted confidence: ${renderModel.confidenceIntegrity.adjustedConfidence}.`,
    `Evidence completeness: ${formatLabel(renderModel.confidenceIntegrity.completenessStatus)}.`,
    renderModel.confidenceIntegrity.userFacingDisclosure,
    ...renderModel.reportFields.presentStrengths,
    ...renderModel.disputeIntelligenceReport.positives,
    ...renderModel.reportFields.documentedProcedures,
    ...renderModel.reportFields.documentedHighlights,
  ]).slice(0, 6);

  const missingBullets = dedupe([
    ...renderModel.findingReasoning.map((finding) =>
      `${finding.issue}: ${finding.rationaleSummary ?? finding.why_it_matters}; ${summarizeUserFacingSupport(finding.evidenceChainSummary ?? finding.what_proves_it)} ${finding.riskIfOmitted ?? ""} ${finding.next_action}`
    ),
    ...renderModel.disputeIntelligenceReport.topDrivers.map(
      (driver) => `${driver.title}: ${driver.whyItMatters}`
    ),
    ...renderModel.disputeIntelligenceReport.supportGaps,
    ...renderModel.oemContradictions.map((contradiction) =>
      `${contradiction.affectedOperation}: ${contradiction.conflictSummary}; ${summarizeUserFacingSupport(contradiction.oemSupportCitation)} Follow-up: ${contradiction.recommendedFollowUp}`
    ),
    ...renderModel.supplementItems.slice(0, 5).map((item) => `${item.title}: ${item.rationale}`),
  ]).slice(0, 6);

  const nextMoveBullets = dedupe([
    ...(renderModel.disputeStrategy
      ? [
          `Leverage score: ${renderModel.disputeStrategy.leverageScore}/100.`,
          ...renderModel.disputeStrategy.recommendedSequence.map((item, index) => `${index + 1}. ${item}`),
        ]
      : []),
    ...renderModel.disputeIntelligenceReport.nextMoves,
    ...renderModel.negotiationPlaybook.suggestedSequence,
    ...renderModel.negotiationPlaybook.documentationNeeded,
  ]).slice(0, 6);
  const retrievalBullets = renderModel.retrievalSummary
    ? dedupe([
        `Drive docs used: ${renderModel.retrievalSummary.driveDocsUsed}.`,
        `Web sources used: ${renderModel.retrievalSummary.webSourcesUsed}.`,
        `Serper status: ${formatLabel(renderModel.retrievalSummary.serperStatus)}.`,
        `OEM evidence found: ${renderModel.retrievalSummary.oemEvidenceFound ? "Yes" : "No"}.`,
        ...renderModel.retrievalSummary.sourcesInfluencingFindings.map(
          (source) => `${source.title} (${formatLabel(source.sourceType)}) influenced ${source.relatedFindingIds.length} finding(s).`
        ),
      ]).slice(0, 6)
    : [];
  const retrievalSections: SectionData[] = retrievalBullets.length > 0
    ? [{
        insightKey: "support_strengths",
        title: "Retrieval Summary",
        eyebrow: "Sources",
        summary: "Only sources that influenced included findings are shown.",
        bullets: retrievalBullets,
      }]
    : [];
  const financialBullets = dedupe([
    renderModel.valuation.acvReasoning,
    ...renderModel.valuation.acvMissingInputs,
    renderModel.valuation.dvReasoning,
    ...renderModel.valuation.dvMissingInputs,
    renderModel.disputeIntelligenceReport.valuationPreview?.acv,
    renderModel.disputeIntelligenceReport.valuationPreview?.dv,
  ]).slice(0, 6);

  const executiveBullets = dedupe([
    renderModel.positionStatement,
    renderModel.disputeIntelligenceReport.summary,
  ]).slice(0, 4);

  const sections = [
    {
      insightKey: "executive_summary",
      title: "Summary",
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
      title: "Evidence Gaps",
      eyebrow: "Exposure",
      summary: "The main omissions, support gaps, or underwritten items worth pressing on.",
      bullets: missingBullets,
    },
    ...retrievalSections,
    {
      insightKey: "financial_view",
      title: "Estimate Delta",
      eyebrow: "Financial View",
      summary: "Directional estimate, total-loss, gap, or valuation posture from the current material.",
      bullets: financialBullets,
      prose: buildValuationSummary(renderModel),
    },
    {
      insightKey: "next_moves",
      title: "Recommended Next Moves",
      eyebrow: "Next Moves",
      summary: "The clearest actions to strengthen support, negotiation posture, and outputs.",
      bullets: nextMoveBullets,
      prose: "Formal exports and carrier-ready outputs remain available in the right rail.",
    },
  ] satisfies SectionData[];
  const visibleSections = sections.filter((section) => section.bullets.length > 0 || section.prose);

  const caseLabel =
    renderModel.vehicle.label || renderModel.reportFields.vehicleLabel || "Vehicle still being resolved";
  const latestFile = attachments[attachments.length - 1]?.filename ?? "No attachment yet";
  const attachmentStatus =
    attachments.length > 20
      ? buildCompactAttachmentSummary(attachments)
      : `Latest file: ${latestFile}`;
  const issueCount = renderModel.supplementItems.length;
  const focusModeActive = activeInsightKey !== null;
  const activeEvidenceTarget = evidenceModel
    ? getEvidenceTargetById(evidenceModel, activeEvidenceTargetId ?? null)
    : null;

  return (
    <div className="mt-2 space-y-2">
      <DeterminationCard determination={renderModel.determination} />

      <section className="border border-border bg-card p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#a35d26] dark:text-[#c57934]">
              Active Case
            </div>
            <div className="mt-1 break-words text-[1rem] font-semibold text-card-foreground">
              {caseLabel}
            </div>
            <div className="mt-1 break-words text-[12px] leading-5 text-muted-foreground">
              {attachmentStatus}
            </div>
          </div>

          <div className="grid w-full min-w-0 grid-cols-2 gap-2 sm:w-auto sm:grid-cols-4">
            <Metric
              label="Risk"
              value={renderModel.supplementItems.length > 0 ? "Review" : "Low"}
            />
            <Metric
              label="Confidence"
              value={renderModel.confidenceIntegrity.adjustedConfidence}
            />
            <Metric
              label="Drivers"
              value={String(renderModel.disputeIntelligenceReport.topDrivers.length)}
            />
            <Metric label="Issues" value={String(issueCount)} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <div className="text-[12px] leading-5 text-muted-foreground">
            Continue the current review or intentionally clear this case before starting a new one.
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onContinueChat}
              className="rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-background"
            >
              Continue with this case
            </button>

            {endAnalysisConfirming ? (
              <>
                <button
                  type="button"
                  onClick={onConfirmEndAnalysis}
                  className="rounded-md border border-[#b86a2d]/30 bg-[#b86a2d]/12 px-3 py-1.5 text-xs font-medium text-[#b86a2d] transition hover:bg-[#b86a2d]/18 dark:text-[#c57934]"
                >
                  Confirm End Analysis
                </button>
                <button
                  type="button"
                  onClick={onCancelEndAnalysis}
                  className="rounded-md border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-background hover:text-foreground"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onRequestEndAnalysis}
                className="rounded-md border border-red-500/25 bg-red-500/8 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-500/14 dark:text-red-300"
              >
                End Analysis
              </button>
            )}
          </div>
        </div>

        {endAnalysisConfirming ? (
          <div className="mt-3 border border-red-500/20 bg-red-500/10 px-3 py-2 text-[12px] leading-5 text-muted-foreground">
            This clears the current transcript, uploaded files, structured analysis, and rail state for this browser session.
          </div>
        ) : null}
      </section>

      <div className="space-y-2">
        {visibleSections.map((section) => (
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
              preview={buildSectionPreview(section)}
              expanded={activeInsightKey === section.insightKey}
              collapsible={false}
              active={activeInsightKey === section.insightKey}
              dimmed={focusModeActive && activeInsightKey !== section.insightKey}
              forceExpanded={activeInsightKey === section.insightKey}
              onInteract={() => onActiveInsightChange(section.insightKey)}
              onClearFocus={() => onActiveInsightChange(null)}
            >
              <div className="space-y-3">
                {section.prose ? (
                  <div className="break-words border border-border bg-muted px-3 py-2.5 text-[13px] leading-5 text-muted-foreground">
                    {sanitizeUserFacingEvidenceText(section.prose)}
                  </div>
                ) : null}

                {section.bullets.length > 0 ? (
                  <div className="space-y-2">
                    {section.bullets.map((bullet) => (
                      <LinkedInsightBullet
                        key={bullet}
                        bullet={bullet}
                        insightKey={section.insightKey}
                        evidenceModel={evidenceModel}
                        activeEvidenceTargetId={activeEvidenceTargetId ?? null}
                        onEvidenceSelect={onEvidenceSelect}
                      />
                    ))}
                  </div>
                ) : null}

                {activeEvidenceTarget?.insightKey === section.insightKey ? (
                  <EvidenceSupportBlock target={activeEvidenceTarget} />
                ) : null}
              </div>
            </AnalysisSectionCard>
          </div>
        ))}
      </div>

      {canRenderExports ? (
        <div
          ref={(node) => {
            centerSectionRefs.current.exports = node;
          }}
        >
          <AnalysisSectionCard
            title="Ready Outputs"
            eyebrow="Reports"
            summary={
              canUseFullReportExports
                ? "Carrier-ready reports remain available in the right rail when you're ready to export."
                : "Your 1-Page Snapshot is available in the right rail. Repair Intelligence, Estimate Scrubber, and Policy & Rights Review reports are available on Pro."
            }
            preview={
              canUseFullReportExports
                ? "Repair Intelligence Report, Citation Density PDF, and Policy & Rights Review remain available in the rail."
                : "Use the 1-Page Snapshot for the shareable export. Repair Intelligence, Estimate Scrubber, and Policy & Rights Review are Pro-only upgrades."
            }
            expanded={activeInsightKey === "exports"}
            collapsible={false}
            active={activeInsightKey === "exports"}
            dimmed={focusModeActive && activeInsightKey !== "exports"}
            forceExpanded={activeInsightKey === "exports"}
            onInteract={() => onActiveInsightChange("exports")}
            onClearFocus={() => onActiveInsightChange(null)}
          >
            <div className="border border-border bg-muted px-3 py-2.5 text-[13px] leading-5 text-muted-foreground">
              {canUseFullReportExports
                ? "Use the rail to generate the Repair Intelligence Report, Citation Density PDF, or Policy & Rights Review."
                : "Use the rail to download the 1-Page Snapshot. Repair Intelligence, Estimate Scrubber, Policy & Rights Review, and Customer Report are available on Pro."}
            </div>
          </AnalysisSectionCard>
        </div>
      ) : null}
    </div>
  );
}

function buildValuationSummary(renderModel: ExportModel): string | undefined {
  const parts = dedupe([
    renderModel.valuation.acvStatus !== "not_determinable"
      ? `Market Preview posture: ${formatLabel(renderModel.valuation.acvStatus)}.`
      : null,
    renderModel.valuation.dvStatus !== "not_determinable"
      ? `DV posture: ${formatLabel(renderModel.valuation.dvStatus)}.`
      : null,
  ]);

  return parts.length > 0 ? parts.join(" ") : undefined;
}

function LinkedInsightBullet({
  bullet,
  insightKey,
  evidenceModel,
  activeEvidenceTargetId,
  onEvidenceSelect,
}: {
  bullet: string;
  insightKey: InsightKey;
  evidenceModel?: EvidenceLinkModel | null;
  activeEvidenceTargetId: string | null;
  onEvidenceSelect?: (link: EvidenceLink) => void;
}) {
  const evidenceLink = evidenceModel
    ? findEvidenceLinkForSectionItem(evidenceModel, insightKey, bullet)
    : null;
  const active = Boolean(evidenceLink && evidenceLink.targetId === activeEvidenceTargetId);

  if (!evidenceLink) {
    return (
      <div className="flex min-w-0 gap-2 border border-border bg-muted px-3 py-2.5 text-[13px] leading-5 text-muted-foreground">
        <span className="pt-[1px] text-[#b86a2d]">&bull;</span>
        <span className="min-w-0 break-words">{sanitizeUserFacingEvidenceText(bullet) || "Evidence supported."}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onEvidenceSelect?.(evidenceLink)}
      className={`w-full rounded-md border px-3 py-2.5 text-left transition-[border-color,background-color] duration-200 ${
        active
          ? "border-[#b86a2d]/40 bg-[#C65A2A]/10"
          : "border-border bg-muted hover:border-ring/30 hover:bg-muted/70"
      }`}
    >
      <div className="flex min-w-0 gap-2 text-[13px] leading-5 text-foreground">
        <span className="pt-[1px] text-[#b86a2d]">&bull;</span>
        <span className="min-w-0 break-words">{sanitizeUserFacingEvidenceText(bullet) || "Evidence supported."}</span>
      </div>
      <div className="mt-2 inline-flex rounded-sm border border-border bg-card px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        View support
      </div>
    </button>
  );
}

function EvidenceSupportBlock({
  target,
}: {
  target: NonNullable<ReturnType<typeof getEvidenceTargetById>>;
}) {
  return (
    <div className="rounded-md border border-[#b86a2d]/28 bg-[#C65A2A]/10 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.08em] text-[#b86a2d]">
          Supporting Evidence
        </div>
        <div className="rounded-sm border border-border bg-muted px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          {target.type.replace(/_/g, " ")}
        </div>
      </div>
      <div className="mt-2 text-[13px] font-medium leading-5 text-foreground">{sanitizeUserFacingEvidenceText(target.title) || "Supporting evidence"}</div>
      <div className="mt-2 text-[13px] leading-5 text-muted-foreground">{sanitizeUserFacingEvidenceText(target.detail) || "Evidence supported."}</div>
      {target.summary ? (
        <div className="mt-2 text-[12px] leading-5 text-muted-foreground">{sanitizeUserFacingEvidenceText(target.summary) || "Evidence supported."}</div>
      ) : null}
      {target.sourceLabel ? (
        <div className="mt-2 text-[11px] leading-5 text-muted-foreground">Source: {sanitizeUserFacingEvidenceText(target.sourceLabel) || "reviewed file evidence"}</div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-muted px-3 py-2 sm:min-w-[84px]">
      <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}
