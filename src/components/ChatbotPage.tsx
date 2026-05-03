"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Download, FileText, Mail } from "lucide-react";
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
import UpgradeModal from "@/components/UpgradeModal";
import WorkspacePanel from "@/components/WorkspacePanel";
import type { DecisionPanel } from "@/lib/ai/builders/buildDecisionPanel";
import type { AccountEntitlements } from "@/lib/billing/entitlements";
import { getNormalizedDetermination } from "@/lib/analysis/getNormalizedDetermination";
import { canAccessFeature } from "@/lib/featureAccess";
import { emitSafeCrmEventFromClient } from "@/lib/crm/events";
import {
  buildExportModel,
  resolveCanonicalInsurer,
  resolveCanonicalVehicleLabel,
  resolveCanonicalVin,
} from "@/lib/ai/builders/buildExportModel";
import { buildCarrierReport, type CarrierReportDocument } from "@/lib/ai/builders/carrierPdfBuilder";
import { buildCollisionSnapshot, type CollisionSnapshot } from "@/lib/ai/builders/collisionSnapshot";
import {
  buildCollisionSnapshotPdf,
  buildCollisionSnapshotPdfFromSnapshot,
} from "@/lib/ai/builders/collisionSnapshotPdfBuilder";
import { buildCustomerReportPdf } from "@/lib/ai/builders/customerReportPdfBuilder";
import { buildDisputeIntelligencePdf } from "@/lib/ai/builders/disputeIntelligencePdfBuilder";
import { buildCarrierPdfBlob, exportCarrierPDF } from "@/lib/ai/builders/exportPdf";
import { buildRebuttalEmailPdf } from "@/lib/ai/builders/rebuttalEmailPdfBuilder";
import { toStableClaimId } from "@/lib/claims/claimIdentity";
import {
  buildSnapshotEmailBody,
  buildSnapshotPlainText,
  buildSnapshotSendSafeEvent,
  sanitizeSnapshotOutboundText,
  type SnapshotDestinationType,
} from "@/lib/ai/builders/snapshotShare";
import {
  normalizeExternalDocumentDisplay,
  redactExternalDocumentUrls,
  summarizeExternalDocumentForDisplay,
} from "@/lib/externalDocuments";
import { normalizeReportToAnalysisResult } from "@/lib/ai/builders/normalizeReportToAnalysisResult";
import { cleanOperationDisplayText } from "@/lib/ui/presentationText";
import type {
  AnalysisResult,
  RepairIntelligenceReport,
} from "@/lib/ai/types/analysis";
import type { CustomerReport } from "@/lib/ai/generateCustomerReport";
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

type LeftPaneMode = "chat" | "review";
type ReportType =
  | "snapshot"
  | "full_report"
  | "rebuttal"
  | "dispute_intelligence"
  | "customer_report";
type ReportDestinationType = "customer" | "carrier" | "internal";
type ReportSendHistoryItem = {
  id: string;
  caseId: string | null;
  reportType: ReportType;
  destinationType: ReportDestinationType;
  recipient: string;
  subject: string | null;
  resendId: string | null;
  status: string;
  sentAt: string;
  deliveredAt: string | null;
  bouncedAt: string | null;
  failedAt: string | null;
  openedAt: string | null;
};

type LinkedEvidenceDebugItem = {
  id?: string | null;
  title?: string | null;
  url?: string;
  finalUrl?: string;
  status?: "ok" | "blocked" | "failed" | "skipped";
  sourceType?: string;
  textPreview?: string;
  notes?: string;
};

