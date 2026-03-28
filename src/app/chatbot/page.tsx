"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ChatWidget from "@/components/ChatWidget";
import type { DecisionPanel } from "@/lib/ai/builders/buildDecisionPanel";
import {
  buildExportModel,
  buildPreferredVehicleIdentityLabel,
  COLLISION_ACADEMY_HANDOFF_URL,
} from "@/lib/ai/builders/buildExportModel";
import { buildCarrierReport } from "@/lib/ai/builders/carrierPdfBuilder";
import { exportCarrierPDF } from "@/lib/ai/builders/exportPdf";
import { buildRebuttalEmailPdf } from "@/lib/ai/builders/rebuttalEmailPdfBuilder";
import { buildSideBySidePdf } from "@/lib/ai/builders/sideBySidePdfBuilder";
import { buildLineByLinePdf } from "@/lib/ai/builders/lineByLinePdfBuilder";
import { normalizeReportToAnalysisResult } from "@/lib/ai/builders/normalizeReportToAnalysisResult";
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
const CHAT_CONSENT_STORAGE_KEY = "collision_iq_chat_consent";
const CHAT_CONSENT_TERMS_VERSION = "2026-03-28";
const CHAT_CONSENT_PRIVACY_VERSION = "2026-03-28";

type ChatConsentRecord = {
  consentStatus: "accepted";
  acceptedAt: string;
  termsVersion: string;
  privacyVersion: string;
  checkboxChecked: true;
};

function isValidConsentRecord(value: unknown): value is ChatConsentRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ChatConsentRecord>;

  return (
    record.consentStatus === "accepted" &&
    typeof record.acceptedAt === "string" &&
    Boolean(record.acceptedAt.trim()) &&
    record.termsVersion === CHAT_CONSENT_TERMS_VERSION &&
    record.privacyVersion === CHAT_CONSENT_PRIVACY_VERSION &&
    record.checkboxChecked === true
  );
}

function readStoredChatConsent(): ChatConsentRecord | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(CHAT_CONSENT_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;
    if (isValidConsentRecord(parsed)) {
      return parsed;
    }

    window.localStorage.removeItem(CHAT_CONSENT_STORAGE_KEY);
    return null;
  } catch {
    window.localStorage.removeItem(CHAT_CONSENT_STORAGE_KEY);
    return null;
  }
}

