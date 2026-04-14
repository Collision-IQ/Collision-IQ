"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ChatShell from "@/components/ChatShell";
import ChatWidget from "@/components/ChatWidget";
import CaseContextSummary from "@/components/CaseContextSummary";
import {
  buildEvidenceLinkModel,
  type EvidenceLink,
  type EvidenceLinkModel,
  findEvidenceLinkForDisputeDriver,
} from "@/components/chatbot/evidenceLinks";
import { resolveFinancialView } from "@/components/chatbot/financialView";
import type { InsightKey } from "@/components/chatbot/insightSync";
import StructuredAnalysisCanvas from "@/components/StructuredAnalysisCanvas";
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
import { buildDisputeIntelligencePdf } from "@/lib/ai/builders/disputeIntelligencePdfBuilder";
import { exportCarrierPDF } from "@/lib/ai/builders/exportPdf";
import { buildRebuttalEmailPdf } from "@/lib/ai/builders/rebuttalEmailPdfBuilder";
import { normalizeReportToAnalysisResult } from "@/lib/ai/builders/normalizeReportToAnalysisResult";
import { cleanOperationDisplayText } from "@/lib/ui/presentationText";
import type {
  AnalysisResult,
  RepairIntelligenceReport,
} from "@/lib/ai/types/analysis";
import type { WorkspaceData } from "@/types/workspaceTypes";

function displayOperationLabel(value: string | null | undefined): string {
  return cleanOperationDisplayText(value) || value || "Repair Operation";
}

type SupplementItem = ReturnType<typeof buildExportModel>["supplementItems"][number];
type AttachmentTrayItem = {
  attachmentId: string;
  filename: string;
  hasVision?: boolean;
};

type DisputeDriver = {
  title: string;
  impact: string;
  whyItMatters: string;
  carrierPosture: string;
  action: string;
};

type NegotiationPosture = {
  likelyApprovedItems: string[];
  likelyPushbackItems: string[];
  highLeverageArguments: string[];
  suggestedStrategy: string[];
};

type LineStatus = {
  title: string;
  impact: string;
  status: string;
  whyItMatters: string;
  action: string;
};

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