type DisputeDriver = {
  title: string;
  impact: string;
  whyItMatters: string;
  currentFileStatus: string;
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

function getHeroCollapseStorageKey(caseId: string) {
  return `case:${caseId}:heroCollapsed`;
}

function getHeaderExpandedStorageKey(caseId: string) {
  return `case:${caseId}:headerExpanded`;
}

function getHeaderPinnedStorageKey(caseId: string) {
  return `case:${caseId}:headerPinnedByUser`;
}

type ImmersiveHeaderChangeReason =
  | "AUTO_COLLAPSE_CHAT_ENGAGED"
  | "AUTO_REOPEN_UPLOAD_COMPLETE"
  | "RAIL_REOPENED"
  | "USER_OPENED"
  | "USER_COLLAPSED"
  | "CHAT_FOCUS"
  | "CASE_RESET"
  | "END_CHAT";

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

function getCurrentWorkspaceReturnUrl(): string | null {
  if (typeof window === "undefined") return null;

  return window.location.href;
}

export function ChatbotWorkspacePage() {
  const router = useRouter();
  const centerScrollRequestRef = useRef<((key: InsightKey) => void) | null>(null);
  const immersiveWorkspaceRef = useRef<HTMLDivElement | null>(null);
  const immersiveToolbarRef = useRef<HTMLDivElement | null>(null);
  const revealScrollTimeoutRef = useRef<number | null>(null);
  const [leftPaneMode, setLeftPaneMode] = useState<LeftPaneMode>("chat");
  const chatSessionControlsRef = useRef<{
    focusComposer: () => void;
    resetSession: () => void;
  } | null>(null);
  const [attachment, setAttachment] = useState<string | null>(null);
  const [attachmentsState, setAttachmentsState] = useState<AttachmentTrayItem[]>([]);
  const [analysisText, setAnalysisText] = useState("");
  const [analysisReportId, setAnalysisReportId] = useState<string | null>(null);
  const [linkedEvidenceDebug, setLinkedEvidenceDebug] = useState<LinkedEvidenceDebugItem[]>([]);
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
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [isImmersiveHeaderExpanded, setIsImmersiveHeaderExpanded] = useState(true);
  const [headerPinnedByUser, setHeaderPinnedByUser] = useState(false);
  const [lastHeaderChangeReason, setLastHeaderChangeReason] =
    useState<ImmersiveHeaderChangeReason>("CASE_RESET");
  const immersiveHeaderExpandedRef = useRef(true);

  useEffect(() => {
    immersiveHeaderExpandedRef.current = isImmersiveHeaderExpanded;
  }, [isImmersiveHeaderExpanded]);

  useEffect(() => {
    return () => {
      if (revealScrollTimeoutRef.current !== null) {
        window.clearTimeout(revealScrollTimeoutRef.current);
      }
    };
  }, []);

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
  const structuredDeterminationView = useMemo(() => {
    if (!analysisResult) return null;

    return getNormalizedDetermination({
      vehicle: {
        year: analysisResult.vehicle?.year ?? null,
        make: analysisResult.vehicle?.make ?? null,
        model: analysisResult.vehicle?.model ?? null,
        trim: analysisResult.vehicle?.trim ?? null,
        mileage: normalizedResult?.estimateFacts?.mileage ?? null,
      },
      estimateText:
        analysisResult.sourceEstimateText ||
        analysisResult.analysis?.rawEstimateText ||
        normalizedResult?.rawEstimateText ||
        "",
      files: [],
      linkedEvidence: analysisResult.linkedEvidence ?? [],
      extractedFacts: {
        vehicleLabel: renderModel.vehicle.label || renderModel.reportFields.vehicleLabel || null,
        vin: renderModel.reportFields.vin || null,
        mileage: renderModel.reportFields.mileage ?? null,
        estimateTotal: renderModel.reportFields.estimateTotal ?? null,
        insurer: renderModel.reportFields.insurer || null,
        repairPosition: renderModel.repairPosition || null,
        valuationSourceType: renderModel.valuation.acvSourceType || null,
      },
    });
  }, [analysisResult, normalizedResult, renderModel]);

  const panel = hasResolvedAnalysis ? analysisPanel ?? EMPTY_PANEL : EMPTY_PANEL;
  const hasStructuredAnalysis = hasResolvedAnalysis;

  const isReviewOpen = hasStructuredAnalysis && isImmersiveHeaderExpanded;
  const isReviewActive = isReviewOpen && leftPaneMode === "review";
  const isChatActive = leftPaneMode === "chat";
  const workspaceRowsClass = hasStructuredAnalysis
    ? "grid-rows-[auto_minmax(0,1fr)_auto]"
    : "grid-rows-[minmax(0,1fr)]";

  useEffect(() => {
    immersiveHeaderExpandedRef.current = isImmersiveHeaderExpanded;
    console.info("[immersive-header] state changed", {
      expanded: isImmersiveHeaderExpanded,
      activeCaseId: analysisReportId,
      hasStructuredAnalysis,
      lastHeaderChangeReason,
    });
  }, [
    analysisReportId,
    hasStructuredAnalysis,
    isImmersiveHeaderExpanded,
    lastHeaderChangeReason,
  ]);

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
    if (!analysisReportId) {
      setIsImmersiveHeaderExpanded(true);
      setHeaderPinnedByUser(false);
      setLastHeaderChangeReason("CASE_RESET");
      return;
    }

    if (typeof window === "undefined") return;

    const expandedValue = window.localStorage.getItem(
      getHeaderExpandedStorageKey(analysisReportId)
    );
    const pinnedValue = window.localStorage.getItem(
      getHeaderPinnedStorageKey(analysisReportId)
    );

    if (expandedValue === "false" || expandedValue === "true") {
      setIsImmersiveHeaderExpanded(expandedValue === "true");
    } else {
      setIsImmersiveHeaderExpanded(true);
      window.localStorage.setItem(getHeaderExpandedStorageKey(analysisReportId), "true");
    }

    setHeaderPinnedByUser(pinnedValue === "true");
  }, [analysisReportId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!analysisReportId || typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      getHeaderExpandedStorageKey(analysisReportId),
      String(isImmersiveHeaderExpanded)
    );
    window.localStorage.setItem(
      getHeaderPinnedStorageKey(analysisReportId),
      String(headerPinnedByUser)
    );
    window.localStorage.setItem(
      getHeroCollapseStorageKey(analysisReportId),
      String(!isImmersiveHeaderExpanded)
    );
  }, [analysisReportId, headerPinnedByUser, isImmersiveHeaderExpanded]);

  const collapsePreChatHero = useCallback(() => {
    // Removed implicit auto-collapse path.
    // Left pane mode is controlled only by explicit UI transitions.
  }, []);

  const reopenImmersiveHeaderAfterUpload = useCallback(() => {
    if (headerPinnedByUser) {
      console.info("[immersive-header] auto-state skipped", {
        reason: "user_pinned",
        requestedState: "expanded",
        activeCaseId: analysisReportId,
        hasStructuredAnalysis,
        lastHeaderChangeReason,
      });
      return;
    }

    console.info("[immersive-header] auto-state applied", {
      requestedState: "expanded",
      activeCaseId: analysisReportId,
      hasStructuredAnalysis,
      lastHeaderChangeReason,
    });
    setIsImmersiveHeaderExpanded(true);
    setLastHeaderChangeReason("AUTO_REOPEN_UPLOAD_COMPLETE");
  }, [analysisReportId, hasStructuredAnalysis, headerPinnedByUser, lastHeaderChangeReason]);

  const handleToggleImmersiveHeader = useCallback(() => {
    const previous = immersiveHeaderExpandedRef.current;
    const next = !previous;

    console.info("[immersive-header] toggle requested", {
      previousExpanded: previous,
      nextExpanded: next,
      activeCaseId: analysisReportId,
      hasStructuredAnalysis,
      lastHeaderChangeReason,
    });

    immersiveHeaderExpandedRef.current = next;
    setHeaderPinnedByUser(next);
    setLastHeaderChangeReason(next ? "USER_OPENED" : "USER_COLLAPSED");
    setIsImmersiveHeaderExpanded(next);

    if (next) {
      setLeftPaneMode("review");
    } else {
      setLeftPaneMode("chat");
    }
  }, [analysisReportId, hasStructuredAnalysis, lastHeaderChangeReason]);

  const activateChatPane = useCallback(() => {
    if (revealScrollTimeoutRef.current !== null) {
      window.clearTimeout(revealScrollTimeoutRef.current);
      revealScrollTimeoutRef.current = null;
    }

    immersiveHeaderExpandedRef.current = false;
    setHeaderPinnedByUser(false);
    setLastHeaderChangeReason("CHAT_FOCUS");
    setIsImmersiveHeaderExpanded(false);
    setLeftPaneMode("chat");
    setActiveEvidenceTargetId(null);
  }, []);

  const collapseChatPane = useCallback(() => {
    if (hasStructuredAnalysis) {
      immersiveHeaderExpandedRef.current = true;
      setIsImmersiveHeaderExpanded(true);
      setLeftPaneMode("review");
    }
  }, [hasStructuredAnalysis]);

  const openChatPane = useCallback(() => {
    setLeftPaneMode("chat");
  }, []);

  const openReviewPane = useCallback(() => {
    if (!hasStructuredAnalysis) {
      return;
    }

    immersiveHeaderExpandedRef.current = true;
    setHeaderPinnedByUser(true);
    setLastHeaderChangeReason("USER_OPENED");
    setIsImmersiveHeaderExpanded(true);
    setLeftPaneMode("review");
  }, [hasStructuredAnalysis]);

  const scheduleImmersiveReveal = useCallback((insightKey: InsightKey, delayMs = 180) => {
    if (revealScrollTimeoutRef.current !== null) {
      window.clearTimeout(revealScrollTimeoutRef.current);
    }

    revealScrollTimeoutRef.current = window.setTimeout(() => {
      immersiveToolbarRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });

      window.setTimeout(() => {
        centerScrollRequestRef.current?.(insightKey);
      }, 120);
    }, delayMs);
  }, []);

  const revealImmersiveSection = useCallback(
    (insightKey: InsightKey, evidenceTargetId: string | null = null) => {
      setActiveInsightKey(insightKey);
      setActiveEvidenceTargetId(evidenceTargetId);
      setLeftPaneMode("review");

      const wasExpanded = immersiveHeaderExpandedRef.current;

      immersiveHeaderExpandedRef.current = true;
      setHeaderPinnedByUser(true);
      setLastHeaderChangeReason("RAIL_REOPENED");
      setIsImmersiveHeaderExpanded(true);

      scheduleImmersiveReveal(insightKey, wasExpanded ? 40 : 220);
    },
    [scheduleImmersiveReveal]
  );

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
    if (analysisReportId && typeof window !== "undefined") {
      window.localStorage.removeItem(getHeroCollapseStorageKey(analysisReportId));
      window.localStorage.removeItem(getHeaderExpandedStorageKey(analysisReportId));
      window.localStorage.removeItem(getHeaderPinnedStorageKey(analysisReportId));
    }

    setIsImmersiveHeaderExpanded(true);
    setHeaderPinnedByUser(false);
    setLastHeaderChangeReason("END_CHAT");
    setAttachment(null);
    setAttachmentsState([]);
    setAnalysisText("");
    setAnalysisReportId(null);
    setLinkedEvidenceDebug([]);
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
    revealImmersiveSection(link.insightKey, link.targetId);
  }

  function handleConfirmEndAnalysis() {
    chatSessionControlsRef.current?.resetSession();
    handleSessionReset();
  }

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
  const plan = viewerAccess?.plan ?? "none";
  const canUseSnapshotExport = canAccessFeature(plan, "snapshot_export");
  const canUseBasicPdfExport = canAccessFeature(plan, "full_report_export");
  const canUseDisputeReportExport = canAccessFeature(plan, "dispute_report_export");
  const canUseRebuttalEmail = canAccessFeature(plan, "rebuttal_export");
  const canUseCustomerReport = canAccessFeature(plan, "customer_report_export");
  const followUpExports = [
    hasResolvedAnalysis
      ? { label: "Chat Export", type: "pdf" }
      : null,
    canUseSnapshotExport
      ? { label: "1-Page Snapshot", type: "pdf" }
      : null,
    canUseBasicPdfExport
      ? { label: "Collision Repair Intelligence Report", type: "pdf" }
      : hasResolvedAnalysis
        ? { label: "Collision Repair Intelligence Report (Pro)", type: "locked" }
      : null,
    canUseRebuttalEmail
      ? { label: "Rebuttal Email", type: "pdf" }
      : hasResolvedAnalysis
        ? { label: "Rebuttal Email (Pro)", type: "locked" }
      : null,
    canUseDisputeReportExport
      ? { label: "Dispute Intelligence Report", type: "pdf" }
      : hasResolvedAnalysis
        ? { label: "Dispute Intelligence Report (Pro)", type: "locked" }
      : null,
    canUseCustomerReport
      ? { label: "Customer Report", type: "pdf" }
      : hasResolvedAnalysis
        ? { label: "Customer Report (Pro)", type: "locked" }
      : null,
  ].filter(Boolean) as Array<{ label: string; type?: string; url?: string }>;
  const canonicalWorkspaceCounts = useMemo(
    () => ({
      supportSignals: dedupeRailItems([
        ...renderModel.reportFields.presentStrengths,
        ...renderModel.disputeIntelligenceReport.positives,
        ...renderModel.reportFields.documentedProcedures,
        ...renderModel.reportFields.documentedHighlights,
      ]).length,
      topDisputeDrivers: renderModel.disputeIntelligenceReport.topDrivers.length,
      supportGaps: renderModel.disputeIntelligenceReport.supportGaps.length,
      supplementItems: renderModel.supplementItems.length,
      cautionFlags: panel.appraisal?.triggered ? 1 : 0,
      linkedEvidence: linkedEvidenceDebug.length,
      negotiationDraftSections: renderModel.request ? 1 : 0,
      exports: followUpExports.length,
    }),
    [
      followUpExports.length,
      linkedEvidenceDebug.length,
      panel.appraisal?.triggered,
      renderModel,
    ]
  );

  useEffect(() => {
    if (!hasResolvedAnalysis) return;

    console.info("[workspace] canonical model built", {
      activeCaseId: analysisReportId,
      ...canonicalWorkspaceCounts,
    });
    console.info("[workspace] left-immersive hydrated", {
      activeCaseId: analysisReportId,
      ...canonicalWorkspaceCounts,
    });
    console.info("[workspace] right-rail hydrated", {
      activeCaseId: analysisReportId,
      ...canonicalWorkspaceCounts,
    });
    console.info("[workspace] section counts", {
      activeCaseId: analysisReportId,
      ...canonicalWorkspaceCounts,
    });
    console.info("[workspace] hydrated prior exports", {
      activeCaseId: analysisReportId,
      hasStoredReport: Boolean(analysisResult),
      artifactCount: followUpExports.length,
    });
    console.info("[workspace] merged export sources", {
      activeCaseId: analysisReportId,
      storedArtifacts: followUpExports.length,
      transientArtifacts: 0,
      artifactCount: followUpExports.length,
    });
  }, [
    analysisReportId,
    analysisResult,
    canonicalWorkspaceCounts,
    followUpExports.length,
    hasResolvedAnalysis,
  ]);

  if (!consentResolved) return null;

  return (
    <div className="h-[100svh] overflow-hidden bg-background text-foreground">
      <ChatShell
        title="Collision-IQ"
        center={
          <div className="relative h-full min-h-0 w-full">
            <div className={`grid h-full min-h-0 w-full gap-3 pt-12 ${workspaceRowsClass}`}>
              {hasStructuredAnalysis && (
                <div
                  className={
                    isReviewActive
                      ? "row-span-2 flex min-h-0 flex-col px-1"
                      : "flex min-h-0 flex-col px-1"
                  }
                >
                  <div
                    ref={immersiveToolbarRef}
                    className="z-20 mb-3 shrink-0 rounded-[22px] border border-border bg-card/95 px-4 py-3 shadow-[0_18px_44px_rgba(15,23,42,0.10)] ring-1 ring-ring/10 backdrop-blur-xl dark:shadow-[0_18px_44px_rgba(0,0,0,0.28)]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          Review workspace
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {isReviewActive
                            ? "The case review is open. Collapse it anytime to give chat more room."
                            : "The case review is collapsed. Selecting a right-rail item will reopen it and jump to the matching section."}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={isReviewActive ? handleToggleImmersiveHeader : openReviewPane}
                          className="rounded-xl border border-border bg-muted px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted/70"
                          aria-expanded={isReviewActive}
                          aria-controls="immersive-case-header"
                        >
                          {isReviewActive
                            ? "Collapse review workspace"
                            : "Open review workspace"}
                        </button>
                      </div>
                    </div>
                  </div>

                  {isReviewActive ? (
                    <div
                      ref={immersiveWorkspaceRef}
                      className="min-h-0 flex-1 overflow-y-auto rounded-[26px] border border-border bg-card/80 px-1 pb-4 shadow-[0_24px_70px_rgba(15,23,42,0.10)] ring-1 ring-ring/10 dark:shadow-[0_24px_70px_rgba(0,0,0,0.22)]"
                    >
                      <div id="immersive-case-header" data-header-change-reason={lastHeaderChangeReason}>
                        <div className="mb-2 text-right text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                          {headerPinnedByUser ? "Pinned by user" : "Auto"}
                        </div>
                        <AtAGlanceCard
                          renderModel={renderModel}
                          analysisResult={analysisResult}
                          active={hasResolvedAnalysis && hasAtGlanceContent(renderModel)}
                        />

                      <div className="mt-3 rounded-[24px] border border-border bg-card p-3.5">
                        <WorkspacePanel
                          workspaceData={workspaceData ?? undefined}
                          evidenceModel={evidenceModel}
                          activeEvidenceTargetId={activeEvidenceTargetId}
                        />
                      </div>

                    </div>

                  <StructuredAnalysisCanvas
                    renderModel={renderModel}
                    attachments={attachmentsState}
                    hasResolvedAnalysis={hasResolvedAnalysis}
                    activeInsightKey={activeInsightKey}
                    onActiveInsightChange={setActiveInsightKey}
                    canRenderExports={hasResolvedAnalysis}
                    canUseFullReportExports={canUseBasicPdfExport}
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

                  <section className="mt-4 rounded-[26px] border border-border bg-card p-4 shadow-[0_20px_48px_rgba(15,23,42,0.10)] dark:shadow-[0_20px_48px_rgba(0,0,0,0.2)]">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.22em] text-orange-200/72">
                          Continue with this case
                        </div>
                        <div className="mt-1 text-[1.02rem] font-semibold tracking-[-0.02em] text-card-foreground">
                          Continue with this case
                        </div>
                        <div className="mt-1 text-[13px] leading-5 text-muted-foreground">
                          This follow-up keeps the uploaded files, extracted facts, transcript summary,
                          determination, support gaps, and exports in context.
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleContinueReview}
                        className="rounded-xl border border-border bg-muted px-3.5 py-2 text-xs font-medium text-foreground transition hover:bg-muted/70"
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
                        determinationPayload={structuredDeterminationView}
                        supportGaps={renderModel.disputeIntelligenceReport.supportGaps}
                      />
                    </div>

                    {linkedEvidenceDebug.length > 0 && (
                      <section className="mt-4 rounded-[20px] border border-border bg-muted p-4">
                        <div className="text-[10px] uppercase tracking-[0.22em] text-orange-200/72">
                          Linked OEM / procedure evidence
                        </div>
                        <div className="mt-3 space-y-3">
                          {linkedEvidenceDebug.map((item, index) => {
                            const display = normalizeExternalDocumentDisplay(item, `linked-${index + 1}`);

                            return (
                              <div
                                key={`${display.id}-${index}`}
                                className="rounded-2xl border border-border bg-card px-3.5 py-3"
                              >
                                <div className="text-sm font-semibold text-card-foreground">
                                  {display.title}
                                </div>
                                <div className="mt-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                  {formatExternalDocumentStatus(display.status)} - {formatExternalDocumentSource(display.source)}
                                </div>
                                <div className="mt-2 text-[13px] leading-5 text-muted-foreground">
                                  {summarizeExternalDocumentForDisplay(display)}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    )}

                  </section>
                    </div>
                  ) : null}
                </div>
              )}
              <div className="flex min-h-0 flex-col">
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
                        <span className="ml-2 text-foreground/80">
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
                        <span className="ml-2 text-foreground/80">
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
                    <span className="ml-2 text-foreground/80">
                      Upgrade to avoid interruption.
                    </span>
                  </div>
                )}
                <section className="h-full min-h-0 overflow-hidden">
                {!isChatActive && (
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-x-10 -top-1 z-10 h-4 rounded-full bg-orange-500/8 blur-2xl" />
                    <div className="rounded-[24px] border border-border bg-card/95 px-4 py-3 shadow-[0_18px_50px_rgba(15,23,42,0.10)] ring-1 ring-ring/10 backdrop-blur-2xl dark:shadow-[0_18px_50px_rgba(0,0,0,0.34)]">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={openChatPane}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-xs font-semibold text-foreground">
                            Chat
                          </div>
                          <div className="min-w-0">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                              Chat available
                            </div>
                            <div className="truncate text-sm text-foreground/80">
                              Click to reopen chat.
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={openChatPane}
                          className="rounded-xl border border-border bg-muted px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted/70"
                        >
                          Open chat
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {isChatActive && (
                  <div className="relative h-full min-h-0">
                    <div className="pointer-events-none absolute inset-x-8 -top-2 z-10 h-5 rounded-full bg-orange-500/10 blur-2xl" />
                    <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] bg-background/78 shadow-[0_24px_80px_rgba(15,23,42,0.10)] ring-1 ring-border/45 backdrop-blur-2xl dark:bg-background/70 dark:shadow-[0_28px_90px_rgba(0,0,0,0.38)]">
                      <div className="flex shrink-0 items-center justify-between gap-4 px-5 py-4">
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                            Chat workspace
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            Collapse it anytime to focus on the immersive review.
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={collapseChatPane}
                          className="rounded-xl bg-card px-3 py-2 text-xs font-medium text-muted-foreground shadow-sm ring-1 ring-border/60 transition hover:bg-muted hover:text-foreground"
                        >
                          Collapse chat
                        </button>
                      </div>
                      <div className="h-full min-h-0">
                        <ChatWidget
                          key="chat-widget"
                          onAttachmentChange={setAttachment}
                          onAttachmentsChange={setAttachmentsState}
                          onAnalysisChange={setAnalysisText}
                          onPrimaryAnalysisChange={setPrimaryAnalysis}
                          onAnalysisReportIdChange={(reportId) => {
                            if (reportId !== analysisReportId) {
                              setAnalysisReportId(reportId);
                            }
                          }}
                          onAnalysisResultChange={handleAnalysisResultChange}
                          onLinkedEvidenceChange={setLinkedEvidenceDebug}
                          onAnalysisPanelChange={setAnalysisPanel}
                          onAnalysisLoadingChange={setAnalysisLoading}
                          onAnalysisStatusChange={(status, detail) => {
                            setAnalysisStatus(status);
                            setAnalysisStatusDetail(detail ?? null);
                          }}
                          onWorkspaceDataChange={setWorkspaceData}
                          onSessionReset={handleSessionReset}
                          onChatEngagement={collapsePreChatHero}
                          onUserPromptSent={activateChatPane}
                          onCaseUploadComplete={reopenImmersiveHeaderAfterUpload}
                          onSessionControlsReady={(controls) => {
                            chatSessionControlsRef.current = controls;
                          }}
                          onCaseIntentChange={setCaseIntent}
                          viewerAccess={viewerAccess}
                          caseChatEnabled={Boolean(analysisReportId)}
                          activeCaseId={analysisReportId}
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
                    </div>
                  </div>
                )}
                </section>
              </div>
            </div>
          </div>
        }
        right={
          <RailContent
            attachment={attachment}
            analysisText={redactExternalDocumentUrls(analysisText)}
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
                          plan={plan}
                          canUseSnapshotExport={canUseSnapshotExport}
                          canUseBasicPdfExport={canUseBasicPdfExport}
                          canUseDisputeReportExport={canUseDisputeReportExport}
            canUseRebuttalEmail={canUseRebuttalEmail}
            canUseCustomerReport={canUseCustomerReport}
            analysisReportId={analysisReportId}
            attachmentIds={attachmentsState.map((file) => file.attachmentId)}
            onCustomerReportLocked={() => setUpgradeModalOpen(true)}
            activeInsightKey={activeInsightKey}
            evidenceModel={evidenceModel}
            activeEvidenceTargetId={activeEvidenceTargetId}
            onInsightSelect={(insightKey) => {
              revealImmersiveSection(insightKey);
            }}
            onEvidenceSelect={handleEvidenceSelect}
          />
        }
      />

      {chatBlocked && (
        <div
          className="fixed inset-0 z-[80] bg-background/82 backdrop-blur-xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="chat-consent-title"
        >
          <div className="flex min-h-full items-center justify-center p-6">
            <div className="w-full max-w-2xl rounded-3xl border border-border bg-card/95 p-6 text-card-foreground shadow-[0_30px_90px_rgba(15,23,42,0.20)] dark:shadow-[0_30px_90px_rgba(0,0,0,0.6)] md:p-8">
              <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Collision IQ Consent
              </div>
              <h2 id="chat-consent-title" className="mt-3 text-2xl font-semibold text-card-foreground md:text-3xl">
                Consent Required to Use AI Chat
              </h2>
              <div className="mt-3 space-y-4 text-sm leading-7 text-muted-foreground md:text-base">
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
                    className="text-foreground underline underline-offset-4 hover:text-orange-600"
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
                    className="text-foreground underline underline-offset-4 hover:text-orange-600"
                  >
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a
                    href="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground underline underline-offset-4 hover:text-orange-600"
                  >
                    Privacy Policy
                  </a>.
                </p>
              </div>

              <div className="mt-6 rounded-2xl border border-border bg-muted p-4">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={consentChecked}
                    onChange={(event) => setConsentChecked(event.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-border bg-input text-orange-500 focus:ring-orange-500"
                  />
                  <span className="text-sm leading-6 text-muted-foreground">
                    I have read and agree to the Terms of Service and Privacy Policy, and I consent to the use of the AI chatbot as described above.
                  </span>
                </label>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  You must check the box before continuing.
                </p>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <a
                    href="/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="transition hover:text-foreground"
                  >
                    Terms of Service
                  </a>
                  <span className="opacity-30">|</span>
                  <a
                    href="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="transition hover:text-foreground"
                  >
                    Privacy Policy
                  </a>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleConsentCancel}
                    className="rounded-2xl bg-background px-4 py-2 text-sm text-muted-foreground transition hover:bg-card hover:text-foreground"
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

      <UpgradeModal
        open={upgradeModalOpen}
        onClose={() => setUpgradeModalOpen(false)}
        title="Upgrade to Pro"
        description="Upgrade to Pro to generate a Customer Report."
      />
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
  plan,
  canUseSnapshotExport,
  canUseBasicPdfExport,
  canUseDisputeReportExport,
  canUseRebuttalEmail,
  canUseCustomerReport,
  analysisReportId,
  attachmentIds,
  onCustomerReportLocked,
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
  plan: AccountEntitlements["plan"] | "none";
  canUseSnapshotExport: boolean;
  canUseBasicPdfExport: boolean;
  canUseDisputeReportExport: boolean;
  canUseRebuttalEmail: boolean;
  canUseCustomerReport: boolean;
  analysisReportId: string | null;
  attachmentIds: string[];
  onCustomerReportLocked: () => void;
  activeInsightKey: InsightKey | null;
  evidenceModel: EvidenceLinkModel | null;
  activeEvidenceTargetId: string | null;
  onInsightSelect: (insightKey: InsightKey) => void;
  onEvidenceSelect: (link: EvidenceLink) => void;
}) {
  const sectionRefs = useRef<Partial<Record<InsightKey, HTMLDivElement | null>>>({});
  const [isGeneratingCustomerReport, setIsGeneratingCustomerReport] = useState(false);
  const [customerReportError, setCustomerReportError] = useState<string | null>(null);
  const [snapshotPreviewOpen, setSnapshotPreviewOpen] = useState(false);
  const [snapshotSendTarget, setSnapshotSendTarget] = useState<SnapshotDestinationType | null>(null);
  const [snapshotRecipientEmail, setSnapshotRecipientEmail] = useState("");
  const [snapshotSubject, setSnapshotSubject] = useState("");
  const [snapshotMessage, setSnapshotMessage] = useState("");
  const [snapshotReviewed, setSnapshotReviewed] = useState(false);
  const [snapshotStatus, setSnapshotStatus] = useState<string | null>(null);
  const [snapshotSending, setSnapshotSending] = useState(false);
  const [snapshotSent, setSnapshotSent] = useState(false);
  const [reportSendTarget, setReportSendTarget] = useState<ReportDestinationType>("internal");
  const [activeReportToSend, setActiveReportToSend] = useState<ReportType | null>(null);
  const [reportRecipientEmail, setReportRecipientEmail] = useState("");
  const [reportSubject, setReportSubject] = useState("");
  const [reportMessage, setReportMessage] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const [reportSendStatus, setReportSendStatus] = useState<string | null>(null);
  const [reportReviewed, setReportReviewed] = useState(false);
  const [reportSendHistory, setReportSendHistory] = useState<ReportSendHistoryItem[]>([]);
  const [reportSendHistoryLoading, setReportSendHistoryLoading] = useState(false);
  const [serviceCheckoutLoading, setServiceCheckoutLoading] = useState(false);
  function registerSectionRef(insightKey: InsightKey, node: HTMLDivElement | null) {
    sectionRefs.current[insightKey] = node;
  }
  const snapshot = useMemo(
    () =>
      hasResolvedAnalysis
        ? buildCollisionSnapshot({
            renderModel,
            estimateComparisons:
              workspaceData?.estimateComparisons ??
              normalizedResult?.estimateComparisons ??
              analysisResult?.analysis?.estimateComparisons,
          })
        : null,
    [analysisResult, hasResolvedAnalysis, normalizedResult, renderModel, workspaceData]
  );
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
    ? renderModel.supplementItems.length > 0
      ? "Review"
      : "Low"
    : "Pending";
  const railConfidence = hasResolvedAnalysis
    ? formatLabel(renderModel.vehicle.confidence)
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
    ...renderModel.reportFields.documentedProcedures,
    ...renderModel.reportFields.documentedHighlights,
  ]).slice(0, 5);
  const recommendedMoves = dedupeRailItems([
    ...renderModel.disputeIntelligenceReport.nextMoves,
    ...renderModel.negotiationPlaybook.suggestedSequence,
    ...renderModel.negotiationPlaybook.documentationNeeded,
  ]).slice(0, 5);
  const academyTrigger = snapshot
    ? resolveAcademyServiceTrigger({
        snapshot,
        renderModel,
        valuationLowConfidence,
        appraisalTriggered: Boolean(panel.appraisal?.triggered),
      })
    : null;
  const fetchReportSendHistory = useCallback(async () => {
    if (!analysisReportId) {
      setReportSendHistory([]);
      return;
    }

    setReportSendHistoryLoading(true);
    try {
      const response = await fetch(
        `/api/reports/sends?caseId=${encodeURIComponent(analysisReportId)}&limit=25`,
        { credentials: "same-origin" }
      );
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { sends?: ReportSendHistoryItem[] };
      setReportSendHistory(Array.isArray(data.sends) ? data.sends : []);
    } catch {
      // Send history is advisory; email and download flows should keep working.
    } finally {
      setReportSendHistoryLoading(false);
    }
  }, [analysisReportId]);
  const getLastSendFor = useCallback(
    (reportType: ReportType, destinationType?: ReportDestinationType) =>
      reportSendHistory.find(
        (send) =>
          send.reportType === reportType &&
          (!destinationType || send.destinationType === destinationType)
      ) ?? null,
    [reportSendHistory]
  );
  const snapshotSendReady =
    Boolean(snapshotSendTarget) &&
    isValidEmail(snapshotRecipientEmail) &&
    Boolean(snapshotSubject.trim()) &&
    Boolean(snapshotMessage.trim()) &&
    snapshotReviewed &&
    !snapshotSending;
  const reportSendReady =
    Boolean(activeReportToSend) &&
    isValidEmail(reportRecipientEmail) &&
    Boolean(reportSubject.trim()) &&
    Boolean(reportMessage.trim()) &&
    reportReviewed &&
    !reportSending;

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void fetchReportSendHistory();
  }, [fetchReportSendHistory]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function openSnapshotPreview() {
    if (!snapshot) {
      setSnapshotStatus("Snapshot could not be generated from the current report.");
      return;
    }

    setSnapshotStatus(null);
    setSnapshotPreviewOpen(true);
    emitSafeCrmEventFromClient({
      event: "snapshot_created",
      plan,
      adjustedConfidence: snapshot.evidenceCompleteness.adjustedConfidence,
      completenessStatus: snapshot.evidenceCompleteness.completenessStatus,
      topDisputeCount: snapshot.topDisputeItems.length,
      uploadLimitReached: snapshot.evidenceCompleteness.uploadLimitReached,
      userIndicatedMoreFiles: snapshot.evidenceCompleteness.userIndicatedMoreFiles,
    });
  }

  function downloadSnapshotPdf() {
    if (!snapshot) {
      setSnapshotStatus("Snapshot could not be generated from the current report.");
      return;
    }

    void exportCarrierPDF(buildCollisionSnapshotPdfFromSnapshot(snapshot));
    emitSafeCrmEventFromClient({
      event: "snapshot_downloaded",
      plan,
      exportType: "snapshot",
      adjustedConfidence: snapshot.evidenceCompleteness.adjustedConfidence,
      completenessStatus: snapshot.evidenceCompleteness.completenessStatus,
      topDisputeCount: snapshot.topDisputeItems.length,
      uploadLimitReached: snapshot.evidenceCompleteness.uploadLimitReached,
      userIndicatedMoreFiles: snapshot.evidenceCompleteness.userIndicatedMoreFiles,
    });
  }

  async function copySnapshotSummary() {
    if (!snapshot) {
      setSnapshotStatus("Snapshot could not be generated from the current report.");
      return;
    }

    try {
      await navigator.clipboard.writeText(buildSnapshotPlainText(snapshot));
      setSnapshotStatus("Redacted snapshot summary copied.");
      emitSafeCrmEventFromClient({
        event: "snapshot_copied",
        plan,
        adjustedConfidence: snapshot.evidenceCompleteness.adjustedConfidence,
        completenessStatus: snapshot.evidenceCompleteness.completenessStatus,
        topDisputeCount: snapshot.topDisputeItems.length,
        uploadLimitReached: snapshot.evidenceCompleteness.uploadLimitReached,
        userIndicatedMoreFiles: snapshot.evidenceCompleteness.userIndicatedMoreFiles,
      });
    } catch {
      setSnapshotStatus("Snapshot summary could not be copied.");
    }
  }

  function openSnapshotSend(target: SnapshotDestinationType) {
    if (!snapshot) {
      setSnapshotStatus("Snapshot could not be generated from the current report.");
      return;
    }

    setSnapshotSendTarget(target);
    setSnapshotRecipientEmail("");
    setSnapshotSubject(
      target === "customer"
        ? "[Collision IQ] Your Vehicle Snapshot Report"
        : "[Collision IQ] Collision Snapshot - Repair Plan and Estimate Comparison"
    );
    setSnapshotMessage(buildSnapshotEmailBody(snapshot, target));
    setSnapshotReviewed(false);
    setSnapshotStatus(null);
  }

  function openReportSend(reportType: ReportType, destinationType: ReportDestinationType = "internal") {
    if (reportType === "snapshot" && !snapshot) {
      setSnapshotStatus("Snapshot could not be generated from the current report.");
      return;
    }
    if (reportType !== "snapshot" && !canRenderExports) {
      setReportSendStatus("Report is not ready to send yet.");
      return;
    }

    setActiveReportToSend(reportType);
    setReportSendTarget(destinationType);
    setReportRecipientEmail("");
    setReportSubject(getDefaultReportSubject(reportType));
    setReportMessage(getDefaultReportMessage(reportType, destinationType, renderModel));
    setReportReviewed(false);
    setReportSendStatus(null);
  }

  async function buildReportDocument(reportType: ReportType): Promise<CarrierReportDocument> {
    if (reportType === "snapshot") {
      if (!snapshot) {
        throw new Error("Snapshot could not be generated from the current report.");
      }
      return buildCollisionSnapshotPdfFromSnapshot(snapshot);
    }

    const resolvedAnalysis =
      normalizedResult ?? (analysisResult ? normalizeReportToAnalysisResult(analysisResult) : null);
    const sharedInput = {
      renderModel,
      report: analysisResult,
      analysis: resolvedAnalysis,
      panel,
      assistantAnalysis: analysisText,
      workspaceData,
    };

    if (reportType === "full_report") {
      return buildCarrierReport(sharedInput);
    }
    if (reportType === "rebuttal") {
      return buildRebuttalEmailPdf(sharedInput);
    }
    if (reportType === "dispute_intelligence") {
      return buildDisputeIntelligencePdf(sharedInput);
    }

    return await buildCustomerReportDocument({
      renderModel,
      normalizedResult,
      analysisResult,
      panel,
      analysisText,
      workspaceData,
      onLocked: onCustomerReportLocked,
    });
  }

  async function sendReportEmail() {
    if (!activeReportToSend || !reportSendReady) {
      return;
    }

    setReportSending(true);
    setReportSendStatus("Sending...");
    setReportSent(false);
    setCustomerReportError(null);

    try {
      const document = await buildReportDocument(activeReportToSend);
      const pdfBlob = await buildCarrierPdfBlob(document);
      const pdfBase64 = await blobToBase64(pdfBlob);
      const response = await fetch("/api/reports/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          reportType: activeReportToSend,
          destinationType: reportSendTarget,
          recipientEmail: reportRecipientEmail,
          subject: reportSubject,
          message: reportMessage,
          pdfBase64,
          filename: document.filename || getDefaultReportFilename(activeReportToSend),
          metadata: {
            caseId: analysisReportId ?? undefined,
            vehicle: vehicleIdentity ?? undefined,
            vin: vehicleVin ?? undefined,
            customerEmail: undefined,
          },
        }),
      });

      const result = (await response.json().catch(() => null)) as {
        deliveryMode?: "email" | "manual";
        message?: string;
        error?: string;
        id?: string | null;
        sentAt?: string;
        reportSendId?: string | null;
      } | null;

      if (!response.ok) {
        throw new Error(result?.error || "Report email failed.");
      }

      if (result?.deliveryMode === "manual") {
        setReportSendStatus(result.message || "Email provider is not configured. Download the PDF and send manually.");
      } else {
        setReportSent(true);
        setReportSendStatus("Sent successfully.");
      }
      emitSafeCrmEventFromClient({
        event: "report_sent",
        plan,
        exportType: activeReportToSend,
        destinationType: reportSendTarget,
      });
      if (analysisReportId) {
        void fetchReportSendHistory();
      } else if (result?.sentAt) {
        const sentAt = result.sentAt;
        setReportSendHistory((current) => [
          {
            id: result.reportSendId ?? `local-${sentAt}`,
            caseId: null,
            reportType: activeReportToSend,
            destinationType: reportSendTarget,
            recipient: reportRecipientEmail,
            subject: reportSubject,
            resendId: result.id ?? null,
            status: result.deliveryMode === "manual" ? "manual" : "sent",
            sentAt,
            deliveredAt: null,
            bouncedAt: null,
            failedAt: null,
            openedAt: null,
          },
          ...current,
        ]);
      }
    } catch (error) {
      setReportSendStatus(
        error instanceof Error
          ? error.message
          : "Report was not sent. Please download the PDF and send manually."
      );
    } finally {
      setReportSending(false);
    }
  }

  async function sendSnapshot() {
    if (!snapshot || !snapshotSendTarget || !snapshotSendReady) {
      return;
    }

    setSnapshotSending(true);
    setSnapshotStatus("Sending...");
    setSnapshotSent(false);

    try {
      const document = buildCollisionSnapshotPdfFromSnapshot(snapshot);
      const pdfBlob = await buildCarrierPdfBlob(document);
      const pdfBase64 = await blobToBase64(pdfBlob);
      logSnapshotSendAttempt(snapshot, snapshotSendTarget, Boolean(pdfBase64));

      const response = await fetch("/api/reports/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          reportType: "snapshot",
          destinationType: snapshotSendTarget,
          recipientEmail: snapshotRecipientEmail,
          subject: snapshotSubject,
          message: sanitizeSnapshotOutboundText(snapshotMessage),
          pdfBase64,
          filename: "collision-snapshot.pdf",
          metadata: {
            caseId: analysisReportId ?? undefined,
            vehicle: snapshot.vehicleLabel,
            vin: vehicleVin ?? undefined,
          },
        }),
      });

      if (!response.ok) {
        throw new Error("Snapshot email failed.");
      }

      const result = (await response.json()) as {
        deliveryMode?: "email" | "manual";
        message?: string;
        id?: string | null;
        sentAt?: string;
        reportSendId?: string | null;
      };
      if (result.deliveryMode === "manual") {
        setSnapshotStatus(result.message || "Email provider is not configured. Download the PDF and send manually.");
      } else {
        setSnapshotSent(true);
        setSnapshotStatus("Sent successfully.");
      }
      emitSafeCrmEventFromClient({
        event: "report_sent",
        plan,
        destinationType: snapshotSendTarget,
        exportType: "snapshot",
      });
      if (analysisReportId) {
        void fetchReportSendHistory();
      } else if (result.sentAt) {
        const sentAt = result.sentAt;
        setReportSendHistory((current) => [
          {
            id: result.reportSendId ?? `local-${sentAt}`,
            caseId: null,
            reportType: "snapshot",
            destinationType: snapshotSendTarget,
            recipient: snapshotRecipientEmail,
            subject: snapshotSubject,
            resendId: result.id ?? null,
            status: result.deliveryMode === "manual" ? "manual" : "sent",
            sentAt,
            deliveredAt: null,
            bouncedAt: null,
            failedAt: null,
            openedAt: null,
          },
          ...current,
        ]);
      }
      emitSafeCrmEventFromClient({
        event: snapshotSendTarget === "customer" ? "snapshot_sent_customer" : "snapshot_sent_carrier",
        plan,
        destinationType: snapshotSendTarget,
        exportType: "snapshot",
        adjustedConfidence: snapshot.evidenceCompleteness.adjustedConfidence,
        completenessStatus: snapshot.evidenceCompleteness.completenessStatus,
        topDisputeCount: snapshot.topDisputeItems.length,
        uploadLimitReached: snapshot.evidenceCompleteness.uploadLimitReached,
        userIndicatedMoreFiles: snapshot.evidenceCompleteness.userIndicatedMoreFiles,
      });
    } catch {
      setSnapshotStatus("Snapshot was not sent. Please download the PDF and send manually.");
    } finally {
      setSnapshotSending(false);
    }
  }

  async function startAcademyServiceCheckout(serviceTypeOverride?: string) {
    if (!analysisReportId) {
      setSnapshotStatus("Start a case review before opening an Academy service checkout.");
      return;
    }

    const claimId = toStableClaimId(analysisReportId);
    if (!claimId) {
      setSnapshotStatus("We could not resolve the active case ID for checkout.");
      return;
    }

    setServiceCheckoutLoading(true);
    setSnapshotStatus(null);
    const serviceType = serviceTypeOverride ?? academyTrigger?.serviceKey ?? "academy_appraisal";

    const checkoutWindow = window.open("about:blank", "_blank");
    if (checkoutWindow) {
      checkoutWindow.opener = null;
    }

    try {
      const response = await fetch("/api/billing/service-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          serviceType,
          claimId,
          analysisReportId,
          attachmentIds,
          sourcePage: "collision-iq-case",
          returnUrl: getCurrentWorkspaceReturnUrl(),
        }),
      });

      const data = (await response.json().catch(() => null)) as {
        url?: string;
        error?: string;
      } | null;

      if (!response.ok || !data?.url) {
        throw new Error(data?.error || "Academy checkout could not be started.");
      }

      if (checkoutWindow) {
        checkoutWindow.location.href = data.url;
      } else {
        window.open(data.url, "_blank", "noopener,noreferrer");
      }
      setSnapshotStatus("Checkout opened in a new tab. You can keep working in this chat.");
    } catch (error) {
      checkoutWindow?.close();
      setSnapshotStatus(
        error instanceof Error
          ? error.message
          : "Academy checkout could not be started."
      );
    } finally {
      setServiceCheckoutLoading(false);
    }
  }

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
    <div className="flex h-full min-h-0 flex-col px-4 py-5 md:px-5 md:py-6">
      <section className="rounded-[24px] bg-card/92 p-4 shadow-[0_18px_46px_rgba(15,23,42,0.09)] ring-1 ring-border/50 dark:shadow-[0_18px_46px_rgba(0,0,0,0.22)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Claim Command Center
            </div>
            <div className="mt-1.5 text-[1.12rem] font-semibold tracking-[-0.03em] text-card-foreground">
              Decision-Ready Analysis
            </div>
            <div className="mt-1 text-[13px] leading-5 text-muted-foreground">
              Fast scan first. Details below.
            </div>
          </div>
          <div className="rounded-full bg-muted/85 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground ring-1 ring-border/50">
            {railStatus}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5">
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
          <div className="text-[13px] leading-5 text-muted-foreground">
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
          <div className="text-[13px] leading-5 text-muted-foreground">
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
          <section className="mt-5 space-y-2 rounded-2xl bg-card/88 p-3.5 shadow-sm ring-1 ring-border/45">
            <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Decision Snapshot</div>
            <div className="text-[13px] leading-5 text-muted-foreground">
              Upload an estimate or photos to generate the key repair risks, missing support, and next-step guidance.
            </div>
          </section>
        )}
      </RailInsightSection>

      <RailGroup label="Context" compact />

      {hasResolvedAnalysis && (
        <section className="mt-5 space-y-2.5 rounded-2xl border border-border bg-card p-3.5">
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Vehicle Context
          </div>
          <div className="space-y-1.5 text-[13px] leading-5 text-muted-foreground">
            {vehicleIdentity && <div className="text-foreground">{vehicleIdentity}</div>}
            {renderModel.vehicle.trim && (
              <div className="text-muted-foreground">Trim: {renderModel.vehicle.trim}</div>
            )}
            {vehicleVin && <div className="text-muted-foreground">VIN: {vehicleVin}</div>}
            {insurer && <div className="text-muted-foreground">Insurer: {insurer}</div>}
            {typeof renderModel.reportFields.mileage === "number" && (
              <div className="text-muted-foreground">
                Mileage: {renderModel.reportFields.mileage.toLocaleString("en-US")}
              </div>
            )}
            {estimateTotal && <div className="text-muted-foreground">Estimate total: {estimateTotal}</div>}
            <div className="text-muted-foreground">
              Confidence: {formatVehicleConfidence(renderModel.vehicle)}
            </div>
          </div>
        </section>
      )}

      {hasResolvedAnalysis ? (
        <ConfidenceIntegrityCard integrity={renderModel.confidenceIntegrity} />
      ) : null}

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
          {renderModel.findingReasoning.length > 0 ? (
            <FindingReasoningCard findings={renderModel.findingReasoning} />
          ) : null}
          {renderModel.retrievalSummary ? (
            <RetrievalSummaryCard summary={renderModel.retrievalSummary} />
          ) : null}
          {renderModel.disputeStrategy ? (
            <DisputeStrategyCard strategy={renderModel.disputeStrategy} />
          ) : null}
        </RailInsightSection>
      ) : null}

      {hasResolvedAnalysis && canViewSupplementLines && renderModel.findingReasoning.length === 0 ? (
        <LineStatusCard />
      ) : null}

      {hasResolvedAnalysis && canViewSupplementLines ? (
        <RailInsightSection
          insightKey="financial_view"
          activeInsightKey={activeInsightKey}
          registerSectionRef={registerSectionRef}
          onActivate={onInsightSelect}
        >
          <GapSummaryCard
            renderModel={renderModel}
          />
          {analysisResult ? (
            <div className="mt-3">
              <ValuationSection
                renderModel={renderModel}
                lowConfidence={valuationLowConfidence}
                checkoutLoading={serviceCheckoutLoading}
                onStartAcvCheckout={() => void startAcademyServiceCheckout("academy_acv_review")}
              />
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
          {hasResolvedAnalysis && canViewSupplementLines && !renderModel.disputeStrategy ? (
            <NegotiationPostureCard />
          ) : null}
        </RailInsightSection>
      ) : null}

      {hasResolvedAnalysis && canViewSupplementLines ? (
        <RailInsightSection
          insightKey="support_gaps"
          activeInsightKey={activeInsightKey}
          registerSectionRef={registerSectionRef}
          onActivate={onInsightSelect}
        >
        <section className="mt-5 space-y-2.5 rounded-2xl border border-border bg-card p-3.5">
        <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Support Gaps
        </div>
        {remainingRecommendations.length > 0 ? (
          <div className="space-y-2.5">
            {remainingRecommendations.map((item, index) => (
              <div key={`${item.title}-${index}`} className="rounded-xl bg-muted px-3 py-3">
                <div className="text-sm font-medium leading-5 text-foreground">
                  {displayOperationLabel(item.title)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatLabel(item.category)} · {formatLabel(item.kind)} · Priority {formatLabel(item.priority)}
                </div>
                <div className="mt-2 text-[13px] leading-5 text-muted-foreground">{item.rationale}</div>
                {item.evidence && (
                  <div className="mt-2 text-xs leading-5 text-muted-foreground">Evidence: {item.evidence}</div>
                )}
                {item.source && (
                  <div className="mt-1 text-[11px] leading-5 text-muted-foreground">Source: {item.source}</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[13px] leading-5 text-muted-foreground">
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
        <section className="mt-5 space-y-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border/45">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Reports & Exports
            </div>
            <div className="mt-1 text-[13px] leading-5 text-muted-foreground">
              Download carrier-ready PDFs or email a report directly.
            </div>
          </div>
          <div className="grid gap-3">
            <button
              type="button"
              onClick={openSnapshotPreview}
              disabled={!canUseSnapshotExport}
              className="group flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#C65A2A]/35 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-ring/25 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#C65A2A]/12 text-[#C65A2A]">
                  <FileText size={17} aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">1-Page Snapshot</span>
                  <span className="block text-[12px] leading-5 text-muted-foreground">Preview, download, or send a redacted snapshot.</span>
                </span>
              </span>
              <ArrowRight size={16} className="shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-[#C65A2A]" aria-hidden />
            </button>
            <ReportSendStatusLine
              send={getLastSendFor("snapshot")}
              loading={reportSendHistoryLoading}
            />
            {canUseBasicPdfExport ? (
              <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-sm transition hover:border-[#C65A2A]/25 hover:shadow-md">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <FileText size={15} className="text-[#C65A2A]" aria-hidden />
                    Collision Repair Intelligence Report
                  </div>
                  <div className="mt-1 text-[12px] leading-5 text-muted-foreground">Carrier-ready repair intelligence package.</div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      exportReport(
                        renderModel,
                        normalizedResult,
                        analysisResult,
                        panel,
                        analysisText,
                        workspaceData
                      );
                      emitSafeCrmEventFromClient({
                        event: "report_generated",
                        plan,
                        exportType: "full_report",
                      });
                    }}
                    className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-left text-xs font-semibold leading-5 text-foreground transition hover:border-[#C65A2A]/35 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring/25 active:scale-[0.99]"
                  >
                    <span className="inline-flex items-center gap-2"><Download size={15} aria-hidden /> Download PDF</span>
                    <ArrowRight size={14} className="transition group-hover:translate-x-0.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => openReportSend("full_report")}
                    className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-[#C65A2A] bg-[#C65A2A] px-3 py-2.5 text-left text-xs font-semibold leading-5 text-black transition hover:bg-[#C65A2A]/90 focus:outline-none focus:ring-2 focus:ring-ring/25 active:scale-[0.99]"
                  >
                    <span className="inline-flex items-center gap-2"><Mail size={15} aria-hidden /> Email report</span>
                    <ArrowRight size={14} className="transition group-hover:translate-x-0.5" aria-hidden />
                  </button>
                </div>
                <ReportSendStatusLine
                  send={getLastSendFor("full_report")}
                  loading={reportSendHistoryLoading}
                />
              </div>
            ) : null}
            {canUseRebuttalEmail ? (
              <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-sm transition hover:border-[#C65A2A]/25 hover:shadow-md">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <FileText size={15} className="text-[#C65A2A]" aria-hidden />
                    Rebuttal Email
                  </div>
                  <div className="mt-1 text-[12px] leading-5 text-muted-foreground">Negotiation-ready rebuttal language.</div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      exportPdfVariant({
                        normalizedResult,
                        analysisResult,
                        panel,
                        analysisText,
                        workspaceData,
                        renderModel,
                        variant: "rebuttal",
                      });
                      emitSafeCrmEventFromClient({
                        event: "report_generated",
                        plan,
                        exportType: "rebuttal",
                      });
                    }}
                    className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-left text-xs font-semibold leading-5 text-foreground transition hover:border-[#C65A2A]/35 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring/25 active:scale-[0.99]"
                  >
                    <span className="inline-flex items-center gap-2"><Download size={15} aria-hidden /> Download PDF</span>
                    <ArrowRight size={14} className="transition group-hover:translate-x-0.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => openReportSend("rebuttal", "carrier")}
                    className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-[#C65A2A] bg-[#C65A2A] px-3 py-2.5 text-left text-xs font-semibold leading-5 text-black transition hover:bg-[#C65A2A]/90 focus:outline-none focus:ring-2 focus:ring-ring/25 active:scale-[0.99]"
                  >
                    <span className="inline-flex items-center gap-2"><Mail size={15} aria-hidden /> Email report</span>
                    <ArrowRight size={14} className="transition group-hover:translate-x-0.5" aria-hidden />
                  </button>
                </div>
                <ReportSendStatusLine
                  send={getLastSendFor("rebuttal")}
                  loading={reportSendHistoryLoading}
                />
              </div>
            ) : null}
            {canUseDisputeReportExport ? (
              <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-sm transition hover:border-[#C65A2A]/25 hover:shadow-md">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <FileText size={15} className="text-[#C65A2A]" aria-hidden />
                    Dispute Intelligence Report
                  </div>
                  <div className="mt-1 text-[12px] leading-5 text-muted-foreground">Evidence-backed dispute framing.</div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      exportPdfVariant({
                        normalizedResult,
                        analysisResult,
                        panel,
                        analysisText,
                        workspaceData,
                        renderModel,
                        variant: "dispute_intelligence",
                      });
                      emitSafeCrmEventFromClient({
                        event: "report_generated",
                        plan,
                        exportType: "dispute_report",
                      });
                    }}
                    className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-left text-xs font-semibold leading-5 text-foreground transition hover:border-[#C65A2A]/35 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring/25 active:scale-[0.99]"
                  >
                    <span className="inline-flex items-center gap-2"><Download size={15} aria-hidden /> Download PDF</span>
                    <ArrowRight size={14} className="transition group-hover:translate-x-0.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => openReportSend("dispute_intelligence", "carrier")}
                    className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-[#C65A2A] bg-[#C65A2A] px-3 py-2.5 text-left text-xs font-semibold leading-5 text-black transition hover:bg-[#C65A2A]/90 focus:outline-none focus:ring-2 focus:ring-ring/25 active:scale-[0.99]"
                  >
                    <span className="inline-flex items-center gap-2"><Mail size={15} aria-hidden /> Email report</span>
                    <ArrowRight size={14} className="transition group-hover:translate-x-0.5" aria-hidden />
                  </button>
                </div>
                <ReportSendStatusLine
                  send={getLastSendFor("dispute_intelligence")}
                  loading={reportSendHistoryLoading}
                />
              </div>
            ) : null}
            {canUseCustomerReport ? (
              <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-sm transition hover:border-[#C65A2A]/25 hover:shadow-md">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <FileText size={15} className="text-[#C65A2A]" aria-hidden />
                    Customer Report
                  </div>
                  <div className="mt-1 text-[12px] leading-5 text-muted-foreground">Plain-language customer-facing summary.</div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    aria-disabled={isGeneratingCustomerReport}
                    onClick={() => {
                      if (isGeneratingCustomerReport) {
                        return;
                      }

                      void exportCustomerReport({
                        renderModel,
                        normalizedResult,
                        analysisResult,
                        panel,
                        analysisText,
                        workspaceData,
                        onStart: () => {
                          setCustomerReportError(null);
                          setIsGeneratingCustomerReport(true);
                        },
                        onComplete: () => setIsGeneratingCustomerReport(false),
                        onLocked: onCustomerReportLocked,
                        onError: setCustomerReportError,
                      });
                      emitSafeCrmEventFromClient({
                        event: "report_generated",
                        plan,
                        exportType: "customer_report",
                      });
                    }}
                    className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-left text-xs font-semibold leading-5 text-foreground transition hover:border-[#C65A2A]/35 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring/25 active:scale-[0.99] aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                  >
                    <span className="inline-flex items-center gap-2"><Download size={15} aria-hidden /> {isGeneratingCustomerReport ? "Generating..." : "Download PDF"}</span>
                    <ArrowRight size={14} className="transition group-hover:translate-x-0.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    disabled={isGeneratingCustomerReport}
                    onClick={() => openReportSend("customer_report", "customer")}
                    className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-[#C65A2A] bg-[#C65A2A] px-3 py-2.5 text-left text-xs font-semibold leading-5 text-black transition hover:bg-[#C65A2A]/90 focus:outline-none focus:ring-2 focus:ring-ring/25 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="inline-flex items-center gap-2"><Mail size={15} aria-hidden /> Email report</span>
                    <ArrowRight size={14} className="transition group-hover:translate-x-0.5" aria-hidden />
                  </button>
                </div>
                <ReportSendStatusLine
                  send={getLastSendFor("customer_report")}
                  loading={reportSendHistoryLoading}
                />
              </div>
            ) : null}
            {!canUseBasicPdfExport || !canUseDisputeReportExport || !canUseRebuttalEmail || !canUseCustomerReport ? (
              <button
                type="button"
                onClick={onCustomerReportLocked}
                className="w-full rounded-xl border border-orange-400/18 bg-[#C65A2A]/10 p-3 text-xs text-foreground transition hover:bg-[#C65A2A]/16"
              >
                Full reports, Dispute Intelligence, Rebuttal PDF, and Customer Report are available on Pro.
              </button>
            ) : null}
            {academyTrigger ? (
              <button
                type="button"
                onClick={() => void startAcademyServiceCheckout()}
                disabled={serviceCheckoutLoading}
                className="w-full rounded-xl border border-[#C65A2A]/30 bg-gradient-to-br from-[#C65A2A]/18 via-[#C65A2A]/10 to-white/[0.02] p-3 text-left transition hover:bg-[#C65A2A]/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="text-[10px] uppercase tracking-[0.22em] text-[#E8A27F]">Academy Service</div>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {serviceCheckoutLoading ? "Opening checkout..." : academyTrigger.cta}
                </div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">Why this is showing: {academyTrigger.reason}</div>
              </button>
            ) : null}
            {customerReportError ? (
              <div className="rounded-xl border border-red-500/16 bg-red-500/[0.05] px-3 py-2 text-[12px] leading-5 text-red-200/80">
                {customerReportError}
              </div>
            ) : null}
            {snapshotStatus ? (
              <div className="rounded-xl border border-border bg-muted px-3 py-2 text-[12px] leading-5 text-muted-foreground">
                {snapshotStatus}
              </div>
            ) : null}
            {reportSendStatus ? (
              <div className="rounded-xl border border-border bg-muted px-3 py-2 text-[12px] leading-5 text-muted-foreground">
                {reportSendStatus}
              </div>
            ) : null}
          </div>
        </section>
        </RailInsightSection>
      ) : null}

      {snapshotPreviewOpen && snapshot ? (
        <SnapshotPreviewModal
          snapshot={snapshot}
          sendTarget={snapshotSendTarget}
          recipientEmail={snapshotRecipientEmail}
          subject={snapshotSubject}
          message={snapshotMessage}
          reviewed={snapshotReviewed}
          sending={snapshotSending}
          sent={snapshotSent}
          status={snapshotStatus}
          sendReady={snapshotSendReady}
          onClose={() => {
            setSnapshotPreviewOpen(false);
            setSnapshotSendTarget(null);
            setSnapshotSent(false);
          }}
          onDownload={downloadSnapshotPdf}
          onCopy={copySnapshotSummary}
          onOpenSend={openSnapshotSend}
          onRecipientEmailChange={setSnapshotRecipientEmail}
          onSubjectChange={setSnapshotSubject}
          onMessageChange={setSnapshotMessage}
          onReviewedChange={setSnapshotReviewed}
          serviceCheckoutLoading={serviceCheckoutLoading}
          onStartServiceCase={() => void startAcademyServiceCheckout()}
          onSend={() => void sendSnapshot()}
          onCancelSend={() => { setSnapshotSendTarget(null); setSnapshotSent(false); }}
        />
      ) : null}
      {activeReportToSend ? (
        <ReportSendModal
          destinationType={reportSendTarget}
          recipientEmail={reportRecipientEmail}
          subject={reportSubject}
          message={reportMessage}
          reviewed={reportReviewed}
          sending={reportSending}
          sent={reportSent}
          sendReady={reportSendReady}
          status={reportSendStatus}
          onDestinationTypeChange={setReportSendTarget}
          onRecipientEmailChange={setReportRecipientEmail}
          onSubjectChange={setReportSubject}
          onMessageChange={setReportMessage}
          onReviewedChange={setReportReviewed}
          onSend={() => void sendReportEmail()}
          onCancel={() => {
            setActiveReportToSend(null);
            setReportSendStatus(null);
            setReportSent(false);
          }}
        />
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
  variant: "snapshot" | "rebuttal" | "dispute_intelligence";
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
    params.variant === "snapshot"
      ? buildCollisionSnapshotPdf(sharedInput)
      : params.variant === "rebuttal"
      ? buildRebuttalEmailPdf(sharedInput)
      : buildDisputeIntelligencePdf(sharedInput);

  void exportCarrierPDF(document);
}

function getDefaultReportSubject(reportType: ReportType): string {
  switch (reportType) {
    case "snapshot":
      return "[Collision IQ] Your Vehicle Snapshot Report";
    case "full_report":
      return "[Collision IQ] Collision Repair Intelligence Report";
    case "rebuttal":
      return "[Collision IQ] Carrier Rebuttal Package";
    case "dispute_intelligence":
      return "[Collision IQ] Dispute Intelligence Report";
    case "customer_report":
      return "[Collision IQ] Customer Repair Summary";
  }
}

function getDefaultReportFilename(reportType: ReportType): string {
  switch (reportType) {
    case "snapshot":
      return "collision-snapshot.pdf";
    case "full_report":
      return "collision-iq-main-report.pdf";
    case "rebuttal":
      return "carrier-rebuttal-package.pdf";
    case "dispute_intelligence":
      return "dispute-intelligence-report.pdf";
    case "customer_report":
      return "customer-report.pdf";
  }
}

function getDefaultReportMessage(
  reportType: ReportType,
  destinationType: ReportDestinationType,
  renderModel: ReturnType<typeof buildExportModel>
): string {
  const vehicle = resolveCanonicalVehicleLabel(renderModel) || "the vehicle";
  const reportName = getDefaultReportSubject(reportType).replace("[Collision IQ] ", "");
  const greeting =
    destinationType === "carrier"
      ? "Hello,"
      : destinationType === "customer"
        ? "Hi,"
        : "Hello,";

  return [
    greeting,
    "",
    `Attached is the ${reportName} for ${vehicle}.`,
    "",
    "Please review the attached PDF and let us know if you have any questions.",
    "",
    "Thank you,",
    "Collision IQ",
  ].join("\n");
}

function ReportSendStatusLine({
  send,
  loading,
}: {
  send: ReportSendHistoryItem | null;
  loading: boolean;
}) {
  if (loading && !send) {
    return <div className="px-1 text-[11px] leading-4 text-muted-foreground">Loading send history...</div>;
  }
  if (!send) {
    return null;
  }

  return (
    <div className="px-1 text-[11px] leading-4 text-muted-foreground">
      {formatReportSendStatus(send)}
    </div>
  );
}

function formatReportSendStatus(send: ReportSendHistoryItem): string {
  const destination = formatReportDestination(send.destinationType);
  const relativeTime = formatRelativeTime(send.sentAt);

  if (send.status === "manual") {
    return `Manual send required for ${destination}${relativeTime ? ` ${relativeTime}` : ""}`;
  }
  if (send.status === "delivered") {
    return `Delivered to ${destination}${relativeTime ? ` ${relativeTime}` : ""}`;
  }
  if (send.status === "bounced") {
    return `Bounced to ${destination}${relativeTime ? ` ${relativeTime}` : ""}`;
  }
  if (send.status === "failed") {
    return `Failed sending to ${destination}${relativeTime ? ` ${relativeTime}` : ""}`;
  }
  if (send.status === "opened") {
    return `Opened by ${destination}${relativeTime ? ` ${relativeTime}` : ""}`;
  }

  return `Last sent to ${destination}${relativeTime ? ` ${relativeTime}` : ""}`;
}

function formatReportDestination(destinationType: ReportDestinationType): string {
  switch (destinationType) {
    case "customer":
      return "customer";
    case "carrier":
      return "carrier";
    case "internal":
      return "internal review";
  }
}

function formatRelativeTime(value: string): string | null {
  const date = new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) {
    return null;
  }

  const diffMs = Date.now() - time;
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

function ReportSendModal({
  destinationType,
  recipientEmail,
  subject,
  message,
  reviewed,
  sending,
  sent,
  sendReady,
  status,
  onDestinationTypeChange,
  onRecipientEmailChange,
  onSubjectChange,
  onMessageChange,
  onReviewedChange,
  onSend,
  onCancel,
}: {
  destinationType: ReportDestinationType;
  recipientEmail: string;
  subject: string;
  message: string;
  reviewed: boolean;
  sending: boolean;
  sent: boolean;
  sendReady: boolean;
  status: string | null;
  onDestinationTypeChange: (value: ReportDestinationType) => void;
  onRecipientEmailChange: (value: string) => void;
  onSubjectChange: (value: string) => void;
  onMessageChange: (value: string) => void;
  onReviewedChange: (value: boolean) => void;
  onSend: () => void;
  onCancel: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[10000]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="send-report-title"
    >
      <div className="fixed inset-0 z-[10000] bg-black/40 dark:bg-black/60" />
      <div className="fixed inset-0 isolate z-[10010] flex items-center justify-center p-4 sm:p-6">
      <div
        className="relative z-[10020] flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] shadow-xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-[#C65A2A]">
              Collision IQ
            </div>
            <h2 id="send-report-title" className="mt-2 text-2xl font-semibold text-foreground">Send report</h2>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onCancel} className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground hover:bg-muted/80 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/25">
            Cancel
          </button>
        </div>

        <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto px-5 py-4 pb-8">
          <div className="grid gap-3">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Destination
            <select
              value={destinationType}
              onChange={(event) => onDestinationTypeChange(event.target.value as ReportDestinationType)}
              className="relative z-[160] rounded-xl border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-ring focus:ring-2 focus:ring-ring/15"
            >
              <option value="customer">Customer</option>
              <option value="carrier">Carrier</option>
              <option value="internal">Internal review</option>
            </select>
          </label>
          <SnapshotInput label="Recipient email" value={recipientEmail} onChange={onRecipientEmailChange} type="email" />
          <SnapshotInput label="Subject" value={subject} onChange={onSubjectChange} />
          <label className="grid gap-1 text-xs text-muted-foreground">
            Message
            <textarea
              value={message}
              onChange={(event) => onMessageChange(event.target.value)}
              rows={7}
              className="rounded-xl border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm leading-6 text-[var(--foreground)] outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/15"
            />
          </label>
          <label className="flex items-start gap-3 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => onReviewedChange(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-border bg-input text-orange-500 focus:ring-ring"
            />
            <span>I reviewed this report before sending</span>
          </label>
          {status ? <div className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">{status}</div> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-[var(--border)] bg-[var(--background)] px-5 py-4">
          <button type="button" onClick={onCancel} className="rounded-xl bg-muted px-4 py-2 text-sm text-muted-foreground hover:bg-muted/80 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/25">
            Cancel
          </button>
          <button type="button" onClick={onSend} disabled={!sendReady} className="rounded-xl bg-[#C65A2A] px-4 py-2 text-sm font-semibold text-black hover:bg-[#C65A2A]/90 focus:outline-none focus:ring-2 focus:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-45">
            {sending ? "Sending..." : sent ? "Resend" : "Send"}
          </button>
        </div>
      </div>
      </div>
    </div>,
    document.body
  );
}

function SnapshotPreviewModal({
  snapshot,
  sendTarget,
  recipientEmail,
  subject,
  message,
  reviewed,
  sending,
  sent,
  status,
  sendReady,
  serviceCheckoutLoading,
  onClose,
  onDownload,
  onCopy,
  onOpenSend,
  onRecipientEmailChange,
  onSubjectChange,
  onMessageChange,
  onReviewedChange,
  onStartServiceCase,
  onSend,
  onCancelSend,
}: {
  snapshot: CollisionSnapshot;
  sendTarget: SnapshotDestinationType | null;
  recipientEmail: string;
  subject: string;
  message: string;
  reviewed: boolean;
  sending: boolean;
  sent: boolean;
  status: string | null;
  sendReady: boolean;
  serviceCheckoutLoading: boolean;
  onClose: () => void;
  onDownload: () => void;
  onCopy: () => void;
  onOpenSend: (target: SnapshotDestinationType) => void;
  onRecipientEmailChange: (value: string) => void;
  onSubjectChange: (value: string) => void;
  onMessageChange: (value: string) => void;
  onReviewedChange: (value: boolean) => void;
  onStartServiceCase: () => void;
  onSend: () => void;
  onCancelSend: () => void;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[10000]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="snapshot-preview-title"
    >
      <div className="fixed inset-0 z-[10000] bg-black/40 dark:bg-black/60" />
      <div className="fixed inset-0 isolate z-[10010] flex items-center justify-center p-4 sm:p-6">
      <div
        className="relative z-[10020] flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] shadow-xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-[#C65A2A]">
              {snapshot.redactionNotice}
            </div>
            <h2 id="snapshot-preview-title" className="mt-2 text-2xl font-semibold text-foreground">{snapshot.title}</h2>
            <div className="mt-1 text-sm text-muted-foreground">{snapshot.vehicleLabel}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground hover:bg-muted/80 hover:text-foreground">
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 pb-8">
        <div className="grid gap-3 md:grid-cols-2">
          <SnapshotPanel title="Adjusted Confidence" items={[
            snapshot.evidenceCompleteness.adjustedConfidence,
            `Completeness: ${formatLabel(snapshot.evidenceCompleteness.completenessStatus)}`,
          ]} />
          <SnapshotPanel title="Repair Plan Verdict" items={[
            `More complete plan: ${snapshot.repairPlanVerdict.moreCompletePlan}`,
            `Carrier plan: ${snapshot.repairPlanVerdict.carrierPlanStatus}`,
            snapshot.repairPlanVerdict.reason,
          ]} />
          <SnapshotPanel title="Damage Snapshot" items={snapshot.damageSummary} />
          <SnapshotPanel title="Estimate Comparison" items={
            snapshot.estimateComparison.available
              ? [
                  snapshot.estimateComparison.shopEstimateTotal ? `Shop: ${snapshot.estimateComparison.shopEstimateTotal}` : null,
                  snapshot.estimateComparison.carrierEstimateTotal ? `Carrier: ${snapshot.estimateComparison.carrierEstimateTotal}` : null,
                  snapshot.estimateComparison.difference ? `Difference: ${snapshot.estimateComparison.difference}` : null,
                  ...snapshot.estimateComparison.keyDeltas,
                ].filter((item): item is string => Boolean(item))
              : [snapshot.estimateComparison.unavailableReason ?? "Estimate comparison is unavailable."]
          } />
          <SnapshotPanel
            title="Top 3 Dispute Items"
            items={snapshot.topDisputeItems.map(
              (item, index) => `${index + 1}. ${item.issue}: ${item.evidenceState} Next: ${item.nextAction}`
            )}
          />
          <SnapshotPanel title="Evidence Completeness" items={[
            `Files uploaded: ${snapshot.evidenceCompleteness.uploadedFileCount}`,
            `Upload cap reached: ${snapshot.evidenceCompleteness.uploadLimitReached ? "Yes" : "No"}`,
            `More files indicated: ${snapshot.evidenceCompleteness.userIndicatedMoreFiles ? "Yes" : "No"}`,
            snapshot.evidenceCompleteness.missingCriticalEvidence.length
              ? `Missing proof: ${snapshot.evidenceCompleteness.missingCriticalEvidence.join(", ")}`
              : "No critical missing proof listed.",
            snapshot.evidenceCompleteness.userFacingDisclosure,
          ]} />
          <SnapshotPanel title="Next Actions" items={snapshot.nextActions.map((item, index) => `${index + 1}. ${item}`)} />
          <SnapshotPanel title="ACV / DV Preview" items={
            snapshot.valuationSnapshot.available
              ? [
                  snapshot.valuationSnapshot.acvPreviewRange ? `ACV: ${snapshot.valuationSnapshot.acvPreviewRange}` : null,
                  snapshot.valuationSnapshot.dvPreviewRange ? `DV: ${snapshot.valuationSnapshot.dvPreviewRange}` : null,
                  snapshot.valuationSnapshot.confidence ? `Confidence: ${snapshot.valuationSnapshot.confidence}` : null,
                  snapshot.valuationSnapshot.disclosure,
                ].filter((item): item is string => Boolean(item))
              : [snapshot.valuationSnapshot.disclosure]
          } />
        </div>

        {resolveAcademyServiceTrigger({
          snapshot,
          renderModel: buildSnapshotRenderModel(snapshot),
          valuationLowConfidence:
            snapshot.valuationSnapshot.confidence?.toLowerCase() === "low" ||
            snapshot.evidenceCompleteness.adjustedConfidence === "Low",
          appraisalTriggered: false,
        }) ? (
          <div className="mt-5 rounded-2xl border border-[#C65A2A]/24 bg-gradient-to-br from-[#C65A2A]/14 via-[#C65A2A]/08 to-white/[0.02] p-4">
            {(() => {
              const trigger = resolveAcademyServiceTrigger({
                snapshot,
                renderModel: buildSnapshotRenderModel(snapshot),
                valuationLowConfidence:
                  snapshot.valuationSnapshot.confidence?.toLowerCase() === "low" ||
                  snapshot.evidenceCompleteness.adjustedConfidence === "Low",
                appraisalTriggered: false,
              });
              if (!trigger) return null;
              return (
                <div>
                  <div className="text-[10px] uppercase tracking-[0.22em] text-[#E8A27F]">Need Help Resolving This?</div>
                  <div className="mt-1 text-base font-semibold text-foreground">{trigger.cta}</div>
                  <div className="mt-1 text-sm leading-6 text-muted-foreground">Why this is showing: {trigger.reason}</div>
                  <button
                    type="button"
                    onClick={onStartServiceCase}
                    disabled={serviceCheckoutLoading}
                    className="mt-3 rounded-xl bg-[#C65A2A] px-4 py-2 text-sm font-semibold text-black hover:bg-[#C65A2A]/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {serviceCheckoutLoading ? "Opening checkout..." : "Start service case"}
                  </button>
                </div>
              );
            })()}
          </div>
        ) : null}

        {sendTarget ? (
          <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--muted)] p-4">
            <div className="text-sm font-semibold text-foreground">
              Send redacted snapshot to {sendTarget === "customer" ? "customer" : "carrier"}
            </div>
            <div className="mt-3 grid gap-3">
              <SnapshotInput label="Recipient email" value={recipientEmail} onChange={onRecipientEmailChange} type="email" />
              <SnapshotInput label="Subject" value={subject} onChange={onSubjectChange} />
              <label className="grid gap-1 text-xs text-muted-foreground">
                Message
                <textarea
                  value={message}
                  onChange={(event) => onMessageChange(event.target.value)}
                  rows={6}
                  className="rounded-xl border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm leading-6 text-[var(--foreground)] outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/15"
                />
              </label>
              <label className="flex items-start gap-3 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(event) => onReviewedChange(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-border bg-input text-orange-500 focus:ring-ring"
                />
                <span>I reviewed this redacted snapshot</span>
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={onSend} disabled={!sendReady} className="rounded-xl bg-[#C65A2A] px-4 py-2 text-sm font-semibold text-black hover:bg-[#C65A2A]/90 disabled:cursor-not-allowed disabled:opacity-45">
                  {sending ? "Sending..." : sent ? "Resend" : "Send"}
                </button>
                <button type="button" onClick={onCancelSend} className="rounded-xl bg-muted/80 px-4 py-2 text-sm text-muted-foreground hover:bg-background hover:text-foreground">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {status ? <div className="mt-4 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">{status}</div> : null}
        </div>
        <div className="sticky bottom-0 flex shrink-0 flex-wrap gap-2 border-t border-[var(--border)] bg-[var(--background)] px-5 py-4">
          <button type="button" onClick={onDownload} className="rounded-xl bg-[#C65A2A] px-4 py-2 text-sm font-semibold text-black hover:bg-[#C65A2A]/90">
            Download PDF
          </button>
          <button type="button" onClick={onCopy} className="rounded-xl bg-muted px-4 py-2 text-sm text-muted-foreground hover:bg-muted/80 hover:text-foreground">
            Copy Summary
          </button>
          <button type="button" onClick={() => onOpenSend("customer")} className="rounded-xl bg-muted px-4 py-2 text-sm text-muted-foreground hover:bg-muted/80 hover:text-foreground">
            Send to Customer
          </button>
          <button type="button" onClick={() => onOpenSend("carrier")} className="rounded-xl bg-muted px-4 py-2 text-sm text-muted-foreground hover:bg-muted/80 hover:text-foreground">
            Send to Carrier
          </button>
        </div>
      </div>
      </div>
    </div>,
    document.body
  );
}

function SnapshotPanel({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--muted)] p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{title}</div>
      <div className="mt-2 space-y-1.5 text-[13px] leading-5 text-foreground/75">
        {items.map((item, index) => (
          <div key={`${title}-${index}`}>{item}</div>
        ))}
      </div>
    </section>
  );
}

function SnapshotInput({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-xl border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--foreground)] outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/15"
      />
    </label>
  );
}

function resolveAcademyServiceTrigger(params: {
  snapshot: CollisionSnapshot;
  renderModel: ReturnType<typeof buildExportModel> | SnapshotTriggerRenderModel;
  valuationLowConfidence: boolean;
  appraisalTriggered: boolean;
}): {
  serviceKey: string;
  cta: string;
  reason: string;
} | null {
  const missingCritical = params.snapshot.evidenceCompleteness.missingCriticalEvidence;
  const missingCalibration =
    missingCritical.some((item) => /calibration|scan|adas/i.test(item)) ||
    params.snapshot.topDisputeItems.some((item) => /calibration|scan|adas/i.test(item.issue));
  const laborDelta = params.snapshot.estimateComparison.keyDeltas.some((item) => /labor/i.test(item));
  const valuationGap =
    params.valuationLowConfidence ||
    /ACV|DV/i.test(params.snapshot.valuationSnapshot.disclosure) ||
    params.snapshot.topDisputeItems.some((item) => /value|valuation|acv|dv/i.test(item.issue));

  if (params.appraisalTriggered) {
    return {
      serviceKey: "academy_appraisal",
      cta: "Need help resolving this? Start an Appraisal case",
      reason: "The claim appears to be moving beyond normal estimate negotiation and may require formal escalation.",
    };
  }

  if (valuationGap) {
    return {
      serviceKey: "academy_acv_review",
      cta: "Need help resolving this? Start an ACV Review case",
      reason: "Valuation support may be incomplete, which could affect the total-loss or value position on the claim.",
    };
  }

  if (missingCalibration || laborDelta || params.snapshot.topDisputeItems.length >= 2) {
    return {
      serviceKey: "academy_value_dispute",
      cta: "Need help resolving this? Start a Value Dispute case",
      reason: missingCalibration && laborDelta
        ? "Missing calibration documentation and reduced estimate scope may affect repair completeness."
        : missingCalibration
          ? "Calibration or scan documentation may be incomplete, which can affect repair completeness and verification."
          : laborDelta
            ? "The estimate scope appears reduced in labor-related areas, which may affect repair completeness."
            : "The file shows multiple unresolved estimate gaps that may benefit from assisted claim resolution.",
    };
  }

  return null;
}

type SnapshotTriggerRenderModel = {
  valuationSnapshot?: CollisionSnapshot["valuationSnapshot"];
};

function buildSnapshotRenderModel(snapshot: CollisionSnapshot): SnapshotTriggerRenderModel {
  return {
    valuationSnapshot: snapshot.valuationSnapshot,
  };
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Unable to read snapshot PDF."));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read snapshot PDF."));
    reader.readAsDataURL(blob);
  });

  return dataUrl.split(",")[1] ?? "";
}

function logSnapshotSendAttempt(
  snapshot: CollisionSnapshot,
  destinationType: SnapshotDestinationType,
  hasPdf: boolean
) {
  console.info("[snapshot_send_attempt]", buildSnapshotSendSafeEvent({ snapshot, destinationType, hasPdf }));
}

async function exportCustomerReport(params: {
  renderModel: ReturnType<typeof buildExportModel>;
  normalizedResult: AnalysisResult | null;
  analysisResult: RepairIntelligenceReport | null;
  panel: DecisionPanel;
  analysisText: string;
  workspaceData: WorkspaceData | null;
  onStart: () => void;
  onComplete: () => void;
  onLocked: () => void;
  onError: (message: string | null) => void;
}) {
  params.onStart();

  try {
    const response = await fetch("/api/customer-report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify(buildCustomerReportRequest(params)),
    });

    if (response.status === 403) {
      params.onLocked();
      return;
    }

    if (!response.ok) {
      throw new Error("Customer report could not be generated. Please try again.");
    }

    const data = (await response.json()) as {
      fileName?: string;
      html?: string;
      report?: CustomerReport;
    };
    if (!data.report) {
      throw new Error("Customer report response was empty.");
    }

    exportCustomerReportPdf(data.report, {
      renderModel: params.renderModel,
      fileName: data.fileName,
    });
  } catch (error) {
    params.onError(
      error instanceof Error
        ? error.message
        : "Customer report could not be generated. Please try again."
    );
  } finally {
    params.onComplete();
  }
}

async function buildCustomerReportDocument(params: {
  renderModel: ReturnType<typeof buildExportModel>;
  normalizedResult: AnalysisResult | null;
  analysisResult: RepairIntelligenceReport | null;
  panel: DecisionPanel;
  analysisText: string;
  workspaceData: WorkspaceData | null;
  onLocked: () => void;
}): Promise<CarrierReportDocument> {
  const response = await fetch("/api/customer-report", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "same-origin",
    body: JSON.stringify(buildCustomerReportRequest(params)),
  });

  if (response.status === 403) {
    params.onLocked();
    throw new Error("Customer report export is not included in this plan.");
  }

  if (!response.ok) {
    throw new Error("Customer report could not be generated. Please try again.");
  }

  const data = (await response.json()) as {
    fileName?: string;
    report?: CustomerReport;
  };

  if (!data.report) {
    throw new Error("Customer report response was empty.");
  }

  return createCustomerReportPdfDocument(data.report, {
    renderModel: params.renderModel,
    fileName: data.fileName,
  });
}

function buildCustomerReportRequest(params: {
  renderModel: ReturnType<typeof buildExportModel>;
  normalizedResult: AnalysisResult | null;
  analysisResult: RepairIntelligenceReport | null;
  panel: DecisionPanel;
  analysisText: string;
  workspaceData: WorkspaceData | null;
}) {
  const vehicle =
    resolveCanonicalVehicleLabel(params.renderModel) ||
    params.renderModel.reportFields.vehicleLabel ||
    "Vehicle not specified";
  const vin = resolveCanonicalVin(params.renderModel);
  const insurer = resolveCanonicalInsurer(params.renderModel);
  const mileage =
    typeof params.renderModel.reportFields.mileage === "number"
      ? params.renderModel.reportFields.mileage.toLocaleString("en-US")
      : null;
  const estimateTotal =
    typeof params.renderModel.reportFields.estimateTotal === "number"
      ? formatCurrency(params.renderModel.reportFields.estimateTotal, true)
      : null;
  const findings = dedupeRailItems([
    ...params.renderModel.supplementItems.map((item) =>
      [displayOperationLabel(item.title), item.rationale].filter(Boolean).join(": ")
    ),
    ...(params.analysisResult?.issues.map((issue) =>
      [issue.title, issue.impact || issue.finding].filter(Boolean).join(": ")
    ) ?? []),
    ...(params.analysisResult?.missingProcedures.map((procedure) => `Missing or unclear: ${procedure}`) ?? []),
    params.panel.narrative,
  ]).map(redactExternalDocumentUrls);
  const estimateSummary = dedupeRailItems([
    params.renderModel.positionStatement,
    params.renderModel.repairPosition,
    params.normalizedResult?.narrative,
    ...(params.workspaceData?.keyIssues ?? []),
    params.workspaceData?.fullAnalysis,
    params.analysisText,
  ]).map(redactExternalDocumentUrls).join("\n\n");
  const documentedPositives = dedupeRailItems([
    ...params.renderModel.reportFields.presentStrengths,
    ...(params.analysisResult?.presentProcedures ?? []),
  ]);
  const supportGaps = dedupeRailItems([
    ...params.renderModel.disputeIntelligenceReport.supportGaps,
    ...params.renderModel.supplementItems.map((item) =>
      [displayOperationLabel(item.title), item.rationale].filter(Boolean).join(": ")
    ),
    ...(params.analysisResult?.missingProcedures ?? []),
  ]).map(redactExternalDocumentUrls);
  const imageSummary = extractImageSummary(params.analysisResult?.sourceEstimateText ?? "");

  return {
    vehicle,
    vin,
    insurer,
    mileage,
    estimateTotal,
    determination: params.renderModel.determination?.answer || params.renderModel.positionStatement,
    documentedPositives: documentedPositives.map(redactExternalDocumentUrls),
    supportGaps: supportGaps.length > 0 ? supportGaps : findings,
    estimateSummary,
    imageSummary,
  };
}

function exportCustomerReportPdf(report: CustomerReport, params: {
  renderModel: ReturnType<typeof buildExportModel>;
  fileName?: string;
}) {
  void exportCarrierPDF(createCustomerReportPdfDocument(report, params));
}

function createCustomerReportPdfDocument(report: CustomerReport, params: {
  renderModel: ReturnType<typeof buildExportModel>;
  fileName?: string;
}): CarrierReportDocument {
  const vehicle =
    resolveCanonicalVehicleLabel(params.renderModel) ||
    params.renderModel.reportFields.vehicleLabel ||
    "Vehicle";
  return buildCustomerReportPdf({
    report,
    vehicle,
    vin: resolveCanonicalVin(params.renderModel),
    insurer: resolveCanonicalInsurer(params.renderModel),
    mileage:
      typeof params.renderModel.reportFields.mileage === "number"
        ? params.renderModel.reportFields.mileage.toLocaleString("en-US")
        : null,
    estimateTotal:
      typeof params.renderModel.reportFields.estimateTotal === "number"
        ? formatCurrency(params.renderModel.reportFields.estimateTotal, true)
        : null,
    filename: params.fileName || "customer-report.pdf",
    confidenceIntegrity: params.renderModel.confidenceIntegrity,
  });
}

function extractImageSummary(sourceText: string): string | null {
  const lines = sourceText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) =>
      /^(Visible damage zones|Visible repair cues|Damage severity|Estimate validation signals|Structural cues|Suspension \/ wheel-opening cues):/i.test(
        line
      )
    );

  return lines.length > 0 ? lines.slice(0, 12).join("\n") : null;
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
          ? "border-orange-500/25 bg-gradient-to-br from-[#C65A2A]/12 via-[#C65A2A]/[0.05] to-card"
          : "border-border bg-card"
      }`}
    >
      <div
        className={`text-[10px] uppercase tracking-[0.22em] ${
          active ? "text-orange-700 dark:text-orange-200/68" : "text-muted-foreground"
        }`}
      >
        At a glance
      </div>
      <div className={`mt-2 text-sm font-semibold leading-6 ${active ? "text-card-foreground" : "text-muted-foreground"}`}>
        {headline}
      </div>
      <div className="mt-2 text-xs leading-5 text-muted-foreground">
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
        <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{label}</div>
        <div className="h-px flex-1 bg-gradient-to-r from-border/80 to-transparent" />
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
      className={`min-w-0 rounded-2xl px-3 py-2.5 shadow-sm ring-1 ring-border/50 ${
        prominent
          ? "bg-gradient-to-br from-[#C65A2A]/18 via-[#C65A2A]/[0.07] to-card"
          : "bg-muted/72"
      }`}
    >
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{label}</div>
      <div className={`mt-1 min-w-0 font-medium text-foreground ${detailClassName || "text-sm"}`}>{value}</div>
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
      className={`cursor-pointer rounded-[26px] transition-all hover:bg-muted/50 ${
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
    <section className="mt-5 space-y-2.5 rounded-2xl border border-border bg-card p-3.5">
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Support Signals</div>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item} className="flex gap-2 rounded-xl bg-muted px-3 py-3 text-[13px] leading-5 text-muted-foreground">
            <span className="pt-[1px] text-green-600 dark:text-green-300/80">&bull;</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function NextMovesCard({ items }: { items: string[] }) {
  return (
    <section className="mt-5 space-y-2.5 rounded-2xl border border-border bg-card p-3.5">
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Next Moves</div>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={item} className="flex gap-2 rounded-xl bg-muted px-3 py-3 text-[13px] leading-5 text-muted-foreground">
            <span className="font-semibold text-foreground">{index + 1}.</span>
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

function formatExternalDocumentSource(source: "drive" | "external" | "legacy_egnyte") {
  if (source === "drive") return "Drive-linked evidence";
  return "External document";
}

function formatExternalDocumentStatus(status: ReturnType<typeof normalizeExternalDocumentDisplay>["status"]) {
  switch (status) {
    case "ready":
      return "Ready";
    case "access_limited":
      return "Access limited";
    case "failed":
      return "Failed to load";
    case "directional_support_only":
      return "Directional procedure support";
    case "referenced_not_retrieved":
      return "Referenced, not retrieved";
    case "skipped":
      return "Skipped";
    case "preview_unavailable":
    default:
      return "Preview unavailable";
  }
}

function mapSupplementItemToDisputeDriver(item: SupplementItem): DisputeDriver | null {
  const lowerTitle = item.title.toLowerCase();

  if (lowerTitle.includes("structural measurement")) {
    return {
      title: "Structural Measurement Verification",
      impact: "HIGH ($$$ + safety critical)",
      whyItMatters: "affects geometry validation",
      currentFileStatus: "open pending measurement support",
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
      currentFileStatus: "calibration path not clearly documented",
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
    currentFileStatus: summarizeCurrentFileStatus(item.kind),
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

function summarizeCurrentFileStatus(kind: SupplementItem["kind"]): string {
  switch (kind) {
    case "missing_verification":
      return "verification not documented";
    case "missing_operation":
      return "operation not clearly documented";
    case "underwritten_operation":
      return "repair path documentation is not shown";
    default:
      return "repair path remains open or lightly supported";
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
    <section className="mt-5 space-y-3 rounded-[24px] border border-orange-500/18 bg-gradient-to-br from-[#C65A2A]/10 via-card to-muted p-4 shadow-[0_18px_44px_rgba(198,90,42,0.12)]">
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

function FindingReasoningCard({
  findings,
}: {
  findings: ReturnType<typeof buildExportModel>["findingReasoning"];
}) {
  if (!findings.length) return null;

  return (
    <section className="space-y-3 rounded-[24px] border border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        Finding Reasoning
      </div>
      <div className="space-y-3">
        {findings.slice(0, 5).map((finding, index) => (
          <div key={finding.id ?? `${finding.issue}-${index}`} className="rounded-2xl bg-muted px-3.5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold leading-5 text-foreground">
                {finding.priorityRank ?? index + 1}. {finding.issue}
              </div>
              <div className="rounded-full border border-border bg-card px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {formatLabel(finding.evidenceLevel)}
              </div>
            </div>
            <ReasoningLine label="Why it matters" value={finding.why_it_matters} />
            <ReasoningLine label="What proves it" value={finding.what_proves_it} />
            <ReasoningLine label="Next action" value={finding.next_action} />
            <div className="mt-2 text-[11px] leading-5 text-muted-foreground">
              Confidence {Math.round(finding.confidence * 100)}% · Specificity {formatLabel(finding.claimSpecificity)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReasoningLine({ label, value }: { label: string; value: string }) {
  if (!value.trim()) return null;

  return (
    <div className="mt-2 text-[13px] leading-5 text-muted-foreground">
      <span className="font-semibold text-foreground">{label}:</span> {value}
    </div>
  );
}

function RetrievalSummaryCard({
  summary,
}: {
  summary: NonNullable<ReturnType<typeof buildExportModel>["retrievalSummary"]>;
}) {
  const sources = summary.sourcesInfluencingFindings.slice(0, 5);

  return (
    <section className="space-y-3 rounded-[24px] border border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        Retrieval Summary
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MetricCard label="Drive Docs" value={String(summary.driveDocsUsed)} />
        <MetricCard label="Web Sources" value={String(summary.webSourcesUsed)} />
        <MetricCard label="Serper" value={formatLabel(summary.serperStatus)} />
        <MetricCard label="OEM Evidence" value={summary.oemEvidenceFound ? "Found" : "Not found"} />
      </div>
      {sources.length > 0 ? (
        <div className="space-y-2">
          {sources.map((source, index) => (
            <div key={`${source.title}-${index}`} className="rounded-xl bg-muted px-3 py-2.5">
              <div className="text-[13px] font-medium leading-5 text-foreground">{source.title}</div>
              <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {formatLabel(source.sourceType)} · {source.relatedFindingIds.length} finding(s)
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[13px] leading-5 text-muted-foreground">
          No retrieved source influenced an included finding.
        </div>
      )}
    </section>
  );
}

function ConfidenceIntegrityCard({
  integrity,
}: {
  integrity: ReturnType<typeof buildExportModel>["confidenceIntegrity"];
}) {
  return (
    <section className="mt-5 space-y-3 rounded-[24px] border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          File Coverage / Evidence Completeness
        </div>
        <div className="rounded-full border border-border bg-muted px-3 py-1 text-[11px] font-semibold text-foreground">
          {integrity.completenessStatus}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MetricCard label="Adjusted" value={integrity.adjustedConfidence} prominent />
        <MetricCard label="Base" value={integrity.baseConfidence} />
        <MetricCard label="Files" value={String(integrity.uploadedFileCount)} />
        <MetricCard label="Upload Cap" value={integrity.uploadLimitReached ? "Reached" : "Not reached"} />
      </div>
      <div className="rounded-2xl bg-muted px-3.5 py-3 text-[13px] leading-5 text-muted-foreground">
        {integrity.userFacingDisclosure}
      </div>
      {integrity.missingCriticalEvidence.length > 0 ? (
        <StrategyList label="Missing Proof" items={integrity.missingCriticalEvidence} />
      ) : null}
    </section>
  );
}

function DisputeStrategyCard({
  strategy,
}: {
  strategy: NonNullable<ReturnType<typeof buildExportModel>["disputeStrategy"]>;
}) {
  return (
    <section className="space-y-3 rounded-[24px] border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Dispute Strategy
        </div>
        <div className="rounded-full border border-orange-400/18 bg-[#C65A2A]/10 px-3 py-1 text-[11px] font-semibold text-orange-100/82">
          Leverage {strategy.leverageScore}/100
        </div>
      </div>
      <StrategyList label="Priority Rank" items={strategy.priorityFindings} />
      <StrategyList label="Easy Wins" items={strategy.easyWins} />
      <StrategyList label="Hard Fights" items={strategy.hardFights} />
      <StrategyList label="Recommended Sequence" items={strategy.recommendedSequence} numbered />
    </section>
  );
}

function StrategyList({
  label,
  items,
  numbered = false,
}: {
  label: string;
  items: string[];
  numbered?: boolean;
}) {
  if (!items.length) return null;

  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-2 space-y-1.5">
        {items.slice(0, 5).map((item, index) => (
          <div key={`${label}-${item}-${index}`} className="flex gap-2 rounded-xl bg-muted px-3 py-2 text-[13px] leading-5 text-muted-foreground">
            <span className="font-semibold text-foreground">{numbered ? `${index + 1}.` : "•"}</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
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
      : "border border-border bg-muted"
  }`;

  const content = (
    <>
      <div className="text-sm font-semibold leading-5 text-foreground">
        {index + 1}. {driver.title}
      </div>
      <div className="mt-2 text-[13px] leading-5 text-muted-foreground">
        <span className="font-semibold text-foreground">Impact:</span> {driver.impact}
      </div>
      <div className="mt-1 text-[13px] leading-5 text-muted-foreground">
        <span className="font-semibold text-foreground">Why it matters:</span> {driver.whyItMatters}
      </div>
      <div className="mt-1 text-[13px] leading-5 text-muted-foreground">
        <span className="font-semibold text-foreground">Current file status:</span> {driver.currentFileStatus}
      </div>
      <div className="mt-1 text-[13px] leading-5 text-muted-foreground">
        <span className="font-semibold text-foreground">What to do:</span> {driver.action}
      </div>
      {evidenceLink ? (
        <div className="mt-2 inline-flex rounded-full border border-border bg-card px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
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
      className={`${className} w-full text-left hover:border-ring/30 hover:bg-muted/70`}
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
      "OEM vs aftermarket suspension support where vehicle-specific documentation applies",
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
    status: "Open pending documentation",
    whyItMatters: "Geometry validation / safety",
    action: "Request documented measurement report",
  };
}

function LineStatusCard() {
  const lineStatus = buildLineStatus();

  return (
    <section className="mt-5 space-y-3 rounded-[24px] border border-red-500/18 bg-gradient-to-br from-red-500/[0.08] via-[#C65A2A]/[0.05] to-muted p-4 shadow-[0_18px_40px_rgba(0,0,0,0.10)] dark:shadow-[0_18px_40px_rgba(0,0,0,0.18)]">
      <div className="text-[10px] uppercase tracking-[0.22em] text-red-200/72">Decision Card</div>
      <div className="rounded-2xl bg-card/70 px-3.5 py-3">
        <div className="text-sm font-semibold leading-5 text-foreground">
          [Red] {lineStatus.title.toUpperCase()}
        </div>
        <div className="mt-2 text-[13px] leading-5 text-muted-foreground">
          <span className="font-semibold text-foreground">Impact:</span> {lineStatus.impact}
        </div>
        <div className="mt-1 text-[13px] leading-5 text-muted-foreground">
          <span className="font-semibold text-foreground">Status:</span> {lineStatus.status}
        </div>
        <div className="mt-3 text-[13px] leading-5 text-muted-foreground">
          <span className="font-semibold text-foreground">Why it matters:</span>
          <div className="mt-1 text-muted-foreground">-&gt; {lineStatus.whyItMatters}</div>
        </div>
        <div className="mt-3 text-[13px] leading-5 text-muted-foreground">
          <span className="font-semibold text-foreground">What to do:</span>
          <div className="mt-1 text-muted-foreground">-&gt; {lineStatus.action}</div>
        </div>
      </div>
    </section>
  );
}

function GapSummaryCard({
  renderModel,
}: {
  renderModel: ReturnType<typeof buildExportModel>;
}) {
  const financialSignals = dedupeRailItems([
    renderModel.valuation.acvReasoning,
    ...renderModel.valuation.acvMissingInputs,
    renderModel.valuation.dvReasoning,
    ...renderModel.valuation.dvMissingInputs,
    renderModel.disputeIntelligenceReport.valuationPreview?.acv,
    renderModel.disputeIntelligenceReport.valuationPreview?.dv,
  ]).slice(0, 5);
  const hasValuationPosture =
    renderModel.valuation.acvStatus !== "not_determinable" ||
    renderModel.valuation.dvStatus !== "not_determinable";
  const postureSummary = dedupeRailItems([
    renderModel.valuation.acvStatus !== "not_determinable"
      ? `ACV posture: ${formatLabel(renderModel.valuation.acvStatus)}.`
      : null,
    renderModel.valuation.dvStatus !== "not_determinable"
      ? `DV posture: ${formatLabel(renderModel.valuation.dvStatus)}.`
      : null,
  ]).join(" ");

  return (
    <section className="mt-5 space-y-3 rounded-[24px] border border-orange-500/18 bg-gradient-to-br from-[#C65A2A]/10 via-[#C65A2A]/[0.04] to-muted p-4 shadow-[0_18px_44px_rgba(198,90,42,0.12)]">
      <div className="text-[10px] uppercase tracking-[0.22em] text-orange-200/72">
        Financial View
      </div>
      <div className="rounded-2xl bg-card/70 px-3.5 py-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Directional Posture
        </div>
        <div className="mt-2 text-[13px] leading-5 text-muted-foreground">
          {postureSummary || "The canonical export model does not yet include a reliable valuation posture."}
        </div>
      </div>
      <div className="rounded-2xl bg-card/70 px-3.5 py-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Available Signals
        </div>
        {hasValuationPosture && financialSignals.length > 0 ? (
          <div className="mt-2 space-y-2">
            {financialSignals.map((item) => (
              <div key={item} className="flex gap-2 text-[13px] leading-5 text-muted-foreground">
                <span className="pt-[1px] text-orange-200/85">&bull;</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 text-[13px] leading-5 text-muted-foreground">
            Not yet quantified in the canonical export model.
          </div>
        )}
      </div>
    </section>
  );
}

function NegotiationPostureCard() {
  const posture = buildNegotiationPosture();

  return (
    <section className="mt-5 space-y-3 rounded-[24px] border border-border bg-gradient-to-br from-card via-card to-muted p-4 shadow-[0_18px_40px_rgba(0,0,0,0.10)] dark:shadow-[0_18px_40px_rgba(0,0,0,0.18)]">
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
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

      <div className="rounded-2xl bg-muted px-3.5 py-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Suggested Strategy
        </div>
        <div className="mt-2 space-y-2">
          {posture.suggestedStrategy.map((item, index) => (
            <div key={item} className="flex gap-2 text-[13px] leading-5 text-muted-foreground">
              <span className="font-semibold text-foreground">{index + 1}.</span>
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
    <div className="rounded-2xl bg-muted px-3.5 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{title}</div>
      <div className="mt-2 space-y-2">
        {items.map((item) => (
          <div key={item} className="flex gap-2 text-[13px] leading-5 text-muted-foreground">
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
    <section className="rounded-[24px] border border-orange-500/20 bg-gradient-to-br from-[#C65A2A]/12 via-[#C65A2A]/[0.045] to-muted p-4 shadow-[0_18px_44px_rgba(198,90,42,0.14)]">
      <div className="text-[10px] uppercase tracking-[0.22em] text-orange-200/72">Top recommendation</div>
      <div className="mt-2 text-[1.08rem] font-semibold leading-6 text-foreground">{displayOperationLabel(item.title)}</div>
      <div className="mt-2 text-xs text-muted-foreground">
        {formatLabel(item.category)} · {formatLabel(item.kind)} · Priority {formatLabel(item.priority)}
      </div>
      <div className="mt-3 text-sm leading-6 text-muted-foreground">{item.rationale}</div>
      {item.evidence && (
        <div className="mt-3 text-xs leading-5 text-muted-foreground">Evidence: {item.evidence}</div>
      )}
      {item.source && (
        <button
          type="button"
          className="mt-4 inline-flex items-center rounded-xl bg-muted px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-card hover:text-foreground"
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
    <section className="space-y-2.5 rounded-2xl border border-orange-500/16 bg-gradient-to-br from-[#C65A2A]/9 via-muted to-card p-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[10px] uppercase tracking-[0.22em] text-orange-200/68">{title}</div>
          <Link
            href="/billing"
            className="rounded-full border border-orange-500/24 bg-orange-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-[#C65A2A] transition hover:bg-orange-500/18 dark:text-orange-100"
          >
            Upgrade Access
          </Link>
        </div>
      <div className="text-[13px] leading-5 text-muted-foreground">{body}</div>
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
    neutral: "border-border bg-card",
  };

  return (
    <section
      className={`space-y-2.5 rounded-2xl border ${compact ? "p-3.5" : "p-4"} ${tones[tone]} ${
        featured ? "shadow-[0_18px_40px_rgba(0,0,0,0.18)]" : ""
      }`}
    >
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{title}</div>
      <div
        className={`whitespace-pre-wrap ${
          compact ? "text-[13px] leading-5 text-muted-foreground" : featured ? "text-sm leading-6 text-muted-foreground" : "text-sm leading-6 text-muted-foreground"
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
    neutral: "border-border bg-card",
  };
  const previewHeightClass = previewLines >= 7 ? "max-h-48" : "max-h-36";

  return (
    <section className={`space-y-2.5 rounded-2xl border p-3.5 ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{title}</div>
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
          className={`text-[13px] leading-5 text-muted-foreground whitespace-pre-wrap ${mono ? "font-mono text-[12px]" : ""} ${
            expanded ? "" : `overflow-hidden ${previewHeightClass}`
          }`}
        >
          {body}
        </div>
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
  checkoutLoading,
  onStartAcvCheckout,
}: {
  renderModel: ReturnType<typeof buildExportModel>;
  lowConfidence: boolean;
  checkoutLoading: boolean;
  onStartAcvCheckout: () => void;
}) {
  const [expanded, setExpanded] = useState(!lowConfidence);
  const hasAcvService =
    renderModel.valuation.acvStatus !== "not_determinable" ||
    Boolean(renderModel.valuation.acvRange || renderModel.valuation.acvValue);
  const hasDiminishedValueService =
    renderModel.valuation.dvStatus !== "not_determinable" ||
    Boolean(renderModel.valuation.dvRange || renderModel.valuation.dvValue);

  return (
    <section
      className={`space-y-3 rounded-2xl border p-3.5 ${
        lowConfidence
          ? "border-border bg-card opacity-90"
          : "border-green-500/18 bg-green-500/[0.04]"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Valuation</div>
          {lowConfidence && (
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              Low-confidence preview. Expand for the directional band, limits, and missing inputs.
            </div>
          )}
        </div>
        {lowConfidence && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
          >
            {expanded ? "Hide" : "Expand"}
          </button>
        )}
      </div>

      {expanded && (
        <div className="text-[13px] leading-5 text-muted-foreground whitespace-pre-wrap">
          {buildValuationDisplay(renderModel)}
        </div>
      )}

      <div className="rounded-xl bg-muted px-3 py-2.5 text-[12px] leading-5 text-muted-foreground">
        Premium preview only. The formal valuation service can widen, tighten, or move the band after full file review and broader market support.
      </div>

      <div className="flex flex-wrap gap-2">
        {hasAcvService ? (
          <button
            type="button"
            onClick={onStartAcvCheckout}
            disabled={checkoutLoading}
            className="inline-flex items-center justify-center rounded-xl bg-[#C65A2A] px-3 py-2 text-[11px] font-semibold text-black transition hover:bg-[#C65A2A]/90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {checkoutLoading ? "Opening checkout..." : "Start ACV Review Checkout"}
          </button>
        ) : null}
        {hasDiminishedValueService ? (
          <Link
            href="/the-academy"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center rounded-xl border border-border bg-background px-3 py-2 text-[11px] font-semibold text-foreground transition hover:border-[#C65A2A]/35 hover:bg-muted sm:w-auto"
          >
            View Diminished Value Services
          </Link>
        ) : null}
        {!hasAcvService && !hasDiminishedValueService ? (
          <Link
            href="/the-academy"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center rounded-xl border border-border bg-background px-3 py-2 text-[11px] font-semibold text-foreground transition hover:border-[#C65A2A]/35 hover:bg-muted sm:w-auto"
          >
            View Academy Services
          </Link>
        ) : null}
      </div>
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