export default function ChatbotPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [desktopRailOpen, setDesktopRailOpen] = useState(false);
  const [attachment, setAttachment] = useState<string | null>(null);
  const [analysisText, setAnalysisText] = useState("");
  const [analysisResult, setAnalysisResult] = useState<RepairIntelligenceReport | null>(null);
  const [analysisPanel, setAnalysisPanel] = useState<DecisionPanel | null>(null);
  const [consentResolved, setConsentResolved] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
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

  useEffect(() => {
    if (typeof window === "undefined") return;

    setConsentAccepted(Boolean(readStoredChatConsent()));
    setConsentResolved(true);
  }, []);

  function handleConsentAccept() {
    if (!consentChecked || typeof window === "undefined") return;

    const record: ChatConsentRecord = {
      consentStatus: "accepted",
      acceptedAt: new Date().toISOString(),
      termsVersion: CHAT_CONSENT_TERMS_VERSION,
      privacyVersion: CHAT_CONSENT_PRIVACY_VERSION,
      checkboxChecked: true,
    };

    window.localStorage.setItem(CHAT_CONSENT_STORAGE_KEY, JSON.stringify(record));
    setConsentAccepted(true);
  }

  function handleConsentCancel() {
    router.push("/");
  }

  if (isMobile === null || !consentResolved) return null;

  const chatBlocked = !consentAccepted;

  return (
    <div className="h-screen bg-black text-white flex flex-col">
      <header className="px-6 py-4 border-b border-white/10 bg-black/60 backdrop-blur-md">
        <div className="flex items-center justify-between gap-4 max-w-[1680px] mx-auto">
          <div className="flex items-center gap-4">
            <Image
              src="/brand/logos/Logo-grey.png"
              alt="Collision Academy"
              width={150}
              height={40}
              className="opacity-90"
              priority
            />

            <div>
              <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-white to-white/70 bg-clip-text text-transparent">
                Collision-IQ
              </h1>

              <p className="text-xs text-white/50">
                Repair intelligence for estimates, OEM procedures, and damage photos
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <a
              href="https://collision-iq.ai/"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-2xl border border-white/12 bg-white/5 px-4 py-2 text-sm text-white/85 transition hover:bg-white/10"
            >
              Collision Academy
            </a>

            <div className="flex flex-wrap items-center justify-end gap-3 text-xs text-white/55">
              <Link href="/terms" className="transition hover:text-white">
                Terms
              </Link>
              <span className="opacity-30">/</span>
              <Link href="/privacy" className="transition hover:text-white">
                Privacy
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 w-full max-w-[1680px] mx-auto">
        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex-1 min-h-0 flex justify-center">
            <div className="flex flex-col w-full max-w-[1040px] min-h-0">
              {!isMobile && hasAtGlanceContent(renderModel) && (
                <AtAGlanceCard renderModel={renderModel} analysisResult={analysisResult} />
              )}
              <ChatWidget
                onAttachmentChange={setAttachment}
                onAnalysisChange={setAnalysisText}
                onAnalysisResultChange={setAnalysisResult}
                onAnalysisPanelChange={setAnalysisPanel}
                disabled={chatBlocked}
              />
            </div>
          </div>
        </div>

        {!isMobile && (
          <aside className="w-[420px] xl:w-[460px] border-l border-white/10 bg-black/70 backdrop-blur-xl flex flex-col shadow-[-24px_0_60px_rgba(0,0,0,0.22)]">
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

      {chatBlocked && (
        <div
          className="fixed inset-0 z-[80] bg-black/82 backdrop-blur-xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="chat-consent-title"
        >
          <div className="flex min-h-full items-center justify-center p-6">
            <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-black/80 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.6)] md:p-8">
              <div className="text-xs uppercase tracking-[0.24em] text-white/45">
                Collision IQ Consent
              </div>
              <h2 id="chat-consent-title" className="mt-3 text-2xl font-semibold text-white md:text-3xl">
                Consent Required to Use AI Chat
              </h2>
              <div className="mt-3 space-y-4 text-sm leading-7 text-white/72 md:text-base">
                <p>
                  You are about to use an AI-powered chatbot. This chatbot is an automated system and not a live human representative.
                </p>
                <p>
                  By continuing, you represent that you are at least 18 years old, or that you are using this chatbot with the permission and supervision of a parent or legal guardian where required by law.
                </p>
                <p>
                  You also consent to the Company&apos;s and its service providers&apos; collection, processing, storage, review, monitoring, recording, and retention of your prompts, messages, feedback, uploads, voice communications, and related technical and usage data for the purposes of providing, operating, analyzing, maintaining, improving, and training the chatbot and related systems, and for customer service, quality assurance, safety, security, abuse prevention, legal compliance, and other operational purposes, as described in our{" "}
                  <a
                    href="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white underline underline-offset-4 hover:text-orange-200"
                  >
                    Privacy Policy
                  </a>.
                </p>
                <p>
                  Your use of this chatbot is subject to our{" "}
                  <a
                    href="/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white underline underline-offset-4 hover:text-orange-200"
                  >
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a
                    href="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white underline underline-offset-4 hover:text-orange-200"
                  >
                    Privacy Policy
                  </a>.
                </p>
              </div>

              <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={consentChecked}
                    onChange={(event) => setConsentChecked(event.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-white/20 bg-black/40 text-orange-500 focus:ring-orange-500"
                  />
                  <span className="text-sm leading-6 text-white/80">
                    I have read and agree to the Terms of Service and Privacy Policy, and I consent to the use of the AI chatbot as described above.
                  </span>
                </label>
                <p className="mt-3 text-xs leading-5 text-white/45">
                  You must check the box before continuing.
                </p>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3 text-xs text-white/40">
                  <a
                    href="/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="transition hover:text-white"
                  >
                    Terms of Service
                  </a>
                  <span className="opacity-30">|</span>
                  <a
                    href="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="transition hover:text-white"
                  >
                    Privacy Policy
                  </a>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleConsentCancel}
                    className="rounded-2xl border border-white/12 bg-white/5 px-4 py-2 text-sm text-white/80 transition hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConsentAccept}
                    disabled={!consentChecked}
                    className="rounded-2xl bg-[#C65A2A] px-5 py-2 text-sm font-semibold text-black transition hover:bg-[#C65A2A]/90 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Continue
                  </button>
                </div>
              </div>
            </div>
          </div>
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
  const featuredRecommendation = renderModel.supplementItems[0];
  const remainingRecommendations = renderModel.supplementItems.slice(1);
  const valuationLowConfidence = isLowConfidenceValuation(renderModel);
  const vehicleIdentity =
    buildPreferredVehicleIdentityLabel(renderModel.vehicle) ??
    "Vehicle details are still limited in the current material.";

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

      <DecisionSection title="What Stands Out" body={renderModel.repairPosition} tone="neutral" />

      {featuredRecommendation && (
        <FeaturedRecommendationCard item={featuredRecommendation} />
      )}

      <section className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="text-[11px] uppercase tracking-[0.2em] text-white/45">
          Vehicle Context
        </div>
        <div className="space-y-1 text-sm text-white/80">
          <div>{vehicleIdentity}</div>
          {renderModel.vehicle.trim && (
            <div className="text-white/55">Trim: {renderModel.vehicle.trim}</div>
          )}
          <div className="text-white/55">
            VIN: {renderModel.vehicle.vin || "Not clearly supported in the current material."}
          </div>
          <div className="text-white/45">
            Confidence: {formatVehicleConfidence(renderModel.vehicle)}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="text-[11px] uppercase tracking-[0.2em] text-white/45">
          Supplement Lines
        </div>
        {remainingRecommendations.length > 0 ? (
          <div className="space-y-3">
            {remainingRecommendations.map((item, index) => (
              <div key={`${item.title}-${index}`} className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="text-sm font-medium text-white">
                  {item.title}
                </div>
                <div className="mt-1 text-xs text-white/60">
                  {formatLabel(item.category)} · {formatLabel(item.kind)} · Priority {formatLabel(item.priority)}
                </div>
                <div className="mt-2 text-sm leading-6 text-white/80">{item.rationale}</div>
                {item.evidence && (
                  <div className="mt-2 text-xs leading-5 text-white/45">Evidence: {item.evidence}</div>
                )}
                {item.source && (
                  <div className="mt-1 text-[11px] leading-5 text-white/35">Source: {item.source}</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-white/45">
            {featuredRecommendation
              ? "The strongest recommendation is highlighted above."
              : "No clear supportable missing, underwritten, or disputed repair-path items were identified from the current structured analysis."}
          </div>
        )}
      </section>

      {analysisResult && (
        <ValuationSection renderModel={renderModel} lowConfidence={valuationLowConfidence} />
      )}

      {renderModel.request && (
        <ExpandableDecisionSection
          title="Negotiation Draft"
          body={renderModel.request}
          tone="neutral"
          mono
          previewLines={7}
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
        <section className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
          <div className="text-[11px] uppercase tracking-[0.2em] text-white/45">
            Exports
          </div>
          <div className="grid gap-2">
            <button
              onClick={() =>
                exportReport(normalizedResult, analysisResult, panel, analysisText)
              }
              className="w-full rounded-md border border-white/10 bg-white/5 hover:bg-white/10 p-3 text-xs"
            >
              Export PDF
            </button>
            <button
              onClick={() =>
                exportPdfVariant({
                  normalizedResult,
                  analysisResult,
                  panel,
                  analysisText,
                  variant: "rebuttal",
                })
              }
              className="w-full rounded-md border border-white/10 bg-white/5 hover:bg-white/10 p-3 text-xs"
            >
              Rebuttal Email
            </button>
            <button
              onClick={() =>
                exportPdfVariant({
                  normalizedResult,
                  analysisResult,
                  panel,
                  analysisText,
                  variant: "side_by_side",
                })
              }
              className="w-full rounded-md border border-white/10 bg-white/5 hover:bg-white/10 p-3 text-xs"
            >
              Side-by-Side Report
            </button>
            <button
              onClick={() =>
                exportPdfVariant({
                  normalizedResult,
                  analysisResult,
                  panel,
                  analysisText,
                  variant: "line_by_line",
                })
              }
              className="w-full rounded-md border border-white/10 bg-white/5 hover:bg-white/10 p-3 text-xs"
            >
              Line-by-Line Report
            </button>
          </div>
        </section>
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

function exportPdfVariant(params: {
  normalizedResult: AnalysisResult | null;
  analysisResult: RepairIntelligenceReport | null;
  panel: DecisionPanel;
  analysisText: string;
  variant: "rebuttal" | "side_by_side" | "line_by_line";
}) {
  const resolvedAnalysis =
    params.normalizedResult ??
    (params.analysisResult ? normalizeReportToAnalysisResult(params.analysisResult) : null);

  const sharedInput = {
    report: params.analysisResult,
    analysis: resolvedAnalysis,
    panel: params.panel,
    assistantAnalysis: params.analysisText,
  };

  const document =
    params.variant === "rebuttal"
      ? buildRebuttalEmailPdf(sharedInput)
      : params.variant === "side_by_side"
        ? buildSideBySidePdf(sharedInput)
        : buildLineByLinePdf(sharedInput);

  void exportCarrierPDF(document);
}

function AtAGlanceCard({
  renderModel,
  analysisResult,
}: {
  renderModel: ReturnType<typeof buildExportModel>;
  analysisResult: RepairIntelligenceReport | null;
}) {
  const vehicleIdentity = buildPreferredVehicleIdentityLabel(renderModel.vehicle);
  const bullets = [
    vehicleIdentity ? `Vehicle: ${vehicleIdentity}` : null,
    renderModel.supplementItems[0]?.title ? `Top recommendation: ${renderModel.supplementItems[0].title}` : null,
    analysisResult ? `Evidence quality: ${formatLabel(analysisResult.summary.evidenceQuality)}` : null,
  ].filter(Boolean) as string[];

  if (bullets.length === 0 && !renderModel.repairPosition) {
    return null;
  }

  return (
    <section className="mb-4 rounded-2xl border border-orange-500/25 bg-gradient-to-br from-[#C65A2A]/18 via-[#C65A2A]/8 to-white/[0.03] p-5 shadow-[0_18px_50px_rgba(198,90,42,0.14)]">
      <div className="text-[11px] uppercase tracking-[0.22em] text-orange-200/70">At a glance</div>
      <div className="mt-2 text-lg font-semibold text-white">
        {renderModel.repairPosition || "Structured analysis highlights will appear here once documents are processed."}
      </div>
      {bullets.length > 0 && (
        <div className="mt-4 grid gap-2 xl:grid-cols-3">
          {bullets.map((bullet) => (
            <div key={bullet} className="rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-sm text-white/80">
              {bullet}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function FeaturedRecommendationCard({
  item,
}: {
  item: ReturnType<typeof buildExportModel>["supplementItems"][number];
}) {
  return (
    <section className="rounded-2xl border border-orange-500/30 bg-gradient-to-br from-[#C65A2A]/16 via-[#C65A2A]/8 to-black/20 p-5 shadow-[0_18px_45px_rgba(198,90,42,0.16)]">
      <div className="text-[11px] uppercase tracking-[0.22em] text-orange-200/75">Top recommendation</div>
      <div className="mt-2 text-lg font-semibold text-white">{item.title}</div>
      <div className="mt-2 text-xs text-white/60">
        {formatLabel(item.category)} · {formatLabel(item.kind)} · Priority {formatLabel(item.priority)}
      </div>
      <div className="mt-4 text-sm leading-6 text-white/82">{item.rationale}</div>
      {item.evidence && (
        <div className="mt-3 text-xs leading-5 text-white/48">Evidence: {item.evidence}</div>
      )}
      {item.source && (
        <button
          type="button"
          className="mt-4 inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/80 hover:bg-white/10"
        >
          View source details
        </button>
      )}
    </section>
  );
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

function ExpandableDecisionSection({
  title,
  body,
  tone,
  mono = false,
  previewLines = 6,
}: {
  title: string;
  body: string;
  tone: "red" | "yellow" | "green" | "neutral";
  mono?: boolean;
  previewLines?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const tones = {
    red: "border-red-500/30 bg-red-500/5",
    yellow: "border-yellow-500/30 bg-yellow-500/5",
    green: "border-green-500/30 bg-green-500/5",
    neutral: "border-white/10 bg-white/5",
  };
  const previewHeightClass = previewLines >= 7 ? "max-h-48" : "max-h-36";

  return (
    <section className={`rounded-xl border p-4 space-y-3 ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.2em] text-white/45">{title}</div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="text-[11px] font-medium uppercase tracking-[0.16em] text-orange-200/80 hover:text-orange-100"
        >
          {expanded ? "Show less" : "Expand"}
        </button>
      </div>
      <div className="relative">
        <div
          className={`text-sm leading-6 text-white/85 whitespace-pre-wrap ${mono ? "font-mono text-[12px]" : ""} ${
            expanded ? "" : `overflow-hidden ${previewHeightClass}`
          }`}
        >
          {body}
        </div>
        {!expanded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/90 via-black/55 to-transparent" />
        )}
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
      includeHandoffHint: false,
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
      includeHandoffHint: false,
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
  includeHandoffHint?: boolean;
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

  if (params.includeHandoffHint !== false) {
    lines.push("Continue below for the full valuation handoff.");
  }

  return lines.join("\n");
}

function ValuationSection({
  renderModel,
  lowConfidence,
}: {
  renderModel: ReturnType<typeof buildExportModel>;
  lowConfidence: boolean;
}) {
  const [expanded, setExpanded] = useState(!lowConfidence);

  return (
    <section
      className={`rounded-xl border p-4 space-y-3 ${
        lowConfidence
          ? "border-white/10 bg-white/[0.03] opacity-85"
          : "border-green-500/30 bg-green-500/5"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-white/45">Valuation</div>
          {lowConfidence && (
            <div className="mt-1 text-xs text-white/45">
              Low-confidence preview. Expand only if you need the provisional range notes.
            </div>
          )}
        </div>
        {lowConfidence && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/60 hover:text-white/85"
          >
            {expanded ? "Hide" : "Expand"}
          </button>
        )}
      </div>

      {expanded && (
        <div className="text-sm leading-6 text-white/82 whitespace-pre-wrap">
          {buildValuationDisplay(renderModel)}
        </div>
      )}

      <a
        href={COLLISION_ACADEMY_HANDOFF_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/80 hover:bg-white/10"
      >
        Continue for Full Valuation
      </a>
    </section>
  );
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

function hasAtGlanceContent(renderModel: ReturnType<typeof buildExportModel>): boolean {
  return Boolean(
    renderModel.repairPosition ||
      buildPreferredVehicleIdentityLabel(renderModel.vehicle) ||
      renderModel.supplementItems[0]
  );
}

function isLowConfidenceValuation(renderModel: ReturnType<typeof buildExportModel>): boolean {
  const acvLow = !renderModel.valuation.acvConfidence || renderModel.valuation.acvConfidence === "low";
  const dvLow = !renderModel.valuation.dvConfidence || renderModel.valuation.dvConfidence === "low";
  const noStrongRange =
    renderModel.valuation.acvStatus === "not_determinable" &&
    renderModel.valuation.dvStatus === "not_determinable";

  return (acvLow && dvLow) || noStrongRange;
}