export function ChatbotWorkspacePage() {
  const router = useRouter();
  const centerScrollRequestRef = useRef<((key: InsightKey) => void) | null>(null);
  const chatSessionControlsRef = useRef<{
    focusComposer: () => void;
    resetSession: () => void;
  } | null>(null);
  const [attachment, setAttachment] = useState<string | null>(null);
  const [attachmentsState, setAttachmentsState] = useState<AttachmentTrayItem[]>([]);
  const [analysisText, setAnalysisText] = useState("");
  const [primaryAnalysis, setPrimaryAnalysis] = useState<{
    messageId: string;
    content: string;
  } | null>(null);
  const [activeInsightKey, setActiveInsightKey] = useState<InsightKey | null>("executive_summary");
  const [activeEvidenceTargetId, setActiveEvidenceTargetId] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<RepairIntelligenceReport | null>(null);
  const [analysisPanel, setAnalysisPanel] = useState<DecisionPanel | null>(null);
  const [workspaceData, setWorkspaceData] = useState<WorkspaceData | null>(null);
  const [caseIntent, setCaseIntent] = useState("");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<"idle" | "processing" | "complete" | "error">("idle");
  const [analysisStatusDetail, setAnalysisStatusDetail] = useState<string | null>(null);
  const [endAnalysisConfirming, setEndAnalysisConfirming] = useState(false);
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
  const financialView = useMemo(
    () =>
      resolveFinancialView({
        renderModel,
        normalizedResult,
        workspaceData,
      }),
    [normalizedResult, renderModel, workspaceData]
  );
  const evidenceModel = useMemo<EvidenceLinkModel | null>(() => {
    if (!hasResolvedAnalysis) return null;

    return buildEvidenceLinkModel({
      renderModel,
      workspaceData,
      normalizedResult,
      analysisResult,
      financialView,
    });
  }, [analysisResult, financialView, hasResolvedAnalysis, normalizedResult, renderModel, workspaceData]);

  const panel = hasResolvedAnalysis ? analysisPanel ?? EMPTY_PANEL : EMPTY_PANEL;
  const hasStructuredAnalysis = hasResolvedAnalysis;

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

  const trialDaysRemaining = useMemo(() => {
    if (!viewerAccess) return null;

    const isTrial =
      viewerAccess.plan === "trial" ||
      viewerAccess.activeSubscriptionStatus === "TRIALING";

    if (!isTrial) return null;

    const createdAt = viewerAccess.createdAt
      ? new Date(viewerAccess.createdAt)
      : null;

    if (!createdAt || Number.isNaN(createdAt.getTime())) return null;

    const now = new Date();
    const trialEnd = new Date(createdAt);
    trialEnd.setDate(trialEnd.getDate() + 30);

    const diffMs = trialEnd.getTime() - now.getTime();
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    return days > 0 ? days : 0;
  }, [viewerAccess]);

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
    router.push("/collision-academy");
  }

  function handleContinueReview() {
    setActiveInsightKey(null);
    setActiveEvidenceTargetId(null);
    setEndAnalysisConfirming(false);
    chatSessionControlsRef.current?.focusComposer();
  }

  function handleRequestEndAnalysis() {
    setEndAnalysisConfirming(true);
  }

  function handleCancelEndAnalysis() {
    setEndAnalysisConfirming(false);
  }

  function handleSessionReset() {
    setAttachment(null);
    setAttachmentsState([]);
    setAnalysisText("");
    setPrimaryAnalysis(null);
    setAnalysisResult(null);
    setAnalysisPanel(null);
    setWorkspaceData(null);
    setCaseIntent("");
    setAnalysisLoading(false);
    setAnalysisStatus("idle");
    setAnalysisStatusDetail(null);
    setActiveInsightKey(null);
    setActiveEvidenceTargetId(null);
    setEndAnalysisConfirming(false);
  }

  function handleAnalysisResultChange(next: RepairIntelligenceReport | null) {
    setAnalysisResult(next);

    if (next) {
      setAnalysisStatus("complete");
      setAnalysisStatusDetail(null);
      setActiveInsightKey((current) => current ?? "executive_summary");
    }
  }

  function handleEvidenceSelect(link: EvidenceLink) {
    setActiveInsightKey(link.insightKey);
    setActiveEvidenceTargetId(link.targetId);
    centerScrollRequestRef.current?.(link.insightKey);
  }

  function handleConfirmEndAnalysis() {
    chatSessionControlsRef.current?.resetSession();
    handleSessionReset();
  }

  if (!consentResolved) return null;

  const chatBlocked = !consentAccepted;
  const featureFlags = viewerAccess?.featureFlags;
  const remainingAnalyses = viewerAccess?.usage?.remaining ?? null;
  const showLowUsageWarning =
    viewerAccess?.plan !== "trial" &&
    viewerAccess?.plan !== "pro" &&
    typeof remainingAnalyses === "number" &&
    remainingAnalyses > 0 &&
    remainingAnalyses <= 2;
  const isTrialing =
    viewerAccess?.subscriptionStatus === "active" &&
    (viewerAccess?.plan === "trial" || viewerAccess?.activeSubscriptionStatus === "TRIALING");
  const canViewSupplementLines = featureFlags?.supplement_lines ?? false;
  const canViewNegotiationDraft = featureFlags?.negotiation_draft ?? false;
  const canUseBasicPdfExport = featureFlags?.basic_pdf_export ?? true;
  const canUseRebuttalEmail = featureFlags?.rebuttal_email ?? false;
  const followUpExports = [
    canUseBasicPdfExport
      ? { label: "Collision Repair Intelligence Report", type: "pdf" }
      : null,
    canUseRebuttalEmail
      ? { label: "Rebuttal Email", type: "pdf" }
      : null,
    canUseBasicPdfExport
      ? { label: "Dispute Intelligence Report", type: "pdf" }
      : null,
  ].filter(Boolean) as Array<{ label: string; type?: string; url?: string }>;

  return (
    <div className="h-[100svh] overflow-hidden bg-[#050505] text-white">
      <ChatShell
        title="Collision-IQ"
        center={
          <div
            className={`flex h-full min-h-0 w-full flex-col ${
              hasStructuredAnalysis ? "overflow-y-auto pr-1" : "overflow-hidden"
            }`}
          >
            <AtAGlanceCard
              renderModel={renderModel}
              analysisResult={analysisResult}
              active={hasResolvedAnalysis && hasAtGlanceContent(renderModel)}
            />

            <div className="mt-3 rounded-[24px] border border-white/8 bg-white/[0.035] p-3.5">
              <WorkspacePanel
                workspaceData={workspaceData ?? undefined}
                evidenceModel={evidenceModel}
                activeEvidenceTargetId={activeEvidenceTargetId}
              />
            </div>

            <StructuredAnalysisCanvas
              analysisText={primaryAnalysis?.content ?? analysisText}
              renderModel={renderModel}
              normalizedResult={normalizedResult}
              analysisResult={analysisResult}
              workspaceData={workspaceData}
              attachments={attachmentsState}
              hasResolvedAnalysis={hasResolvedAnalysis}
              activeInsightKey={activeInsightKey}
              onActiveInsightChange={setActiveInsightKey}
              canRenderExports={hasResolvedAnalysis && Boolean(analysisText || panel.narrative)}
              evidenceModel={evidenceModel}
              activeEvidenceTargetId={activeEvidenceTargetId}
              onEvidenceSelect={handleEvidenceSelect}
              onContinueChat={handleContinueReview}
              onRequestEndAnalysis={handleRequestEndAnalysis}
              onConfirmEndAnalysis={handleConfirmEndAnalysis}
              onCancelEndAnalysis={handleCancelEndAnalysis}
              endAnalysisConfirming={endAnalysisConfirming}
              onCenterScrollRequest={(scrollToCenterSection) => {
                centerScrollRequestRef.current = scrollToCenterSection;
              }}
            />

            {hasStructuredAnalysis ? (
              <section className="mt-4 rounded-[26px] border border-white/8 bg-gradient-to-br from-white/[0.04] via-white/[0.025] to-black/24 p-4 shadow-[0_20px_48px_rgba(0,0,0,0.2)]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 pb-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.22em] text-orange-200/72">
                      Continue with this case
                    </div>
                    <div className="mt-1 text-[1.02rem] font-semibold tracking-[-0.02em] text-white/88">
                      Continue with this case
                    </div>
                    <div className="mt-1 text-[13px] leading-5 text-white/55">
                      This follow-up keeps the uploaded files, extracted facts, transcript summary,
                      determination, support gaps, and exports in context.
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleContinueReview}
                    className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-medium text-white/76 transition hover:bg-white/10 hover:text-white"
                  >
                    Continue with this case
                  </button>
                  </div>

                  <div className="mt-4">
                    <CaseContextSummary
                      intent={caseIntent || "Continue with this case"}
                      vehicleLabel={renderModel.vehicle.label || renderModel.reportFields.vehicleLabel}
                      fileCount={attachmentsState.length}
                      determinationAnswer={renderModel.determination?.answer}
                    />
                  </div>

                  <div className="mt-4 h-[min(56svh,680px)] min-h-[360px]">
                    {trialDaysRemaining !== null && trialDaysRemaining <= 7 && (
                      <div
                        className={`mb-3 rounded-xl px-4 py-3 text-sm ${
                          trialDaysRemaining <= 2
                            ? "border border-red-500/30 bg-red-500/10 text-red-200"
                            : "border border-orange-500/20 bg-[#C65A2A]/10 text-orange-100"
                        }`}
                      >
                        {trialDaysRemaining > 0 ? (
                          <>
                            Trial ends in {trialDaysRemaining} day
                            {trialDaysRemaining === 1 ? "" : "s"}.
                            <span className="ml-2 text-white/80">
                              Upgrade to keep full access.
                            </span>
                            <Link
                              href="/billing"
                              className="ml-3 inline-block rounded-md bg-[#C65A2A] px-3 py-1 text-xs font-semibold text-black"
                            >
                              Upgrade
                            </Link>
                          </>
                        ) : (
                          <>
                            Your trial has ended.
                            <span className="ml-2 text-white/80">
                              Upgrade to continue using full features.
                            </span>
                            <Link
                              href="/billing"
                              className="ml-3 inline-block rounded-md bg-[#C65A2A] px-3 py-1 text-xs font-semibold text-black"
                            >
                              Upgrade
                            </Link>
                          </>
                        )}
                      </div>
                    )}
                    {isTrialing && (
                      <div className="mb-3 text-xs text-green-300/80">
                        Trial active - full access enabled
                      </div>
                    )}
                    {showLowUsageWarning && (
                      <div className="mb-3 rounded-xl border border-orange-500/20 bg-[#C65A2A]/10 px-4 py-3 text-sm text-orange-100">
                        You have {remainingAnalyses} analysis{remainingAnalyses === 1 ? "" : "es"} remaining.
                        <span className="ml-2 text-white/80">
                          Upgrade to avoid interruption.
                        </span>
                      </div>
                    )}
                    <ChatWidget
                      onAttachmentChange={setAttachment}
                      onAttachmentsChange={setAttachmentsState}
                      onAnalysisChange={setAnalysisText}
                      onPrimaryAnalysisChange={setPrimaryAnalysis}
                      onAnalysisResultChange={handleAnalysisResultChange}
                      onAnalysisPanelChange={setAnalysisPanel}
                      onAnalysisLoadingChange={setAnalysisLoading}
                      onAnalysisStatusChange={(status, detail) => {
                        setAnalysisStatus(status);
                        setAnalysisStatusDetail(detail ?? null);
                      }}
                      onWorkspaceDataChange={setWorkspaceData}
                      onSessionReset={handleSessionReset}
                      onSessionControlsReady={(controls) => {
                        chatSessionControlsRef.current = controls;
                      }}
                      onCaseIntentChange={setCaseIntent}
                      viewerAccess={viewerAccess}
                      caseChatEnabled={hasResolvedAnalysis}
                      caseIntent={caseIntent || "Continue with this case"}
                      transcriptSummary={primaryAnalysis?.content ?? analysisText}
                      exportModel={hasResolvedAnalysis ? renderModel : null}
                      followUpFiles={attachmentsState.map((file) => ({
                        id: file.attachmentId,
                        name: file.filename,
                        type: file.hasVision ? "image" : undefined,
                      }))}
                      followUpExports={followUpExports}
                      suppressedMessageIds={primaryAnalysis ? [primaryAnalysis.messageId] : []}
                      disabled={chatBlocked}
                    />
                </div>
                </section>
              ) : (
                <div className="mt-3 min-h-0 flex-1 overflow-hidden">
                    {trialDaysRemaining !== null && trialDaysRemaining <= 7 && (
                      <div
                        className={`mb-3 rounded-xl px-4 py-3 text-sm ${
                          trialDaysRemaining <= 2
                            ? "border border-red-500/30 bg-red-500/10 text-red-200"
                            : "border border-orange-500/20 bg-[#C65A2A]/10 text-orange-100"
                        }`}
                      >
                        {trialDaysRemaining > 0 ? (
                          <>
                            Trial ends in {trialDaysRemaining} day
                            {trialDaysRemaining === 1 ? "" : "s"}.
                            <span className="ml-2 text-white/80">
                              Upgrade to keep full access.
                            </span>
                            <Link
                              href="/billing"
                              className="ml-3 inline-block rounded-md bg-[#C65A2A] px-3 py-1 text-xs font-semibold text-black"
                            >
                              Upgrade
                            </Link>
                          </>
                        ) : (
                          <>
                            Your trial has ended.
                            <span className="ml-2 text-white/80">
                              Upgrade to continue using full features.
                            </span>
                            <Link
                              href="/billing"
                              className="ml-3 inline-block rounded-md bg-[#C65A2A] px-3 py-1 text-xs font-semibold text-black"
                            >
                              Upgrade
                            </Link>
                          </>
                        )}
                      </div>
                    )}
                    {isTrialing && (
                      <div className="mb-3 text-xs text-green-300/80">
                        Trial active - full access enabled
                      </div>
                    )}
                    {showLowUsageWarning && (
                        <div className="mb-3 rounded-xl border border-orange-500/20 bg-[#C65A2A]/10 px-4 py-3 text-sm text-orange-100">
                          You have {remainingAnalyses} analysis{remainingAnalyses === 1 ? "" : "es"} remaining.
                        <span className="ml-2 text-white/80">
                          Upgrade to avoid interruption.
                        </span>
                      </div>
                    )}
                    <ChatWidget
                      onAttachmentChange={setAttachment}
                      onAttachmentsChange={setAttachmentsState}
                  onAnalysisChange={setAnalysisText}
                  onPrimaryAnalysisChange={setPrimaryAnalysis}
                  onAnalysisResultChange={handleAnalysisResultChange}
                  onAnalysisPanelChange={setAnalysisPanel}
                  onAnalysisLoadingChange={setAnalysisLoading}
                  onAnalysisStatusChange={(status, detail) => {
                    setAnalysisStatus(status);
                    setAnalysisStatusDetail(detail ?? null);
                  }}
                  onWorkspaceDataChange={setWorkspaceData}
                  onSessionReset={handleSessionReset}
                      onSessionControlsReady={(controls) => {
                        chatSessionControlsRef.current = controls;
                      }}
                      viewerAccess={viewerAccess}
                      suppressedMessageIds={primaryAnalysis ? [primaryAnalysis.messageId] : []}
                      disabled={chatBlocked}
                    />
                  </div>
                )}
          </div>
        }
        right={
          <RailContent
            attachment={attachment}
            analysisText={analysisText}
            analysisLoading={analysisLoading}
            analysisStatus={analysisStatus}
            analysisStatusDetail={analysisStatusDetail}
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
            activeInsightKey={activeInsightKey}
            evidenceModel={evidenceModel}
            activeEvidenceTargetId={activeEvidenceTargetId}
            onInsightSelect={(insightKey) => {
              setActiveInsightKey(insightKey);
              setActiveEvidenceTargetId(null);
              centerScrollRequestRef.current?.(insightKey);
            }}
            onEvidenceSelect={handleEvidenceSelect}
          />
        }
      />

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

