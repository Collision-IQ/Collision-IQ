"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ChatWidget from "@/components/ChatWidget";
import WorkspacePanel from "@/components/WorkspacePanel";
import type { DecisionPanel } from "@/lib/ai/builders/buildDecisionPanel";
import type { AccountEntitlements } from "@/lib/billing/entitlements";
import {
  buildExportModel,
  COLLISION_ACADEMY_HANDOFF_URL,
  resolveCanonicalInsurer,
  resolveCanonicalVehicleLabel,
  resolveCanonicalVin,
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
import type { WorkspaceData } from "@/types/workspaceTypes";

const EMPTY_PANEL: DecisionPanel = {
  narrative:
    "Upload an estimate or supporting documents to generate a decision-ready repair review. This rail will surface the key risks, context, and next steps once analysis completes.",
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
  const [workspaceData, setWorkspaceData] = useState<WorkspaceData | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [consentResolved, setConsentResolved] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [viewerAccess, setViewerAccess] = useState<AccountEntitlements | null>(null);
  const normalizedResult = useMemo(
    () => (analysisResult ? normalizeReportToAnalysisResult(analysisResult) : null),
    [analysisResult]
  );
  const hasResolvedAnalysis = Boolean(analysisResult && normalizedResult);
  const renderModel = useMemo(
    () =>
      buildExportModel({
        report: analysisResult,
        analysis: normalizedResult,
        panel: hasResolvedAnalysis ? analysisPanel : null,
        assistantAnalysis: hasResolvedAnalysis ? analysisText : "",
      }),
    [analysisPanel, analysisResult, analysisText, hasResolvedAnalysis, normalizedResult]
  );

  const panel = hasResolvedAnalysis ? analysisPanel ?? EMPTY_PANEL : EMPTY_PANEL;
  const railOpen = isMobile ? false : desktopRailOpen;

  function handleRailOpenChange(next: boolean) {
    if (isMobile) return;
    setDesktopRailOpen(next);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (typeof window === "undefined") return;

    setConsentAccepted(Boolean(readStoredChatConsent()));
    setConsentResolved(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    let cancelled = false;

    async function loadViewerAccess() {
      try {
        const response = await fetch("/api/account/entitlements", {
          credentials: "same-origin",
        });
        if (!response.ok) return;

        const data = (await response.json()) as AccountEntitlements;
        if (!cancelled) {
          setViewerAccess(data);
        }
      } catch {
        if (!cancelled) {
          setViewerAccess(null);
        }
      }
    }

    void loadViewerAccess();
    return () => {
      cancelled = true;
    };
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (viewerAccess?.consentStatus !== "ACCEPTED" || typeof window === "undefined") {
      return;
    }

    if (consentAccepted) {
      return;
    }

    const record: ChatConsentRecord = {
      consentStatus: "accepted",
      acceptedAt: new Date().toISOString(),
      termsVersion: CHAT_CONSENT_TERMS_VERSION,
      privacyVersion: CHAT_CONSENT_PRIVACY_VERSION,
      checkboxChecked: true,
    };

    window.localStorage.setItem(CHAT_CONSENT_STORAGE_KEY, JSON.stringify(record));
    setConsentAccepted(true);
  }, [consentAccepted, viewerAccess]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleConsentAccept() {
    if (!consentChecked || typeof window === "undefined") return;

    const record: ChatConsentRecord = {
      consentStatus: "accepted",
      acceptedAt: new Date().toISOString(),
      termsVersion: CHAT_CONSENT_TERMS_VERSION,
      privacyVersion: CHAT_CONSENT_PRIVACY_VERSION,
      checkboxChecked: true,
    };

    window.localStorage.setItem(CHAT_CONSENT_STORAGE_KEY, JSON.stringify(record));

    try {
      await fetch("/api/account/consent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(record),
      });
    } catch {
      // Local consent remains the primary gate until auth rollout is complete.
    }

    setConsentAccepted(true);
  }

  function handleConsentCancel() {
    router.push("/");
  }

  if (isMobile === null || !consentResolved) return null;

  const chatBlocked = !consentAccepted;
  const featureFlags = viewerAccess?.featureFlags;
  const canViewSupplementLines = featureFlags?.supplement_lines ?? false;
  const canViewNegotiationDraft = featureFlags?.negotiation_draft ?? false;
  const canUseBasicPdfExport = featureFlags?.basic_pdf_export ?? true;
  const canUseRebuttalEmail = featureFlags?.rebuttal_email ?? false;
  const canUseSideBySide = featureFlags?.side_by_side_report ?? false;
  const canUseLineByLine = featureFlags?.line_by_line_report ?? false;

  return (
    <div className="flex h-screen flex-col bg-[#050505] text-white">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-x-0 top-[-180px] mx-auto h-[460px] w-[860px] rounded-full bg-[#C65A2A]/10 blur-3xl" />
        <div className="absolute right-[-140px] top-[18%] h-[360px] w-[360px] rounded-full bg-white/[0.04] blur-3xl" />
      </div>
      <header className="sticky top-0 z-30 border-b border-white/6 bg-[#050505]/78 backdrop-blur-2xl">
        <div className="mx-auto flex h-[70px] max-w-[1640px] items-center justify-between px-5 md:px-6">
          <div className="flex items-center gap-3">
            <Image
              src="/brand/logos/Logo-grey.png"
              alt="Collision Academy"
              width={150}
              height={40}
              className="h-auto w-[132px] opacity-85"
              priority
            />

            <div className="space-y-0.5">
              <h1 className="bg-gradient-to-r from-white via-white to-white/70 bg-clip-text text-[1.08rem] font-semibold tracking-[-0.03em] text-transparent">
                Collision-IQ
              </h1>

              <p className="text-[11px] text-white/40">
                Repair intelligence for estimates, OEM procedures, and damage photos
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <a
              href="https://collision-iq.ai/"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full bg-white/[0.045] px-3 py-1.5 text-xs font-medium text-white/65 transition hover:bg-white/[0.075] hover:text-white/85"
            >
              Collision Academy
            </a>

            <div className="flex flex-wrap items-center justify-end gap-2 text-[11px] text-white/40">
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

      <div className="relative z-10 mx-auto flex min-h-0 w-full max-w-[1640px] flex-1 gap-5 px-3 pb-3 pt-4 md:px-5 md:pb-5">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 justify-center">
            <div className="flex min-h-0 w-full max-w-[980px] flex-col">
              {!isMobile && (
                <AtAGlanceCard
                  renderModel={renderModel}
                  analysisResult={analysisResult}
                  active={hasResolvedAnalysis && hasAtGlanceContent(renderModel)}
                />
              )}
              <div className="min-h-0 flex-1">
                <ChatWidget
                  onAttachmentChange={setAttachment}
                  onAnalysisChange={setAnalysisText}
                  onAnalysisResultChange={setAnalysisResult}
                  onAnalysisPanelChange={setAnalysisPanel}
                  onAnalysisLoadingChange={setAnalysisLoading}
                  onWorkspaceDataChange={setWorkspaceData}
                  disabled={chatBlocked}
                />
              </div>
            </div>
          </div>
        </div>

        {!isMobile && (
          <aside className="flex w-[400px] xl:w-[436px] flex-col rounded-[28px] bg-white/[0.045] shadow-[0_28px_80px_rgba(0,0,0,0.34)] backdrop-blur-2xl">
            <RailContent
              attachment={attachment}
              analysisText={analysisText}
              analysisLoading={analysisLoading}
              hasResolvedAnalysis={hasResolvedAnalysis}
              panel={panel}
              renderModel={renderModel}
              normalizedResult={normalizedResult}
              analysisResult={analysisResult}
              workspaceData={workspaceData}
              canViewSupplementLines={canViewSupplementLines}
              canViewNegotiationDraft={canViewNegotiationDraft}
              canUseBasicPdfExport={canUseBasicPdfExport}
              canUseRebuttalEmail={canUseRebuttalEmail}
              canUseSideBySide={canUseSideBySide}
              canUseLineByLine={canUseLineByLine}
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
            analysisLoading={analysisLoading}
            hasResolvedAnalysis={hasResolvedAnalysis}
            panel={panel}
            renderModel={renderModel}
            normalizedResult={normalizedResult}
            analysisResult={analysisResult}
            workspaceData={workspaceData}
            canViewSupplementLines={canViewSupplementLines}
            canViewNegotiationDraft={canViewNegotiationDraft}
            canUseBasicPdfExport={canUseBasicPdfExport}
            canUseRebuttalEmail={canUseRebuttalEmail}
            canUseSideBySide={canUseSideBySide}
            canUseLineByLine={canUseLineByLine}
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
            <div className="w-full max-w-2xl rounded-3xl border border-white/8 bg-black/80 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.6)] md:p-8">
              <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">
                Collision IQ Consent
              </div>
              <h2 id="chat-consent-title" className="mt-3 text-2xl font-semibold text-white md:text-3xl">
                Consent Required to Use AI Chat
              </h2>
              <div className="mt-3 space-y-4 text-sm leading-7 text-white/65 md:text-base">
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

              <div className="mt-6 rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={consentChecked}
                    onChange={(event) => setConsentChecked(event.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-white/20 bg-black/40 text-orange-500 focus:ring-orange-500"
                  />
                  <span className="text-sm leading-6 text-white/65">
                    I have read and agree to the Terms of Service and Privacy Policy, and I consent to the use of the AI chatbot as described above.
                  </span>
                </label>
                <p className="mt-3 text-xs leading-5 text-white/40">
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
                    className="rounded-2xl bg-white/[0.045] px-4 py-2 text-sm text-white/65 transition hover:bg-white/[0.075] hover:text-white/85"
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
  analysisLoading,
  hasResolvedAnalysis,
  panel,
  renderModel,
  normalizedResult,
  analysisResult,
  workspaceData,
  canViewSupplementLines,
  canViewNegotiationDraft,
  canUseBasicPdfExport,
  canUseRebuttalEmail,
  canUseSideBySide,
  canUseLineByLine,
}: {
  attachment: string | null;
  analysisText: string;
  analysisLoading: boolean;
  hasResolvedAnalysis: boolean;
  panel: DecisionPanel;
  renderModel: ReturnType<typeof buildExportModel>;
  normalizedResult: AnalysisResult | null;
  analysisResult: RepairIntelligenceReport | null;
  workspaceData: WorkspaceData | null;
  canViewSupplementLines: boolean;
  canViewNegotiationDraft: boolean;
  canUseBasicPdfExport: boolean;
  canUseRebuttalEmail: boolean;
  canUseSideBySide: boolean;
  canUseLineByLine: boolean;
}) {
  const featuredRecommendation = renderModel.supplementItems[0];
  const remainingRecommendations = renderModel.supplementItems.slice(1);
  const valuationLowConfidence = isLowConfidenceValuation(renderModel);
  const vehicleIdentity = resolveCanonicalVehicleLabel(renderModel);
  const vehicleVin = resolveCanonicalVin(renderModel);
  const insurer = resolveCanonicalInsurer(renderModel);
  const estimateTotal =
    typeof renderModel.reportFields.estimateTotal === "number"
      ? formatCurrency(renderModel.reportFields.estimateTotal, true)
      : null;
  const canRenderExports = hasResolvedAnalysis && Boolean(analysisText || panel.narrative);
  const railRisk = hasResolvedAnalysis
    ? formatLabel(workspaceData?.riskLevel ?? "low")
    : "Pending";
  const railConfidence = hasResolvedAnalysis
    ? formatLabel(workspaceData?.confidence ?? renderModel.vehicle.confidence)
    : "Pending";
  const railStatus = analysisLoading
    ? "Processing"
    : hasResolvedAnalysis
      ? "Ready"
      : "Awaiting files";
  const attachmentLabel = attachment ?? "No attachment yet";

  return (
    <div className="flex h-full flex-col overflow-y-auto px-5 py-5 md:px-6 md:py-6">
      <section className="rounded-[24px] border border-white/8 bg-gradient-to-br from-white/[0.07] via-white/[0.035] to-black/20 p-4 shadow-[0_20px_48px_rgba(0,0,0,0.24)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">
              Claim Command Center
            </div>
            <div className="mt-1.5 text-[1.12rem] font-semibold tracking-[-0.03em] text-white/85">
              Decision-Ready Analysis
            </div>
            <div className="mt-1 text-[13px] leading-5 text-white/40">
              Fast scan first. Details below.
            </div>
          </div>
          <div className="rounded-full border border-white/8 bg-black/20 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-white/40">
            {railStatus}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <MetricCard label="Risk" value={railRisk} prominent={hasResolvedAnalysis} />
          <MetricCard label="Confidence" value={railConfidence} prominent={hasResolvedAnalysis} />
          <MetricCard
            label="Latest file"
            value={attachmentLabel}
            detailClassName="truncate text-[12px]"
          />
          <MetricCard label="Analysis" value={railStatus} />
        </div>
      </section>

      {analysisLoading && !hasResolvedAnalysis && (
        <section className="mt-5 space-y-2 rounded-2xl border border-orange-500/12 bg-gradient-to-br from-[#C65A2A]/10 via-[#C65A2A]/[0.04] to-white/[0.02] p-3.5">
          <div className="text-[10px] uppercase tracking-[0.22em] text-orange-200/68">
            Analysis in progress
          </div>
          <div className="text-[13px] leading-5 text-white/65">
            Structured review is still hydrating for the current file set. We&apos;ll populate the
            rail, valuation, supplement lines, and exports when the analysis route finishes.
          </div>
        </section>
      )}

      <RailGroup label="Decision" />

      {hasResolvedAnalysis && featuredRecommendation && (
        <FeaturedRecommendationCard item={featuredRecommendation} />
      )}

      {hasResolvedAnalysis ? (
        <DecisionSection title="What stands out" body={renderModel.repairPosition} tone="neutral" featured />
      ) : (
        <section className="mt-5 space-y-2 rounded-2xl border border-white/7 bg-white/[0.03] p-3.5">
          <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">What stands out</div>
          <div className="text-[13px] leading-5 text-white/65">
            Upload an estimate or photos to generate the key repair risks, missing support, and next-step guidance.
          </div>
        </section>
      )}

      <RailGroup label="Context" compact />

      {hasResolvedAnalysis && (
        <section className="mt-5 space-y-2.5 rounded-2xl border border-white/7 bg-white/[0.03] p-3.5">
          <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">
            Vehicle Context
          </div>
          <div className="space-y-1.5 text-[13px] leading-5 text-white/65">
            {vehicleIdentity && <div className="text-white/85">{vehicleIdentity}</div>}
            {renderModel.vehicle.trim && (
              <div className="text-white/65">Trim: {renderModel.vehicle.trim}</div>
            )}
            {vehicleVin && <div className="text-white/65">VIN: {vehicleVin}</div>}
            {insurer && <div className="text-white/65">Insurer: {insurer}</div>}
            {typeof renderModel.reportFields.mileage === "number" && (
              <div className="text-white/65">
                Mileage: {renderModel.reportFields.mileage.toLocaleString("en-US")}
              </div>
            )}
            {estimateTotal && <div className="text-white/65">Estimate total: {estimateTotal}</div>}
            <div className="text-white/40">
              Confidence: {formatVehicleConfidence(renderModel.vehicle)}
            </div>
          </div>
        </section>
      )}

      <div className="mt-5">
        <WorkspacePanel workspaceData={workspaceData ?? undefined} />
      </div>

      <RailGroup label="Action" compact />

      {hasResolvedAnalysis && canViewSupplementLines ? (
        <section className="mt-5 space-y-2.5 rounded-2xl border border-white/7 bg-white/[0.03] p-3.5">
        <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">
          Supplements
        </div>
        {remainingRecommendations.length > 0 ? (
          <div className="space-y-2.5">
            {remainingRecommendations.map((item, index) => (
              <div key={`${item.title}-${index}`} className="rounded-xl bg-black/16 px-3 py-3">
                <div className="text-sm font-medium leading-5 text-white/85">
                  {item.title}
                </div>
                <div className="mt-1 text-xs text-white/40">
                  {formatLabel(item.category)} · {formatLabel(item.kind)} · Priority {formatLabel(item.priority)}
                </div>
                <div className="mt-2 text-[13px] leading-5 text-white/65">{item.rationale}</div>
                {item.evidence && (
                  <div className="mt-2 text-xs leading-5 text-white/40">Evidence: {item.evidence}</div>
                )}
                {item.source && (
                  <div className="mt-1 text-[11px] leading-5 text-white/40">Source: {item.source}</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[13px] leading-5 text-white/40">
            {featuredRecommendation
              ? "The strongest recommendation is highlighted above."
              : "No clear supportable missing, underwritten, or disputed repair-path items were identified from the current structured analysis."}
          </div>
        )}
        </section>
      ) : hasResolvedAnalysis ? (
        <LockedFeatureCard
          title="Supplements"
          body="Upgrade to Pro to unlock detailed supplement-line recommendations, evidence, and export-ready support details."
        />
      ) : null}

      {hasResolvedAnalysis && analysisResult && (
        <ValuationSection renderModel={renderModel} lowConfidence={valuationLowConfidence} />
      )}

      {hasResolvedAnalysis && renderModel.request && canViewNegotiationDraft && (
        <ExpandableDecisionSection
          title="Negotiation Draft"
          body={renderModel.request}
          tone="neutral"
          mono
          previewLines={7}
        />
      )}

      {hasResolvedAnalysis && renderModel.request && !canViewNegotiationDraft && (
        <LockedFeatureCard
          title="Negotiation Draft"
          body="Upgrade to Pro to unlock the negotiation draft, rebuttal support, and premium carrier-facing exports."
        />
      )}

      {hasResolvedAnalysis && panel.appraisal?.triggered && panel.appraisal.reasoning && (
        <DecisionSection
          title="Appraisal Signal"
          body={panel.appraisal.reasoning}
          tone="red"
          compact
        />
      )}

      {hasResolvedAnalysis && panel.stateLeverage && panel.stateLeverage.length > 0 && (
        <DecisionSection
          title="State Leverage"
          body={panel.stateLeverage.map((point) => `- ${point}`).join("\n")}
          tone="yellow"
          compact
        />
      )}

      <RailGroup label="Output" compact />

      {canRenderExports && (
        <section className="mt-5 space-y-3 rounded-2xl bg-white/[0.03] p-4">
          <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">
            Exports
          </div>
          <div className="grid gap-2">
            <button
              onClick={() =>
                exportReport(
                  renderModel,
                  normalizedResult,
                  analysisResult,
                  panel,
                  analysisText,
                  workspaceData
                )
              }
              disabled={!canUseBasicPdfExport}
              className="w-full rounded-xl bg-white/[0.045] p-3 text-xs text-white/65 transition hover:bg-white/[0.075] hover:text-white/85 disabled:cursor-not-allowed disabled:opacity-40"
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
                  workspaceData,
                  renderModel,
                  variant: "rebuttal",
                })
              }
              disabled={!canUseRebuttalEmail}
              className="w-full rounded-xl bg-white/[0.045] p-3 text-xs text-white/65 transition hover:bg-white/[0.075] hover:text-white/85 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {canUseRebuttalEmail ? "Rebuttal Email" : "Rebuttal Email (Pro)"}
            </button>
            <button
              onClick={() =>
                exportPdfVariant({
                  normalizedResult,
                  analysisResult,
                  panel,
                  analysisText,
                  workspaceData,
                  renderModel,
                  variant: "side_by_side",
                })
              }
              disabled={!canUseSideBySide}
              className="w-full rounded-xl bg-white/[0.045] p-3 text-xs text-white/65 transition hover:bg-white/[0.075] hover:text-white/85 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {canUseSideBySide ? "Side-by-Side Report" : "Side-by-Side Report (Pro)"}
            </button>
            <button
              onClick={() =>
                exportPdfVariant({
                  normalizedResult,
                  analysisResult,
                  panel,
                  analysisText,
                  workspaceData,
                  renderModel,
                  variant: "line_by_line",
                })
              }
              disabled={!canUseLineByLine}
              className="w-full rounded-xl bg-white/[0.045] p-3 text-xs text-white/65 transition hover:bg-white/[0.075] hover:text-white/85 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {canUseLineByLine ? "Line-by-Line Report" : "Line-by-Line Report (Pro)"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function exportReport(
  renderModel: ReturnType<typeof buildExportModel>,
  normalizedResult: AnalysisResult | null,
  analysisResult: RepairIntelligenceReport | null,
  panel: DecisionPanel,
  analysisText: string,
  workspaceData: WorkspaceData | null
) {
  const resolvedAnalysis =
    normalizedResult ?? (analysisResult ? normalizeReportToAnalysisResult(analysisResult) : null);

  const reportDocument = buildCarrierReport({
    renderModel,
    report: analysisResult,
    analysis: resolvedAnalysis,
    panel,
    assistantAnalysis: analysisText,
    workspaceData,
  });

  void exportCarrierPDF(reportDocument);
}

function exportPdfVariant(params: {
  renderModel: ReturnType<typeof buildExportModel>;
  normalizedResult: AnalysisResult | null;
  analysisResult: RepairIntelligenceReport | null;
  panel: DecisionPanel;
  analysisText: string;
  workspaceData: WorkspaceData | null;
  variant: "rebuttal" | "side_by_side" | "line_by_line";
}) {
  const resolvedAnalysis =
    params.normalizedResult ??
    (params.analysisResult ? normalizeReportToAnalysisResult(params.analysisResult) : null);

  const sharedInput = {
    renderModel: params.renderModel,
    report: params.analysisResult,
    analysis: resolvedAnalysis,
    panel: params.panel,
    assistantAnalysis: params.analysisText,
    workspaceData: params.workspaceData,
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
  active,
}: {
  renderModel: ReturnType<typeof buildExportModel>;
  analysisResult: RepairIntelligenceReport | null;
  active: boolean;
}) {
  const vehicleIdentity = resolveCanonicalVehicleLabel(renderModel);
  const bullets = [
    vehicleIdentity ? `Vehicle: ${vehicleIdentity}` : null,
    resolveCanonicalVin(renderModel) ? `VIN: ${resolveCanonicalVin(renderModel)}` : null,
    resolveCanonicalInsurer(renderModel) ? `Insurer: ${resolveCanonicalInsurer(renderModel)}` : null,
    typeof renderModel.reportFields.mileage === "number"
      ? `Mileage: ${renderModel.reportFields.mileage.toLocaleString("en-US")}`
      : null,
    typeof renderModel.reportFields.estimateTotal === "number"
      ? `Estimate total: ${formatCurrency(renderModel.reportFields.estimateTotal, true)}`
      : null,
    renderModel.supplementItems[0]?.title
      ? `Top recommendation: ${renderModel.supplementItems[0].title}`
      : null,
    analysisResult
      ? `Evidence quality: ${formatLabel(analysisResult.summary.evidenceQuality)}`
      : null,
  ].filter(Boolean) as string[];
  const visibleBullets = bullets.slice(0, 3);
  const hiddenBulletCount = Math.max(0, bullets.length - visibleBullets.length);
  const headline = active
    ? renderModel.repairPosition ||
      "Structured analysis highlights will appear here once documents are processed."
    : "Analysis summary will settle here once the current file set finishes processing.";

  return (
    <section
      className={`mb-3 shrink-0 rounded-[24px] border px-4 py-3 shadow-[0_20px_50px_rgba(198,90,42,0.12)] transition-colors ${
        active
          ? "border-orange-500/18 bg-gradient-to-br from-[#C65A2A]/12 via-[#C65A2A]/[0.05] to-white/[0.025]"
          : "border-white/7 bg-white/[0.03]"
      }`}
    >
      <div
        className={`text-[10px] uppercase tracking-[0.22em] ${
          active ? "text-orange-200/68" : "text-white/40"
        }`}
      >
        At a glance
      </div>
      <div
        className={`mt-2 min-h-[48px] max-h-[4.8rem] overflow-hidden text-[1rem] font-semibold leading-6 ${
          active ? "text-white/85" : "text-white/40"
        }`}
      >
        {headline}
      </div>
      <div className="mt-3 grid min-h-[54px] gap-2 sm:grid-cols-3">
        {active && visibleBullets.length > 0 ? (
          <>
            {visibleBullets.map((bullet) => (
              <div
                key={bullet}
                className="rounded-xl bg-black/22 px-3 py-2 text-[13px] leading-5 text-white/65"
              >
                {bullet}
              </div>
            ))}
            {hiddenBulletCount > 0 && (
              <div className="rounded-xl bg-black/18 px-3 py-2 text-[13px] leading-5 text-white/40">
                +{hiddenBulletCount} more details in the right rail
              </div>
            )}
          </>
        ) : (
          <>
            <div className="rounded-xl bg-black/18 px-3 py-2 text-[13px] leading-5 text-white/40">
              Vehicle and estimate summary
            </div>
            <div className="rounded-xl bg-black/18 px-3 py-2 text-[13px] leading-5 text-white/40">
              Top recommendation snapshot
            </div>
            <div className="rounded-xl bg-black/18 px-3 py-2 text-[13px] leading-5 text-white/40">
              Evidence quality and insurer context
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function RailGroup({
  label,
  compact = false,
}: {
  label: string;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "mt-5.5" : "mt-5"}>
      <div className="flex items-center gap-3">
        <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">{label}</div>
        <div className="h-px flex-1 bg-white/8" />
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  prominent = false,
  detailClassName = "",
}: {
  label: string;
  value: string;
  prominent?: boolean;
  detailClassName?: string;
}) {
  return (
    <div
      className={`min-w-0 rounded-xl border border-white/7 px-3 py-2.5 ${
        prominent
          ? "bg-gradient-to-br from-[#C65A2A]/18 via-[#C65A2A]/[0.07] to-black/18"
          : "bg-black/16"
      }`}
    >
      <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">{label}</div>
      <div className={`mt-1 min-w-0 font-medium text-white/85 ${detailClassName || "text-sm"}`}>{value}</div>
    </div>
  );
}

function FeaturedRecommendationCard({
  item,
}: {
  item: ReturnType<typeof buildExportModel>["supplementItems"][number];
}) {
  return (
    <section className="rounded-[24px] border border-orange-500/20 bg-gradient-to-br from-[#C65A2A]/12 via-[#C65A2A]/[0.045] to-black/20 p-4 shadow-[0_18px_44px_rgba(198,90,42,0.14)]">
      <div className="text-[10px] uppercase tracking-[0.22em] text-orange-200/72">Top recommendation</div>
      <div className="mt-2 text-[1.08rem] font-semibold leading-6 text-white/85">{item.title}</div>
      <div className="mt-2 text-xs text-white/40">
        {formatLabel(item.category)} · {formatLabel(item.kind)} · Priority {formatLabel(item.priority)}
      </div>
      <div className="mt-3 text-sm leading-6 text-white/65">{item.rationale}</div>
      {item.evidence && (
        <div className="mt-3 text-xs leading-5 text-white/40">Evidence: {item.evidence}</div>
      )}
      {item.source && (
        <button
          type="button"
          className="mt-4 inline-flex items-center rounded-xl bg-white/[0.045] px-3 py-2 text-xs font-medium text-white/65 transition hover:bg-white/[0.075] hover:text-white/85"
        >
          View source details
        </button>
      )}
    </section>
  );
}

function LockedFeatureCard({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <section className="space-y-2.5 rounded-2xl border border-orange-500/16 bg-gradient-to-br from-[#C65A2A]/9 via-black/34 to-black/18 p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-[0.22em] text-orange-200/68">{title}</div>
        <Link
          href="/pricing"
          className="rounded-full border border-orange-500/24 bg-orange-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-orange-100 transition hover:bg-orange-500/18"
        >
          Upgrade
        </Link>
      </div>
      <div className="text-[13px] leading-5 text-white/65">{body}</div>
    </section>
  );
}

function DecisionSection({
  title,
  body,
  tone,
  mono = false,
  compact = false,
  featured = false,
}: {
  title: string;
  body: string;
  tone: "red" | "yellow" | "green" | "neutral";
  mono?: boolean;
  compact?: boolean;
  featured?: boolean;
}) {
  const tones = {
    red: "border-red-500/18 bg-red-500/[0.04]",
    yellow: "border-yellow-500/18 bg-yellow-500/[0.04]",
    green: "border-green-500/18 bg-green-500/[0.04]",
    neutral: "border-white/7 bg-white/[0.032]",
  };

  return (
    <section
      className={`space-y-2.5 rounded-2xl border ${compact ? "p-3.5" : "p-4"} ${tones[tone]} ${
        featured ? "shadow-[0_18px_40px_rgba(0,0,0,0.18)]" : ""
      }`}
    >
      <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">{title}</div>
      <div
        className={`whitespace-pre-wrap ${
          compact ? "text-[13px] leading-5 text-white/65" : featured ? "text-sm leading-6 text-white/65" : "text-sm leading-6 text-white/65"
        } ${mono ? "font-mono text-[12px]" : ""}`}
      >
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
    red: "border-red-500/18 bg-red-500/[0.04]",
    yellow: "border-yellow-500/18 bg-yellow-500/[0.04]",
    green: "border-green-500/18 bg-green-500/[0.04]",
    neutral: "border-white/7 bg-white/[0.032]",
  };
  const previewHeightClass = previewLines >= 7 ? "max-h-48" : "max-h-36";

  return (
    <section className={`space-y-2.5 rounded-2xl border p-3.5 ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">{title}</div>
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
          className={`text-[13px] leading-5 text-white/65 whitespace-pre-wrap ${mono ? "font-mono text-[12px]" : ""} ${
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

function buildValuationDisplay(renderModel: ReturnType<typeof buildExportModel>): string {
  return [
    "ACV",
    buildSingleValuationDisplay({
      label: "Preliminary ACV preview band",
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
      sourceType: renderModel.valuation.acvSourceType,
      compCount: renderModel.valuation.acvCompCount,
      includeHandoffHint: false,
    }),
    "",
    "DV",
    buildSingleValuationDisplay({
      label: "Preliminary diminished value preview band",
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
  sourceType?: "comps" | "jd_power" | "fallback";
  compCount?: number;
  includeHandoffHint?: boolean;
}): string {
  const lines: string[] = [];

  if (params.status === "provided" && typeof params.value === "number") {
    lines.push(`${params.label}: directional preview around ${formatCurrency(params.value)}`);
  } else if (params.status === "estimated_range" && hasSaneRange(params.range, params.maxRange)) {
    lines.push(`${params.label}: ${formatCurrency(params.range.low)}-${formatCurrency(params.range.high)}`);
  } else {
    lines.push(`${params.label}: Preview band not supportable from the current file set.`);
  }

  if (params.confidence) {
    lines.push(`Preview confidence: ${formatLabel(params.confidence)}`);
  }

  if (params.sourceType === "comps" && typeof params.compCount === "number" && params.compCount > 0) {
    lines.push(`Support: ${params.compCount} comparable listing${params.compCount === 1 ? "" : "s"}`);
  } else if (params.sourceType === "jd_power") {
    lines.push("Support: structured market valuation data");
  }

  const reasoning = cleanValuationReasoning(
    params.reasoning,
    params.status === "not_determinable"
      ? "Preview band not supportable from the current file set."
      : params.label
  );
  if (reasoning) {
    lines.push(reasoning);
  }

  if (params.missingInputs.length) {
    lines.push(`Still needed for a stronger preview: ${params.missingInputs.join(", ")}`);
  }

  if (params.status === "provided" || params.status === "estimated_range") {
    lines.push("Directional only. This preview is not a formal appraisal, binding ACV, or paid valuation result.");
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
      className={`space-y-3 rounded-2xl border p-3.5 ${
        lowConfidence
          ? "border-white/7 bg-white/[0.03] opacity-90"
          : "border-green-500/18 bg-green-500/[0.04]"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">Valuation</div>
          {lowConfidence && (
            <div className="mt-1 text-xs leading-5 text-white/40">
              Low-confidence preview. Expand for the directional band, limits, and missing inputs.
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
        <div className="text-[13px] leading-5 text-white/65 whitespace-pre-wrap">
          {buildValuationDisplay(renderModel)}
        </div>
      )}

      <div className="rounded-xl bg-black/18 px-3 py-2.5 text-[12px] leading-5 text-white/40">
        Premium preview only. The formal valuation service can widen, tighten, or move the band after full file review and broader market support.
      </div>

      <a
        href={COLLISION_ACADEMY_HANDOFF_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center justify-center rounded-xl bg-[#C65A2A]/18 px-3 py-2 text-[11px] font-medium text-white/85 transition hover:bg-[#C65A2A]/26 sm:w-auto"
      >
        Continue for Full Valuation
      </a>
    </section>
  );
}

function formatCurrency(value: number, includeCents = false): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: includeCents ? 2 : 0,
    maximumFractionDigits: includeCents ? 2 : 0,
  }).format(value);
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
      resolveCanonicalVehicleLabel(renderModel) ||
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
