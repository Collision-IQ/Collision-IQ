"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { ArrowRight, Download, FileText, Mail, Maximize2, Minimize2, RefreshCcw, X } from "lucide-react";
import ChatShell from "@/components/ChatShell";
import ChatWidget from "@/components/ChatWidget";
import type { ReviewProgress } from "@/components/ChatWidget";
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
import type { CitationDensityAnnotationMetadata } from "@/components/CitationDensityAnnotationViewer";
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
  buildCollisionSnapshotPdfFromSnapshot,
  sanitizeSnapshotForFinalRender,
} from "@/lib/ai/builders/collisionSnapshotPdfBuilder";
import { buildCustomerReportPdf } from "@/lib/ai/builders/customerReportPdfBuilder";
import { buildDoiComplaintPacketPdf } from "@/lib/ai/builders/doiComplaintPacketPdfBuilder";
import {
  buildAnnotatedEstimateReviewModel,
  buildEstimatorChangeRequestListPdf,
  type AnnotatedEstimateReviewModel,
} from "@/lib/ai/builders/estimateScrubberPdfBuilder";
import { buildPolicyRightsReviewPdf } from "@/lib/ai/builders/policyRightsReviewPdfBuilder";
import { buildCarrierPdfBlob, exportCarrierPDF } from "@/lib/ai/builders/exportPdf";
import { toStableClaimId } from "@/lib/claims/claimIdentity";
import { classifyOutputMode } from "@/lib/ai/outputMode";
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
import { sanitizeUserFacingEvidenceText, summarizeUserFacingSupport } from "@/lib/ui/presentationText";
import {
  buildIndexedExclusionAuditNote,
  buildReviewCompletenessMessage,
} from "@/lib/reviewCompleteness";
import { buildReportApplicability } from "@/lib/reports/applicability";
import { selectAcademyServiceCta, type AcademyServiceCta } from "@/lib/academy/serviceCta";
import { normalizeReportToAnalysisResult } from "@/lib/ai/builders/normalizeReportToAnalysisResult";
import { cleanOperationDisplayText } from "@/lib/ui/presentationText";
import { toCustomerFacingText } from "@/lib/ai/customerFacingText";
import { isRetryableProviderMessage } from "@/lib/ai/providerRetryableError";
import { isNative } from "@/lib/native";
import type {
  AnalysisResult,
  ConfidenceIntegrity,
  ExportResearchSnapshot,
  RepairIntelligenceReport,
} from "@/lib/ai/types/analysis";
import type { CustomerReport } from "@/lib/ai/generateCustomerReport";
import type { WorkspaceData } from "@/types/workspaceTypes";

const CitationDensityAnnotationViewer = dynamic(
  () => import("@/components/CitationDensityAnnotationViewer"),
  { ssr: false }
);

function displayOperationLabel(value: string | null | undefined): string {
  return cleanOperationDisplayText(value) || value || "Repair Operation";
}

type SupplementItem = ReturnType<typeof buildExportModel>["supplementItems"][number];
type AttachmentTrayItem = {
  attachmentId: string;
  filename: string;
  hasVision?: boolean;
};
type CitationDensityEstimateRole = "carrier" | "shop" | "unknown";
type CitationDensityEstimateCandidate = {
  documentId: string;
  filename: string;
  estimateRole: CitationDensityEstimateRole;
  classification: "estimate";
  sourcePdfAvailable: boolean;
};
type AnnotatedEstimateExportResult = {
  blob: Blob;
  filename: string;
  artifactId: string;
  downloadUrl: string;
  pdfBase64?: string;
  artifactFallbackUsed?: boolean;
  annotationMetadata: CitationDensityAnnotationMetadata[];
  annotatedFindingCount: number;
  unresolvedAnchorCount: number;
  warnings: string[];
  debugCounts?: Record<string, unknown> | null;
  // Standalone findings report (cover + one card per finding), delivered as a
  // separate PDF so the findings aren't buried inside the annotated estimate.
  findingsReportUrl?: string;
  findingsReportPdfBase64?: string;
  findingsReportFilename?: string;
};

type CitationDensityWorkspaceReportFlavor = "delta" | "oem";
type CitationDensityTargetEstimate = "auto" | "shop" | "carrier" | "both";

type LeftPaneMode = "chat" | "review";
export type ReportKind =
  | "snapshot"
  | "customer_report"
  | "repair_intelligence"
  | "estimate_scrubber"
  | "estimator_change_request_list"
  | "policy_rights_review"
  | "oem_citation_density"
  | "doi_complaint_packet";
type BottomReportViewerState =
  | {
      kind: "citation-density";
      id: string;
      reportFlavor: CitationDensityWorkspaceReportFlavor;
      title: string;
      filename: string;
      pdfUrl: string;
      annotations: CitationDensityAnnotationMetadata[];
      diagnostics?: Record<string, unknown> | null;
      artifactId?: string;
      downloadUrl?: string;
      artifactUnavailableMessage?: string | null;
      onRegenerate?: () => void;
    }
  | {
      kind: "report-document";
      id: string;
      reportType: ReportKind;
      title: string;
      filename: string;
      document: CarrierReportDocument;
      generatedAtLabel: string;
      onRegenerate?: () => void;
    }
  | null;