export default function ChatbotPage() {
  return <ChatbotWorkspacePage />;
}

function RailContent({
  attachment,
  analysisText,
  analysisLoading,
  analysisStatus,
  analysisStatusDetail,
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
  activeInsightKey,
  evidenceModel,
  activeEvidenceTargetId,
  onInsightSelect,
  onEvidenceSelect,
}: {
  attachment: string | null;
  analysisText: string;
  analysisLoading: boolean;
  analysisStatus: "idle" | "processing" | "complete" | "error";
  analysisStatusDetail: string | null;
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
  activeInsightKey: InsightKey | null;
  evidenceModel: EvidenceLinkModel | null;
  activeEvidenceTargetId: string | null;
  onInsightSelect: (insightKey: InsightKey) => void;
  onEvidenceSelect: (link: EvidenceLink) => void;
}) {
  const sectionRefs = useRef<Partial<Record<InsightKey, HTMLDivElement | null>>>({});
  function registerSectionRef(insightKey: InsightKey, node: HTMLDivElement | null) {
    sectionRefs.current[insightKey] = node;
  }
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
  const railStatus =
    analysisStatus === "error"
      ? "Blocked"
      : analysisLoading || analysisStatus === "processing"
        ? "Processing"
        : hasResolvedAnalysis || analysisStatus === "complete"
          ? "Ready"
          : attachment
            ? "Files attached"
            : "Awaiting files";
  const attachmentLabel = attachment ?? "No attachment yet";
  const supportSignals = dedupeRailItems([
    ...renderModel.reportFields.presentStrengths,
    ...renderModel.disputeIntelligenceReport.positives,
    ...(analysisResult?.presentProcedures ?? []),
  ]).slice(0, 5);
  const recommendedMoves = dedupeRailItems([
    ...renderModel.disputeIntelligenceReport.nextMoves,
    ...(analysisResult?.recommendedActions ?? []),
    ...renderModel.negotiationPlaybook.suggestedSequence,
  ]).slice(0, 5);

  useEffect(() => {
    if (!activeInsightKey) return;

    const node = sectionRefs.current[activeInsightKey];
    if (!node) return;

    node.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [activeInsightKey]);

  return (
    <div className="flex h-full min-h-0 flex-col px-5 py-5 md:px-6 md:py-6">
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

      {analysisStatus === "error" && !hasResolvedAnalysis && (
        <section className="mt-5 space-y-2 rounded-2xl border border-red-500/16 bg-red-500/[0.05] p-3.5">
          <div className="text-[10px] uppercase tracking-[0.22em] text-red-200/72">
            Analysis blocked
          </div>
          <div className="text-[13px] leading-5 text-white/65">
            {analysisStatusDetail ||
              "The current file set could not be analyzed. Review access status or retry."}
          </div>
        </section>
      )}

      <RailGroup label="Decision" />

      <RailInsightSection
        insightKey="executive_summary"
        activeInsightKey={activeInsightKey}
        registerSectionRef={registerSectionRef}
        onActivate={onInsightSelect}
      >
        {hasResolvedAnalysis && featuredRecommendation ? (
          <FeaturedRecommendationCard item={featuredRecommendation} />
        ) : null}

        {hasResolvedAnalysis ? (
          <DecisionSection
            title="Decision Snapshot"
            body={renderModel.positionStatement || renderModel.repairPosition}
            tone="neutral"
            featured
          />
        ) : (
          <section className="mt-5 space-y-2 rounded-2xl border border-white/7 bg-white/[0.03] p-3.5">
            <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">Decision Snapshot</div>
            <div className="text-[13px] leading-5 text-white/65">
              Upload an estimate or photos to generate the key repair risks, missing support, and next-step guidance.
            </div>
          </section>
        )}
      </RailInsightSection>

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

      {hasResolvedAnalysis && supportSignals.length > 0 ? (
        <RailInsightSection
          insightKey="support_strengths"
          activeInsightKey={activeInsightKey}
          registerSectionRef={registerSectionRef}
          onActivate={onInsightSelect}
        >
          <SupportSignalsCard items={supportSignals} />
        </RailInsightSection>
      ) : null}

      <RailGroup label="Action" compact />

      {hasResolvedAnalysis && canViewSupplementLines ? (
        <RailInsightSection
          insightKey="support_gaps"
          activeInsightKey={activeInsightKey}
          registerSectionRef={registerSectionRef}
          onActivate={onInsightSelect}
        >
          <TopDisputeDriversCard
            items={renderModel.supplementItems}
            evidenceModel={evidenceModel}
            activeEvidenceTargetId={activeEvidenceTargetId}
            onEvidenceSelect={onEvidenceSelect}
          />
        </RailInsightSection>
      ) : null}

      {hasResolvedAnalysis && canViewSupplementLines ? <LineStatusCard /> : null}

      {hasResolvedAnalysis && canViewSupplementLines ? (
        <RailInsightSection
          insightKey="financial_view"
          activeInsightKey={activeInsightKey}
          registerSectionRef={registerSectionRef}
          onActivate={onInsightSelect}
        >
          <GapSummaryCard
            renderModel={renderModel}
            normalizedResult={normalizedResult}
            workspaceData={workspaceData}
          />
          {analysisResult ? (
            <div className="mt-3">
              <ValuationSection renderModel={renderModel} lowConfidence={valuationLowConfidence} />
            </div>
          ) : null}
        </RailInsightSection>
      ) : null}

      {hasResolvedAnalysis ? (
        <RailInsightSection
          insightKey="next_moves"
          activeInsightKey={activeInsightKey}
          registerSectionRef={registerSectionRef}
          onActivate={onInsightSelect}
        >
          {recommendedMoves.length > 0 ? <NextMovesCard items={recommendedMoves} /> : null}
          {hasResolvedAnalysis && canViewSupplementLines ? <NegotiationPostureCard /> : null}
        </RailInsightSection>
      ) : null}

      {hasResolvedAnalysis && canViewSupplementLines ? (
        <RailInsightSection
          insightKey="support_gaps"
          activeInsightKey={activeInsightKey}
          registerSectionRef={registerSectionRef}
          onActivate={onInsightSelect}
        >
        <section className="mt-5 space-y-2.5 rounded-2xl border border-white/7 bg-white/[0.03] p-3.5">
        <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">
          Support Gaps
        </div>
        {remainingRecommendations.length > 0 ? (
          <div className="space-y-2.5">
            {remainingRecommendations.map((item, index) => (
              <div key={`${item.title}-${index}`} className="rounded-xl bg-black/16 px-3 py-3">
                <div className="text-sm font-medium leading-5 text-white/85">
                  {displayOperationLabel(item.title)}
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
        </RailInsightSection>
      ) : hasResolvedAnalysis ? (
        <LockedFeatureCard
          title="Supplements"
          body="Upgrade to Pro to unlock detailed supplement-line recommendations, evidence, and export-ready support details."
        />
      ) : null}

      {hasResolvedAnalysis && renderModel.request && canViewNegotiationDraft ? (
        <RailInsightSection
          insightKey="next_moves"
          activeInsightKey={activeInsightKey}
          registerSectionRef={registerSectionRef}
          onActivate={onInsightSelect}
        >
          <ExpandableDecisionSection
            title="Negotiation Draft"
            body={renderModel.request}
            tone="neutral"
            mono
            previewLines={7}
          />
        </RailInsightSection>
      ) : null}

      {hasResolvedAnalysis && renderModel.request && !canViewNegotiationDraft && (
        <LockedFeatureCard
          title="Negotiation Draft"
          body="Upgrade to Pro to unlock the negotiation draft, rebuttal support, and premium carrier-facing exports."
        />
      )}

      {hasResolvedAnalysis && panel.appraisal?.triggered && panel.appraisal.reasoning ? (
        <RailInsightSection
          insightKey="next_moves"
          activeInsightKey={activeInsightKey}
          registerSectionRef={registerSectionRef}
          onActivate={onInsightSelect}
        >
          <DecisionSection
            title="Appraisal Signal"
            body={panel.appraisal.reasoning}
            tone="red"
            compact
          />
        </RailInsightSection>
      ) : null}

      {hasResolvedAnalysis && panel.stateLeverage && panel.stateLeverage.length > 0 ? (
        <RailInsightSection
          insightKey="next_moves"
          activeInsightKey={activeInsightKey}
          registerSectionRef={registerSectionRef}
          onActivate={onInsightSelect}
        >
          <DecisionSection
            title="State Leverage"
            body={panel.stateLeverage.map((point) => `- ${point}`).join("\n")}
            tone="yellow"
            compact
          />
        </RailInsightSection>
      ) : null}

      <RailGroup label="Output" compact />

      {canRenderExports ? (
        <RailInsightSection
          insightKey="exports"
          activeInsightKey={activeInsightKey}
          registerSectionRef={registerSectionRef}
          onActivate={onInsightSelect}
        >
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
              Collision Repair Intelligence Report
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
                  variant: "dispute_intelligence",
                })
              }
              disabled={!canUseBasicPdfExport}
              className="w-full rounded-xl bg-white/[0.045] p-3 text-xs text-white/65 transition hover:bg-white/[0.075] hover:text-white/85 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Dispute Intelligence Report
            </button>
          </div>
        </section>
        </RailInsightSection>
      ) : null}
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
  variant: "rebuttal" | "dispute_intelligence";
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
      : buildDisputeIntelligencePdf(sharedInput);

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
  const headline = active
    ? "Case framing and confidence snapshot"
    : "Case framing will settle here once the current file set finishes processing.";
  const compactSummary = [
    vehicleIdentity,
    renderModel.supplementItems[0]?.title
      ? `Top: ${displayOperationLabel(renderModel.supplementItems[0].title)}`
      : null,
    analysisResult ? `Critical: ${analysisResult.summary.criticalIssues}` : null,
    analysisResult ? `Evidence: ${formatLabel(analysisResult.summary.evidenceQuality)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      className={`shrink-0 rounded-[20px] border px-4 py-3 shadow-[0_16px_40px_rgba(198,90,42,0.1)] transition-colors ${
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
      <div className={`mt-2 text-sm font-semibold leading-6 ${active ? "text-white/85" : "text-white/40"}`}>
        {headline}
      </div>
      <div className="mt-2 text-xs leading-5 text-white/55">
        {compactSummary || "Vehicle context, recommendation priority, and evidence quality will appear here."}
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

function RailInsightSection({
  insightKey,
  activeInsightKey,
  registerSectionRef,
  onActivate,
  children,
}: {
  insightKey: InsightKey;
  activeInsightKey: InsightKey | null;
  registerSectionRef: (insightKey: InsightKey, node: HTMLDivElement | null) => void;
  onActivate: (insightKey: InsightKey) => void;
  children: ReactNode;
}) {
  const active = activeInsightKey === insightKey;

  return (
    <div
      ref={(node) => {
        registerSectionRef(insightKey, node);
      }}
      onClick={() => onActivate(insightKey)}
      className={`cursor-pointer rounded-[26px] transition-all hover:bg-white/[0.02] ${
        active ? "bg-[#C65A2A]/[0.06] ring-1 ring-inset ring-orange-400/18" : ""
      }`}
    >
      {children}
    </div>
  );
}

function dedupeRailItems(items: Array<string | undefined | null>) {
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

function SupportSignalsCard({ items }: { items: string[] }) {
  return (
    <section className="mt-5 space-y-2.5 rounded-2xl border border-white/7 bg-white/[0.03] p-3.5">
      <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">Support Signals</div>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item} className="flex gap-2 rounded-xl bg-black/16 px-3 py-3 text-[13px] leading-5 text-white/70">
            <span className="pt-[1px] text-green-300/80">&bull;</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function NextMovesCard({ items }: { items: string[] }) {
  return (
    <section className="mt-5 space-y-2.5 rounded-2xl border border-white/7 bg-white/[0.03] p-3.5">
      <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">Next Moves</div>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={item} className="flex gap-2 rounded-xl bg-black/16 px-3 py-3 text-[13px] leading-5 text-white/70">
            <span className="font-semibold text-white/88">{index + 1}.</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function buildTopDisputeDrivers(items: SupplementItem[]): DisputeDriver[] {
  const drivers: DisputeDriver[] = [];
  const seenTitles = new Set<string>();

  for (const item of items) {
    const driver = mapSupplementItemToDisputeDriver(item);
    if (!driver) continue;

    const normalizedTitle = driver.title.toLowerCase();
    if (seenTitles.has(normalizedTitle)) continue;

    seenTitles.add(normalizedTitle);
    drivers.push(driver);

    if (drivers.length >= 5) break;
  }

  return drivers;
}

function mapSupplementItemToDisputeDriver(item: SupplementItem): DisputeDriver | null {
  const lowerTitle = item.title.toLowerCase();

  if (lowerTitle.includes("structural measurement")) {
    return {
      title: "Structural Measurement Verification",
      impact: "HIGH ($$$ + safety critical)",
      whyItMatters: "affects geometry validation",
      carrierPosture: "under-documenting",
      action: "request measurement report + frame data",
    };
  }

  if (
    lowerTitle.includes("adas") ||
    lowerTitle.includes("calibration") ||
    lowerTitle.includes("scan") ||
    lowerTitle.includes("sensor") ||
    lowerTitle.includes("headlamp aim") ||
    lowerTitle.includes("steering angle")
  ) {
    return {
      title: "ADAS Calibration",
      impact: "HIGH",
      whyItMatters: "liability + post-repair safety",
      carrierPosture: "no calibration path documented",
      action: "require OEM procedure + invoice-backed calibration",
    };
  }

  return {
    title: displayOperationLabel(item.title),
    impact:
      item.priority === "high"
        ? "HIGH"
        : item.priority === "medium"
          ? "MEDIUM"
          : "LOW",
    whyItMatters: summarizeDriverWhyItMatters(item),
    carrierPosture: summarizeCarrierPosture(item.kind),
    action: summarizeDriverAction(item),
  };
}

function summarizeDriverWhyItMatters(item: SupplementItem): string {
  const rationale = item.rationale.trim();
  if (!rationale) {
    return "affects repair completeness and documentation support";
  }

  const sentence = rationale.split(/(?<=[.!?])\s+/)[0]?.trim() ?? rationale;
  return trimDriverSentence(sentence);
}

function summarizeCarrierPosture(kind: SupplementItem["kind"]): string {
  switch (kind) {
    case "missing_verification":
      return "verification not documented";
    case "missing_operation":
      return "not carrying the full operation";
    case "underwritten_operation":
      return "under-documenting the repair path";
    default:
      return "keeping the repair path open or lightly supported";
  }
}

function summarizeDriverAction(item: SupplementItem): string {
  const lowerTitle = item.title.toLowerCase();

  if (lowerTitle.includes("alignment")) {
    return "request alignment rationale + post-repair printout";
  }
  if (lowerTitle.includes("test fit")) {
    return "require test-fit documentation before final finish approval";
  }
  if (lowerTitle.includes("corrosion") || lowerTitle.includes("seam")) {
    return "request OEM corrosion-protection steps + material documentation";
  }
  if (lowerTitle.includes("hardware") || lowerTitle.includes("clip") || lowerTitle.includes("seal")) {
    return "request OEM hardware list + replacement support";
  }

  return "request OEM procedure, supporting documentation, and invoice-backed proof where applicable";
}

function trimDriverSentence(value: string): string {
  return value.replace(/\s+/g, " ").replace(/[.]+$/g, "").trim();
}

function TopDisputeDriversCard({
  items,
  evidenceModel,
  activeEvidenceTargetId,
  onEvidenceSelect,
}: {
  items: SupplementItem[];
  evidenceModel: EvidenceLinkModel | null;
  activeEvidenceTargetId: string | null;
  onEvidenceSelect: (link: EvidenceLink) => void;
}) {
  const drivers = buildTopDisputeDrivers(items);

  if (!drivers.length) {
    return null;
  }

  return (
    <section className="mt-5 space-y-3 rounded-[24px] border border-orange-500/18 bg-gradient-to-br from-[#C65A2A]/10 via-[#C65A2A]/[0.04] to-black/20 p-4 shadow-[0_18px_44px_rgba(198,90,42,0.12)]">
      <div className="text-[10px] uppercase tracking-[0.22em] text-orange-200/72">
        Top Dispute Drivers
      </div>
      <div className="space-y-3">
        {drivers.map((driver, index) => (
          <DisputeDriverCard
            key={`${driver.title}-${index}`}
            index={index}
            driver={driver}
            evidenceLink={
              evidenceModel
                ? findEvidenceLinkForDisputeDriver(
                    evidenceModel,
                    driver.title,
                    `${driver.whyItMatters} ${driver.action}`
                  )
                : null
            }
            activeEvidenceTargetId={activeEvidenceTargetId}
            onEvidenceSelect={onEvidenceSelect}
          />
        ))}
      </div>
    </section>
  );
}

function DisputeDriverCard({
  index,
  driver,
  evidenceLink,
  activeEvidenceTargetId,
  onEvidenceSelect,
}: {
  index: number;
  driver: DisputeDriver;
  evidenceLink: EvidenceLink | null;
  activeEvidenceTargetId: string | null;
  onEvidenceSelect: (link: EvidenceLink) => void;
}) {
  const active = Boolean(evidenceLink && evidenceLink.targetId === activeEvidenceTargetId);
  const className = `rounded-2xl px-3.5 py-3 transition-[border-color,background-color,box-shadow] duration-300 ${
    active
      ? "border border-orange-300/28 bg-[#C65A2A]/12 shadow-[0_0_0_1px_rgba(210,122,81,0.12)]"
      : "bg-black/18"
  }`;

  const content = (
    <>
      <div className="text-sm font-semibold leading-5 text-white/88">
        {index + 1}. {driver.title}
      </div>
      <div className="mt-2 text-[13px] leading-5 text-white/70">
        <span className="font-semibold text-white/88">Impact:</span> {driver.impact}
      </div>
      <div className="mt-1 text-[13px] leading-5 text-white/70">
        <span className="font-semibold text-white/88">Why it matters:</span> {driver.whyItMatters}
      </div>
      <div className="mt-1 text-[13px] leading-5 text-white/70">
        <span className="font-semibold text-white/88">What carrier is doing:</span> {driver.carrierPosture}
      </div>
      <div className="mt-1 text-[13px] leading-5 text-white/70">
        <span className="font-semibold text-white/88">What to do:</span> {driver.action}
      </div>
      {evidenceLink ? (
        <div className="mt-2 inline-flex rounded-full border border-white/8 bg-black/18 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-white/48">
          View support
        </div>
      ) : null}
    </>
  );

  if (!evidenceLink) {
    return <div className={className}>{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onEvidenceSelect(evidenceLink)}
      className={`${className} w-full text-left hover:border-white/12 hover:bg-black/22`}
    >
      {content}
    </button>
  );
}

function buildNegotiationPosture(): NegotiationPosture {
  return {
    likelyApprovedItems: [
      "Body labor (already aligned)",
      "Core structural direction",
    ],
    likelyPushbackItems: [
      "Calibration pricing (needs invoices)",
      "Alignment cost (needs support)",
    ],
    highLeverageArguments: [
      "OEM vs aftermarket suspension (BMW case = strong win)",
      "Paint time realism (8.9 hour gap)",
    ],
    suggestedStrategy: [
      "Lead with OEM procedures",
      "Anchor on safety + calibration",
      "Concede minor manual charges if needed",
    ],
  };
}

function buildLineStatus(): LineStatus {
  return {
    title: "Structural Measurement Verification",
    impact: "HIGH",
    status: "Missing / Underwritten",
    whyItMatters: "Geometry validation / safety",
    action: "Request documented measurement report",
  };
}

function LineStatusCard() {
  const lineStatus = buildLineStatus();

  return (
    <section className="mt-5 space-y-3 rounded-[24px] border border-red-500/18 bg-gradient-to-br from-red-500/[0.08] via-[#C65A2A]/[0.05] to-black/20 p-4 shadow-[0_18px_40px_rgba(0,0,0,0.18)]">
      <div className="text-[10px] uppercase tracking-[0.22em] text-red-200/72">Decision Card</div>
      <div className="rounded-2xl bg-black/20 px-3.5 py-3">
        <div className="text-sm font-semibold leading-5 text-white/88">
          [Red] {lineStatus.title.toUpperCase()}
        </div>
        <div className="mt-2 text-[13px] leading-5 text-white/70">
          <span className="font-semibold text-white/88">Impact:</span> {lineStatus.impact}
        </div>
        <div className="mt-1 text-[13px] leading-5 text-white/70">
          <span className="font-semibold text-white/88">Status:</span> {lineStatus.status}
        </div>
        <div className="mt-3 text-[13px] leading-5 text-white/70">
          <span className="font-semibold text-white/88">Why it matters:</span>
          <div className="mt-1 text-white/70">-&gt; {lineStatus.whyItMatters}</div>
        </div>
        <div className="mt-3 text-[13px] leading-5 text-white/70">
          <span className="font-semibold text-white/88">What to do:</span>
          <div className="mt-1 text-white/70">-&gt; {lineStatus.action}</div>
        </div>
      </div>
    </section>
  );
}

function GapSummaryCard({
  renderModel,
  normalizedResult,
  workspaceData,
}: {
  renderModel: ReturnType<typeof buildExportModel>;
  normalizedResult: AnalysisResult | null;
  workspaceData: WorkspaceData | null;
}) {
  const financialView = resolveFinancialView({
    renderModel,
    normalizedResult,
    workspaceData,
  });

  return (
    <section className="mt-5 space-y-3 rounded-[24px] border border-orange-500/18 bg-gradient-to-br from-[#C65A2A]/10 via-[#C65A2A]/[0.04] to-black/20 p-4 shadow-[0_18px_44px_rgba(198,90,42,0.12)]">
      <div className="text-[10px] uppercase tracking-[0.22em] text-orange-200/72">
        {financialView.kind === "quantified_gap" ? "Gap Summary" : "Financial View"}
      </div>
      <div className="rounded-2xl bg-black/20 px-3.5 py-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">
          {financialView.kind === "quantified_gap" ? "Total Gap" : "Directional Posture"}
        </div>
        {financialView.kind === "quantified_gap" ? (
          <div className="mt-2 text-[1.2rem] font-semibold tracking-[-0.02em] text-white/88">
            {financialView.totalGap ?? "Not yet quantified"}
          </div>
        ) : (
          <div className="mt-2 text-[13px] leading-5 text-white/70">
            {financialView.narrative}
          </div>
        )}
      </div>
      <div className="rounded-2xl bg-black/20 px-3.5 py-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">
          {financialView.kind === "quantified_gap" ? "Drivers" : "Available Signals"}
        </div>
        {financialView.kind === "quantified_gap" ? (
          financialView.drivers.length > 0 ? (
            <div className="mt-2 space-y-2">
              {financialView.drivers.map((driver) => (
                <div key={`${driver.label}-${driver.value}`} className="flex gap-2 text-[13px] leading-5 text-white/70">
                  <span className="pt-[1px] text-orange-200/85">&bull;</span>
                  <span>
                    {driver.label}: <span className="text-white/88">{driver.value}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-[13px] leading-5 text-white/55">
              {financialView.narrative ?? "The current structured comparison does not yet support a reliable quantified driver breakdown."}
            </div>
          )
        ) : financialView.kind === "directional_financial_view" ? (
          <div className="mt-2 space-y-2">
            {financialView.bullets.map((item) => (
              <div key={item} className="flex gap-2 text-[13px] leading-5 text-white/70">
                <span className="pt-[1px] text-orange-200/85">&bull;</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 text-[13px] leading-5 text-white/55">
            Not yet quantified.
          </div>
        )}
      </div>
    </section>
  );
}

function NegotiationPostureCard() {
  const posture = buildNegotiationPosture();

  return (
    <section className="mt-5 space-y-3 rounded-[24px] border border-white/8 bg-gradient-to-br from-white/[0.055] via-white/[0.03] to-black/20 p-4 shadow-[0_18px_40px_rgba(0,0,0,0.18)]">
      <div className="text-[10px] uppercase tracking-[0.22em] text-white/45">
        Negotiation Posture
      </div>

      <NegotiationPostureList
        title="Likely Approved Items"
        items={posture.likelyApprovedItems}
        accentClassName="text-green-300/85"
      />

      <NegotiationPostureList
        title="Likely Pushback Items"
        items={posture.likelyPushbackItems}
        accentClassName="text-red-300/85"
      />

      <NegotiationPostureList
        title="High-Leverage Arguments"
        items={posture.highLeverageArguments}
        accentClassName="text-orange-200/85"
      />

      <div className="rounded-2xl bg-black/18 px-3.5 py-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">
          Suggested Strategy
        </div>
        <div className="mt-2 space-y-2">
          {posture.suggestedStrategy.map((item, index) => (
            <div key={item} className="flex gap-2 text-[13px] leading-5 text-white/70">
              <span className="font-semibold text-white/88">{index + 1}.</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function NegotiationPostureList({
  title,
  items,
  accentClassName,
}: {
  title: string;
  items: string[];
  accentClassName: string;
}) {
  return (
    <div className="rounded-2xl bg-black/18 px-3.5 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">{title}</div>
      <div className="mt-2 space-y-2">
        {items.map((item) => (
          <div key={item} className="flex gap-2 text-[13px] leading-5 text-white/70">
            <span className={`pt-[1px] ${accentClassName}`}>&bull;</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeaturedRecommendationCard({
  item,
}: {
  item: SupplementItem;
}) {
  return (
    <section className="rounded-[24px] border border-orange-500/20 bg-gradient-to-br from-[#C65A2A]/12 via-[#C65A2A]/[0.045] to-black/20 p-4 shadow-[0_18px_44px_rgba(198,90,42,0.14)]">
      <div className="text-[10px] uppercase tracking-[0.22em] text-orange-200/72">Top recommendation</div>
      <div className="mt-2 text-[1.08rem] font-semibold leading-6 text-white/85">{displayOperationLabel(item.title)}</div>
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
            href="/billing"
            className="rounded-full border border-orange-500/24 bg-orange-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-orange-100 transition hover:bg-orange-500/18"
          >
            Upgrade Access
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
