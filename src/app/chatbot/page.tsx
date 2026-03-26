"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import ChatWidget from "@/components/ChatWidget";
import type { DecisionPanel } from "@/lib/ai/builders/buildDecisionPanel";
import {
  buildExportModel,
  COLLISION_ACADEMY_HANDOFF_URL,
} from "@/lib/ai/builders/buildExportModel";
import { buildCarrierReport } from "@/lib/ai/builders/carrierPdfBuilder";
import { exportCarrierPDF } from "@/lib/ai/builders/exportPdf";
import { normalizeReportToAnalysisResult } from "@/lib/ai/builders/normalizeReportToAnalysisResult";
import {
  cleanPresentationText,
  cleanVehicleSummaryLabel,
  cleanVehicleTrimLabel,
} from "@/lib/ui/presentationText";
import type {
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
  const [analysisPanel, setAnalysisPanel] = useState<DecisionPanel | null>(null);
  const normalizedResult = useMemo(
    () => (analysisResult ? normalizeReportToAnalysisResult(analysisResult) : null),
    [analysisResult]
  );
  const renderModel = useMemo(
    () =>
      buildExportModel({
        report: analysisResult,
        analysis: normalizedResult,
        panel: analysisPanel,
        assistantAnalysis: analysisText,
      }),
    [analysisPanel, analysisResult, analysisText, normalizedResult]
  );

  const panel = analysisPanel ?? EMPTY_PANEL;
  const railOpen = isMobile ? false : desktopRailOpen;

  function handleRailOpenChange(next: boolean) {
    if (isMobile) return;
    setDesktopRailOpen(next);
  }

  if (isMobile === null) return null;

  return (
    <div className="h-screen bg-black text-white flex flex-col">
      <header className="px-6 py-4 border-b border-white/10 bg-black/60 backdrop-blur-md">
        <div className="flex items-center justify-center gap-4 max-w-[1480px] mx-auto">
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

      <div className="flex flex-1 min-h-0 w-full max-w-[1480px] mx-auto">
        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex-1 min-h-0 flex justify-center">
            <div className="flex flex-col w-full max-w-[840px] min-h-0">
              <ChatWidget
                onAttachmentChange={setAttachment}
                onAnalysisChange={setAnalysisText}
                onAnalysisResultChange={setAnalysisResult}
                onAnalysisPanelChange={setAnalysisPanel}
                analysisPanel={analysisPanel}
              />
            </div>
          </div>
        </div>

        {!isMobile && (
          <aside className="w-[480px] border-l border-white/10 bg-black/75 shadow-[-24px_0_60px_rgba(0,0,0,0.28)] backdrop-blur-xl flex flex-col">
            <RailContent
              attachment={attachment}
              analysisText={analysisText}
              panel={panel}
              renderModel={renderModel}
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
            renderModel={renderModel}
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
  renderModel,
  normalizedResult,
  analysisResult,
}: {
  attachment: string | null;
  analysisText: string;
  panel: DecisionPanel;
  renderModel: ReturnType<typeof buildExportModel>;
  normalizedResult: AnalysisResult | null;
  analysisResult: RepairIntelligenceReport | null;
}) {
  const summary = useMemo(() => buildRailSummary(panel, renderModel), [panel, renderModel]);
  const vehicleLabel =
    cleanVehicleSummaryLabel(renderModel.vehicle.label) ||
    "Vehicle details are still limited in the current material.";
  const vehicleTrim = cleanVehicleTrimLabel(renderModel.vehicle.trim);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="sticky top-0 z-10 border-b border-white/10 bg-black/88 px-6 pb-4 pt-6 backdrop-blur-xl">
        <div className="text-xs tracking-[0.3em] uppercase text-white/60">
          Decision Support
        </div>

        <div className="mt-1 text-xl font-semibold">Analysis</div>

        {attachment && (
          <div className="mt-2 truncate text-xs text-white/40">
            Latest attachment: {attachment}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <RailNavButton targetId="rail-summary" label="Summary" />
          <RailNavButton targetId="rail-disputes" label="Disputes" />
          <RailNavButton targetId="rail-valuation" label="Valuation" />
          <RailNavButton targetId="rail-negotiation" label="Negotiation" />
        </div>
      </div>

      <div className="space-y-6 p-6">
        <section
          id="rail-summary"
          className="rounded-2xl border border-orange-500/30 bg-gradient-to-br from-[#C65A2A]/14 via-[#C65A2A]/8 to-white/[0.03] p-5 shadow-[0_18px_50px_rgba(198,90,42,0.14)]"
        >
          <div className="text-[11px] uppercase tracking-[0.24em] text-orange-200/70">
            Primary Recommendation
          </div>
          <div className="mt-3 text-base font-semibold leading-7 text-white">
            {summary.conclusion}
          </div>
          <div className="mt-4 grid gap-3">
            <CompactRailItem label="Top dispute areas" value={summary.disputes} />
            <CompactRailItem label="Next recommended action" value={summary.nextAction} />
          </div>
        </section>

        <DecisionSection
          title="What Stands Out"
          body={cleanPresentationText(renderModel.repairPosition)}
          tone="neutral"
        />

      <section className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="text-[11px] uppercase tracking-[0.2em] text-white/45">
          Vehicle Context
        </div>
        <div className="space-y-1 text-sm text-white/80">
          <div>{vehicleLabel}</div>
          {vehicleTrim && (
            <div className="text-white/55">Trim: {vehicleTrim}</div>
          )}
          <div className="text-white/55">
            VIN: {renderModel.vehicle.vin || "Not clearly supported in the current material."}
          </div>
          <div className="text-white/45">
            Confidence: {formatVehicleConfidence(renderModel.vehicle)}
          </div>
        </div>
      </section>

      <section id="rail-disputes" className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="text-[11px] uppercase tracking-[0.2em] text-white/45">
          Supplement Lines
        </div>
        {renderModel.supplementItems.length > 0 ? (
          <div className="space-y-3">
            {renderModel.supplementItems.map((item, index) => (
              <div
                key={`${item.title}-${index}`}
                className={`rounded-lg border p-3 ${
                  index === 0
                    ? "border-orange-500/30 bg-orange-500/8"
                    : "border-white/10 bg-black/20"
                }`}
              >
                <div className="text-sm font-medium text-white">
                  {cleanPresentationText(item.title)}
                </div>
                <div className="mt-1 text-xs text-white/60">
                  {formatLabel(item.category)} · {formatLabel(item.kind)} · Priority {formatLabel(item.priority)}
                </div>
                <div className="mt-2 text-sm leading-6 text-white/80">{cleanPresentationText(item.rationale)}</div>
                {item.evidence && (
                  <div className="mt-2 text-xs leading-5 text-white/45">Evidence: {cleanPresentationText(item.evidence)}</div>
                )}
                {item.source && (
                  <div className="mt-1 text-[11px] leading-5 text-white/35">Source: {cleanPresentationText(item.source)}</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-white/45">
            No clear supportable missing, underwritten, or disputed repair-path items were identified from the current structured analysis.
          </div>
        )}
      </section>

      {analysisResult && (
        <div id="rail-valuation">
          <ValuationSection renderModel={renderModel} />
        </div>
      )}

      {renderModel.request && (
        <div id="rail-negotiation">
          <NegotiationSection body={renderModel.request} />
        </div>
      )}

      {panel.appraisal?.triggered && panel.appraisal.reasoning && (
        <DecisionSection
          title="Appraisal Signal"
            body={cleanPresentationText(panel.appraisal.reasoning)}
          tone="red"
        />
      )}

      {panel.stateLeverage && panel.stateLeverage.length > 0 && (
        <DecisionSection
          title="State Leverage"
            body={panel.stateLeverage.map((point) => `- ${cleanPresentationText(point)}`).join("\n")}
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
    </div>
  );
}

function exportReport(
  normalizedResult: AnalysisResult | null,
  analysisResult: RepairIntelligenceReport | null,
  panel: DecisionPanel,
  analysisText: string
) {
  const resolvedAnalysis =
    normalizedResult ?? (analysisResult ? normalizeReportToAnalysisResult(analysisResult) : null);

  const reportDocument = buildCarrierReport({
    report: analysisResult,
    analysis: resolvedAnalysis,
    panel,
    assistantAnalysis: analysisText,
  });

  void exportCarrierPDF(reportDocument);
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
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDVRange(low: number, high: number) {
  if (low === 0 && high === 0) {
    return "Not enough data to quantify a DV range yet.";
  }

  return `$${low} - $${high}`;
}

function buildValuationDisplay(renderModel: ReturnType<typeof buildExportModel>): string {
  return [
    "ACV",
    buildSingleValuationDisplay({
      label: "Preliminary ACV preview",
      status: renderModel.valuation.acvStatus,
      value:
        renderModel.valuation.acvStatus === "provided"
          ? renderModel.valuation.acvValue
          : undefined,
      range:
        renderModel.valuation.acvStatus === "estimated_range"
          ? renderModel.valuation.acvRange
          : undefined,
      confidence: renderModel.valuation.acvConfidence,
      reasoning: renderModel.valuation.acvReasoning,
      missingInputs: renderModel.valuation.acvMissingInputs,
      maxRange: 250000,
    }),
    "",
    "DV",
    buildSingleValuationDisplay({
      label: "Preliminary diminished value preview",
      status: renderModel.valuation.dvStatus,
      value:
        renderModel.valuation.dvStatus === "provided"
          ? renderModel.valuation.dvValue
          : undefined,
      range:
        renderModel.valuation.dvStatus === "estimated_range"
          ? renderModel.valuation.dvRange
          : undefined,
      confidence: renderModel.valuation.dvConfidence,
      reasoning: renderModel.valuation.dvReasoning,
      missingInputs: renderModel.valuation.dvMissingInputs,
      maxRange: 50000,
    }),
  ].join("\n");
}

function buildSingleValuationDisplay(params: {
  label: string;
  status: "provided" | "estimated_range" | "not_determinable";
  value?: number;
  range?: { low: number; high: number };
  confidence?: "low" | "medium" | "high";
  reasoning: string;
  missingInputs: string[];
  maxRange: number;
}): string {
  const lines: string[] = [];

  if (params.status === "provided" && typeof params.value === "number") {
    lines.push(`${params.label}: ${formatCurrency(params.value)}`);
  } else if (params.status === "estimated_range" && hasSaneRange(params.range, params.maxRange)) {
    lines.push(
      `${params.label}: ${formatCurrency(params.range.low)}-${formatCurrency(params.range.high)}`
    );
  } else {
    lines.push(`${params.label}: Not determinable from the current documents.`);
  }

  if (params.confidence) {
    lines.push(`Confidence: ${formatLabel(params.confidence)}`);
  }

  const reasoning = cleanValuationReasoning(
    params.reasoning,
    params.status === "not_determinable"
      ? "Not determinable from the current documents."
      : params.label
  );
  if (reasoning) {
    lines.push(reasoning);
  }

  if (params.missingInputs.length) {
    lines.push(`Missing inputs: ${params.missingInputs.join(", ")}`);
  }

  if (params.status === "provided" || params.status === "estimated_range") {
    lines.push("This is a preliminary preview based on the current file set, not a formal appraisal or binding valuation.");
  }

  return lines.join("\n");
}

function formatCurrency(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function hasSaneRange(
  range: { low: number; high: number } | undefined,
  max: number
): range is { low: number; high: number } {
  if (!range) return false;
  if (!Number.isFinite(range.low) || !Number.isFinite(range.high)) return false;
  if (range.low <= 0 || range.high <= 0) return false;
  if (range.high < range.low || range.high > max) return false;
  return true;
}

function cleanValuationReasoning(reasoning: string, lead: string): string | null {
  const cleaned = reasoning.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;

  const normalizedReason = cleaned.toLowerCase().replace(/[^\w\s]/g, "");
  const normalizedLead = lead.toLowerCase().replace(/[^\w\s]/g, "");

  if (normalizedReason === normalizedLead) {
    return null;
  }

  if (
    normalizedLead.includes("not determinable") &&
    normalizedReason.includes("not determinable from the current documents")
  ) {
    return null;
  }

  return cleaned;
}

function formatVehicleConfidence(
  vehicle: ReturnType<typeof buildExportModel>["vehicle"]
): string {
  const label = formatLabel(vehicle.confidence);
  if (typeof vehicle.sourceConfidence !== "number") {
    return label;
  }

  return `${label} (${vehicle.sourceConfidence.toFixed(2)})`;
}

function RailNavButton({
  targetId,
  label,
}: {
  targetId: string;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" })}
      className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-white/65 transition hover:bg-white/[0.08] hover:text-white"
    >
      {label}
    </button>
  );
}

function CompactRailItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">{label}</div>
      <div className="mt-1 text-sm leading-6 text-white/84">{value}</div>
    </div>
  );
}

function NegotiationSection({ body }: { body: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const cleaned = cleanPresentationText(body);
  const preview = truncateLongText(cleaned, 680);
  const visible = expanded ? cleaned : preview;
  const isTruncated = preview.length < cleaned.length;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(cleaned);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.2em] text-white/45">Negotiation Draft</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-md border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-white/65 transition hover:bg-black/30 hover:text-white"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          {isTruncated && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="rounded-md border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-white/65 transition hover:bg-black/30 hover:text-white"
            >
              {expanded ? "Collapse" : "Expand"}
            </button>
          )}
        </div>
      </div>
      <div className="rounded-lg border border-white/10 bg-black/20 p-3 whitespace-pre-wrap text-sm leading-6 text-white/82">
        {visible}
      </div>
    </section>
  );
}

function ValuationSection({
  renderModel,
}: {
  renderModel: ReturnType<typeof buildExportModel>;
}) {
  const subdued = shouldDemoteValuation(renderModel.valuation);

  return (
    <section
      className={`rounded-xl border p-4 space-y-4 ${
        subdued
          ? "border-white/10 bg-white/[0.03]"
          : "border-green-500/30 bg-green-500/5"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.2em] text-white/45">Valuation</div>
        {subdued && (
          <div className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-white/55">
            Low-confidence preview
          </div>
        )}
      </div>
      <ValuationItem
        label="ACV"
        body={buildSingleValuationDisplay({
          label: "Preliminary ACV preview",
          status: renderModel.valuation.acvStatus,
          value:
            renderModel.valuation.acvStatus === "provided"
              ? renderModel.valuation.acvValue
              : undefined,
          range:
            renderModel.valuation.acvStatus === "estimated_range"
              ? renderModel.valuation.acvRange
              : undefined,
          confidence: renderModel.valuation.acvConfidence,
          reasoning: renderModel.valuation.acvReasoning,
          missingInputs: renderModel.valuation.acvMissingInputs,
          maxRange: 250000,
        })}
      />
      <ValuationItem
        label="DV"
        body={buildSingleValuationDisplay({
          label: "Preliminary diminished value preview",
          status: renderModel.valuation.dvStatus,
          value:
            renderModel.valuation.dvStatus === "provided"
              ? renderModel.valuation.dvValue
              : undefined,
          range:
            renderModel.valuation.dvStatus === "estimated_range"
              ? renderModel.valuation.dvRange
              : undefined,
          confidence: renderModel.valuation.dvConfidence,
          reasoning: renderModel.valuation.dvReasoning,
          missingInputs: renderModel.valuation.dvMissingInputs,
          maxRange: 50000,
        })}
      />
      <a
        href={COLLISION_ACADEMY_HANDOFF_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs font-medium text-white/80 transition hover:bg-black/30 hover:text-white"
      >
        Continue to Full Valuation
      </a>
    </section>
  );
}

function ValuationItem({
  label,
  body,
}: {
  label: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">{label}</div>
      <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/82">
        {cleanPresentationText(body)}
      </div>
    </div>
  );
}

function buildRailSummary(
  panel: DecisionPanel,
  renderModel: ReturnType<typeof buildExportModel>
): {
  conclusion: string;
  disputes: string;
  nextAction: string;
} {
  const conclusion =
    cleanPresentationText(renderModel.repairPosition) ||
    cleanPresentationText(panel.narrative) ||
    "The current material does not yet support a strong repair-position conclusion.";
  const disputeTitles = renderModel.supplementItems
    .map((item) => cleanPresentationText(item.title))
    .filter(Boolean)
    .slice(0, 3);
  const nextAction = cleanPresentationText(
    (panel.appraisal?.triggered && panel.appraisal.reasoning) ||
      panel.negotiationResponse ||
      panel.stateLeverage?.[0] ||
      renderModel.supplementItems[0]?.rationale ||
      renderModel.request ||
      "Continue with the strongest supported repair position and document the key disputed items."
  );

  return {
    conclusion,
    disputes:
      disputeTitles.length > 0
        ? disputeTitles.join("; ")
        : "No major dispute areas were clearly surfaced from the current analysis.",
    nextAction: extractLeadSentence(nextAction) || nextAction,
  };
}

function cleanDisplayText(value: string | null | undefined): string {
  if (!value) return "";

  return value
    .replace(/Â·/g, "·")
    .replace(/([A-Za-z])m0\.\d+\b/g, "$1")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanVehicleTrim(value: string | null | undefined): string {
  const cleaned = cleanDisplayText(value);
  if (!cleaned) return "";
  if (cleaned.length > 36) return "";
  if (/(scan|module|dtc|fault|code)/i.test(cleaned)) return "";
  return cleaned;
}

function extractLeadSentence(value: string): string {
  const cleaned = cleanPresentationText(value);
  if (!cleaned) return "";
  const match = cleaned.match(/^.*?[.!?](\s|$)/);
  return match ? match[0].trim() : cleaned;
}

function truncateLongText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars).trimEnd()}...`;
}

function shouldDemoteValuation(
  valuation: ReturnType<typeof buildExportModel>["valuation"]
): boolean {
  const acvWeak =
    valuation.acvStatus === "not_determinable" || valuation.acvConfidence === "low" || !valuation.acvConfidence;
  const dvWeak =
    valuation.dvStatus === "not_determinable" || valuation.dvConfidence === "low" || !valuation.dvConfidence;

  return acvWeak && dvWeak;
}