type ReportDestinationType = "customer" | "carrier" | "internal";
type ReportSendHistoryItem = {
  id: string;
  caseId: string | null;
  reportType: ReportKind;
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

function resolveEffectiveReviewProgress(
  progress: ReviewProgress,
  integrity: ConfidenceIntegrity
): ReviewProgress {
  const diagnostics = integrity.fileReviewDiagnostics;
  const reviewedForDetermination = Math.max(
    progress.reviewedForDetermination,
    diagnostics?.reviewedCount ?? 0,
    integrity.reviewedFileCount ?? 0
  );
  const indexed = Math.max(
    progress.indexed,
    diagnostics?.indexedCount ?? 0,
    integrity.indexedFileCount ?? integrity.uploadedFileCount
  );
  const visionProcessed = Math.max(
    progress.visionProcessed,
    diagnostics?.imageVisionCount ?? 0,
    integrity.visionProcessedFileCount ?? 0
  );
  const totalKnownFiles = Math.max(
    progress.totalKnownFiles,
    integrity.totalKnownFileCount ?? indexed,
    reviewedForDetermination
  );
  const reviewableFileCount = Math.max(
    progress.reviewableFileCount,
    diagnostics?.reviewableCount ?? 0,
    integrity.reviewableFileCount ?? 0,
    reviewedForDetermination,
    visionProcessed
  );
  const excludedFromReviewCount = Math.max(
    progress.excludedFromReviewCount,
    diagnostics?.excludedCount ?? 0,
    integrity.excludedFromReviewCount ?? 0,
    Math.max(0, indexed - reviewableFileCount)
  );

  return {
    uploaded: Math.max(progress.uploaded, diagnostics?.totalUploaded ?? 0, integrity.uploadedFileCount),
    indexed,
    visionProcessed,
    reviewedForDetermination,
    reviewableFileCount,
    excludedFromReviewCount,
    excludedFromReviewReasons: [
      ...new Set([
        ...progress.excludedFromReviewReasons,
        ...(integrity.excludedFromReviewReasons ?? []),
      ]),
    ],
    excludedFromReviewFiles: mergeExcludedFromReviewFiles(
      progress.excludedFromReviewFiles,
      integrity.excludedFromReviewFiles ?? [],
      diagnostics?.excludedFiles ?? []
    ),
    totalKnownFiles,
  };
}

function mergeExcludedFromReviewFiles(
  current: ReviewProgress["excludedFromReviewFiles"],
  next: ReviewProgress["excludedFromReviewFiles"],
  diagnostics: ReviewProgress["excludedFromReviewFiles"] = []
) {
  const seen = new Set<string>();
  return [...current, ...next, ...diagnostics].filter((item) => {
    const key = `${item.filename}:${item.detectedType}:${item.reason}:${item.indexed}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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
const CHAT_ONLY_STORAGE_KEY = "collisionIq.chatOnlyMode";
const ASSISTANCE_PROFILE_STORAGE_KEY = "collisionIq.assistanceProfile";
const TRIAL_BADGE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

type AssistanceProfile =
  | "shop"
  | "insurance_adjuster"
  | "policyholder"
  | "attorney_or_appraiser"
  | "other";

const ASSISTANCE_PROFILE_OPTIONS: Array<{
  value: AssistanceProfile;
  label: string;
}> = [
  { value: "shop", label: "Repair shop" },
  { value: "insurance_adjuster", label: "Insurance adjuster" },
  { value: "policyholder", label: "Vehicle owner / policyholder" },
  { value: "attorney_or_appraiser", label: "Attorney / appraiser" },
  { value: "other", label: "Other" },
];

function getHeroCollapseStorageKey(caseId: string) {
  return `case:${caseId}:heroCollapsed`;
}

function getHeaderExpandedStorageKey(caseId: string) {
  return `case:${caseId}:headerExpanded`;
}

function getHeaderPinnedStorageKey(caseId: string) {
  return `case:${caseId}:headerPinnedByUser`;
}

function readStoredChatOnlyMode() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(CHAT_ONLY_STORAGE_KEY) === "true";
}

function isAssistanceProfile(value: string | null): value is AssistanceProfile {
  return ASSISTANCE_PROFILE_OPTIONS.some((option) => option.value === value);
}

function readStoredAssistanceProfile(): AssistanceProfile | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(ASSISTANCE_PROFILE_STORAGE_KEY);
  return isAssistanceProfile(value) ? value : null;
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

function isWithinTrialBadgeWindow(access: AccountEntitlements | null) {
  if (!access) return false;

  const isTrialAccount =
    access.plan === "trial" ||
    access.billingPlan === "trial" ||
    access.activeSubscriptionStatus === "TRIALING" ||
    access.trialActive;

  if (!isTrialAccount) return false;

  const startedAt = access.trialStart ?? access.createdAt;
  if (!startedAt) return false;

  const startedAtMs = new Date(startedAt).getTime();
  if (Number.isNaN(startedAtMs)) return false;

  const ageMs = Date.now() - startedAtMs;
  return ageMs >= 0 && ageMs < TRIAL_BADGE_WINDOW_MS;
}

export function ChatbotWorkspacePage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const centerScrollRequestRef = useRef<((key: InsightKey) => void) | null>(null);
  const immersiveWorkspaceRef = useRef<HTMLDivElement | null>(null);
  const immersiveToolbarRef = useRef<HTMLDivElement | null>(null);
  const revealScrollTimeoutRef = useRef<number | null>(null);
  const [leftPaneMode, setLeftPaneMode] = useState<LeftPaneMode>("chat");
  const chatSessionControlsRef = useRef<{
    focusComposer: () => void;
    resetSession: () => void;
    sendPrompt: (prompt: string) => Promise<void>;
  } | null>(null);
  const [attachment, setAttachment] = useState<string | null>(null);
  const [attachmentsState, setAttachmentsState] = useState<AttachmentTrayItem[]>([]);
  const [reviewProgress, setReviewProgress] = useState<ReviewProgress>({
    uploaded: 0,
    indexed: 0,
    visionProcessed: 0,
    reviewedForDetermination: 0,
    reviewableFileCount: 0,
    excludedFromReviewCount: 0,
    excludedFromReviewReasons: [],
    excludedFromReviewFiles: [],
    totalKnownFiles: 0,
  });
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
  const [chatOnlyMode, setChatOnlyMode] = useState(false);
  const [assistanceProfile, setAssistanceProfile] = useState<AssistanceProfile | null>(null);
  const [assistanceProfileResolved, setAssistanceProfileResolved] = useState(false);
  const [bottomReportViewer, setBottomReportViewer] = useState<BottomReportViewerState>(null);
  const [citationDensityTargetEstimate, setCitationDensityTargetEstimate] =
    useState<CitationDensityTargetEstimate>("auto");
  const [citationDensitySelectedSourceDocumentId, setCitationDensitySelectedSourceDocumentId] =
    useState<string>("");
  const bottomReportObjectUrlRef = useRef<string | null>(null);
  const immersiveHeaderExpandedRef = useRef(true);

  useEffect(() => {
    immersiveHeaderExpandedRef.current = isImmersiveHeaderExpanded;
  }, [isImmersiveHeaderExpanded]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setChatOnlyMode(readStoredChatOnlyMode());
    setAssistanceProfile(readStoredAssistanceProfile());
    setAssistanceProfileResolved(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CHAT_ONLY_STORAGE_KEY, String(chatOnlyMode));
  }, [chatOnlyMode]);

  const handleAssistanceProfileSelect = useCallback((profile: AssistanceProfile) => {
    setAssistanceProfile(profile);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ASSISTANCE_PROFILE_STORAGE_KEY, profile);
    }
  }, []);

  const revokeBottomReportObjectUrl = useCallback(() => {
    if (bottomReportObjectUrlRef.current && typeof URL !== "undefined") {
      URL.revokeObjectURL(bottomReportObjectUrlRef.current);
      bottomReportObjectUrlRef.current = null;
    }
  }, []);

  const closeBottomReportViewer = useCallback(() => {
    revokeBottomReportObjectUrl();
    setBottomReportViewer(null);
  }, [revokeBottomReportObjectUrl]);

  useEffect(() => {
    return () => {
      revokeBottomReportObjectUrl();
    };
  }, [revokeBottomReportObjectUrl]);

  useEffect(() => {
    closeBottomReportViewer();
  }, [analysisReportId, closeBottomReportViewer]);

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
        outputMode: classifyOutputMode(`${caseIntent}\n\n${primaryAnalysis?.content ?? ""}\n\n${analysisText}`),
      }),
    [analysisPanel, analysisResult, analysisText, caseIntent, hasResolvedAnalysis, normalizedResult, primaryAnalysis]
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
  const workspaceRowsClass = isReviewActive
    ? "grid-rows-[auto_minmax(0,1fr)]"
    : "grid-rows-[minmax(0,1fr)]";
  const workspaceShellClass = isReviewActive
    ? "relative flex h-full min-h-0 w-full flex-col"
    : "relative flex h-full min-h-0 w-full flex-col";
  const workspaceGridClass = isReviewActive
    ? "grid h-full min-h-0 w-full flex-1 gap-1 pt-1 sm:gap-3 sm:pt-3"
    : "grid h-full min-h-0 w-full flex-1 gap-1 pt-1 sm:gap-3 sm:pt-3";
  const chatColumnClass = isReviewActive
    ? "flex h-full min-h-0 flex-1 flex-col"
    : "flex h-full min-h-0 flex-1 flex-col";
  const chatSectionClass = isReviewActive
    ? "flex min-h-0 flex-1 flex-col overflow-hidden"
    : "flex min-h-0 flex-1 flex-col overflow-hidden";
  const chatPaneClass = isChatActive
    ? isReviewActive
      ? "relative min-h-0 w-full flex-1"
      : "relative min-h-0 w-full flex-1"
    : "hidden";
  const chatFrameClass = isReviewActive
    ? "relative flex h-full min-h-0 w-full flex-col overflow-hidden border border-border bg-background"
    : "relative flex h-full min-h-0 w-full flex-col overflow-hidden border border-border bg-background";
  const chatWidgetWrapClass = "min-h-0 flex-1";

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
        const token = await getToken();
        const API_BASE_URL =
          process.env.NEXT_PUBLIC_APP_URL?.trim() ||
          (typeof window !== "undefined" ? window.location.origin : "");
        console.log("API_BASE_URL", API_BASE_URL);
        console.log("isNative", isNative());
        console.log("HAS_CLERK_TOKEN", !!token);

        const response = await fetch("/api/account/entitlements", {
          credentials: "same-origin",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!response.ok) return;

        const data = (await response.json()) as AccountEntitlements;
        console.log("ENTITLEMENTS_RESPONSE", data);
        console.log("DERIVED_UPLOAD_CAP", data.uploadCap);
        console.log("DERIVED_IS_ADMIN", data.isPlatformAdmin === true);
        console.log("FINAL_DERIVED_UPLOAD_CAP", data.uploadCap);
        console.log("FINAL_DERIVED_IS_ADMIN", data.isPlatformAdmin === true);
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
  }, [getToken]);

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
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      console.info("[immersive-header] auto-state skipped", {
        reason: "mobile_chat_primary",
        requestedState: "expanded",
        activeCaseId: analysisReportId,
        hasStructuredAnalysis,
        lastHeaderChangeReason,
      });
      setLeftPaneMode("chat");
      return;
    }

    if (chatOnlyMode) {
      console.info("[immersive-header] auto-state skipped", {
        reason: "chat_only_mode",
        requestedState: "expanded",
        activeCaseId: analysisReportId,
        hasStructuredAnalysis,
        lastHeaderChangeReason,
      });
      return;
    }

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
  }, [analysisReportId, chatOnlyMode, hasStructuredAnalysis, headerPinnedByUser, lastHeaderChangeReason]);

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
    if (chatOnlyMode) {
      return;
    }

    if (hasStructuredAnalysis) {
      immersiveHeaderExpandedRef.current = true;
      setIsImmersiveHeaderExpanded(true);
      setLeftPaneMode("review");
    }
  }, [chatOnlyMode, hasStructuredAnalysis]);

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

    const trialEndDate = viewerAccess.trialEnd
      ? new Date(viewerAccess.trialEnd)
      : null;

    if (!trialEndDate || Number.isNaN(trialEndDate.getTime())) return null;

    const now = new Date();
    const diffMs = trialEndDate.getTime() - now.getTime();
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    return days > 0 ? days : 0;
  }, [viewerAccess]);
  const trialBadgeLabel = isWithinTrialBadgeWindow(viewerAccess) ? "30-Day Trial" : null;

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

  async function sendCitationDensityFindingPrompt(prompt: string) {
    if (!analysisReportId || !chatSessionControlsRef.current) {
      return false;
    }

    setLeftPaneMode("chat");
    await chatSessionControlsRef.current.sendPrompt(prompt);
    return true;
  }

  function openCitationDensityReportWorkspace({
    reportFlavor,
    result,
    onRegenerate,
  }: {
    reportFlavor: CitationDensityWorkspaceReportFlavor;
    result: AnnotatedEstimateExportResult;
    onRegenerate?: () => void;
  }) {
    revokeBottomReportObjectUrl();
    const pdfUrl = URL.createObjectURL(result.blob);
    bottomReportObjectUrlRef.current = pdfUrl;
    setBottomReportViewer({
      kind: "citation-density",
      id: `${reportFlavor}-${Date.now()}`,
      reportFlavor,
      title: getCitationDensityWorkspaceTitle(reportFlavor),
      filename: result.filename,
      pdfUrl,
      annotations: result.annotationMetadata,
      diagnostics: buildCitationDensityViewerDiagnostics(result, reportFlavor),
      artifactId: result.artifactId,
      downloadUrl: result.downloadUrl,
      artifactUnavailableMessage: result.artifactFallbackUsed
        ? "The saved artifact link was unavailable, so this viewer is using fresh generated PDF bytes from the current report response."
        : null,
      onRegenerate,
    });
  }

  function openReportDocumentWorkspace({
    reportType,
    document,
    onRegenerate,
  }: {
    reportType: ReportKind;
    document: CarrierReportDocument;
    onRegenerate?: () => void;
  }) {
    revokeBottomReportObjectUrl();
    setBottomReportViewer({
      kind: "report-document",
      id: `${reportType}-${Date.now()}`,
      reportType,
      title: getReportWorkspaceTitle(reportType, document),
      filename: document.filename || getDefaultReportFilename(reportType),
      document,
      generatedAtLabel: new Date().toLocaleString(),
      onRegenerate,
    });
  }

  async function askAboutBottomCitationDensityFinding(annotation: CitationDensityAnnotationMetadata) {
    closeBottomReportViewer();
    const prompt = buildCitationDensityFindingPrompt(annotation);
    const sent = await sendCitationDensityFindingPrompt(prompt);
    if (!sent) {
      console.info("Open or continue this case before asking about a finding.");
    }
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
  const canUseBasicPdfExport = canAccessFeature(plan, "repair_intelligence_export");
  const canUseEstimateScrubberExport = canAccessFeature(plan, "estimate_scrubber_export");
  const canUsePolicyRightsReviewExport = canAccessFeature(plan, "policy_rights_review_export");
  const canUseDoiComplaintPacketExport = canAccessFeature(plan, "doi_complaint_packet_export");
  const canUseCustomerReport = canAccessFeature(plan, "customer_report_export");
  const followUpExports = [
    hasResolvedAnalysis
      ? { label: "Chat Export", type: "pdf" }
      : null,
    canUseSnapshotExport
      ? { label: "1-Page Snapshot", type: "pdf" }
      : null,
    canUseBasicPdfExport
      ? { label: "Repair Intelligence Report", type: "pdf" }
      : hasResolvedAnalysis
        ? { label: "Repair Intelligence Report (Pro)", type: "locked" }
      : null,
    canUseEstimateScrubberExport
      ? { label: "Delta Citation Density Report", type: "pdf" }
      : hasResolvedAnalysis
        ? { label: "Delta Citation Density Report (Pro)", type: "locked" }
      : null,
    canUsePolicyRightsReviewExport
      ? { label: "OEM Citation Density Report", type: "pdf" }
      : hasResolvedAnalysis
        ? { label: "OEM Citation Density Report (Pro)", type: "locked" }
      : null,
    canUseDoiComplaintPacketExport
      ? { label: "DOI Complaint Packet", type: "pdf" }
      : hasResolvedAnalysis
        ? { label: "DOI Complaint Packet (Pro)", type: "locked" }
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
    <div className="flex h-[100svh] flex-col overflow-hidden bg-background text-foreground">
      <ChatShell
        title="Collision-IQ"
        planLabel={trialBadgeLabel}
        center={
          <div className={workspaceShellClass}>
            <div className={`${workspaceGridClass} ${workspaceRowsClass}`}>
              {hasStructuredAnalysis && isReviewActive && (
                <div
                  className="flex min-h-0 flex-col px-1 max-lg:absolute max-lg:inset-0 max-lg:z-40 max-lg:bg-card max-lg:p-2"
                >
                  <div
                    ref={immersiveToolbarRef}
                    className="z-20 mb-2 min-h-[56px] shrink-0 rounded-[14px] border border-border bg-card/95 px-3 py-2 shadow-[0_18px_44px_rgba(15,23,42,0.10)] ring-1 ring-ring/10 backdrop-blur-xl lg:mb-3 lg:min-h-[86px] lg:rounded-[22px] lg:px-4 lg:py-3 dark:shadow-[0_18px_44px_rgba(0,0,0,0.28)]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          Review workspace
                        </div>
                        <div className="mt-1 hidden text-sm text-muted-foreground lg:block">
                          {isReviewActive
                            ? "The case review is open. Collapse it anytime to give chat more room."
                            : "The case review is collapsed. Selecting a right-rail item will reopen it and jump to the matching section."}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={isReviewActive ? handleToggleImmersiveHeader : openReviewPane}
                          className="rounded-xl border border-border bg-muted px-2.5 py-2 text-xs font-medium text-foreground transition hover:bg-muted/70 sm:px-3"
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

                  <div
                      ref={immersiveWorkspaceRef}
                      className="min-h-0 flex-1 overflow-y-auto rounded-[16px] border border-border bg-card/80 px-1 pb-3 shadow-[0_24px_70px_rgba(15,23,42,0.10)] ring-1 ring-ring/10 lg:max-h-[min(54svh,680px)] lg:min-h-[280px] lg:rounded-[26px] lg:pb-4 dark:shadow-[0_24px_70px_rgba(0,0,0,0.22)]"
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

                      <div className="mt-3 rounded-[18px] border border-border bg-card p-2.5 sm:rounded-[24px] sm:p-3.5">
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

                  <section className="mt-3 rounded-[18px] border border-border bg-card p-3 shadow-[0_20px_48px_rgba(15,23,42,0.10)] sm:mt-4 sm:rounded-[26px] sm:p-4 dark:shadow-[0_20px_48px_rgba(0,0,0,0.2)]">
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
                </div>
              )}
              <div className={chatColumnClass}>
                <div className="min-h-0 shrink-0 lg:min-h-[56px]">
                {trialDaysRemaining !== null && trialDaysRemaining <= 7 && isWithinTrialBadgeWindow(viewerAccess) && (
                  <div
                    className={`mb-3 rounded-xl px-4 py-3 text-sm ${
                      trialDaysRemaining <= 2
                        ? "border border-red-500/30 bg-red-500/10 text-red-200"
                        : "border border-orange-500/20 bg-[var(--accent)]/10 text-orange-100"
                    }`}
                  >
                    {trialDaysRemaining > 0 ? (
                      <>
                        Trial ends in {trialDaysRemaining} day
                        {trialDaysRemaining === 1 ? "" : "s"}
                        <span className="ml-2 text-foreground/80">
                          Upgrade to keep full access.
                        </span>
                        <Link
                          href="/billing"
                          className="ml-3 inline-block rounded-md bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-black"
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
                          className="ml-3 inline-block rounded-md bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-black"
                        >
                          Upgrade
                        </Link>
                      </>
                    )}
                  </div>
                )}
                {isTrialing && isWithinTrialBadgeWindow(viewerAccess) && (
                  <div className="mb-3 min-h-4 text-xs text-green-300/80">
                    Trial active - full access enabled
                  </div>
                )}
                {showLowUsageWarning && (
                  <div className="mb-3 rounded-xl border border-orange-500/20 bg-[var(--accent)]/10 px-4 py-3 text-sm text-orange-100">
                    You have {remainingAnalyses} analysis{remainingAnalyses === 1 ? "" : "es"} remaining.
                    <span className="ml-2 text-foreground/80">
                      Upgrade to avoid interruption.
                    </span>
                  </div>
                )}
                </div>
                <section className={chatSectionClass}>
                {!isChatActive && (
                  <div className="relative">
                    <div className="rounded-md border border-border bg-card px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={openChatPane}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[11px] font-semibold text-foreground">
                            Chat
                          </div>
                          <div className="min-w-0">
                            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                              Command surface
                            </div>
                            <div className="truncate text-[13px] text-foreground/80">
                              Reopen the case command thread.
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={openChatPane}
                          className="rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted/70"
                        >
                          Open chat
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                <div className={chatPaneClass}>
                      <div className={chatFrameClass}>
                        <div className="flex min-h-9 shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-2.5 py-1 lg:min-h-[58px] lg:gap-4 lg:px-3 lg:py-2">
                          <div>
                          <div className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground lg:text-[10px]">
                            Command Surface
                          </div>
                          <div className="mt-0.5 hidden text-xs text-muted-foreground lg:block">
                              Case commands, uploads, and follow-up analysis.
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {hasStructuredAnalysis && (
                              <button
                                type="button"
                                onClick={openReviewPane}
                                className="rounded-md border border-border bg-muted px-2.5 py-1 text-[11px] font-medium text-foreground transition hover:bg-muted/70 lg:hidden"
                              >
                                Open review
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setChatOnlyMode((value) => !value)}
                              className={`hidden rounded-md border px-3 py-1.5 text-xs font-medium transition lg:inline-flex ${
                                chatOnlyMode
                                  ? "border-[var(--accent)]/40 bg-[var(--accent)]/15 text-[var(--accent)]"
                                  : "border-border bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                              }`}
                              aria-pressed={chatOnlyMode}
                            >
                              Chat Only: {chatOnlyMode ? "On" : "Off"}
                            </button>
                            <button
                              type="button"
                              onClick={collapseChatPane}
                              className="hidden rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted/70 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 lg:inline-flex"
                              disabled={chatOnlyMode}
                            >
                              Collapse chat
                            </button>
                          </div>
                        </div>
                        {assistanceProfileResolved && !assistanceProfile ? (
                          <div className="border-b border-border bg-muted/35 px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-medium text-foreground">Who are we helping today?</span>
                              {ASSISTANCE_PROFILE_OPTIONS.map((option) => (
                                <button
                                  key={option.value}
                                  type="button"
                                  onClick={() => handleAssistanceProfileSelect(option.value)}
                                  className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        <div className={chatWidgetWrapClass}>
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
                          onReviewProgressChange={setReviewProgress}
                          viewerAccess={viewerAccess}
                          caseChatEnabled={Boolean(analysisReportId)}
                          activeCaseId={analysisReportId}
                          caseIntent={caseIntent || "Continue with this case"}
                          assistanceProfile={assistanceProfile}
                          transcriptSummary={primaryAnalysis?.content ?? analysisText}
                          exportModel={hasResolvedAnalysis ? renderModel : null}
                          followUpFiles={attachmentsState.map((file) => ({
                            id: file.attachmentId,
                            name: file.filename,
                            type: file.hasVision ? "image" : undefined,
                          }))}
                          followUpExports={followUpExports}
                          layoutScrollKey={isReviewActive ? "review-open" : "chat-open"}
                          suppressedMessageIds={primaryAnalysis ? [primaryAnalysis.messageId] : []}
                          disabled={chatBlocked}
                        />
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        }
        bottom={
          bottomReportViewer ? (
            <BottomReportWorkspacePanel
              viewer={bottomReportViewer}
              onClose={closeBottomReportViewer}
              onAskAboutCitationDensityFinding={(annotation) => {
                void askAboutBottomCitationDensityFinding(annotation);
              }}
            />
          ) : null
        }
        right={
          <RailContent
            attachment={attachment}
            analysisText={redactExternalDocumentUrls(analysisText)}
            caseIntent={caseIntent}
            primaryAnalysisContent={primaryAnalysis?.content ?? ""}
            analysisLoading={analysisLoading}
            analysisStatus={analysisStatus}
            analysisStatusDetail={analysisStatusDetail}
            hasResolvedAnalysis={hasResolvedAnalysis}
            panel={panel}
            renderModel={renderModel}
            normalizedResult={normalizedResult}
            analysisResult={analysisResult}
            reviewProgress={reviewProgress}
            workspaceData={workspaceData}
            canViewSupplementLines={canViewSupplementLines}
                          canViewNegotiationDraft={canViewNegotiationDraft}
                          plan={plan}
                          canUseSnapshotExport={canUseSnapshotExport}
                          canUseBasicPdfExport={canUseBasicPdfExport}
                          canUseEstimateScrubberExport={canUseEstimateScrubberExport}
                          canUsePolicyRightsReviewExport={canUsePolicyRightsReviewExport}
                          canUseDoiComplaintPacketExport={canUseDoiComplaintPacketExport}
            canUseCustomerReport={canUseCustomerReport}
            analysisReportId={analysisReportId}
            attachmentIds={attachmentsState.map((file) => file.attachmentId)}
            attachments={attachmentsState}
            citationDensityTargetEstimate={citationDensityTargetEstimate}
            onCitationDensityTargetEstimateChange={setCitationDensityTargetEstimate}
            citationDensitySelectedSourceDocumentId={citationDensitySelectedSourceDocumentId}
            onCitationDensitySelectedSourceDocumentIdChange={setCitationDensitySelectedSourceDocumentId}
            onCustomerReportLocked={() => setUpgradeModalOpen(true)}
            activeInsightKey={activeInsightKey}
            evidenceModel={evidenceModel}
            activeEvidenceTargetId={activeEvidenceTargetId}
            onInsightSelect={(insightKey) => {
              revealImmersiveSection(insightKey);
            }}
            onEvidenceSelect={handleEvidenceSelect}
            onCitationDensityReportReady={openCitationDensityReportWorkspace}
            onReportWorkspaceOpen={openReportDocumentWorkspace}
          />
        }
      />

      <CollisionIqFooter />

      {chatBlocked && (
        <div
          className="fixed inset-0 z-[80] overflow-y-auto bg-background/82 backdrop-blur-xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="chat-consent-title"
        >
          <div className="flex min-h-full items-center justify-center p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
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
                    className="rounded-2xl bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-black transition hover:bg-[var(--accent)]/90 disabled:cursor-not-allowed disabled:opacity-45"
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

function CollisionIqFooter() {
  const year = new Date().getFullYear();
  const links = [
    { href: "/", label: "Home" },
    { href: "/dashboard", label: "Dashboard" },
    { href: "/technical-systems/shop-hub", label: "Shop Hub" },
    { href: "/services", label: "Services" },
    { href: "/technical-systems", label: "Collision IQ" },
    { href: "/privacy", label: "Privacy" },
    { href: "/terms", label: "Terms" },
    { href: "/delete-account", label: "Delete Account" },
  ];

  return (
    <footer className="mt-auto border-t border-border bg-card/80 px-4 py-8 text-card-foreground" data-collision-iq-footer="true">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 sm:px-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative block h-9 w-[150px] shrink-0">
            <Image
              src="/iq/iq_logo.png"
              alt="Collision IQ"
              fill
              sizes="150px"
              className="object-contain object-left dark:hidden"
            />
            <Image
              src="/iq/iq_logo-white.png"
              alt="Collision IQ"
              fill
              sizes="150px"
              className="hidden object-contain object-left dark:block"
            />
          </span>
        </div>

        <nav className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground" aria-label="Footer">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="transition hover:text-foreground">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="text-sm text-muted-foreground">&copy; {year} Collision Academy</div>
      </div>
    </footer>
  );
}

function RailContent({
  attachment,
  analysisText,
  caseIntent,
  primaryAnalysisContent,
  analysisLoading,
  analysisStatus,
  analysisStatusDetail,
  hasResolvedAnalysis,
  panel,
  renderModel,
  normalizedResult,
  analysisResult,
  reviewProgress,
  workspaceData,
  canViewSupplementLines,
  canViewNegotiationDraft,
  plan,
  canUseSnapshotExport,
  canUseBasicPdfExport,
  canUseEstimateScrubberExport,
  canUsePolicyRightsReviewExport,
  canUseDoiComplaintPacketExport,
  canUseCustomerReport,
  analysisReportId,
  attachmentIds,
  attachments,
  citationDensityTargetEstimate,
  onCitationDensityTargetEstimateChange,
  citationDensitySelectedSourceDocumentId,
  onCitationDensitySelectedSourceDocumentIdChange,
  onCustomerReportLocked,
  activeInsightKey,
  evidenceModel,
  activeEvidenceTargetId,
  onInsightSelect,
  onEvidenceSelect,
  onCitationDensityReportReady,
  onReportWorkspaceOpen,
}: {
  attachment: string | null;
  analysisText: string;
  caseIntent: string;
  primaryAnalysisContent: string;
  analysisLoading: boolean;
  analysisStatus: "idle" | "processing" | "complete" | "error";
  analysisStatusDetail: string | null;
  hasResolvedAnalysis: boolean;
  panel: DecisionPanel;
  renderModel: ReturnType<typeof buildExportModel>;
  normalizedResult: AnalysisResult | null;
  analysisResult: RepairIntelligenceReport | null;
  reviewProgress: ReviewProgress;
  workspaceData: WorkspaceData | null;
  canViewSupplementLines: boolean;
  canViewNegotiationDraft: boolean;
  plan: AccountEntitlements["plan"] | "none";
  canUseSnapshotExport: boolean;
  canUseBasicPdfExport: boolean;
  canUseEstimateScrubberExport: boolean;
  canUsePolicyRightsReviewExport: boolean;
  canUseDoiComplaintPacketExport: boolean;
  canUseCustomerReport: boolean;
  analysisReportId: string | null;
  attachmentIds: string[];
  attachments: AttachmentTrayItem[];
  citationDensityTargetEstimate: CitationDensityTargetEstimate;
  onCitationDensityTargetEstimateChange: (target: CitationDensityTargetEstimate) => void;
  citationDensitySelectedSourceDocumentId: string;
  onCitationDensitySelectedSourceDocumentIdChange: (documentId: string) => void;
  onCustomerReportLocked: () => void;
  activeInsightKey: InsightKey | null;
  evidenceModel: EvidenceLinkModel | null;
  activeEvidenceTargetId: string | null;
  onInsightSelect: (insightKey: InsightKey) => void;
  onEvidenceSelect: (link: EvidenceLink) => void;
  onCitationDensityReportReady: (params: {
    reportFlavor: CitationDensityWorkspaceReportFlavor;
    result: AnnotatedEstimateExportResult;
    onRegenerate?: () => void;
  }) => void;
  onReportWorkspaceOpen: (params: {
    reportType: ReportKind;
    document: CarrierReportDocument;
    onRegenerate?: () => void;
  }) => void;
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
  const [activeReportToSend, setActiveReportToSend] = useState<ReportKind | null>(null);
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
  const citationDensityEstimateCandidates = useMemo(
    () => buildCitationDensityEstimateCandidates(attachments),
    [attachments]
  );
  const resolvedCitationDensitySelection = useMemo(
    () =>
      resolveCitationDensityEstimateSelection({
        candidates: citationDensityEstimateCandidates,
        targetEstimate: citationDensityTargetEstimate,
        selectedSourceDocumentId: citationDensitySelectedSourceDocumentId,
      }),
    [
      citationDensityEstimateCandidates,
      citationDensitySelectedSourceDocumentId,
      citationDensityTargetEstimate,
    ]
  );
  const annotatedEstimateSourcePdf = resolvedCitationDensitySelection.primaryCandidate;
  const canGenerateCitationDensityAnnotatedEstimate =
    hasResolvedAnalysis && Boolean(analysisReportId && annotatedEstimateSourcePdf);
  const railRisk = hasResolvedAnalysis
    ? renderModel.supplementItems.length > 0
      ? "Review"
      : "Low"
    : "Pending";
  const railConfidence = hasResolvedAnalysis
    ? formatLabel(renderModel.vehicle.confidence)
    : "Pending";
  const hasRetryableAnalysisFailure =
    analysisStatus === "error" && isRetryableProviderMessage(analysisStatusDetail ?? "");
  const railStatus =
    analysisStatus === "error"
      ? hasRetryableAnalysisFailure
        ? "Retry available"
        : "Blocked"
      : analysisLoading || analysisStatus === "processing"
        ? "Processing"
        : hasResolvedAnalysis || analysisStatus === "complete"
          ? "Ready"
          : attachment
            ? "Files attached"
            : "Awaiting files";
  const attachmentLabel = attachment ?? "No attachment yet";
  const effectiveReviewProgress = resolveEffectiveReviewProgress(
    reviewProgress,
    renderModel.confidenceIntegrity
  );
  const fileReviewDiagnostics = renderModel.confidenceIntegrity.fileReviewDiagnostics;
  const fileReviewWarning =
    effectiveReviewProgress.reviewableFileCount > effectiveReviewProgress.reviewedForDetermination
      ? buildReviewCompletenessMessage({
          reviewed: effectiveReviewProgress.reviewedForDetermination,
          total: effectiveReviewProgress.reviewableFileCount,
        })
      : null;
  const indexedExclusionAuditNote = buildIndexedExclusionAuditNote({
    indexedCount: effectiveReviewProgress.indexed,
    reviewableFileCount: effectiveReviewProgress.reviewableFileCount,
    excludedFromReviewCount: effectiveReviewProgress.excludedFromReviewCount,
    excludedFromReviewFiles: effectiveReviewProgress.excludedFromReviewFiles,
  });
  const excludedFileDiagnostics = effectiveReviewProgress.excludedFromReviewFiles;
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
  const reviewedEstimateCount = buildReportUploadedDocuments(analysisResult).filter(
    (doc) => doc.kind === "estimate"
  ).length;
  const serviceIntentText = [
    caseIntent,
    primaryAnalysisContent,
    analysisText,
    panel.narrative,
    renderModel.valuation.acvReasoning,
    renderModel.valuation.dvReasoning,
    renderModel.disputeIntelligenceReport.summary,
    ...renderModel.disputeIntelligenceReport.topDrivers.map((item) => `${item.title} ${item.whyItMatters}`),
  ].join("\n");
  const academyTrigger = snapshot
    ? resolveAcademyServiceTrigger({
        snapshot,
        intentText: serviceIntentText,
        estimateCount: reviewedEstimateCount,
        estimateDispute:
          Boolean(workspaceData?.estimateComparisons?.rows?.length) ||
          (normalizedResult?.mode ?? analysisResult?.analysis?.mode) === "comparison",
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
    (reportType: ReportKind, destinationType?: ReportDestinationType) =>
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

  function openReportSend(reportType: ReportKind, destinationType: ReportDestinationType = "internal") {
    if (reportType === "snapshot" && !snapshot) {
      setSnapshotStatus("Snapshot could not be generated from the current report.");
      return;
    }
    if ((reportType === "estimate_scrubber" || reportType === "oem_citation_density") && !canGenerateCitationDensityAnnotatedEstimate) {
      setReportSendStatus(buildCitationDensitySelectionError(citationDensityEstimateCandidates, citationDensitySelectedSourceDocumentId));
      return;
    }
    if (reportType !== "snapshot" && reportType !== "estimate_scrubber" && reportType !== "oem_citation_density" && !canRenderExports) {
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

  async function prepareExportResearch(reportType: ReportKind): Promise<ExportResearchSnapshot | null> {
    const needsResearch =
      reportType === "policy_rights_review" ||
      reportType === "oem_citation_density" ||
      reportType === "estimate_scrubber" ||
      reportType === "doi_complaint_packet" ||
      (reportType === "repair_intelligence" && renderModel.oemContradictions.length > 0);

    if (!needsResearch || !analysisResult) {
      return null;
    }

    setReportSendStatus("Running Drive and internet source research...");

    const researchReportType =
      reportType === "repair_intelligence"
        ? "oem_contradiction_detection"
          : reportType;
    const response = await fetch("/api/reports/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        reportType: researchReportType,
        caseId: analysisReportId ?? undefined,
        report: analysisResult,
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      snapshot?: ExportResearchSnapshot;
      error?: string;
    } | null;

    if (!response.ok || !payload?.snapshot) {
      setReportSendStatus(payload?.error || "Source research failed; unsupported findings will remain marked as needing source.");
      return null;
    }

    setReportSendStatus(null);
    return payload.snapshot;
  }

  async function prepareAnnotatedEstimatePromptText(
    reportType: ReportKind,
    input: {
      renderModel: ReturnType<typeof buildExportModel>;
      report: RepairIntelligenceReport | null;
      analysis: AnalysisResult | null;
      panel: DecisionPanel;
      assistantAnalysis: string;
      applicabilityInstruction?: string;
      workspaceData: WorkspaceData | null;
      exportResearchSnapshot: ExportResearchSnapshot | null;
    }
  ): Promise<string | null> {
    if (reportType === "estimator_change_request_list") {
      return null;
    }

    const annotationMode = mapReportKindToAnnotationMode(reportType);
    if (!annotationMode) {
      return null;
    }

    const model = buildAnnotatedEstimateReviewModel(input);
    setReportSendStatus("Generating annotated estimate review with Collision IQ prompt...");

    const response = await fetch("/api/reports/annotated-estimate-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        user_request:
          "Generate an annotated estimate review. Show missing, under-documented, reduced, and proof-needed items directly against the relevant estimate lines or sections.",
        case_context: buildAnnotatedPromptCaseContext(input, model),
        uploaded_documents: buildAnnotatedPromptUploadedDocuments(input),
        applicability_instruction: input.applicabilityInstruction ?? "",
        carrier_estimate_text: buildAnnotatedPromptCarrierEstimateText(input, model),
        shop_estimate_text: buildAnnotatedPromptShopEstimateText(model),
        scrubber_findings: buildAnnotatedPromptScrubberFindings(model),
        audience: "estimator",
        annotation_mode: annotationMode,
      }),
    });
    const data = (await response.json().catch(() => null)) as {
      output_text?: unknown;
      error?: string;
    } | null;
    const promptText = typeof data?.output_text === "string" ? data.output_text : "";

    if (!response.ok) {
      setReportSendStatus(data?.error || "Stored prompt generation failed; using deterministic annotations.");
      return null;
    }

    setReportSendStatus(null);
    return promptText.trim() || null;
  }

  async function downloadCitationDensityFindingsReport(exportResult: AnnotatedEstimateExportResult) {
    try {
      let blob: Blob | null = null;
      if (exportResult.findingsReportPdfBase64) {
        blob = pdfBase64ToBlob(exportResult.findingsReportPdfBase64);
      } else if (exportResult.findingsReportUrl) {
        const res = await fetch(exportResult.findingsReportUrl, { credentials: "same-origin" });
        if (res.ok) blob = await res.blob();
      }
      if (blob) {
        downloadBlob(blob, exportResult.findingsReportFilename ?? "citation-density-findings.pdf");
      }
    } catch {
      // Non-blocking: the annotated estimate already downloaded successfully.
    }
  }

  async function downloadReportDocument(reportType: ReportKind) {
    if (reportType === "estimate_scrubber") {
      try {
        const exportResult = await generateAnnotatedCitationDensityEstimate();
        downloadBlob(exportResult.blob, exportResult.filename);
        await downloadCitationDensityFindingsReport(exportResult);
        onCitationDensityReportReady({
          reportFlavor: "delta",
          result: exportResult,
          onRegenerate: () => {
            void downloadReportDocument("estimate_scrubber");
          },
        });
        setReportSendStatus(buildAnnotatedCitationDensityStatus(exportResult));
      } catch (error) {
        setReportSendStatus(error instanceof Error ? error.message : "Annotated estimate download failed.");
      }
      return;
    }
    if (reportType === "oem_citation_density") {
      try {
        const exportResult = await generateOemCitationDensityReport();
        downloadBlob(exportResult.blob, exportResult.filename);
        await downloadCitationDensityFindingsReport(exportResult);
        onCitationDensityReportReady({
          reportFlavor: "oem",
          result: exportResult,
          onRegenerate: () => {
            void downloadReportDocument("oem_citation_density");
          },
        });
        setReportSendStatus(buildAnnotatedCitationDensityStatus(exportResult));
      } catch (error) {
        setReportSendStatus(error instanceof Error ? error.message : "OEM Citation Density Report download failed.");
      }
      return;
    }

    if (reportType !== "snapshot" && !canRenderExports) {
      setReportSendStatus("Report is not ready to download yet.");
      return;
    }

    try {
      const document = await buildReportDocument(reportType);
      onReportWorkspaceOpen({
        reportType,
        document,
        onRegenerate: () => {
          void downloadReportDocument(reportType);
        },
      });
      void exportCarrierPDF(document);
    } catch (error) {
      setReportSendStatus(error instanceof Error ? error.message : "Report download failed.");
    }
  }

  function downloadCustomerReportDocument() {
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
      onDocumentReady: (document) => {
        onReportWorkspaceOpen({
          reportType: "customer_report",
          document,
          onRegenerate: downloadCustomerReportDocument,
        });
      },
    });
    emitSafeCrmEventFromClient({
      event: "report_generated",
      plan,
      exportType: "customer_report",
    });
  }

  async function generateAnnotatedCitationDensityEstimate(): Promise<AnnotatedEstimateExportResult> {
    if (!analysisReportId) {
      throw new Error("Citation Density annotated export needs an active case.");
    }

    if (!annotatedEstimateSourcePdf) {
      throw new Error(buildCitationDensitySelectionError(citationDensityEstimateCandidates, citationDensitySelectedSourceDocumentId));
    }

    setReportSendStatus("Generating annotated Citation Density estimate PDF...");
    const selectionPayload = buildCitationDensitySelectionPayload(resolvedCitationDensitySelection);
    const response = await fetch("/api/reports/citation-density/annotated-estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        caseId: analysisReportId,
        activeCaseId: analysisReportId,
        artifactIds: attachmentIds,
        ...selectionPayload,
        targetEstimate: citationDensityTargetEstimate,
        annotationMode: "both",
        includeLegend: true,
        includeSummaryPage: false,
        redactSensitive: true,
      }),
    });

    const data = (await response.json().catch(() => null)) as {
      downloadUrl?: unknown;
      artifactId?: unknown;
      exportId?: unknown;
      annotationMetadata?: unknown;
      pdfBase64?: unknown;
      findingsReportUrl?: unknown;
      findingsReportPdfBase64?: unknown;
      annotatedFindingCount?: unknown;
      unresolvedAnchorCount?: unknown;
      warnings?: unknown;
      debugCounts?: unknown;
      rejectedSourceCandidates?: unknown;
      acceptedEstimateCandidates?: unknown;
      error?: string;
      userMessage?: string;
    } | null;

    if (!response.ok || typeof data?.downloadUrl !== "string") {
      throw new Error(formatAnnotatedExportError(data, "Annotated estimate export failed."));
    }

    const pdfBase64 = typeof data.pdfBase64 === "string" ? data.pdfBase64 : undefined;
    let artifactFallbackUsed = false;
    const blob = await fetchAnnotatedCitationDensityPdfBlob(data.downloadUrl, pdfBase64, () => {
      artifactFallbackUsed = true;
    });
    return {
      blob,
      filename: "delta-citation-density-report.pdf",
      findingsReportUrl: typeof data.findingsReportUrl === "string" ? data.findingsReportUrl : undefined,
      findingsReportPdfBase64:
        typeof data.findingsReportPdfBase64 === "string" ? data.findingsReportPdfBase64 : undefined,
      findingsReportFilename: "delta-citation-density-findings.pdf",
      artifactId: typeof data.artifactId === "string"
        ? data.artifactId
        : typeof data.exportId === "string"
          ? data.exportId
          : "",
      downloadUrl: data.downloadUrl,
      pdfBase64,
      artifactFallbackUsed,
      annotationMetadata: Array.isArray(data.annotationMetadata)
        ? data.annotationMetadata.filter(isCitationDensityAnnotationMetadata)
        : [],
      annotatedFindingCount:
        typeof data.annotatedFindingCount === "number" ? data.annotatedFindingCount : 0,
      unresolvedAnchorCount:
        typeof data.unresolvedAnchorCount === "number" ? data.unresolvedAnchorCount : 0,
      warnings: Array.isArray(data.warnings)
        ? data.warnings.filter((warning): warning is string => typeof warning === "string")
        : [],
      debugCounts: data.debugCounts && typeof data.debugCounts === "object"
        ? data.debugCounts as Record<string, unknown>
        : null,
    };
  }

  async function generateOemCitationDensityReport(): Promise<AnnotatedEstimateExportResult> {
    if (!analysisReportId) {
      throw new Error("OEM Citation Density Report needs an active case.");
    }

    if (!annotatedEstimateSourcePdf) {
      throw new Error(buildCitationDensitySelectionError(citationDensityEstimateCandidates, citationDensitySelectedSourceDocumentId));
    }

    setReportSendStatus("Generating OEM Citation Density Report...");
    const selectionPayload = buildCitationDensitySelectionPayload(resolvedCitationDensitySelection);
    const response = await fetch("/api/reports/oem-citation-density/annotated-estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        caseId: analysisReportId,
        activeCaseId: analysisReportId,
        artifactIds: attachmentIds,
        ...selectionPayload,
        targetEstimate: citationDensityTargetEstimate,
        annotationMode: "both",
        includeLegend: true,
        includeSummaryPage: false,
        redactSensitive: true,
      }),
    });

    const data = (await response.json().catch(() => null)) as {
      downloadUrl?: unknown;
      artifactId?: unknown;
      exportId?: unknown;
      annotationMetadata?: unknown;
      pdfBase64?: unknown;
      findingsReportUrl?: unknown;
      findingsReportPdfBase64?: unknown;
      annotatedFindingCount?: unknown;
      unresolvedAnchorCount?: unknown;
      warnings?: unknown;
      debugCounts?: unknown;
      rejectedSourceCandidates?: unknown;
      acceptedEstimateCandidates?: unknown;
      error?: string;
      userMessage?: string;
    } | null;

    if (!response.ok || typeof data?.downloadUrl !== "string") {
      throw new Error(formatAnnotatedExportError(data, "OEM Citation Density Report export failed."));
    }

    const pdfBase64 = typeof data.pdfBase64 === "string" ? data.pdfBase64 : undefined;
    let artifactFallbackUsed = false;
    const blob = await fetchAnnotatedCitationDensityPdfBlob(data.downloadUrl, pdfBase64, () => {
      artifactFallbackUsed = true;
    });
    return {
      blob,
      filename: "oem-citation-density-report.pdf",
      findingsReportUrl: typeof data.findingsReportUrl === "string" ? data.findingsReportUrl : undefined,
      findingsReportPdfBase64:
        typeof data.findingsReportPdfBase64 === "string" ? data.findingsReportPdfBase64 : undefined,
      findingsReportFilename: "oem-citation-density-findings.pdf",
      artifactId: typeof data.artifactId === "string"
        ? data.artifactId
        : typeof data.exportId === "string"
          ? data.exportId
          : "",
      downloadUrl: data.downloadUrl,
      pdfBase64,
      artifactFallbackUsed,
      annotationMetadata: Array.isArray(data.annotationMetadata)
        ? data.annotationMetadata.filter(isCitationDensityAnnotationMetadata)
        : [],
      annotatedFindingCount:
        typeof data.annotatedFindingCount === "number" ? data.annotatedFindingCount : 0,
      unresolvedAnchorCount:
        typeof data.unresolvedAnchorCount === "number" ? data.unresolvedAnchorCount : 0,
      warnings: Array.isArray(data.warnings)
        ? data.warnings.filter((warning): warning is string => typeof warning === "string")
        : [],
      debugCounts: data.debugCounts && typeof data.debugCounts === "object"
        ? data.debugCounts as Record<string, unknown>
        : null,
    };
  }

  async function buildReportDocument(reportType: ReportKind): Promise<CarrierReportDocument> {
    if (reportType === "snapshot") {
      if (!snapshot) {
        throw new Error("Snapshot could not be generated from the current report.");
      }
      return buildCollisionSnapshotPdfFromSnapshot(snapshot);
    }
    if (reportType === "estimate_scrubber") {
      throw new Error("Citation Density annotated export requires an original estimate PDF and must use the annotated-estimate PDF route.");
    }
    if (reportType === "oem_citation_density") {
      throw new Error("OEM Citation Density Report requires an original estimate PDF and must use the OEM annotated-estimate PDF route.");
    }

    const resolvedAnalysis =
      normalizedResult ?? (analysisResult ? normalizeReportToAnalysisResult(analysisResult) : null);
    const exportResearchSnapshot = await prepareExportResearch(reportType);
    const damageDescription =
      renderModel.repairPosition || renderModel.positionStatement || resolvedAnalysis?.narrative;
    const vehicle =
      vehicleIdentity || renderModel.reportFields.vehicleLabel || resolvedAnalysis?.vehicle?.make;
    const jurisdiction = extractJurisdictionFromSnapshot(exportResearchSnapshot);
    const uploadedDocuments = buildReportUploadedDocuments(analysisResult);
    const applicability = buildReportApplicability({
      documents: uploadedDocuments.map((doc) => ({
        id: doc.id,
        filename: doc.filename,
        kind: doc.kind,
        text: doc.text,
      })),
      claimFacts: {
        damageDescription,
        vehicle,
        jurisdiction,
      },
    });
    const analysisWithApplicability = [analysisText, applicability.instruction].filter(Boolean).join("\n\n");
    const sharedInput = {
      renderModel,
      report: analysisResult,
      analysis: resolvedAnalysis,
      panel,
      assistantAnalysis: analysisWithApplicability,
      applicabilityInstruction: applicability.instruction,
      workspaceData,
      exportResearchSnapshot,
    };
    const promptGeneratedText = await prepareAnnotatedEstimatePromptText(reportType, sharedInput);
    const annotatedInput = {
      ...sharedInput,
      promptGeneratedText,
    };
    const userProvidedReportContext = buildUserProvidedContextForReports(
      [
        caseIntent ? `Case intent: ${caseIntent}` : null,
        primaryAnalysisContent ? `Primary chat analysis: ${primaryAnalysisContent}` : null,
        analysisWithApplicability,
      ].filter(Boolean).join("\n\n")
    );

    if (reportType === "repair_intelligence") {
      return buildCarrierReport(sharedInput);
    }
    if (reportType === "estimator_change_request_list") {
      return buildEstimatorChangeRequestListPdf(annotatedInput);
    }
    if (reportType === "policy_rights_review") {
      return buildPolicyRightsReviewPdf({
        ...sharedInput,
        assistantAnalysis: userProvidedReportContext,
      });
    }
    if (reportType === "doi_complaint_packet") {
      return buildDoiComplaintPacketPdf({
        ...sharedInput,
        assistantAnalysis: userProvidedReportContext,
      });
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
      if (activeReportToSend === "estimate_scrubber" || activeReportToSend === "oem_citation_density") {
        const reportTypeForRegenerate = activeReportToSend;
        const exportResult = activeReportToSend === "oem_citation_density"
          ? await generateOemCitationDensityReport()
          : await generateAnnotatedCitationDensityEstimate();
        onCitationDensityReportReady({
          reportFlavor: activeReportToSend === "oem_citation_density" ? "oem" : "delta",
          result: exportResult,
          onRegenerate: () => {
            void downloadReportDocument(reportTypeForRegenerate);
          },
        });
        const pdfBase64 = await blobToBase64(exportResult.blob);
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
            filename: exportResult.filename,
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
          throw new Error(result?.error || (activeReportToSend === "oem_citation_density" ? "OEM Citation Density email failed." : "Annotated estimate email failed."));
        }

        if (result?.deliveryMode === "manual") {
          setReportSendStatus(result.message || "Email provider is not configured. Download the annotated PDF and send manually.");
        } else {
          setReportSent(true);
          setReportSendStatus(buildAnnotatedCitationDensityStatus(exportResult, "Sent successfully."));
        }
        emitSafeCrmEventFromClient({
          event: "report_sent",
          plan,
          exportType: activeReportToSend,
          destinationType: reportSendTarget,
        });
        if (analysisReportId) {
          void fetchReportSendHistory();
        }
        return;
      }

      const document = await buildReportDocument(activeReportToSend);
      const reportTypeForRegenerate = activeReportToSend;
      onReportWorkspaceOpen({
        reportType: activeReportToSend,
        document,
        onRegenerate: () => {
          void downloadReportDocument(reportTypeForRegenerate);
        },
      });
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
      } else {
        if (!result) {
          return;
        }
        if (result.sentAt) {
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
        adjustedConfidence: snapshot.evidenceCompleteness.adjustedConfidence,
        completenessStatus: snapshot.evidenceCompleteness.completenessStatus,
        topDisputeCount: snapshot.topDisputeItems.length,
        uploadLimitReached: snapshot.evidenceCompleteness.uploadLimitReached,
        userIndicatedMoreFiles: snapshot.evidenceCompleteness.userIndicatedMoreFiles,
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

        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <MetricCard label="Uploaded" value={String(effectiveReviewProgress.uploaded)} />
          <MetricCard label="Indexed" value={String(effectiveReviewProgress.indexed)} />
          <MetricCard label="Vision Processed" value={String(effectiveReviewProgress.visionProcessed)} />
          <MetricCard
            label="Reviewed"
            value={`${effectiveReviewProgress.reviewedForDetermination}/${effectiveReviewProgress.reviewableFileCount || effectiveReviewProgress.reviewedForDetermination}`}
          />
        </div>

        <div className="mt-2 text-[12px] leading-5 text-muted-foreground">
          Reviewed {effectiveReviewProgress.reviewedForDetermination} of{" "}
          {effectiveReviewProgress.reviewableFileCount || effectiveReviewProgress.reviewedForDetermination} reviewable files.
        </div>

        {fileReviewDiagnostics ? (
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <MetricCard
              label="PDFs parsed"
              value={`${fileReviewDiagnostics.parsedPdfCount}/${fileReviewDiagnostics.pdfCount}`}
            />
            <MetricCard
              label="Images reviewed"
              value={`${fileReviewDiagnostics.imageVisionCount}/${fileReviewDiagnostics.imageCount}`}
            />
            <MetricCard
              label="PDF fallback"
              value={String(fileReviewDiagnostics.scannedPdfFallbackCount)}
            />
            <MetricCard
              label="Support only"
              value={String(fileReviewDiagnostics.supportOnlyCount)}
            />
          </div>
        ) : null}

        {fileReviewWarning ? (
          <div className="mt-3 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-amber-800 dark:text-amber-200">
            {fileReviewWarning}
          </div>
        ) : null}

        {indexedExclusionAuditNote ? (
          <div className="mt-3 rounded-xl border border-border bg-muted px-3 py-2 text-[12px] leading-5 text-muted-foreground">
            {indexedExclusionAuditNote}
          </div>
        ) : null}

        {excludedFileDiagnostics.length ? (
          <div className="mt-3 rounded-xl border border-border bg-muted px-3 py-2 text-[12px] leading-5 text-muted-foreground">
            <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Excluded Files
            </div>
            <div className="space-y-2">
              {excludedFileDiagnostics.map((file, index) => (
                <div key={`${file.filename}-${file.reason}-${index}`} className="border-t border-border/60 pt-2 first:border-t-0 first:pt-0">
                  <div className="font-medium text-foreground">{file.filename}</div>
                  <div>Detected type: {formatLabel(file.detectedType)}</div>
                  <div>Reason: {formatLabel(file.reason)}</div>
                  <div>Indexed: {file.indexed ? "Yes" : "No"}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {analysisLoading && !hasResolvedAnalysis && (
        <section className="mt-5 space-y-2 rounded-2xl border border-orange-500/12 bg-gradient-to-br from-[var(--accent)]/10 via-[var(--accent)]/[0.04] to-white/[0.02] p-3.5">
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
            {hasRetryableAnalysisFailure ? "Analysis delayed" : "Analysis blocked"}
          </div>
          <div className="text-[13px] leading-5 text-muted-foreground">
            {analysisStatusDetail ||
              (hasRetryableAnalysisFailure
                ? "Analysis provider is busy. Please retry shortly."
                : "The current file set could not be analyzed. Review access status or retry.")}
          </div>
        </section>
      )}

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

      {hasResolvedAnalysis && featuredRecommendation ? (
        <RailInsightSection
          insightKey="executive_summary"
          activeInsightKey={activeInsightKey}
          registerSectionRef={registerSectionRef}
          onActivate={onInsightSelect}
        >
          <FeaturedRecommendationCard item={featuredRecommendation} />
        </RailInsightSection>
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
          {renderModel.oemContradictions.length > 0 ? (
            <OemContradictionCard contradictions={renderModel.oemContradictions} />
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
                onStartAcvCheckout={() => void startAcademyServiceCheckout("academy_value_dispute")}
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
                {cleanWorkspaceDisplayText(item.rationale, item.title) ? (
                  <div className="mt-2 text-[13px] leading-5 text-muted-foreground">
                    {cleanWorkspaceDisplayText(item.rationale, item.title)}
                  </div>
                ) : null}
                {cleanWorkspaceDisplayText(item.evidence, item.title, "Evidence") ? (
                  <div className="mt-2 text-xs leading-5 text-muted-foreground">
                    Evidence: {cleanWorkspaceDisplayText(item.evidence, item.title, "Evidence")}
                  </div>
                ) : null}
                {cleanWorkspaceDisplayText(item.source, item.title) ? (
                  <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
                    Source: {cleanWorkspaceDisplayText(item.source, item.title)}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[13px] leading-5 text-muted-foreground">
            {featuredRecommendation
              ? "The strongest recommendation is highlighted above."
              : "No clear missing, reduced, or disputed repair items were identified from the current review."}
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

      {canRenderExports || canGenerateCitationDensityAnnotatedEstimate ? (
        <RailInsightSection
          insightKey="exports"
          activeInsightKey={activeInsightKey}
          registerSectionRef={registerSectionRef}
          onActivate={onInsightSelect}
        >
        <section className="mt-4 space-y-2 border border-border bg-card p-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Reports & Exports
            </div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              Carrier-ready documents, snapshots, and audit packets.
            </div>
          </div>
          <div className="grid gap-2">
            <button
              type="button"
              onClick={openSnapshotPreview}
              disabled={!canUseSnapshotExport}
              className="group flex w-full cursor-pointer items-center justify-between gap-3 rounded-md border border-border bg-muted p-3 text-left transition hover:border-[var(--accent)]/35 hover:bg-card focus:outline-none focus:ring-2 focus:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--accent)]/20 bg-[var(--accent)]/10 text-[var(--accent)]">
                  <FileText size={17} aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-foreground">1-Page Snapshot</span>
                  <span className="block text-[12px] leading-5 text-muted-foreground">Preview, download, or send a redacted snapshot.</span>
                </span>
              </span>
              <ArrowRight size={16} className="shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-[var(--accent)]" aria-hidden />
            </button>
            <ReportSendStatusLine
              send={getLastSendFor("snapshot")}
              loading={reportSendHistoryLoading}
            />
            {canUseBasicPdfExport ? (
              <div className="space-y-2 rounded-md border border-border bg-card p-3 transition hover:border-[var(--accent)]/25">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <FileText size={15} className="text-[var(--accent)]" aria-hidden />
                    Repair Intelligence Report
                  </div>
                  <div className="mt-1 text-[12px] leading-5 text-muted-foreground">
                    Technical, procedural, evidentiary, and negotiation-aware repair position.
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      void downloadReportDocument("repair_intelligence");
                      emitSafeCrmEventFromClient({
                        event: "report_generated",
                        plan,
                        exportType: "repair_intelligence",
                      });
                    }}
                    className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-left text-xs font-semibold leading-5 text-foreground transition hover:border-[var(--accent)]/35 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring/25"
                  >
                    <span className="inline-flex items-center gap-2"><Download size={15} aria-hidden /> Download PDF</span>
                    <ArrowRight size={14} className="transition group-hover:translate-x-0.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => openReportSend("repair_intelligence")}
                    className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-left text-xs font-semibold leading-5 text-black transition hover:bg-[var(--accent)]/90 focus:outline-none focus:ring-2 focus:ring-ring/25"
                  >
                    <span className="inline-flex items-center gap-2"><Mail size={15} aria-hidden /> Email report</span>
                    <ArrowRight size={14} className="transition group-hover:translate-x-0.5" aria-hidden />
                  </button>
                </div>
                <ReportSendStatusLine
                  send={getLastSendFor("repair_intelligence")}
                  loading={reportSendHistoryLoading}
                />
              </div>
            ) : null}
            {canUseEstimateScrubberExport || canUsePolicyRightsReviewExport ? (
              <CitationDensityTargetSelector
                value={citationDensityTargetEstimate}
                onChange={onCitationDensityTargetEstimateChange}
                selectedSourceDocumentId={citationDensitySelectedSourceDocumentId}
                onSelectedSourceDocumentIdChange={onCitationDensitySelectedSourceDocumentIdChange}
                candidates={citationDensityEstimateCandidates}
              />
            ) : null}
            {canUseEstimateScrubberExport ? (
              <div className="space-y-2 rounded-md border border-border bg-card p-3 transition hover:border-[var(--accent)]/25">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <FileText size={15} className="text-[var(--accent)]" aria-hidden />
                    Delta Citation Density Report
                  </div>
                  <div className="mt-1 text-[12px] leading-5 text-muted-foreground">
                    Annotates the actual estimate PDF with supported missed, reduced, or under-documented operations.
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      void downloadReportDocument("estimate_scrubber");
                      emitSafeCrmEventFromClient({
                        event: "report_generated",
                        plan,
                        exportType: "estimate_scrubber",
                      });
                    }}
                    className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-left text-xs font-semibold leading-5 text-foreground transition hover:border-[var(--accent)]/35 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring/25"
                  >
                    <span className="inline-flex items-center gap-2"><Download size={15} aria-hidden /> Download Delta Citation Density Report</span>
                    <ArrowRight size={14} className="transition group-hover:translate-x-0.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => openReportSend("estimate_scrubber", "carrier")}
                    className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-left text-xs font-semibold leading-5 text-black transition hover:bg-[var(--accent)]/90 focus:outline-none focus:ring-2 focus:ring-ring/25"
                  >
                    <span className="inline-flex items-center gap-2"><Mail size={15} aria-hidden /> Email Delta Citation Density Report</span>
                    <ArrowRight size={14} className="transition group-hover:translate-x-0.5" aria-hidden />
                  </button>
                </div>
                <ReportSendStatusLine
                  send={getLastSendFor("estimate_scrubber")}
                  loading={reportSendHistoryLoading}
                />
              </div>
            ) : null}
            {canUsePolicyRightsReviewExport ? (
              <div className="space-y-2 rounded-md border border-border bg-card p-3 transition hover:border-[var(--accent)]/25">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <FileText size={15} className="text-[var(--accent)]" aria-hidden />
                    OEM Citation Density Report
                  </div>
                  <div className="mt-1 text-[12px] leading-5 text-muted-foreground">
                    Reviews uploaded estimate(s) against OEM procedures, position statements, MOTOR guidance, safety requirements, documentation gaps, and repair-standard support.
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      void downloadReportDocument("oem_citation_density");
                      emitSafeCrmEventFromClient({
                        event: "report_generated",
                        plan,
                        exportType: "oem_citation_density",
                      });
                    }}
                    className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-left text-xs font-semibold leading-5 text-foreground transition hover:border-[var(--accent)]/35 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring/25"
                  >
                    <span className="inline-flex items-center gap-2"><Download size={15} aria-hidden /> Download OEM Citation Density Report</span>
                    <ArrowRight size={14} className="transition group-hover:translate-x-0.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => openReportSend("oem_citation_density", "carrier")}
                    className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-left text-xs font-semibold leading-5 text-black transition hover:bg-[var(--accent)]/90 focus:outline-none focus:ring-2 focus:ring-ring/25"
                  >
                    <span className="inline-flex items-center gap-2"><Mail size={15} aria-hidden /> Email OEM Citation Density Report</span>
                    <ArrowRight size={14} className="transition group-hover:translate-x-0.5" aria-hidden />
                  </button>
                </div>
                <ReportSendStatusLine
                  send={getLastSendFor("oem_citation_density")}
                  loading={reportSendHistoryLoading}
                />
              </div>
            ) : hasResolvedAnalysis ? (
              <div className="space-y-2 rounded-md border border-border bg-card p-3 opacity-95 transition hover:border-[var(--accent)]/25 dark:bg-card">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <FileText size={15} className="text-[var(--accent)]" aria-hidden />
                    OEM Citation Density Report
                    <span className="rounded-sm border border-[var(--accent)]/25 bg-[var(--accent)]/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[#a35d26] dark:text-[#d08a4b]">
                      Pro
                    </span>
                  </div>
                  <div className="mt-1 text-[12px] leading-5 text-muted-foreground">
                    OEM procedures, position statements, MOTOR guidance, safety requirements, documentation gaps, and repair-standard support.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onCustomerReportLocked}
                  className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-left text-xs font-semibold leading-5 text-foreground transition hover:border-[var(--accent)]/35 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring/25"
                >
                  <span className="inline-flex items-center gap-2"><ArrowRight size={15} aria-hidden /> Unlock report</span>
                  <ArrowRight size={14} className="transition group-hover:translate-x-0.5" aria-hidden />
                </button>
              </div>
            ) : null}
            {canUseDoiComplaintPacketExport ? (
              <div className="space-y-2 rounded-md border border-border bg-card p-3 transition hover:border-[var(--accent)]/25">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <FileText size={15} className="text-[var(--accent)]" aria-hidden />
                    DOI Complaint Packet
                  </div>
                  <div className="mt-1 text-[12px] leading-5 text-muted-foreground">
                    Formal documentation packet for DOI escalation support, evidence, citations, and unresolved claim items.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void downloadReportDocument("doi_complaint_packet");
                    emitSafeCrmEventFromClient({
                      event: "report_generated",
                      plan,
                      exportType: "doi_complaint_packet",
                    });
                  }}
                  className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-left text-xs font-semibold leading-5 text-foreground transition hover:border-[var(--accent)]/35 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring/25"
                >
                  <span className="inline-flex items-center gap-2"><Download size={15} aria-hidden /> Download PDF</span>
                  <ArrowRight size={14} className="transition group-hover:translate-x-0.5" aria-hidden />
                </button>
              </div>
            ) : null}
            {canUseCustomerReport ? (
              <div className="space-y-2 rounded-md border border-border bg-card p-3 transition hover:border-[var(--accent)]/25">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <FileText size={15} className="text-[var(--accent)]" aria-hidden />
                    Customer Report
                  </div>
                  <div className="mt-1 text-[12px] leading-5 text-muted-foreground">Plain-language customer-facing summary.</div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    aria-disabled={isGeneratingCustomerReport}
                    onClick={downloadCustomerReportDocument}
                    className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-left text-xs font-semibold leading-5 text-foreground transition hover:border-[var(--accent)]/35 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring/25 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                  >
                    <span className="inline-flex items-center gap-2"><Download size={15} aria-hidden /> {isGeneratingCustomerReport ? "Generating..." : "Download PDF"}</span>
                    <ArrowRight size={14} className="transition group-hover:translate-x-0.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    disabled={isGeneratingCustomerReport}
                    onClick={() => openReportSend("customer_report", "customer")}
                    className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-left text-xs font-semibold leading-5 text-black transition hover:bg-[var(--accent)]/90 focus:outline-none focus:ring-2 focus:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50"
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
            {!canUseBasicPdfExport || !canUseEstimateScrubberExport || !canUsePolicyRightsReviewExport || !canUseDoiComplaintPacketExport || !canUseCustomerReport ? (
              <button
                type="button"
                onClick={onCustomerReportLocked}
                className="w-full rounded-md border border-orange-400/18 bg-[var(--accent)]/10 p-3 text-xs text-foreground transition hover:bg-[var(--accent)]/16"
              >
                Repair Intelligence, Delta Citation Density Report, OEM Citation Density Report, DOI Complaint Packet, and Customer Report are available on Pro.
              </button>
            ) : null}
            {academyTrigger ? (
              <button
                type="button"
                onClick={() => void startAcademyServiceCheckout()}
                disabled={serviceCheckoutLoading}
                className="w-full rounded-md border border-[var(--accent)]/30 bg-card p-3 text-left transition hover:border-[var(--accent)]/50 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Services</div>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {academyTrigger.title}
                </div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">Why this is showing: {academyTrigger.reason}</div>
                {academyTrigger.chips.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {academyTrigger.chips.map((chip) => (
                      <span key={chip} className="rounded-sm border border-border bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                        {chip}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="mt-3 inline-flex rounded-md bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-black">
                  {serviceCheckoutLoading ? "Opening checkout..." : academyTrigger.button}
                </div>
              </button>
            ) : null}
            {customerReportError ? (
              <div className="rounded-md border border-red-500/16 bg-red-500/[0.05] px-3 py-2 text-[12px] leading-5 text-red-500">
                {customerReportError}
              </div>
            ) : null}
            {snapshotStatus ? (
              <div className="rounded-md border border-border bg-muted px-3 py-2 text-[12px] leading-5 text-muted-foreground">
                {snapshotStatus}
              </div>
            ) : null}
            {reportSendStatus ? (
              <div className="rounded-md border border-border bg-muted px-3 py-2 text-[12px] leading-5 text-muted-foreground">
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
          onStartServiceCase={(serviceKey) => void startAcademyServiceCheckout(serviceKey)}
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

function BottomReportWorkspacePanel({
  viewer,
  onClose,
  onAskAboutCitationDensityFinding,
}: {
  viewer: BottomReportViewerState;
  onClose: () => void;
  onAskAboutCitationDensityFinding: (annotation: CitationDensityAnnotationMetadata) => void;
}) {
  if (!viewer) return null;

  return (
    <div className="shrink-0 border-t border-border bg-background/95 p-2 shadow-[0_-20px_55px_rgba(15,23,42,0.10)] backdrop-blur sm:p-3 dark:shadow-[0_-20px_55px_rgba(0,0,0,0.28)]">
      {viewer.kind === "citation-density" ? (
        <CitationDensityAnnotationViewer
          key={viewer.id}
          variant="inline"
          title={viewer.title}
          filename={viewer.filename}
          pdfUrl={viewer.pdfUrl}
          annotations={viewer.annotations}
          diagnostics={viewer.diagnostics}
          artifactUnavailableMessage={viewer.artifactUnavailableMessage}
          onClose={onClose}
          onRegenerate={viewer.onRegenerate}
          onAsk={onAskAboutCitationDensityFinding}
        />
      ) : (
        <ReportDocumentBottomViewer key={viewer.id} viewer={viewer} onClose={onClose} />
      )}
    </div>
  );
}

function ReportDocumentBottomViewer({
  viewer,
  onClose,
}: {
  viewer: Extract<NonNullable<BottomReportViewerState>, { kind: "report-document" }>;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"summary" | "sections">("summary");
  const [expanded, setExpanded] = useState(true);
  const tabClass = (active: boolean) => [
    "rounded-md border px-3 py-1.5 text-xs font-semibold transition",
    active
      ? "border-[var(--accent)]/45 bg-[var(--accent)]/12 text-foreground"
      : "border-border bg-muted text-muted-foreground hover:bg-card hover:text-foreground",
  ].join(" ");

  return (
    <section
      className={`flex ${expanded ? "h-[min(72svh,760px)] min-h-[360px] lg:h-[min(75svh,900px)] lg:min-h-[560px]" : "h-[min(34svh,360px)] min-h-[180px]"} flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-[0_20px_60px_rgba(15,23,42,0.16)] ring-1 ring-ring/10 dark:shadow-[0_20px_60px_rgba(0,0,0,0.38)]`}
      aria-label={`${viewer.title} bottom report viewer`}
      data-report-bottom-viewer="true"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3 py-2.5 sm:px-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-card-foreground">{viewer.title}</div>
          <div className="text-xs text-muted-foreground">
            Interactive report review · generated {viewer.generatedAtLabel}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md border border-border bg-muted p-2 text-muted-foreground transition hover:bg-background hover:text-foreground"
            aria-label={expanded ? "Collapse report" : "Expand report"}
            title={expanded ? "Collapse report" : "Expand report"}
          >
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          {viewer.onRegenerate ? (
            <button
              type="button"
              onClick={viewer.onRegenerate}
              className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md border border-border bg-muted p-2 text-muted-foreground transition hover:bg-background hover:text-foreground"
              aria-label={`Regenerate ${viewer.title}`}
              title={`Regenerate ${viewer.title}`}
            >
              <RefreshCcw size={16} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void exportCarrierPDF(viewer.document)}
            className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md border border-border bg-muted p-2 text-muted-foreground transition hover:bg-background hover:text-foreground"
            aria-label="Download PDF"
            title="Download PDF"
          >
            <Download size={16} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md border border-border bg-muted p-2 text-muted-foreground transition hover:bg-background hover:text-foreground"
            aria-label="Close bottom report viewer"
            title="Close bottom report viewer"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-background p-3">
        <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Report sections">
          <button type="button" role="tab" aria-selected={activeTab === "summary"} onClick={() => setActiveTab("summary")} className={tabClass(activeTab === "summary")}>Summary</button>
          <button type="button" role="tab" aria-selected={activeTab === "sections"} onClick={() => setActiveTab("sections")} className={tabClass(activeTab === "sections")}>Report sections</button>
        </div>

        {activeTab === "summary" ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {viewer.document.summary.map((item) => (
              <div key={`${item.label}-${item.value}`} className="rounded-md border border-border bg-card p-3">
                <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{item.label}</div>
                <div className="mt-1 break-words text-sm leading-6 text-card-foreground">{item.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {viewer.document.sections.map((section, index) => (
              <details key={`${section.title}-${index}`} open={index === 0} className="rounded-md border border-border bg-card p-3">
                <summary className="cursor-pointer text-sm font-semibold text-card-foreground">{section.title}</summary>
                {section.body ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{section.body}</p> : null}
                {section.bullets?.length ? (
                  <ul className="mt-3 space-y-2 pl-4 text-sm leading-6 text-muted-foreground">
                    {section.bullets.map((bullet) => <li key={bullet} className="list-disc">{bullet}</li>)}
                  </ul>
                ) : null}
                {section.comparisonRows?.length ? (
                  <div className="mt-3 space-y-2">
                    {section.comparisonRows.map((row) => (
                      <div key={`${row.label}-${row.leftValue}-${row.rightValue}`} className="rounded-md border border-border bg-muted p-3 text-xs leading-5 text-muted-foreground">
                        <div className="font-semibold text-card-foreground">{row.label}</div>
                        <div className="mt-1 grid gap-2 sm:grid-cols-2">
                          <div>{row.leftLabel}: {row.leftValue}</div>
                          <div>{row.rightLabel}: {row.rightValue}</div>
                        </div>
                        {row.delta ? <div className="mt-1">Delta: {row.delta}</div> : null}
                        {row.note ? <div className="mt-1">Note: {row.note}</div> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </details>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function CitationDensityTargetSelector({
  value,
  onChange,
  selectedSourceDocumentId,
  onSelectedSourceDocumentIdChange,
  candidates,
}: {
  value: CitationDensityTargetEstimate;
  onChange: (target: CitationDensityTargetEstimate) => void;
  selectedSourceDocumentId: string;
  onSelectedSourceDocumentIdChange: (documentId: string) => void;
  candidates: CitationDensityEstimateCandidate[];
}) {
  const selectedCandidate = selectedSourceDocumentId
    ? candidates.find((candidate) => candidate.documentId === selectedSourceDocumentId)
    : null;
  const selectedValue = selectedCandidate ? `candidate:${selectedCandidate.documentId}` : value;

  return (
    <label className="grid gap-2 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
      <span>
        <span className="font-semibold text-foreground">Citation Density target</span>
        <span className="mt-0.5 block leading-5">
          Used for Delta Citation Density and OEM Citation Density exports.
        </span>
      </span>
      <select
        value={selectedValue}
        onChange={(event) => {
          const nextValue = event.target.value;
          if (nextValue.startsWith("candidate:")) {
            const documentId = nextValue.slice("candidate:".length);
            const candidate = candidates.find((item) => item.documentId === documentId);
            onSelectedSourceDocumentIdChange(documentId);
            onChange(candidate?.estimateRole === "shop" ? "shop" : "carrier");
            return;
          }
          onSelectedSourceDocumentIdChange("");
          onChange(nextValue as CitationDensityTargetEstimate);
        }}
        className="min-h-8 w-full rounded-md border border-border bg-background px-2 py-1 text-xs font-semibold text-foreground outline-none transition focus:ring-2 focus:ring-ring/25"
        aria-label="Citation Density target estimate"
      >
        <option value="auto">Auto</option>
        {candidates
          .filter((candidate) => candidate.estimateRole === "carrier")
          .map((candidate) => (
            <option key={candidate.documentId} value={`candidate:${candidate.documentId}`}>
              {`Carrier estimate - ${candidate.filename}`}
            </option>
          ))}
        {candidates
          .filter((candidate) => candidate.estimateRole === "shop")
          .map((candidate) => (
            <option key={candidate.documentId} value={`candidate:${candidate.documentId}`}>
              {`Shop estimate - ${candidate.filename}`}
            </option>
          ))}
        {candidates
          .filter((candidate) => candidate.estimateRole === "unknown")
          .map((candidate) => (
            <option key={candidate.documentId} value={`candidate:${candidate.documentId}`}>
              {`Selected estimate - ${candidate.filename}`}
            </option>
          ))}
        <option value="both">Both</option>
      </select>
    </label>
  );
}

function buildCitationDensityFindingPrompt(annotation: CitationDensityAnnotationMetadata) {
  const sourceEstimate = annotation.sourceDocumentRole === "both"
    ? "both estimates"
    : `${annotation.sourceDocumentRole ?? "carrier"} estimate`;
  const lineLabel = annotation.targetLineNumber ?? annotation.estimateLine;
  return [
    `Explain Citation Density finding #${annotation.findingId} for ${sourceEstimate}, page ${annotation.pageNumber}, line ${lineLabel}. Explain what supports it, what proof is missing, why it matters, and what would strengthen or weaken it.`,
    "",
    `Marker: ${annotation.markerNumber}`,
    `Finding id: ${annotation.findingId}`,
    annotation.sourceDocumentId ? `Source document id: ${annotation.sourceDocumentId}` : "",
    annotation.sourceDocumentRole ? `Source estimate: ${annotation.sourceDocumentRole}` : "",
    `Page: ${annotation.pageNumber}`,
    annotation.targetLineNumber ? `Estimate line: ${annotation.targetLineNumber}` : `Estimate line: ${annotation.estimateLine}`,
    annotation.targetSection ? `Target section: ${annotation.targetSection}` : "",
    annotation.targetRawText ? `Target text: ${annotation.targetRawText}` : "",
    annotation.targetNormalizedText ? `Normalized target text: ${annotation.targetNormalizedText}` : "",
    `Label: ${annotation.label}`,
    `Best authority: ${annotation.bestAuthority}`,
    `Authority status: ${annotation.authorityStatus}`,
    `Missing proof: ${annotation.missingProof}`,
    annotation.whyItMatters ? `Why it matters: ${annotation.whyItMatters}` : "",
    `Next action: ${annotation.nextAction}`,
    annotation.sourceRefs.length ? `Source refs: ${annotation.sourceRefs.join("; ")}` : "Source refs: none listed",
  ].filter(Boolean).join("\n");
}

function isCitationDensityAnnotationMetadata(value: unknown): value is CitationDensityAnnotationMetadata {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<CitationDensityAnnotationMetadata>;
  return (
    typeof record.findingId === "string" &&
    typeof record.markerNumber === "number" &&
    typeof record.pageNumber === "number" &&
    typeof record.x === "number" &&
    typeof record.y === "number" &&
    typeof record.width === "number" &&
    typeof record.height === "number" &&
    typeof record.label === "string" &&
    typeof record.shortTitle === "string" &&
    typeof record.estimateLine === "string" &&
    typeof record.bestAuthority === "string" &&
    typeof record.authorityStatus === "string" &&
    typeof record.missingProof === "string" &&
    typeof record.nextAction === "string" &&
    Array.isArray(record.sourceRefs) &&
    record.sourceRefs.every((sourceRef) => typeof sourceRef === "string") &&
    typeof record.comment === "string"
  );
}

function extractJurisdictionFromSnapshot(snapshot: ExportResearchSnapshot | null): string | undefined {
  if (!snapshot) {
    return undefined;
  }

  const jurisdiction =
    snapshot.sourcesAccepted.find((source) => Boolean(source.jurisdiction?.trim()))?.jurisdiction ||
    snapshot.sourcesReviewed.find((source) => Boolean(source.jurisdiction?.trim()))?.jurisdiction;

  return jurisdiction?.trim() || undefined;
}

function buildReportUploadedDocuments(report: RepairIntelligenceReport | null): Array<{
  id?: string;
  filename?: string;
  kind?:
    | "estimate"
    | "policy"
    | "photo"
    | "invoice"
    | "scan"
    | "calibration"
    | "repair_order"
    | "unknown";
  text?: string;
}> {
  const registryDocuments = (report?.evidenceRegistry ?? []).map((doc) => ({
    id: doc.id,
    filename: doc.label,
    kind: mapEvidenceSourceTypeToDocumentKind(doc.sourceType),
    text: [doc.extractedText, doc.extractedSummary].filter(Boolean).join("\n").trim() || undefined,
  }));

  if (registryDocuments.length > 0) {
    return registryDocuments;
  }

  return (report?.evidence ?? []).map((doc) => ({
    id: doc.id,
    filename: doc.title,
    kind: mapEvidenceTextToDocumentKind(`${doc.title}\n${doc.snippet}\n${doc.source}`),
    text: doc.snippet,
  }));
}

function mapEvidenceSourceTypeToDocumentKind(sourceType: string):
  | "estimate"
  | "policy"
  | "photo"
  | "invoice"
  | "scan"
  | "calibration"
  | "repair_order"
  | "unknown" {
  if (sourceType === "shop_estimate" || sourceType === "carrier_estimate" || sourceType === "supplement") {
    return "estimate";
  }
  if (sourceType === "policy_document") {
    return "policy";
  }
  if (sourceType === "photo") {
    return "photo";
  }
  if (sourceType === "invoice" || sourceType === "sublet_document") {
    return "invoice";
  }
  if (sourceType === "scan_report" || sourceType === "adas_report") {
    return "scan";
  }
  if (sourceType === "calibration_report") {
    return "calibration";
  }
  if (sourceType === "repair_order") {
    return "repair_order";
  }

  return "unknown";
}

function mapEvidenceTextToDocumentKind(value: string):
  | "estimate"
  | "policy"
  | "photo"
  | "invoice"
  | "scan"
  | "calibration"
  | "repair_order"
  | "unknown" {
  const text = value.toLowerCase();
  if (/(estimate|mitchell|ccc|audatex|supplement)/.test(text)) return "estimate";
  if (/(policy|coverage|declarations|insured)/.test(text)) return "policy";
  if (/(photo|image|visible damage)/.test(text)) return "photo";
  if (/(invoice|receipt|sublet)/.test(text)) return "invoice";
  if (/(scan|diagnostic|pre[- ]scan|post[- ]scan|adas)/.test(text)) return "scan";
  if (/(calibration|recalibration)/.test(text)) return "calibration";
  if (/(repair order|ro\b|work order)/.test(text)) return "repair_order";
  return "unknown";
}

function mapReportKindToAnnotationMode(
  reportType: ReportKind
):
  | "annotated_estimate_review"
  | "estimator_change_request_list"
  | null {
  switch (reportType) {
    case "estimate_scrubber":
      return "annotated_estimate_review";
    case "estimator_change_request_list":
      return "estimator_change_request_list";
    default:
      return null;
  }
}

function buildAnnotatedPromptCaseContext(
  input: {
    renderModel: ReturnType<typeof buildExportModel>;
    report: RepairIntelligenceReport | null;
    analysis: AnalysisResult | null;
    assistantAnalysis: string;
  },
  model: AnnotatedEstimateReviewModel
): string {
  return compactTextLines([
    `Vehicle: ${model.vehicleIdentity}`,
    `VIN: ${model.vin}`,
    model.insurer ? `Insurer: ${model.insurer}` : null,
    `Repair position: ${input.renderModel.repairPosition}`,
    `Current position statement: ${input.renderModel.positionStatement}`,
    input.analysis?.narrative ? `Analysis narrative: ${input.analysis.narrative}` : null,
    input.report?.summary ? `Risk: ${input.report.summary.riskScore}; Confidence: ${input.report.summary.confidence}` : null,
    input.assistantAnalysis ? `Assistant analysis: ${input.assistantAnalysis}` : null,
  ]);
}

function buildAnnotatedPromptUploadedDocuments(input: {
  renderModel: ReturnType<typeof buildExportModel>;
  report: RepairIntelligenceReport | null;
}): string {
  return compactTextLines([
    ...input.renderModel.reportFields.documentedProcedures.map((item) => `Documented procedure: ${item}`),
    ...input.renderModel.reportFields.documentedHighlights.map((item) => `Documented highlight: ${item}`),
    ...(input.report?.evidence ?? []).slice(0, 10).map((item) =>
      `Evidence: ${item.title ?? "Untitled"} - ${item.snippet ?? item.source ?? ""}`
    ),
  ]);
}

function buildAnnotatedPromptCarrierEstimateText(
  input: { analysis: AnalysisResult | null },
  model: AnnotatedEstimateReviewModel
): string {
  return compactTextLines([
    input.analysis?.rawEstimateText ?? null,
    ...model.lineAnchors
      .filter((anchor) => anchor.sourceRole !== "shop")
      .map((anchor) => `${anchor.lineId}: ${anchor.text}`),
  ]);
}

function buildAnnotatedPromptShopEstimateText(model: AnnotatedEstimateReviewModel): string {
  return compactTextLines([
    ...model.lineAnchors
      .filter((anchor) => anchor.sourceRole === "shop")
      .map((anchor) => `${anchor.lineId}: ${anchor.text}`),
    ...model.comparisonRows.map((row) =>
      row.lhsValue ? `${row.lhsSource ?? "Shop"} ${row.operation ?? row.partName ?? "line"}: ${row.lhsValue}` : null
    ),
  ]);
}

function buildAnnotatedPromptScrubberFindings(model: AnnotatedEstimateReviewModel): string {
  return compactTextLines(
    model.annotations.map((annotation) =>
      [
        `${annotation.title}`,
        `The selected estimate anchor is ${annotation.lineId ?? annotation.section ?? "the related estimate section"} and the annotation category is ${annotation.category}.`,
        `${annotation.explanation}`,
        `Support posture: ${annotation.supportStatus}.`,
        `Estimator request: ${annotation.estimatorText}`,
        annotation.carrierLine ? `Carrier line: ${annotation.carrierLine}` : null,
        annotation.shopLine ? `Shop line: ${annotation.shopLine}` : null,
        annotation.difference ? `Difference: ${annotation.difference}` : null,
      ].filter(Boolean).join("\n")
    )
  );
}

function compactTextLines(values: Array<string | null | undefined>): string {
  return values
    .filter((value): value is string => Boolean(value && value.trim()))
    .join("\n")
    .slice(0, 24000);
}

function buildUserProvidedContextForReports(value: string): string {
  const cleaned = value.trim();
  if (!cleaned) return "";
  return [
    "User-Provided Chat Context",
    "This context may identify reported conduct, timeline details, policy questions, or appraisal posture. It is not verified document evidence unless supported by uploaded emails, letters, claim notes, policy pages, or written insurer positions.",
    cleaned,
  ].join("\n\n");
}

function getDefaultReportSubject(reportType: ReportKind): string {
  switch (reportType) {
    case "snapshot":
      return "[Collision IQ] Your Vehicle Snapshot Report";
    case "repair_intelligence":
      return "[Collision IQ] Repair Intelligence Report";
    case "estimate_scrubber":
      return "[Collision IQ] Delta Citation Density Report";
    case "estimator_change_request_list":
      return "[Collision IQ] Estimate Delta / Change Requests";
    case "oem_citation_density":
      return "[Collision IQ] OEM Citation Density Report";
    case "policy_rights_review":
      return "[Collision IQ] Policy & Rights Review";
    case "doi_complaint_packet":
      return "[Collision IQ] DOI Complaint Packet";
    case "customer_report":
      return "[Collision IQ] Customer Repair Summary";
  }
}

function getDefaultReportFilename(reportType: ReportKind): string {
  switch (reportType) {
    case "snapshot":
      return "collision-snapshot.pdf";
    case "repair_intelligence":
      return "repair-intelligence-report.pdf";
    case "estimate_scrubber":
      return "delta-citation-density-report.pdf";
    case "estimator_change_request_list":
      return "estimate-delta-change-requests.pdf";
    case "oem_citation_density":
      return "oem-citation-density-report.pdf";
    case "policy_rights_review":
      return "policy-rights-review.pdf";
    case "doi_complaint_packet":
      return "doi-complaint-packet.pdf";
    case "customer_report":
      return "customer-report.pdf";
  }
}

function getCitationDensityWorkspaceTitle(reportFlavor: CitationDensityWorkspaceReportFlavor): string {
  return reportFlavor === "oem" ? "OEM Citation Density Report" : "Delta Citation Density Report";
}

function getReportWorkspaceTitle(reportType: ReportKind, document: CarrierReportDocument): string {
  if (document.header.title) return document.header.title;
  switch (reportType) {
    case "repair_intelligence":
      return "Repair Intelligence Report";
    case "customer_report":
      return "Customer Report";
    case "doi_complaint_packet":
      return "DOI Complaint Packet";
    case "snapshot":
      return "Collision Snapshot";
    case "estimator_change_request_list":
      return "Estimator Change Request List";
    case "policy_rights_review":
      return "Policy & Rights Review";
    case "estimate_scrubber":
      return "Delta Citation Density Report";
    case "oem_citation_density":
      return "OEM Citation Density Report";
  }
}

function buildCitationDensityViewerDiagnostics(
  result: AnnotatedEstimateExportResult,
  reportFlavor: CitationDensityWorkspaceReportFlavor
): Record<string, unknown> {
  return {
    ...(result.debugCounts ?? {}),
    reportType: reportFlavor === "oem" ? "oem-citation-density" : "citation-density",
    artifactId: result.artifactId,
    downloadUrl: result.downloadUrl,
    staleArtifactFallbackUsed: result.artifactFallbackUsed === true,
    freshPdfBytesAvailable: Boolean(result.pdfBase64),
    annotatedFindingCount: result.annotatedFindingCount,
    unresolvedAnchorCount: result.unresolvedAnchorCount,
  };
}

function getDefaultReportMessage(
  reportType: ReportKind,
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

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
      <div
        className="fixed inset-0 isolate z-[10010] flex items-center justify-center p-4 sm:p-6"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            onCancel();
          }
        }}
      >
      <div
        className="relative z-[10020] flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] shadow-xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--accent)]">
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
          <button type="button" onClick={onSend} disabled={!sendReady} className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-black hover:bg-[var(--accent)]/90 disabled:cursor-not-allowed disabled:opacity-45">
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
  onStartServiceCase: (serviceKey: AcademyServiceCta["serviceKey"]) => void;
  onSend: () => void;
  onCancelSend: () => void;
}) {
  const safeSnapshot = useMemo(() => sanitizeSnapshotForFinalRender(snapshot), [snapshot]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

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
      <div
        className="fixed inset-0 isolate z-[10010] flex items-center justify-center p-4 sm:p-6"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            onClose();
          }
        }}
      >
      <div
        className="relative z-[10020] flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] shadow-xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--accent)]">
              {safeSnapshot.redactionNotice}
            </div>
            <h2 id="snapshot-preview-title" className="mt-2 text-2xl font-semibold text-foreground">{safeSnapshot.title}</h2>
            <div className="mt-1 text-sm text-muted-foreground">{safeSnapshot.vehicleLabel}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground hover:bg-muted/80 hover:text-foreground">
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 pb-8">
        <div className="grid gap-3 md:grid-cols-2">
          <SnapshotPanel title="File Coverage" items={[
            `Coverage status: ${formatLabel(snapshot.evidenceCompleteness.completenessStatus)}`,
            safeSnapshot.evidenceCompleteness.userFacingDisclosure,
          ]} />
          <SnapshotPanel title="Repair Plan Verdict" items={[
            `More complete plan: ${safeSnapshot.repairPlanVerdict.moreCompletePlan}`,
            `Carrier plan: ${safeSnapshot.repairPlanVerdict.carrierPlanStatus}`,
            safeSnapshot.repairPlanVerdict.reason,
          ]} />
          <SnapshotPanel title="Damage Snapshot" items={safeSnapshot.damageSummary} />
          <SnapshotPanel title="Estimate Comparison" items={
            safeSnapshot.estimateComparison.available
              ? [
                  safeSnapshot.estimateComparison.shopEstimateTotal ? `Shop: ${safeSnapshot.estimateComparison.shopEstimateTotal}` : null,
                  safeSnapshot.estimateComparison.carrierEstimateTotal ? `Carrier: ${safeSnapshot.estimateComparison.carrierEstimateTotal}` : null,
                  safeSnapshot.estimateComparison.difference ? `Difference: ${safeSnapshot.estimateComparison.difference}` : null,
                  ...safeSnapshot.estimateComparison.keyDeltas,
                ].filter((item): item is string => Boolean(item))
              : [safeSnapshot.estimateComparison.unavailableReason ?? "Estimate comparison is unavailable."]
          } />
          <SnapshotPanel
            title="Top 3 Dispute Items"
            items={safeSnapshot.topDisputeItems.map(
              (item, index) => `${index + 1}. ${item.issue}: ${item.evidenceState} Next: ${item.nextAction}`
            )}
          />
          <SnapshotPanel title="File Coverage" items={[
            `Files uploaded: ${safeSnapshot.evidenceCompleteness.uploadedFileCount}`,
            `Upload cap reached: ${safeSnapshot.evidenceCompleteness.uploadLimitReached ? "Yes" : "No"}`,
            `More files indicated: ${safeSnapshot.evidenceCompleteness.userIndicatedMoreFiles ? "Yes" : "No"}`,
            safeSnapshot.evidenceCompleteness.missingCriticalEvidence.length
              ? `Still worth checking: ${safeSnapshot.evidenceCompleteness.missingCriticalEvidence.join(", ")}`
              : "No critical support item remains not yet located in reviewed files.",
            safeSnapshot.evidenceCompleteness.userFacingDisclosure,
          ]} />
          <SnapshotPanel title="Next Actions" items={safeSnapshot.nextActions.map((item, index) => `${index + 1}. ${item}`)} />
          <SnapshotPanel title="Market Preview" items={
            safeSnapshot.valuationSnapshot.available
              ? [
                  safeSnapshot.valuationSnapshot.acvPreviewRange ? `Market Preview: ${safeSnapshot.valuationSnapshot.acvPreviewRange}` : null,
                  safeSnapshot.valuationSnapshot.dvPreviewRange ? `DV: ${safeSnapshot.valuationSnapshot.dvPreviewRange}` : null,
                  safeSnapshot.valuationSnapshot.disclosure,
                ].filter((item): item is string => Boolean(item))
              : [safeSnapshot.valuationSnapshot.disclosure]
          } />
        </div>

        <div className="mt-5 rounded-2xl border border-[var(--accent)]/24 bg-gradient-to-br from-[var(--accent)]/14 via-[var(--accent)]/08 to-white/[0.02] p-4">
            {(() => {
              const trigger = resolveAcademyServiceTrigger({
                snapshot: safeSnapshot,
                intentText: [
                  safeSnapshot.valuationSnapshot.disclosure,
                  safeSnapshot.topDisputeItems.map((item) => `${item.issue} ${item.whyItMatters}`).join("\n"),
                ].join("\n"),
                valuationLowConfidence:
                  safeSnapshot.valuationSnapshot.confidence?.toLowerCase() === "low" ||
                  safeSnapshot.evidenceCompleteness.adjustedConfidence === "Low",
                appraisalTriggered: false,
              });
              return (
                <div>
                  <div className="text-[10px] uppercase tracking-[0.22em] text-[#E8A27F]">Services</div>
                  <div className="mt-1 text-base font-semibold text-foreground">{trigger.title}</div>
                  <div className="mt-1 text-sm leading-6 text-muted-foreground">Why this is showing: {trigger.reason}</div>
                  <button
                    type="button"
                    onClick={() => onStartServiceCase(trigger.serviceKey)}
                    disabled={serviceCheckoutLoading}
                    className="mt-3 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-black hover:bg-[var(--accent)]/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {serviceCheckoutLoading ? "Opening checkout..." : trigger.button}
                  </button>
                </div>
              );
            })()}
          </div>

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
                <button type="button" onClick={onSend} disabled={!sendReady} className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-black hover:bg-[var(--accent)]/90 disabled:cursor-not-allowed disabled:opacity-45">
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
          <button type="button" onClick={onDownload} className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-black hover:bg-[var(--accent)]/90">
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
  const safeItems = items
    .map((item) => sanitizeUserFacingEvidenceText(toCustomerFacingText(item)))
    .filter(Boolean);

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--muted)] p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{title}</div>
      <div className="mt-2 space-y-1.5 text-[13px] leading-5 text-foreground/75">
        {safeItems.map((item, index) => (
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
  intentText?: string | null;
  estimateCount?: number;
  estimateDispute?: boolean;
  valuationLowConfidence: boolean;
  appraisalTriggered: boolean;
}): AcademyServiceCta {
  const missingCritical = params.snapshot.evidenceCompleteness.missingCriticalEvidence;
  const missingCalibration =
    missingCritical.some((item) => /calibration|scan|adas/i.test(item)) ||
    params.snapshot.topDisputeItems.some((item) => /calibration|scan|adas/i.test(item.issue));
  const laborDelta = params.snapshot.estimateComparison.keyDeltas.some((item) => /labor/i.test(item));
  const valuationGap =
    params.valuationLowConfidence ||
    /market preview|DV|valuation/i.test(params.snapshot.valuationSnapshot.disclosure) ||
    params.snapshot.topDisputeItems.some((item) => /value|valuation|acv|dv/i.test(item.issue));
  const defaultReason = missingCalibration && laborDelta
    ? "Missing calibration documentation and reduced estimate scope may affect repair completeness."
    : missingCalibration
      ? "Calibration or scan documentation may be incomplete, which can affect repair completeness and verification."
      : laborDelta
        ? "The estimate scope appears reduced in labor-related areas, which may affect repair completeness."
        : params.snapshot.topDisputeItems.length >= 2
          ? "The file shows multiple unresolved estimate gaps that may benefit from assisted claim resolution."
          : "The file has unresolved repair or documentation issues that may benefit from professional review.";
  const intentText = [
    params.intentText,
    params.snapshot.valuationSnapshot.disclosure,
    params.snapshot.valuationSnapshot.acvPreviewRange,
    params.snapshot.valuationSnapshot.dvPreviewRange,
    params.snapshot.topDisputeItems.map((item) => `${item.issue} ${item.whyItMatters}`).join("\n"),
    valuationGap ? "valuation preview low confidence market preview" : "",
    params.appraisalTriggered ? "right to appraisal estimate dispute" : "",
    missingCalibration || laborDelta ? "estimate dispute repair estimate disagreement" : "",
  ].join("\n");

  return selectAcademyServiceCta({
    intentText,
    estimateCount: params.estimateCount,
    estimateDispute: params.estimateDispute || params.appraisalTriggered || missingCalibration || laborDelta,
    defaultReason,
  });
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
  onDocumentReady?: (document: CarrierReportDocument) => void;
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

    const document = createCustomerReportDocument(data.report, {
      renderModel: params.renderModel,
      fileName: data.fileName,
    });
    params.onDocumentReady?.(document);
    void exportCarrierPDF(document);
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

  return createCustomerReportDocument(data.report, {
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
    selectedEstimatePosture: params.renderModel.selectedEstimatePosture,
  };
}

function selectAnnotatedCitationDensitySourcePdf(attachments: AttachmentTrayItem[]) {
  return attachments.find((attachment) => {
    const text = `${attachment.filename}\n${"text" in attachment && typeof attachment.text === "string" ? attachment.text : ""}`.toLowerCase();
    if (!/\.pdf$/i.test(attachment.filename)) return false;
    if (/citation density|gap report|annotation legend|annotated estimate|repair intelligence|policy rights|doi complaint|snapshot/.test(text)) {
      return false;
    }
    if (/contract of repair|work authorization|customer acknowledges repairer has posted labor rates|assignment of proceeds|physical inspection demand|pa motor vehicle physical damage appraiser act|customer signature|\bwork auth\b|\bauth(?:orization)?\.pdf\b|\bcontract\b/.test(text)) {
      return false;
    }
    return /preliminary estimate|estimate of record|supplement of record|supplement summary|estimate totals|total cost of repairs|net cost of repairs|workfile id|ccc one estimating|line\s+oper\s+description\s+part\s+number\s+qty|estimate|supplement|ccc|mitchell|audatex|carrier|insurer|insurance|shop|repair facility|appraisal/.test(text);
  }) ?? null;
}

function buildCitationDensityEstimateCandidates(
  attachments: AttachmentTrayItem[]
): CitationDensityEstimateCandidate[] {
  return attachments
    .filter((attachment) => /\.pdf$/i.test(attachment.filename))
    .map((attachment) => {
      const estimateRole = inferCitationDensityEstimateRole(attachment.filename);
      return {
        documentId: attachment.attachmentId,
        filename: attachment.filename,
        estimateRole,
        classification: "estimate" as const,
        sourcePdfAvailable: true,
      };
    })
    .filter((candidate) => {
      const text = candidate.filename.toLowerCase();
      if (/citation density|gap report|annotation legend|annotated estimate|repair intelligence|policy rights|doi complaint|snapshot/.test(text)) {
        return false;
      }
      if (/contract of repair|work authorization|\bwork auth\b|\bauth(?:orization)?\.pdf\b|\bcontract\b/.test(text)) {
        return false;
      }
      return /estimate|supplement|sor|shop|carrier|insurer|insurance|ccc|mitchell|audatex|appraisal|rta/.test(text);
    });
}

function inferCitationDensityEstimateRole(filename: string): CitationDensityEstimateRole {
  const text = filename.toLowerCase();
  if (/shop|repair facility|body shop|repairer|rta|right to apprais|appraisal|appraiser/.test(text)) return "shop";
  if (/carrier|insur|insurance|sor|supplement of record|estimate of record|geico|state farm|progressive|allstate/.test(text)) return "carrier";
  return "unknown";
}

function resolveCitationDensityEstimateSelection(params: {
  candidates: CitationDensityEstimateCandidate[];
  targetEstimate: CitationDensityTargetEstimate;
  selectedSourceDocumentId: string;
}) {
  const selectedCandidate = params.selectedSourceDocumentId
    ? params.candidates.find((candidate) => candidate.documentId === params.selectedSourceDocumentId) ?? null
    : null;
  const roleCandidate = params.targetEstimate === "carrier" || params.targetEstimate === "shop"
    ? params.candidates.find((candidate) => candidate.estimateRole === params.targetEstimate) ?? null
    : null;
  const fallbackCandidate = params.targetEstimate === "auto" || params.targetEstimate === "both"
    ? params.candidates[0] ?? null
    : null;
  const primaryCandidate = selectedCandidate ?? roleCandidate ?? fallbackCandidate;

  return {
    selectedCandidate,
    primaryCandidate,
    selectedSourceDocumentId: selectedCandidate?.documentId ?? roleCandidate?.documentId ?? "",
    selectedEstimateRole: selectedCandidate?.estimateRole ?? roleCandidate?.estimateRole ?? params.targetEstimate,
    selectedSourceFilename: selectedCandidate?.filename ?? roleCandidate?.filename ?? "",
  };
}

function buildCitationDensitySelectionPayload(selection: ReturnType<typeof resolveCitationDensityEstimateSelection>) {
  const sourceDocumentId = selection.selectedSourceDocumentId;
  const selectedEstimateRole =
    selection.selectedEstimateRole === "carrier" || selection.selectedEstimateRole === "shop"
      ? selection.selectedEstimateRole
      : undefined;

  return {
    sourceDocumentId: sourceDocumentId || undefined,
    selectedSourceDocumentId: sourceDocumentId || undefined,
    selectedEstimateRole,
    sourceFilename: selection.selectedSourceFilename || undefined,
  };
}

function buildCitationDensitySelectionError(
  candidates: CitationDensityEstimateCandidate[],
  selectedSourceDocumentId: string
) {
  if (candidates.length === 0) {
    return "No estimate PDFs were found for Citation Density.";
  }
  if (selectedSourceDocumentId && !candidates.some((candidate) => candidate.documentId === selectedSourceDocumentId)) {
    return `The selected estimate could not be found. Available estimate candidates: ${candidates.map((candidate) => candidate.filename).join(", ")}.`;
  }
  return "Choose a carrier or shop estimate before generating Citation Density.";
}

function formatAnnotatedExportError(
  data: {
    userMessage?: string;
    error?: string;
    debugCounts?: unknown;
    rejectedSourceCandidates?: unknown;
    acceptedEstimateCandidates?: unknown;
  } | null,
  fallback: string
) {
  const base = data?.userMessage || data?.error || fallback;
  const diagnostics = [
    formatCandidateDiagnostics("Rejected", data?.rejectedSourceCandidates),
    formatCandidateDiagnostics("Accepted", data?.acceptedEstimateCandidates),
    formatDebugCounts(data?.debugCounts),
  ].filter(Boolean).join(" ");
  return diagnostics ? `${base} ${diagnostics}` : base;
}

function formatCandidateDiagnostics(label: string, value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return "";
  const summary = value
    .slice(0, 3)
    .map((candidate) => {
      if (!candidate || typeof candidate !== "object") return "";
      const record = candidate as Record<string, unknown>;
      return [
        typeof record.filename === "string" ? record.filename : "unknown file",
        typeof record.detectedDocumentType === "string" ? record.detectedDocumentType : "unknown",
        typeof record.reason === "string" ? record.reason : undefined,
      ].filter(Boolean).join(": ");
    })
    .filter(Boolean)
    .join("; ");
  return summary ? `${label}: ${summary}.` : "";
}

function formatDebugCounts(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const fields = [
    typeof record.selectedEstimateFileName === "string" ? `selected=${record.selectedEstimateFileName}` : "",
    typeof record.actualSourcePdfName === "string" ? `actual=${record.actualSourcePdfName}` : "",
    typeof record.selectedDocumentType === "string" ? `type=${record.selectedDocumentType}` : "",
    typeof record.badAnchorRejectedCount === "number" ? `badAnchors=${record.badAnchorRejectedCount}` : "",
    record.findingIdPrefixCheckPassed === false ? "findingPrefix=false" : "",
  ].filter(Boolean);
  return fields.length ? `Diagnostics: ${fields.join(", ")}.` : "";
}

function buildAnnotatedCitationDensityStatus(
  result: Pick<AnnotatedEstimateExportResult, "annotatedFindingCount" | "unresolvedAnchorCount" | "warnings">,
  prefix = "Annotated estimate PDF is ready."
) {
  const warnings = result.warnings.length ? ` Warnings: ${result.warnings.join(" ")}` : "";
  return `${prefix} Annotated findings: ${result.annotatedFindingCount}. Unanchored findings: ${result.unresolvedAnchorCount}.${warnings}`;
}

async function fetchAnnotatedCitationDensityPdfBlob(
  downloadUrl: string,
  fallbackPdfBase64?: string,
  onArtifactUnavailable?: () => void
): Promise<Blob> {
  const response = await fetch(downloadUrl, {
    method: "GET",
    credentials: "same-origin",
  });
  if (!response.ok) {
    if (response.status === 404 && fallbackPdfBase64) {
      onArtifactUnavailable?.();
      return pdfBase64ToBlob(fallbackPdfBase64);
    }
    throw new Error(
      response.status === 404
        ? "This Citation Density export is no longer available. Regenerate the report to refresh the artifact."
        : `Annotated estimate download failed (${response.status}).`
    );
  }
  return await response.blob();
}

function pdfBase64ToBlob(value: string): Blob {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: "application/pdf" });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function createCustomerReportDocument(report: CustomerReport, params: {
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
    findingReasoning: params.renderModel.findingReasoning,
    oemContradictions: params.renderModel.oemContradictions,
    selectedEstimatePosture: params.renderModel.selectedEstimatePosture,
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
          ? "border-orange-500/25 bg-gradient-to-br from-[var(--accent)]/12 via-[var(--accent)]/[0.05] to-card"
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
  const cleanValue = sanitizeUserFacingEvidenceText(value) || value;

  return (
    <div
      className={`min-w-0 rounded-2xl px-3 py-2.5 shadow-sm ring-1 ring-border/50 ${
        prominent
          ? "bg-gradient-to-br from-[var(--accent)]/18 via-[var(--accent)]/[0.07] to-card"
          : "bg-muted/72"
      }`}
    >
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{label}</div>
      <div className={`mt-1 min-w-0 break-words font-medium text-foreground ${detailClassName || "text-sm"}`}>{cleanValue}</div>
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
        active ? "bg-[var(--accent)]/[0.06] ring-1 ring-inset ring-orange-400/18" : ""
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
    const normalized = sanitizeUserFacingEvidenceText(item)?.replace(/\s+/g, " ").trim();
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function SupportSignalsCard({ items }: { items: string[] }) {
  const cleanItems = items.map((item) => sanitizeUserFacingEvidenceText(item)).filter(Boolean);

  return (
    <section className="mt-5 space-y-2.5 rounded-2xl border border-border bg-card p-3.5">
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Support Signals</div>
      <div className="space-y-2">
        {cleanItems.map((item) => (
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
  const cleanItems = items.map((item) => sanitizeUserFacingEvidenceText(item)).filter(Boolean);

  return (
    <section className="mt-5 space-y-2.5 rounded-2xl border border-border bg-card p-3.5">
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Next Moves</div>
      <div className="space-y-2">
        {cleanItems.map((item, index) => (
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
    <section className="mt-5 space-y-3 rounded-[24px] border border-orange-500/18 bg-gradient-to-br from-[var(--accent)]/10 via-card to-muted p-4 shadow-[0_18px_44px_rgba(198,90,42,0.12)]">
      <div className="text-[10px] uppercase tracking-[0.22em] text-orange-200/72">
        Supported Findings
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
          <div key={`${finding.id ?? finding.issue ?? "finding"}-${index}`} className="rounded-2xl bg-muted px-3.5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold leading-5 text-foreground">
                {finding.priorityRank ?? index + 1}. {cleanWorkspaceDisplayText(finding.issue) || "Finding"}
              </div>
              <div className="rounded-full border border-border bg-card px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {formatLabel(finding.evidenceLevel)}
              </div>
            </div>
            <ReasoningLine label="Finding" value={finding.rationaleSummary ?? finding.why_it_matters} title={finding.issue} />
            <ReasoningLine label="Support" value={finding.evidenceChainSummary ?? finding.what_proves_it} title={finding.issue} />
            <ReasoningLine label="Next step" value={finding.next_action || finding.riskIfOmitted || ""} title={finding.issue} />
            <div className="mt-2 text-[11px] leading-5 text-muted-foreground">
              Review priority {formatLabel(finding.claimSpecificity)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReasoningLine({ label, value, title }: { label: string; value: string; title?: string }) {
  const cleanValue = cleanWorkspaceDisplayText(value, title, label);
  if (!cleanValue) return null;

  return (
    <div className="mt-2 text-[13px] leading-5 text-muted-foreground">
      <span className="font-semibold text-foreground">{label}:</span> {cleanValue}
    </div>
  );
}

function cleanWorkspaceDisplayText(value: string | null | undefined, title?: string, label?: string): string {
  if (label?.toLowerCase() === "support" || label?.toLowerCase() === "evidence") {
    return summarizeUserFacingSupport(value);
  }

  const cleaned = sanitizeUserFacingEvidenceText(toCustomerFacingText(value ?? ""), title);

  if (!cleaned) {
    const normalizedLabel = label?.toLowerCase();
    return normalizedLabel === "support" || normalizedLabel === "evidence"
      ? "Support verified from reviewed file evidence."
      : "";
  }

  return cleaned;
}

function OemContradictionCard({
  contradictions,
}: {
  contradictions: ReturnType<typeof buildExportModel>["oemContradictions"];
}) {
  if (!contradictions.length) return null;

  return (
    <section className="space-y-3 rounded-[24px] border border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        OEM Contradictions
      </div>
      <div className="space-y-3">
        {contradictions.slice(0, 4).map((contradiction, index) => (
          <div key={`${contradiction.affectedOperation}-${index}`} className="rounded-2xl bg-muted px-3.5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold leading-5 text-foreground">
                {cleanWorkspaceDisplayText(contradiction.affectedOperation) || `Procedure review ${index + 1}`}
              </div>
              <div className="rounded-full border border-border bg-card px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {formatLabel(contradiction.contradictionSeverity)}
              </div>
            </div>
            <ReasoningLine label="Finding" value={contradiction.conflictSummary} title={contradiction.affectedOperation} />
            <ReasoningLine
              label="Support"
              value={contradiction.oemSupportCitation ?? "Inferred only; verify OEM support before asserting."}
              title={contradiction.affectedOperation}
            />
            <ReasoningLine label="Next step" value={contradiction.recommendedFollowUp} title={contradiction.affectedOperation} />
            <div className="mt-2 text-[11px] leading-5 text-muted-foreground">
              Support {formatLabel(contradiction.supportStatus)} · Source {formatLabel(contradiction.sourceType)}
            </div>
          </div>
        ))}
      </div>
    </section>
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
              <div className="text-[13px] font-medium leading-5 text-foreground">{sanitizeUserFacingEvidenceText(source.title) || "Supporting source"}</div>
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
        {sanitizeUserFacingEvidenceText(integrity.userFacingDisclosure)}
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
        <div className="rounded-full border border-orange-400/18 bg-[var(--accent)]/10 px-3 py-1 text-[11px] font-semibold text-orange-100/82">
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
  const cleanItems = items.map((item) => sanitizeUserFacingEvidenceText(item)).filter(Boolean);
  if (!cleanItems.length) return null;

  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-2 space-y-1.5">
        {cleanItems.slice(0, 5).map((item, index) => (
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
  const title = cleanWorkspaceDisplayText(driver.title) || "Dispute driver";
  const impact = cleanWorkspaceDisplayText(driver.impact);
  const finding = cleanWorkspaceDisplayText(driver.whyItMatters, driver.title);
  const support = cleanWorkspaceDisplayText(driver.currentFileStatus, driver.title, "Support");
  const nextStep = cleanWorkspaceDisplayText(driver.action, driver.title);
  const className = `rounded-2xl px-3.5 py-3 transition-[border-color,background-color,box-shadow] duration-300 ${
    active
      ? "border border-orange-300/28 bg-[var(--accent)]/12 shadow-[0_0_0_1px_rgba(210,122,81,0.12)]"
      : "border border-border bg-muted"
  }`;

  const content = (
    <>
      <div className="text-sm font-semibold leading-5 text-foreground">
        {index + 1}. {title}
      </div>
      {impact ? (
        <div className="mt-2 text-[13px] leading-5 text-muted-foreground">
          <span className="font-semibold text-foreground">Impact:</span> {impact}
        </div>
      ) : null}
      {finding ? (
        <div className="mt-1 text-[13px] leading-5 text-muted-foreground">
          <span className="font-semibold text-foreground">Finding:</span> {finding}
        </div>
      ) : null}
      {support ? (
        <div className="mt-1 text-[13px] leading-5 text-muted-foreground">
          <span className="font-semibold text-foreground">Support:</span> {support}
        </div>
      ) : null}
      {nextStep ? (
        <div className="mt-1 text-[13px] leading-5 text-muted-foreground">
          <span className="font-semibold text-foreground">Next step:</span> {nextStep}
        </div>
      ) : null}
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
    <section className="mt-5 space-y-3 rounded-[24px] border border-red-500/18 bg-gradient-to-br from-red-500/[0.08] via-[var(--accent)]/[0.05] to-muted p-4 shadow-[0_18px_40px_rgba(0,0,0,0.10)] dark:shadow-[0_18px_40px_rgba(0,0,0,0.18)]">
      <div className="text-[10px] uppercase tracking-[0.22em] text-red-200/72">Decision Card</div>
      <div className="min-w-0 rounded-2xl bg-card/70 px-3.5 py-3">
        <div className="text-sm font-semibold leading-5 text-foreground">
          [Red] {lineStatus.title.toUpperCase()}
        </div>
        <div className="mt-2 break-words text-[13px] leading-5 text-muted-foreground">
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
      ? `Market Preview posture: ${formatLabel(renderModel.valuation.acvStatus)}.`
      : null,
    renderModel.valuation.dvStatus !== "not_determinable"
      ? `DV posture: ${formatLabel(renderModel.valuation.dvStatus)}.`
      : null,
  ]).join(" ");
  const cleanPostureSummary = sanitizeUserFacingEvidenceText(postureSummary);
  const cleanFinancialSignals = financialSignals.map((item) => sanitizeUserFacingEvidenceText(item)).filter(Boolean);

  return (
    <section className="mt-5 space-y-3 rounded-[24px] border border-orange-500/18 bg-gradient-to-br from-[var(--accent)]/10 via-[var(--accent)]/[0.04] to-muted p-4 shadow-[0_18px_44px_rgba(198,90,42,0.12)]">
      <div className="text-[10px] uppercase tracking-[0.22em] text-orange-200/72">
        Financial View
      </div>
      <div className="min-w-0 rounded-2xl bg-card/70 px-3.5 py-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Directional Posture
        </div>
        <div className="mt-2 text-[13px] leading-5 text-muted-foreground">
          {cleanPostureSummary || "The canonical export model does not yet include a reliable valuation posture."}
        </div>
      </div>
      <div className="rounded-2xl bg-card/70 px-3.5 py-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Available Signals
        </div>
        {hasValuationPosture && cleanFinancialSignals.length > 0 ? (
          <div className="mt-2 space-y-2">
            {cleanFinancialSignals.map((item) => (
              <div key={item} className="flex min-w-0 gap-2 text-[13px] leading-5 text-muted-foreground">
                <span className="pt-[1px] text-orange-200/85">&bull;</span>
                <span className="min-w-0 break-words">{item}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 break-words text-[13px] leading-5 text-muted-foreground">
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
              <span>{sanitizeUserFacingEvidenceText(item) || item}</span>
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
  const cleanItems = items.map((item) => sanitizeUserFacingEvidenceText(item)).filter(Boolean);

  return (
    <div className="rounded-2xl bg-muted px-3.5 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{title}</div>
      <div className="mt-2 space-y-2">
        {cleanItems.map((item) => (
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
  const rationale = cleanWorkspaceDisplayText(item.rationale, item.title);
  const evidence = cleanWorkspaceDisplayText(item.evidence, item.title, "Evidence");

  return (
    <section className="rounded-[24px] border border-orange-500/20 bg-gradient-to-br from-[var(--accent)]/12 via-[var(--accent)]/[0.045] to-muted p-4 shadow-[0_18px_44px_rgba(198,90,42,0.14)]">
      <div className="text-[10px] uppercase tracking-[0.22em] text-orange-200/72">Top recommendation</div>
      <div className="mt-2 text-[1.08rem] font-semibold leading-6 text-foreground">{displayOperationLabel(item.title)}</div>
      <div className="mt-2 text-xs text-muted-foreground">
        {formatLabel(item.category)} · {formatLabel(item.kind)} · Priority {formatLabel(item.priority)}
      </div>
      {rationale ? (
        <div className="mt-3 text-sm leading-6 text-muted-foreground">{rationale}</div>
      ) : null}
      {evidence ? (
        <div className="mt-3 text-xs leading-5 text-muted-foreground">Evidence: {evidence}</div>
      ) : null}
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
  const cleanBody = sanitizeUserFacingEvidenceText(body) || body;

  return (
    <section className="space-y-2.5 rounded-2xl border border-orange-500/16 bg-gradient-to-br from-[var(--accent)]/9 via-muted to-card p-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[10px] uppercase tracking-[0.22em] text-orange-200/68">{title}</div>
          <Link
            href="/billing"
            className="rounded-full border border-orange-500/24 bg-orange-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--accent)] transition hover:bg-orange-500/18 dark:text-orange-100"
          >
            Upgrade Access
          </Link>
        </div>
      <div className="text-[13px] leading-5 text-muted-foreground">{cleanBody}</div>
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

  const cleanBody = sanitizeUserFacingEvidenceText(body) || body;

  return (
    <section
      className={`space-y-2.5 rounded-2xl border p-3.5 ${tones[tone]}`}>
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{title}</div>
      <div
        className={`whitespace-pre-wrap ${
          compact ? "text-[13px] leading-5 text-muted-foreground" : featured ? "text-sm leading-6 text-muted-foreground" : "text-sm leading-6 text-muted-foreground"
        } ${mono ? "font-mono text-[12px]" : ""}`}
      >
        {cleanBody}
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
  const cleanBody = sanitizeUserFacingEvidenceText(body) || body;

  return (
    <section className={`space-y-2.5 rounded-2xl border p-3.5 ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{title}</div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="text-[11px] font-medium uppercase tracking-[0.16em] text-orange-200/80 hover:text-orange-100"
        >
          {expanded ? "Hide" : "Expand"}
        </button>
      </div>
      <div className="relative">
        <div
          className={`text-[13px] leading-5 text-muted-foreground whitespace-pre-wrap ${mono ? "font-mono text-[12px]" : ""} ${
            expanded ? "" : `overflow-hidden ${previewHeightClass}`
          }`}
        >
          {cleanBody}
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
    "Market preview",
    buildSingleValuationDisplay({
      label: "Market preview band",
      status: renderModel.valuation.acvStatus,
      value:
        renderModel.valuation.acvStatus === "provided" || renderModel.valuation.acvSourceType === "comps"
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
      sourceType?: "comps" | "jd_power" | "guide_blend" | "fallback" | "unavailable";
  compCount?: number;
  includeHandoffHint?: boolean;
}): string {
  const lines: string[] = [];

  if (params.status === "provided" && typeof params.value === "number") {
    lines.push(`${params.label}: directional preview around ${formatCurrency(params.value)}`);
  } else if (params.status === "estimated_range" && hasSaneRange(params.range, params.maxRange)) {
    if (params.sourceType === "comps" && typeof params.value === "number" && (params.compCount ?? 0) >= 2) {
      lines.push(`Market Preview median: ${formatCurrency(params.value)}`);
    }
    lines.push(`${params.label}: ${formatCurrency(params.range.low)}-${formatCurrency(params.range.high)}`);
  } else {
    lines.push(`${params.label}: Preview band not supportable from the current file set.`);
  }

  if (params.confidence) {
    lines.push(`Preview confidence: ${formatLabel(params.confidence)}`);
  }

  if (params.sourceType === "comps" && typeof params.compCount === "number" && params.compCount > 0) {
    lines.push(`Support: ${params.compCount} comparable listing${params.compCount === 1 ? "" : "s"}`);
  } else if (params.sourceType === "guide_blend") {
    lines.push(`Support: guide/book anchor plus ${params.compCount ?? 0} comparable listing${params.compCount === 1 ? "" : "s"}`);
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
    lines.push("Directional only. This preview is not a formal appraisal, binding actual cash value conclusion, or paid valuation result.");
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
            className="inline-flex items-center justify-center rounded-xl bg-[var(--accent)] px-3 py-2 text-[11px] font-semibold text-black transition hover:bg-[var(--accent)]/90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {checkoutLoading ? "Opening checkout..." : "Start Market Preview Checkout"}
          </button>
        ) : null}
        {hasDiminishedValueService ? (
          <Link
            href="/the-academy"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center rounded-xl border border-border bg-background px-3 py-2 text-[11px] font-semibold text-foreground transition hover:border-[var(--accent)]/35 hover:bg-muted sm:w-auto"
          >
            View Diminished Value Services
          </Link>
        ) : null}
        {!hasAcvService && !hasDiminishedValueService ? (
          <Link
            href="/the-academy"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center rounded-xl border border-border bg-background px-3 py-2 text-[11px] font-semibold text-foreground transition hover:border-[var(--accent)]/35 hover:bg-muted sm:w-auto"
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
