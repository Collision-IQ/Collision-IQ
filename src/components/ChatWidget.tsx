"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import {
  Paperclip,
  X,
  Camera,
  ChevronDown,
  ChevronUp,
  Eye,
  RefreshCcw,
  Volume2,
  Square,
  Mic,
  LoaderCircle,
  Pause,
  Play,
  StopCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { DecisionPanel } from "@/lib/ai/builders/buildDecisionPanel";
import type { RepairIntelligenceReport } from "@/lib/ai/types/analysis";
import type { AccountEntitlements } from "@/lib/billing/entitlements";
import { buildWorkspaceDataFromAnalysisText } from "@/lib/workspaceAdapter";
import type { WorkspaceData } from "@/types/workspaceTypes";
import {
  buildAttachmentBatchStatus,
  buildAttachmentSummary,
  formatBytes,
  formatAttachmentKind,
  isLikelyImageFile,
  MAX_UPLOAD_FILE_BYTES,
  summarizeAttachmentStats,
} from "@/components/chatWidget/attachmentUtils";
import {
  canUseBrowserReadAloud,
  formatAssistantMessage,
  toSpeechText,
} from "@/components/chatWidget/speechUtils";
import {
  buildChatExportPayload,
  buildExportMessages,
  getDownloadFilename,
  hasExportContent,
  resolveExportErrorMessage,
} from "@/components/chatWidget/exportUtils";
import {
  createMessage,
  isSystemStatusMessage,
  type ChatMessage as Message,
} from "@/components/chatWidget/messageUtils";
import AttachmentPreviewModal, {
  type PreviewAttachment,
} from "@/components/AttachmentPreviewModal";
import { redactExternalDocumentUrls } from "@/lib/externalDocuments";
import { buildPlanRecommendationGuard, canAccessFeature } from "@/lib/featureAccess";
import { emitSafeCrmEventFromClient } from "@/lib/crm/events";
import { buildNextBatchPrompt, buildUploadBatchGuidance } from "@/lib/uploadBatching";
import {
  getUploadBatchLimitMessage,
  resolveUploadPlanLimits,
} from "@/lib/uploadSafety/uploadLimits";
import { TTS_STYLE_PROMPT, VOICE_PRESETS } from "@/lib/voicePresets";

interface Attachment {
  attachmentId: string;
  filename: string;
  mime: string;
  text: string;
  sizeBytes: number;
  imageDataUrl?: string;
  previewUrl?: string;
  pageCount?: number;
  source: "file" | "camera";
  uploadSource?: "direct_upload" | "zip_extraction";
  sourceArchive?: string;
  classification?: "image" | "pdf" | "text" | "docx";
  hasVision: boolean;
  usedInAnalysis?: boolean;
}

type AttachmentTrayItem = {
  attachmentId: string;
  filename: string;
  hasVision?: boolean;
};

type UploadFailureResult = {
  filename?: string;
  reason?: string;
  code?: string;
};

type UploadSuccessResult = {
  attachmentId?: string;
  filename?: string;
  type?: string;
  sizeBytes?: number;
  source?: "direct_upload" | "zip_extraction";
  sourceArchive?: string;
  classification?: "image" | "pdf" | "text" | "docx";
  text?: string;
  imageDataUrl?: string;
  pageCount?: number;
  hasVision?: boolean;
  caseContinuity?: {
    activeCaseId?: string;
    sameCaseFollowUp?: boolean;
  };
};

type UploadResponse = UploadSuccessResult & {
  successfulUploads?: UploadSuccessResult[];
  failedUploads?: UploadFailureResult[];
  zipSummaries?: Array<{
    archive?: string;
    acceptedFiles?: number;
    rejectedFiles?: number;
    extractedBytes?: number;
  }>;
  error?: string;
};

type PrimaryAnalysis = {
  messageId: string;
  content: string;
};

type AnalysisStatus = "idle" | "processing" | "complete" | "error";

type ChatSessionControls = {
  focusComposer: () => void;
  resetSession: () => void;
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

interface ChatWidgetProps {
  onUserPromptSent?: () => void;
  onAttachmentChange?: (filename: string | null) => void;
  onAttachmentsChange?: Dispatch<SetStateAction<AttachmentTrayItem[]>>;
  onAnalysisChange?: (text: string) => void;
  onPrimaryAnalysisChange?: (analysis: PrimaryAnalysis | null) => void;
  onAnalysisReportIdChange?: (reportId: string | null) => void;
  onAnalysisResultChange?: (data: RepairIntelligenceReport | null) => void;
  onLinkedEvidenceChange?: (items: LinkedEvidenceDebugItem[]) => void;
  onAnalysisPanelChange?: (panel: DecisionPanel | null) => void;
  onAnalysisLoadingChange?: (loading: boolean) => void;
  onAnalysisStatusChange?: (status: AnalysisStatus, detail?: string | null) => void;
  onWorkspaceDataChange?: (data: WorkspaceData | null) => void;
  onSessionReset?: () => void;
  onChatEngagement?: () => void;
  onCaseUploadComplete?: () => void;
  onSessionControlsReady?: (controls: ChatSessionControls) => void;
  onCaseIntentChange?: (value: string) => void;
  viewerAccess?: AccountEntitlements | null;
  suppressedMessageIds?: string[];
  caseChatEnabled?: boolean;
  activeCaseId?: string | null;
  caseIntent?: string;
  transcriptSummary?: string | null;
  exportModel?: unknown;
  followUpFiles?: Array<{ id: string; name: string; type?: string; url?: string }>;
  followUpExports?: Array<{ label: string; type?: string; url?: string }>;
  disabled?: boolean;
}

const OPENING_DISCLAIMER =
  "Before we get rolling: I'm here to help analyze estimates, procedures, photos, documents, and negotiation support using the information available in the file and knowledge base. I'm not a lawyer, I'm not an engineer, and I can't give legal or engineering advice. You're responsible for reviewing the output and making final decisions. Think of me as your repair-intelligence copilot with a sharp brain and a deep library — not the final signer on the dotted line.";

const INITIAL_MESSAGE: Message = {
  id: "assistant-initial",
  role: "assistant",
  kind: "analysis",
  content:
    "Hi there - upload an estimate, OEM procedure, or photo and I'll produce a structured repair analysis.",
};

const SERVER_TTS_ENABLED =
  process.env.NEXT_PUBLIC_COLLISION_IQ_ENABLE_SERVER_TTS === "true";
const BROWSER_TTS_ENABLED =
  process.env.NEXT_PUBLIC_COLLISION_IQ_ENABLE_BROWSER_TTS === "true";
const SERVER_TTS_VOICE = process.env.NEXT_PUBLIC_COLLISION_IQ_TTS_VOICE?.trim() || undefined;
const LARGE_UPLOAD_WARNING_BYTES = 10 * 1024 * 1024;

const DEFAULT_UPLOAD_LIMIT_ENTITLEMENTS: Pick<
  AccountEntitlements,
  "plan" | "billingPlan" | "isPlatformAdmin" | "entitlementSource"
> = {
  plan: "pro",
  billingPlan: "pro",
  isPlatformAdmin: false,
  entitlementSource: "paid_subscription",
};

function formatCaseUpdateStatus(
  delta: RepairIntelligenceReport["reassessmentDelta"] | undefined,
  policy: RepairIntelligenceReport["artifactRefreshPolicy"] | undefined
) {
  if (policy?.chatSummaryOnly.shouldRefresh) {
    return `Case reassessment complete. ${policy.chatSummaryOnly.reason}`;
  }

  if (!delta) {
    return "Case reassessment complete. This is an update to the current case.";
  }

  if (delta.addedEvidenceIds.length === 0 && delta.statusChanges.length === 0) {
    return "Case reassessment complete. The new evidence does not materially change the current review.";
  }

  const parts = [
    `Case reassessment complete: ${delta.addedEvidenceIds.length} evidence item(s) added`,
    `${delta.statusChanges.length} issue status change(s)`,
  ];

  if (delta.newlyDocumented.length > 0) {
    parts.push(`${delta.newlyDocumented.length} newly documented`);
  }

  if (!delta.determinationChanged) {
    parts.push("overall determination unchanged");
  }

  if (policy) {
    const recommended = [
      policy.mainReport.shouldRefresh ? "main report" : "",
      policy.customerReport.shouldRefresh ? "customer report" : "",
      policy.disputeReport.shouldRefresh ? "dispute report" : "",
      policy.rebuttalOutput.shouldRefresh ? "rebuttal" : "",
    ].filter(Boolean);

    if (recommended.length > 0) {
      parts.push(`refresh recommended: ${recommended.join(", ")}`);
    }
  }

  return `${parts.join(", ")}.`;
}

const DEFAULT_CASE_TOPIC = "general case summary";

function isAttachmentSummaryMessage(value: string) {
  return /^uploaded\s+\d+\s+file/i.test(value.trim());
}

function buildUploadFailureStatus(failures: UploadFailureResult[]) {
  const namedFailures = failures.filter((failure) => failure.filename);

  if (!namedFailures.length) {
    return "No files could be attached.";
  }

  return `Could not attach ${namedFailures
    .map((failure) => {
      if (failure.code === "RUNTIME_BODY_LIMIT_EXCEEDED") {
        return `${failure.filename}: This file is within your plan limit, but exceeds the current platform upload limit. Direct large-file upload support is coming soon. For now, split ZIPs over 20 MB into smaller uploads.`;
      }

      return `${failure.filename}: ${failure.reason ?? "Upload failed."}`;
    })
    .join("; ")}`;
}

function buildZipExtractionStatus(summaries: NonNullable<UploadResponse["zipSummaries"]>) {
  return summaries
    .filter((summary) => summary.archive)
    .map((summary) => {
      const accepted = summary.acceptedFiles ?? 0;
      const rejected = summary.rejectedFiles ?? 0;
      const size = formatBytes(summary.extractedBytes ?? 0);
      return `${summary.archive}: extracted ${accepted} supported ${accepted === 1 ? "file" : "files"} (${size})${rejected ? `; rejected ${rejected}` : ""}.`;
    })
    .join(" ");
}

function isZipFile(file: Pick<File, "name" | "type">) {
  return (
    file.name.toLowerCase().endsWith(".zip") ||
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed"
  );
}

function buildLargeUploadWarning(files: File[]) {
  const largeFiles = files.filter((file) => file.size >= LARGE_UPLOAD_WARNING_BYTES);
  if (!largeFiles.length) return null;

  return `Large files may take longer. Keep this tab open. ${largeFiles
    .map((file) => `${file.name} (${formatBytes(file.size)})`)
    .join(", ")}`;
}

function buildZipProgressStatus(files: File[]) {
  const zipCount = files.filter(isZipFile).length;
  if (!zipCount) return null;

  return `Uploading ${zipCount} ZIP ${zipCount === 1 ? "archive" : "archives"}. ZIP extraction will run before analysis.`;
}

function buildUploadCompletionStatus(successCount: number, failures: UploadFailureResult[]) {
  if (!failures.length) {
    return null;
  }

  const failureMessage = buildUploadFailureStatus(failures);
  if (successCount <= 0) {
    return failureMessage;
  }

  return `${successCount} ${successCount === 1 ? "file" : "files"} attached. ${failureMessage}`;
}

function resolveCaseTopic(message: string, previousTopic: string) {
  const normalized = message.trim();
  const lower = normalized.toLowerCase();

  if (!normalized || isAttachmentSummaryMessage(normalized)) {
    return previousTopic || DEFAULT_CASE_TOPIC;
  }

  if (/(position statement|oem statement|oem position|position statements|oem support)/i.test(lower)) {
    return "OEM position statements";
  }
  if (/(calibration|calibrate|aiming|initialization|adas|sensor|camera|radar|lidar)/i.test(lower)) {
    return "calibration requirements";
  }
  if (/(structural|measure|measurement|dimension|geometry|frame|unibody|mounting)/i.test(lower)) {
    return "structural verification";
  }
  if (/(corrosion|cavity|seam sealer|rust|anti-corrosion)/i.test(lower)) {
    return "corrosion protection";
  }
  if (/(valuation|value|acv|total loss|market|comparable|comps)/i.test(lower)) {
    return "valuation";
  }
  if (/(rebuttal|carrier|insurer|email|negotia|pushback|ask for|request revision)/i.test(lower)) {
    return "rebuttal strategy";
  }
  if (/(customer report|customer-facing|layman|owner explanation|plain language)/i.test(lower)) {
    return "customer explanation";
  }
  if (/(complete|completeness|included|missing|scope|repair plan|repair path)/i.test(lower)) {
    return "repair completeness";
  }
  if (/(hidden damage|supplement|teardown|bracket|support|absorber|mount|connector invoice|invoice enough)/i.test(lower)) {
    return "hidden damage concerns";
  }
  if (/(scan|pre-scan|post-scan|diagnostic|dtc|codes)/i.test(lower)) {
    return "scan documentation";
  }
  if (/(summary|recap|where do we stand|overall|whole case|full review|case posture)/i.test(lower)) {
    return DEFAULT_CASE_TOPIC;
  }

  return previousTopic || DEFAULT_CASE_TOPIC;
}

export default function ChatWidget({
  onUserPromptSent,
  onAttachmentChange,
  onAttachmentsChange,
  onAnalysisChange,
  onPrimaryAnalysisChange,
  onAnalysisReportIdChange,
  onAnalysisResultChange,
  onLinkedEvidenceChange,
  onAnalysisPanelChange,
  onAnalysisLoadingChange,
  onAnalysisStatusChange,
  onWorkspaceDataChange,
  onSessionReset,
  onChatEngagement,
  onCaseUploadComplete,
  onSessionControlsReady,
  onCaseIntentChange,
  viewerAccess = null,
  caseChatEnabled = false,
  activeCaseId = null,
  caseIntent = "Continue with this case",
  disabled = false,
}: ChatWidgetProps) {
  const router = useRouter();
  const { isLoaded: isUserLoaded, isSignedIn } = useUser();
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isExportingChat, setIsExportingChat] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentsOpen, setAttachmentsOpen] = useState(true);
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null);
  const [replaceAttachmentId, setReplaceAttachmentId] = useState<string | null>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSpeechPaused, setIsSpeechPaused] = useState(false);
  const [ttsVoiceName, setTtsVoiceName] = useState<string | null>(null);
  const [ttsPresetId, setTtsPresetId] = useState<string>("default");
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [totalFilesReviewed, setTotalFilesReviewed] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [showOpeningDisclaimer, setShowOpeningDisclaimer] = useState(true);
  const [openingDisclaimerDismissed, setOpeningDisclaimerDismissed] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<number>(0);
  const analysisRunRef = useRef<number>(0);
  const analysisReportIdRef = useRef<string | null>(null);
  const analysisTextRef = useRef("");
  const workspaceDataRef = useRef<WorkspaceData | null>(null);
  const attachmentsRef = useRef<Attachment[]>([]);
  const firstAttachmentAtRef = useRef<number | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messageCounterRef = useRef(0);
  const activeSystemStatusMessageIdRef = useRef<string | null>(null);
  const currentCaseTopicRef = useRef(DEFAULT_CASE_TOPIC);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const recordingMimeTypeRef = useRef("audio/webm");

  const hasAnyAttachment = useMemo(() => attachments.length > 0, [attachments]);
  const isLikelyMobileCaptureDevice = useMemo(() => {
    if (typeof navigator === "undefined") return false;

    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
  }, []);
  const visionAttachmentCount = useMemo(
    () => attachments.filter((attachment) => attachment.hasVision).length,
    [attachments]
  );
  const previewAttachment = useMemo(
    () => attachments.find((attachment) => attachment.attachmentId === previewAttachmentId) ?? null,
    [attachments, previewAttachmentId]
  );
  const previewAttachmentIndex = useMemo(
    () =>
      previewAttachmentId
        ? attachments.findIndex((attachment) => attachment.attachmentId === previewAttachmentId)
        : -1,
    [attachments, previewAttachmentId]
  );
  const effectiveAttachmentsOpen =
    attachments.length === 0 ? true : attachments.length >= 3 ? false : attachmentsOpen;
  const productPlan = viewerAccess?.plan ?? "none";
  const hasProChatRecommendations = canAccessFeature(productPlan, "chat_report_recommendations");
  const selectedVoicePreset =
    VOICE_PRESETS.find((preset) => preset.id === ttsPresetId) ?? VOICE_PRESETS[0];
  const browserVoiceNotice =
    BROWSER_TTS_ENABLED && canUseBrowserReadAloud() && availableVoices.length === 0
      ? "Voice options depend on your browser/system voices."
      : null;
  const selectedVoiceDescription =
    "description" in selectedVoicePreset ? selectedVoicePreset.description : "Select voice";
  const uploadPlanLimits = useMemo(
    () => resolveUploadPlanLimits(viewerAccess ?? DEFAULT_UPLOAD_LIMIT_ENTITLEMENTS),
    [viewerAccess]
  );
  const maxUploadBatchFiles = uploadPlanLimits.maxFilesPerReview;
  const uploadBatchGuidance = buildUploadBatchGuidance(
    totalFilesReviewed,
    attachments.length,
    maxUploadBatchFiles
  );

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  // Load available browser TTS voices
  useEffect(() => {
    if (!BROWSER_TTS_ENABLED) return;
    if (!canUseBrowserReadAloud()) return;
    function loadVoices() {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        setAvailableVoices(voices);
      }
    }
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, []);

  useEffect(() => {
    if (!activeCaseId) return;
    if (analysisReportIdRef.current === activeCaseId) return;

    console.info("[attachments] chat continuity preserved", {
      activeCaseIdBefore: analysisReportIdRef.current,
      activeCaseIdAfter: activeCaseId,
      reportIdBefore: analysisReportIdRef.current,
      reportIdAfter: activeCaseId,
      messageCount: messages.length,
      skippedReset: true,
    });
    analysisReportIdRef.current = activeCaseId;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- messages.length is logging-only; including it would retrigger on every message
  }, [activeCaseId]);

  useEffect(() => {
    return () => {
      disposeRecordingResources(true);
      stopSpeaking();
      for (const attachment of attachmentsRef.current) {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      }
    };
  }, []);

  useEffect(() => {
    if (!disabled) return;

    if (isRecording) {
      disposeRecordingResources(true);
    }

    stopSpeaking();

    const resetTimer = window.setTimeout(() => {
      setIsRecording(false);
      setIsTranscribing(false);
      setRecordingError(null);
      setPreviewAttachmentId(null);
      setReplaceAttachmentId(null);
    }, 0);

    return () => window.clearTimeout(resetTimer);
  }, [disabled, isRecording]);

  useEffect(() => {
    if (attachments.length < 2) return;

    setMessages((prev) => {
      const feedback =
        "You’ve uploaded multiple files. I’ll focus on the most relevant ones to keep performance fast.";

      if (prev[prev.length - 1]?.role === "assistant" && prev[prev.length - 1]?.content === feedback) {
        return prev;
      }

      messageCounterRef.current += 1;
      return [...prev, createMessage(messageCounterRef.current, "assistant", feedback)];
    });
  }, [attachments.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      const thresholdPx = 140;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      shouldAutoScrollRef.current = distanceFromBottom < thresholdPx;
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role !== "assistant") return;
    if (!shouldAutoScrollRef.current) return;

    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) {
        el.scrollTo({
          top: el.scrollHeight,
          behavior: "smooth",
        });
        return;
      }

      bottomRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    });
  }, [messages, loading]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 112)}px`;
  }, [input]);

  function upsertSystemStatusMessage(content: string) {
    setMessages((prev) => {
      const activeMessageId = activeSystemStatusMessageIdRef.current;
      if (activeMessageId) {
        const statusIndex = prev.findIndex((message) => message.id === activeMessageId);
        if (statusIndex >= 0) {
          if (prev[statusIndex]?.content === content) {
            return prev;
          }

          const next = [...prev];
          next[statusIndex] = { ...next[statusIndex], content };
          return next;
        }
      }

      messageCounterRef.current += 1;
      const nextMessage = createMessage(
        messageCounterRef.current,
        "assistant",
        content,
        "system_status"
      );
      activeSystemStatusMessageIdRef.current = nextMessage.id;
      return [...prev, nextMessage];
    });
  }

  function clearActiveSystemStatusMessage() {
    const activeMessageId = activeSystemStatusMessageIdRef.current;
    if (!activeMessageId) return;

    setMessages((prev) => prev.filter((message) => message.id !== activeMessageId));
    activeSystemStatusMessageIdRef.current = null;
  }

  function pushSystemStatusMessage(content: string) {
    setMessages((prev) => {
      if (isSystemStatusMessage(prev[prev.length - 1]) && prev[prev.length - 1]?.content === content) {
        return prev;
      }

      messageCounterRef.current += 1;
      return [
        ...prev,
        createMessage(messageCounterRef.current, "assistant", content, "system_status"),
      ];
    });
  }

  const clearStructuredAnalysisState = useCallback(() => {
    analysisReportIdRef.current = null;
    analysisTextRef.current = "";
    workspaceDataRef.current = null;
    onAnalysisChange?.("");
    onPrimaryAnalysisChange?.(null);
    onAnalysisReportIdChange?.(null);
    onAnalysisResultChange?.(null);
    onLinkedEvidenceChange?.([]);
    onAnalysisPanelChange?.(null);
    onAnalysisStatusChange?.("idle", null);
    onWorkspaceDataChange?.(null);
  }, [
    onAnalysisChange,
    onAnalysisPanelChange,
    onAnalysisReportIdChange,
    onAnalysisResultChange,
    onAnalysisStatusChange,
    onLinkedEvidenceChange,
    onPrimaryAnalysisChange,
    onWorkspaceDataChange,
  ]);

  function setWorkspaceData(data: WorkspaceData | null) {
    workspaceDataRef.current = data;
    onWorkspaceDataChange?.(data);
  }

  function resolveWorkspaceData(text: string): WorkspaceData | null {
    if (workspaceDataRef.current) {
      return workspaceDataRef.current;
    }

    // Temporary emergency fallback: derive Workspace data from assistant prose
    // only when the backend did not return structured workspaceData.
    return buildWorkspaceDataFromAnalysisText(text);
  }

  function updateAnalysisText(text: string) {
    analysisTextRef.current = text;
    onAnalysisChange?.(text);
    setWorkspaceData(resolveWorkspaceData(text));
  }

  function resolveCaseHistory() {
    return messages
      .filter(
        (entry) =>
          (entry.role === "user" || entry.role === "assistant") &&
          !isSystemStatusMessage(entry) &&
          entry.content.trim().length > 0
      )
      .slice(-8)
      .map((entry) => ({
        role: entry.role,
        content: entry.content,
      }));
  }

  function resolveLatestUserQuestion() {
    return (
      [...messages]
        .reverse()
        .find(
          (entry) =>
            entry.role === "user" &&
            !isSystemStatusMessage(entry) &&
            entry.content.trim().length > 0
        )
        ?.content.trim() ?? null
    );
  }

  function updateCaseTopic(message: string) {
    const nextTopic = resolveCaseTopic(message, currentCaseTopicRef.current);
    currentCaseTopicRef.current = nextTopic;
    return nextTopic;
  }

  const invalidateStructuredAnalysis = useCallback(() => {
    if (analysisReportIdRef.current) {
      console.info("[attachments] follow-up upload preserving chat state", {
        activeCaseIdBefore: analysisReportIdRef.current,
        activeCaseIdAfter: analysisReportIdRef.current,
        reportIdBefore: analysisReportIdRef.current,
        reportIdAfter: analysisReportIdRef.current,
        messageCount: messages.length,
        skippedReset: true,
      });
      console.info("[workspace] preserved prior exports during active-case interaction", {
        activeCaseId: analysisReportIdRef.current,
        artifactCount: 1,
      });
      return;
    }

    analysisRunRef.current += 1;
    clearStructuredAnalysisState();
    onAnalysisLoadingChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- messages.length is logging-only; omitted to prevent stale-closure churn
  }, [clearStructuredAnalysisState, onAnalysisLoadingChange]);

  function beginStructuredAnalysisRun() {
    const runId = analysisRunRef.current + 1;
    analysisRunRef.current = runId;
    if (!analysisReportIdRef.current) {
      clearStructuredAnalysisState();
    } else {
      console.info("[attachments] follow-up upload preserving chat state", {
        activeCaseIdBefore: analysisReportIdRef.current,
        activeCaseIdAfter: analysisReportIdRef.current,
        reportIdBefore: analysisReportIdRef.current,
        reportIdAfter: analysisReportIdRef.current,
        messageCount: messages.length,
        skippedReset: true,
      });
      console.info("[workspace] preserved prior exports during active-case analysis", {
        activeCaseId: analysisReportIdRef.current,
        artifactCount: 1,
      });
    }
    onAnalysisLoadingChange?.(true);
    onAnalysisStatusChange?.("processing", null);
    return runId;
  }

  function browserSupportsRecording() {
    return (
      typeof window !== "undefined" &&
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== "undefined"
    );
  }

  function resolveRecordingMimeType() {
    if (typeof MediaRecorder === "undefined") {
      return "audio/webm";
    }

    const preferredTypes = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/mpeg",
    ];

    return preferredTypes.find((value) => MediaRecorder.isTypeSupported(value)) ?? "audio/webm";
  }

  function disposeRecordingResources(stopRecorder = false) {
    const recorder = mediaRecorderRef.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (stopRecorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Ignore stop errors during cleanup.
        }
      }
    }

    const stream = mediaStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }

    mediaRecorderRef.current = null;
    mediaStreamRef.current = null;
    audioChunksRef.current = [];
  }

  async function startRecording() {
    if (!browserSupportsRecording()) {
      setRecordingError("Voice input is not available in this browser.");
      return;
    }

    try {
      setRecordingError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = resolveRecordingMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      audioChunksRef.current = [];
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingMimeTypeRef.current = recorder.mimeType || mimeType;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        setRecordingError("Recording stopped unexpectedly. Please try again.");
        setIsRecording(false);
        disposeRecordingResources();
      };
      recorder.start();
      setIsRecording(true);
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Microphone permission was denied."
          : "Unable to access the microphone.";
      setRecordingError(message);
      disposeRecordingResources();
      setIsRecording(false);
    }
  }

  async function stopRecordingAndTranscribe() {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    try {
      setRecordingError(null);
      setIsRecording(false);
      setIsTranscribing(true);

      const audioBlob = await new Promise<Blob>((resolve, reject) => {
        recorder.onstop = () => {
          const blob = new Blob(audioChunksRef.current, {
            type: recorder.mimeType || recordingMimeTypeRef.current || "audio/webm",
          });
          disposeRecordingResources();
          resolve(blob);
        };
        recorder.onerror = () => {
          disposeRecordingResources();
          reject(new Error("Recording stopped unexpectedly."));
        };

        try {
          recorder.stop();
        } catch (error) {
          disposeRecordingResources();
          reject(error);
        }
      });

      if (!audioBlob.size) {
        setRecordingError("The recording was empty. Please try again.");
        return;
      }

      const extension = audioBlob.type.includes("mp4")
        ? "m4a"
        : audioBlob.type.includes("mpeg")
          ? "mp3"
          : "webm";
      const audioFile = new File([audioBlob], `collision-iq-recording.${extension}`, {
        type: audioBlob.type || "audio/webm",
      });
      const formData = new FormData();
      formData.append("file", audioFile);

      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Transcription failed.");
      }

      const data = (await response.json()) as { text?: string };
      const transcript = data.text?.trim();
      if (!transcript) {
        setRecordingError("No speech was detected in the recording.");
        return;
      }

      setInput((current) => (current.trim() ? `${current.trim()} ${transcript}` : transcript));
    } catch (error) {
      setRecordingError(error instanceof Error ? error.message : "Transcription failed.");
    } finally {
      setIsTranscribing(false);
    }
  }

  function handleMicClick() {
    if (disabled || isTranscribing) return;
    if (isRecording) {
      void stopRecordingAndTranscribe();
      return;
    }

    void startRecording();
  }

  function prepareFilesForUpload(fileList: FileList | null, source: "file" | "camera") {
    const selectedFiles = Array.from(fileList ?? []);
    const rejectedFiles: UploadFailureResult[] = [];

    const filesWithinCount = selectedFiles.filter((file, index) => {
      if (index < maxUploadBatchFiles) {
        return true;
      }

      rejectedFiles.push({
        filename: file.name,
        reason: getUploadBatchLimitMessage(uploadPlanLimits),
        code: "MAX_FILES_REACHED",
      });
      return false;
    });

    const acceptedFiles = filesWithinCount.filter((file) => {
      if (file.size <= MAX_UPLOAD_FILE_BYTES) {
        return true;
      }

      rejectedFiles.push({
        filename: file.name,
        reason: `File is ${formatBytes(file.size)}. Max size is ${formatBytes(MAX_UPLOAD_FILE_BYTES)}.`,
        code: "FILE_TOO_LARGE",
      });
      return false;
    });

    if (rejectedFiles.length) {
      console.info("[attachments] files rejected before upload", {
        source,
        selectedCount: selectedFiles.length,
        acceptedCount: acceptedFiles.length,
        rejectedFiles,
      });
      upsertSystemStatusMessage(buildUploadFailureStatus(rejectedFiles));
    }

    return { acceptedFiles, rejectedFiles };
  }

  function dismissOpeningDisclaimer() {
    setShowOpeningDisclaimer(false);
    setOpeningDisclaimerDismissed(true);
  }

  function openAttachmentPreview(attachmentId: string) {
    setPreviewAttachmentId(attachmentId);
  }

  function closeAttachmentPreview() {
    setPreviewAttachmentId(null);
  }

  function handlePreviewAttachment(attachmentId: string) {
    openAttachmentPreview(attachmentId);
  }

  const handleEndChat = useCallback(() => {
    const caseIdToClose = analysisReportIdRef.current;
    if (caseIdToClose) {
      void fetch(`/api/cases/${encodeURIComponent(caseIdToClose)}/close`, {
        method: "POST",
        credentials: "same-origin",
      }).catch((error) => {
        console.warn("[chat] case close marker failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }

    abortRef.current?.abort();
    abortRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }

    if (canUseBrowserReadAloud()) {
      window.speechSynthesis.cancel();
    }

    utteranceRef.current = null;
    setSpeakingMessageId(null);
    setIsSpeaking(false);
    sessionRef.current += 1;

    setLoading(false);
    setInput("");
    attachments.forEach((attachment) => {
      if (attachment.previewUrl) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    });
    setMessages([INITIAL_MESSAGE]);
    setAttachments([]);
    setTotalFilesReviewed(0);
    setAttachmentsOpen(true);
    setPreviewAttachmentId(null);
    setReplaceAttachmentId(null);
    firstAttachmentAtRef.current = null;
    currentCaseTopicRef.current = DEFAULT_CASE_TOPIC;
    activeSystemStatusMessageIdRef.current = null;
    setShowOpeningDisclaimer(true);
    setOpeningDisclaimerDismissed(false);

    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";

    onAttachmentChange?.(null);
    onAttachmentsChange?.([]);
    invalidateStructuredAnalysis();
    onSessionReset?.();

    shouldAutoScrollRef.current = true;
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 50);
  }, [
    attachments,
    invalidateStructuredAnalysis,
    onAttachmentChange,
    onAttachmentsChange,
    onSessionReset,
  ]);

  useEffect(() => {
    onSessionControlsReady?.({
      focusComposer: () => textareaRef.current?.focus(),
      resetSession: handleEndChat,
    });
  }, [onSessionControlsReady, handleEndChat]);

  async function handleSend() {
    if (disabled) return;
    if (loading) return;
    if (!input.trim() && attachments.length === 0) return;

    // Collapse the review workspace from the real send path so typed prompts always focus chat.
    onUserPromptSent?.();
    onChatEngagement?.();
    stopSpeaking();
    setLoading(true);
    shouldAutoScrollRef.current = true;

    const mySession = sessionRef.current;
    const messageToSend = input.trim() || buildAttachmentSummary(attachments);
    const activeCaseTopic = updateCaseTopic(messageToSend);
    const hasAttachmentsInTurn = attachments.length > 0;
    const activeAnalysisRunId = hasAttachmentsInTurn ? beginStructuredAnalysisRun() : null;
    const attachmentStats = {
      ...summarizeAttachmentStats(attachments),
      totalPdfPages: attachments.reduce((sum, attachment) => sum + (attachment.pageCount ?? 0), 0),
    };
    const analysisStartMs = Date.now();
    messageCounterRef.current += 1;
    const userMessage: Message = createMessage(messageCounterRef.current, "user", messageToSend);

    const updatedMessages: Message[] = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    onCaseIntentChange?.(messageToSend || caseIntent);

    try {
      const shouldUseCaseChat =
        !hasAttachmentsInTurn && caseChatEnabled && Boolean(analysisReportIdRef.current);

      if (shouldUseCaseChat) {
        const caseChatResponse = await fetch("/api/case-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            caseId: analysisReportIdRef.current,
            message:
              `${messageToSend}\n\nCurrent active topic/mode: ${activeCaseTopic}. ` +
              "Answer this topic first and avoid a broad case recap unless this topic is a general summary. " +
              buildPlanRecommendationGuard(hasProChatRecommendations),
            history: resolveCaseHistory(),
          }),
        });

        if (!caseChatResponse.ok) {
          let errorMessage = `Case chat failed (${caseChatResponse.status})`;

          try {
            const data = (await caseChatResponse.json()) as { error?: string };
            if (data?.error) {
              errorMessage = data.error;
            }
          } catch {
            // Keep fallback message when JSON parsing fails.
          }

          throw new Error(errorMessage);
        }

        const data = (await caseChatResponse.json()) as { reply?: string };
        const reply = redactExternalDocumentUrls(
          data.reply?.trim() || "No response received."
        );

        if (sessionRef.current === mySession) {
          stopSpeaking();
          messageCounterRef.current += 1;
          const assistantMessage = createMessage(
            messageCounterRef.current,
            "assistant",
            reply
          );
          setMessages((prev) => [...prev, assistantMessage]);
          updateAnalysisText(reply);
          onPrimaryAnalysisChange?.({
            messageId: assistantMessage.id,
            content: reply,
          });
        }

        return;
      }

      console.info("[attachments] analysis start", {
        fileCount: attachmentStats.fileCount,
        totalBytes: attachmentStats.totalBytes,
        totalPdfPages: attachmentStats.totalPdfPages,
        timeToAnalysisStartMs: firstAttachmentAtRef.current
          ? analysisStartMs - firstAttachmentAtRef.current
          : 0,
      });
      if (hasAttachmentsInTurn) {
        upsertSystemStatusMessage(
          buildAttachmentBatchStatus(
            attachments.map((attachment) => ({ type: attachment.mime })),
            "analysis_starting"
          )
        );
      }

      if (hasAttachmentsInTurn && analysisReportIdRef.current) {
        const activeCaseId = analysisReportIdRef.current;
        const analysisResponse = await fetch("/api/analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            artifactIds: attachments.map((attachment) => attachment.attachmentId),
            activeCaseId,
            userIntent: messageToSend,
          }),
        });
        const analysisDurationMs = Date.now() - analysisStartMs;

        if (
          !analysisResponse.ok ||
          sessionRef.current !== mySession ||
          analysisRunRef.current !== activeAnalysisRunId
        ) {
          console.info("[attachments] active-case reassessment failure", {
            fileCount: attachmentStats.fileCount,
            totalBytes: attachmentStats.totalBytes,
            totalPdfPages: attachmentStats.totalPdfPages,
            analysisDurationMs,
            status: analysisResponse.status,
          });
          if (analysisRunRef.current === activeAnalysisRunId) {
            onAnalysisStatusChange?.("error", `Analysis failed (${analysisResponse.status})`);
            onAnalysisLoadingChange?.(false);
          }
          return;
        }

        const analysisData = (await analysisResponse.json()) as {
          reportId?: string;
          report?: RepairIntelligenceReport;
          linkedEvidence?: LinkedEvidenceDebugItem[];
          panel?: DecisionPanel;
          workspaceData?: WorkspaceData;
          retrievalAttempted?: boolean;
          retrievalCompleted?: boolean;
          retrievalMatchCount?: number;
          refinedWithRetrieval?: boolean;
          analysisCompletedAt?: string;
          caseContinuity?: {
            activeCaseId?: string;
            mode?: "new_case" | "active_case_update";
            evidenceRegistryCount?: number;
          };
          reassessmentDelta?: RepairIntelligenceReport["reassessmentDelta"];
          artifactRefreshPolicy?: RepairIntelligenceReport["artifactRefreshPolicy"];
        };

        const returnedActiveCaseId =
          analysisData.caseContinuity?.activeCaseId ?? analysisData.reportId ?? activeCaseId;
        const nextActiveCaseId =
          returnedActiveCaseId === activeCaseId || analysisData.caseContinuity?.mode === "active_case_update"
            ? activeCaseId
            : returnedActiveCaseId;
        analysisReportIdRef.current = nextActiveCaseId;
        setWorkspaceData(analysisData.workspaceData ?? workspaceDataRef.current);
        onAnalysisReportIdChange?.(nextActiveCaseId);
        if (analysisData.report) {
          onAnalysisResultChange?.(analysisData.report);
        }
        onLinkedEvidenceChange?.(analysisData.linkedEvidence ?? []);
        onAnalysisPanelChange?.(analysisData.panel ?? null);
        onAnalysisStatusChange?.("complete", null);
        onAnalysisLoadingChange?.(false);
        setTotalFilesReviewed((current) => current + attachmentStats.fileCount);
        emitSafeCrmEventFromClient({
          event: "upload_batch_completed",
          plan: productPlan,
          fileCount: attachmentStats.fileCount,
          totalFilesReviewed: totalFilesReviewed + attachmentStats.fileCount,
        });
        console.info("[attachments] upload completion case state", {
          activeCaseId,
          activeCaseIdAfter: nextActiveCaseId,
          reportId: nextActiveCaseId,
          attachmentIds: attachments.map((attachment) => attachment.attachmentId),
          caseContinuityActiveCaseId: analysisData.caseContinuity?.activeCaseId ?? null,
          messageCountBefore: messages.length,
          messageCountAfter: updatedMessages.length,
        });
        console.info("[attachments] chat continuity preserved", {
          activeCaseIdBefore: activeCaseId,
          activeCaseIdAfter: nextActiveCaseId,
          reportIdBefore: activeCaseId,
          reportIdAfter: nextActiveCaseId,
          messageCountBefore: messages.length,
          messageCountAfter: updatedMessages.length,
          skippedReset: true,
        });
        const reviewedCount = totalFilesReviewed + attachmentStats.fileCount;
        upsertSystemStatusMessage(
          `${formatCaseUpdateStatus(
            analysisData.reassessmentDelta,
            analysisData.artifactRefreshPolicy
          )} ${buildNextBatchPrompt(reviewedCount, maxUploadBatchFiles)}`
        );
        setAttachments((prev) =>
          prev.map((attachment) => ({
            ...attachment,
            usedInAnalysis: true,
          }))
        );
        onCaseUploadComplete?.();

        const latestPriorUserQuestion = resolveLatestUserQuestion();

        const caseChatResponse = await fetch("/api/case-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            caseId: analysisData.reportId ?? activeCaseId,
            message:
              `${messageToSend}\n\nAdditional evidence was just uploaded and merged into this active case. ` +
              `Current active topic/mode: ${activeCaseTopic}.\n` +
              `Latest prior user question/topic: ${latestPriorUserQuestion ?? caseIntent}.\n` +
              "Answer as a continuation. Directly answer the active topic first, use the new upload only where it affects that topic, then mention only the most relevant open items. If the active topic is a general case summary, use a compact current-case posture. Otherwise, do not provide a broad case recap. Separate visible photo evidence, document/invoice-supported repairs, and verification items that remain open only when relevant to the active topic. Do not restart the review or ask for vehicle identity already present in the case. " +
              buildPlanRecommendationGuard(hasProChatRecommendations),
            history: resolveCaseHistory(),
          }),
        });

        if (!caseChatResponse.ok) {
          let errorMessage = `Case chat failed (${caseChatResponse.status})`;

          try {
            const data = (await caseChatResponse.json()) as { error?: string };
            if (data?.error) {
              errorMessage = data.error;
            }
          } catch {
            // Keep fallback message when JSON parsing fails.
          }

          throw new Error(errorMessage);
        }

        const data = (await caseChatResponse.json()) as { reply?: string };
        const reply = redactExternalDocumentUrls(
          data.reply?.trim() || "Case reassessment complete."
        );

        if (sessionRef.current === mySession) {
          stopSpeaking();
          messageCounterRef.current += 1;
          const assistantMessage = createMessage(
            messageCounterRef.current,
            "assistant",
            reply
          );
          setMessages((prev) => [...prev, assistantMessage]);
          updateAnalysisText(reply);
          onPrimaryAnalysisChange?.({
            messageId: assistantMessage.id,
            content: reply,
          });
        }

        return;
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: updatedMessages,
          activeCaseId: analysisReportIdRef.current,
          attachmentIds: attachments.map((attachment) => attachment.attachmentId),
          attachments: attachments.map((attachment) => ({
            filename: attachment.filename,
            type: attachment.mime,
            text: attachment.text,
            pageCount: attachment.pageCount,
            // imageDataUrl intentionally omitted — server fetches it from the
            // attachment store via attachmentIds, keeping the payload small.
          })),
          productAccess: {
            plan: productPlan,
            chatReportRecommendations: hasProChatRecommendations,
            snapshotExport: canAccessFeature(productPlan, "snapshot_export"),
          },
        }),
      });

      if (!response.ok) {
        let errorMessage = `Chat API failed (${response.status})`;

        try {
          const data = (await response.json()) as { error?: string };
          if (data?.error) {
            errorMessage = data.error;
          }
        } catch {
          // Ignore JSON parse failures and keep the fallback message.
        }

        console.warn("[chat] request failed", {
          status: response.status,
          message: errorMessage,
        });

        if (sessionRef.current === mySession) {
          if (hasAttachmentsInTurn) {
            upsertSystemStatusMessage(errorMessage);
          } else {
            pushSystemStatusMessage(errorMessage);
          }
          if (
            hasAttachmentsInTurn &&
            analysisRunRef.current === activeAnalysisRunId
          ) {
            onAnalysisLoadingChange?.(false);
            setTotalFilesReviewed((current) => current + attachmentStats.fileCount);
            emitSafeCrmEventFromClient({
              event: "upload_batch_completed",
              plan: productPlan,
              fileCount: attachmentStats.fileCount,
              totalFilesReviewed: totalFilesReviewed + attachmentStats.fileCount,
            });
          }
        }
        return;
      }

      const contentType = response.headers.get("content-type") || "";
      if (hasAttachmentsInTurn) {
        console.info("[attachments] analysis request assembled", {
          attachmentCount: attachments.length,
          visionAttachmentCount,
          attachments: attachments.map((attachment) => ({
            filename: attachment.filename,
            mimeType: attachment.mime || "unknown",
            hasVision: attachment.hasVision,
            hasImageDataUrl: Boolean(attachment.imageDataUrl),
            pageCount: attachment.pageCount ?? null,
          })),
        });
        void fetch("/api/analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            artifactIds: attachments.map((attachment) => attachment.attachmentId),
            activeCaseId: analysisReportIdRef.current,
            userIntent: messageToSend,
          }),
        })
          .then(async (analysisResponse) => {
            const analysisDurationMs = Date.now() - analysisStartMs;
            if (
              !analysisResponse.ok ||
              sessionRef.current !== mySession ||
              analysisRunRef.current !== activeAnalysisRunId
            ) {
              console.info("[attachments] analysis failure", {
                fileCount: attachmentStats.fileCount,
                totalBytes: attachmentStats.totalBytes,
                totalPdfPages: attachmentStats.totalPdfPages,
                analysisDurationMs,
                status: analysisResponse.status,
              });
              if (analysisRunRef.current === activeAnalysisRunId) {
                onAnalysisStatusChange?.("error", `Analysis failed (${analysisResponse.status})`);
                onAnalysisLoadingChange?.(false);
              }
              return;
            }

            const analysisData = (await analysisResponse.json()) as {
              reportId?: string;
              report?: RepairIntelligenceReport;
              linkedEvidence?: LinkedEvidenceDebugItem[];
              panel?: DecisionPanel;
              workspaceData?: WorkspaceData;
              retrievalAttempted?: boolean;
              retrievalCompleted?: boolean;
              retrievalMatchCount?: number;
              refinedWithRetrieval?: boolean;
              analysisCompletedAt?: string;
              caseContinuity?: {
                activeCaseId?: string;
                mode?: "new_case" | "active_case_update";
                evidenceRegistryCount?: number;
              };
              reassessmentDelta?: RepairIntelligenceReport["reassessmentDelta"];
              artifactRefreshPolicy?: RepairIntelligenceReport["artifactRefreshPolicy"];
            };
            // Backend workspaceData is the primary source of truth for Workspace rendering.
            analysisReportIdRef.current = analysisData.reportId ?? null;
            setWorkspaceData(analysisData.workspaceData ?? workspaceDataRef.current);
            onAnalysisReportIdChange?.(analysisData.reportId ?? null);
            if (analysisData.report) {
              onAnalysisResultChange?.(analysisData.report);
            }
            onLinkedEvidenceChange?.(analysisData.linkedEvidence ?? []);
            onAnalysisPanelChange?.(analysisData.panel ?? null);
            onAnalysisStatusChange?.("complete", null);
            onAnalysisLoadingChange?.(false);
            console.info("[attachments] upload completion case state", {
              activeCaseId: analysisReportIdRef.current,
              reportId: analysisData.reportId ?? null,
              attachmentIds: attachments.map((attachment) => attachment.attachmentId),
              caseContinuityActiveCaseId: analysisData.caseContinuity?.activeCaseId ?? null,
            });
            console.info("[attachments] analysis complete", {
              fileCount: attachmentStats.fileCount,
              totalBytes: attachmentStats.totalBytes,
              totalPdfPages: attachmentStats.totalPdfPages,
              analysisDurationMs,
              retrievalAttempted: analysisData.retrievalAttempted ?? false,
              retrievalCompleted: analysisData.retrievalCompleted ?? false,
              retrievalMatchCount: analysisData.retrievalMatchCount ?? 0,
              refinedWithRetrieval: analysisData.refinedWithRetrieval ?? false,
              analysisCompletedAt: analysisData.analysisCompletedAt ?? null,
            });
            const reviewedCount = totalFilesReviewed + attachmentStats.fileCount;
            upsertSystemStatusMessage(
              `${analysisData.caseContinuity?.mode === "active_case_update"
                ? formatCaseUpdateStatus(
                    analysisData.reassessmentDelta,
                    analysisData.artifactRefreshPolicy
                  )
                : "Analysis complete."} ${buildNextBatchPrompt(reviewedCount, maxUploadBatchFiles)}`
            );
            setAttachments((prev) =>
              prev.map((attachment) => ({
                ...attachment,
                usedInAnalysis: true,
              }))
            );
          })
          .catch((error) => {
            console.info("[attachments] analysis failure", {
              fileCount: attachmentStats.fileCount,
              totalBytes: attachmentStats.totalBytes,
              totalPdfPages: attachmentStats.totalPdfPages,
              analysisDurationMs: Date.now() - analysisStartMs,
              error: error instanceof Error ? error.message : String(error),
            });
            if (
              sessionRef.current === mySession &&
              analysisRunRef.current === activeAnalysisRunId
            ) {
              onAnalysisStatusChange?.("error", "Analysis failed");
              onAnalysisLoadingChange?.(false);
            }
          });
      }

      if (contentType.includes("text/plain") && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let assistantText = "";

        stopSpeaking();
        messageCounterRef.current += 1;
        const streamingAssistantMessage = createMessage(
          messageCounterRef.current,
          "assistant",
          ""
        );
        setMessages((prev) => [...prev, streamingAssistantMessage]);
        const assistantIndex = updatedMessages.length;

        while (true) {
          if (sessionRef.current !== mySession) break;

          const { value, done } = await reader.read();
          if (done) break;

          assistantText = redactExternalDocumentUrls(
            assistantText + decoder.decode(value, { stream: true })
          );

          setMessages((prev) => {
            if (sessionRef.current !== mySession) return prev;

            const next = [...prev];
            if (assistantIndex >= 0 && assistantIndex < next.length) {
              next[assistantIndex] = { ...next[assistantIndex], content: assistantText };
            }
            return next;
          });
        }

        if (
          sessionRef.current === mySession &&
          (!hasAttachmentsInTurn || analysisRunRef.current === activeAnalysisRunId)
        ) {
          updateAnalysisText(assistantText);
          onPrimaryAnalysisChange?.({
            messageId: streamingAssistantMessage.id,
            content: assistantText,
          });
        }
      } else {
        const data = await response.json();
        const reply = redactExternalDocumentUrls(
          (data.reply as string) || "No response received."
        );

        if (sessionRef.current === mySession) {
          stopSpeaking();
          messageCounterRef.current += 1;
          const assistantMessage = createMessage(
            messageCounterRef.current,
            "assistant",
            reply
          );
          setMessages((prev) => [
            ...prev,
            assistantMessage,
          ]);
          if (!hasAttachmentsInTurn || analysisRunRef.current === activeAnalysisRunId) {
            updateAnalysisText(reply);
            onPrimaryAnalysisChange?.({
              messageId: assistantMessage.id,
              content: reply,
            });
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }

      console.warn("[chat] unexpected request failure", {
        message: err instanceof Error ? err.message : String(err),
      });

      if (sessionRef.current === mySession) {
        if (hasAttachmentsInTurn) {
          upsertSystemStatusMessage("The analysis service had a temporary issue. Please retry.");
        } else {
          setMessages((prev) => [
            ...prev,
            (() => {
              messageCounterRef.current += 1;
              return createMessage(
                messageCounterRef.current,
                "assistant",
                "The analysis service had a temporary issue. Please retry.",
                "system_status"
              );
            })(),
          ]);
        }
        if (
          hasAttachmentsInTurn &&
          analysisRunRef.current === activeAnalysisRunId
        ) {
          onAnalysisStatusChange?.("error", "The analysis service had a temporary issue. Please retry.");
          onAnalysisLoadingChange?.(false);
        }
      }
    } finally {
      if (sessionRef.current === mySession) {
        setLoading(false);
      }
    }
  }

  async function uploadSingleFile(
    file: File,
    source: "file" | "camera",
    replaceId?: string | null,
    options?: { openPreview?: boolean }
  ): Promise<string> {
    if (disabled) return "";
    if (!isUserLoaded || !isSignedIn) {
      router.push("/sign-in?next=/chatbot");
      throw new Error("Please sign in before uploading.");
    }

    onChatEngagement?.();
    const formData = new FormData();
    formData.append("file", file);
    if (analysisReportIdRef.current) {
      formData.append("activeCaseId", analysisReportIdRef.current);
    }

    const res = await fetch("/api/upload", {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    if (res.status === 401) {
      router.push("/sign-in?next=/chatbot");
      throw new Error("Please sign in before uploading.");
    }
    const data = (await res.json().catch(() => null)) as UploadResponse | null;

    if (!res.ok) {
      let message = `Upload failed (${res.status})`;

      if (data?.failedUploads?.length) {
        message = data.failedUploads
          .map((failure) => failure.reason ?? "Upload failed.")
          .join("; ");
      } else if (data?.error) {
        message = `Upload failed (${res.status}): ${data.error}`;
      }

      throw new Error(message);
    }

    const upload = data?.successfulUploads?.[0] ?? data;
    const failedUploads = data?.failedUploads ?? [];
    if (failedUploads.length) {
      upsertSystemStatusMessage(buildUploadFailureStatus(failedUploads));
    }
    if (data?.zipSummaries?.length) {
      const zipStatus = buildZipExtractionStatus(data.zipSummaries);
      if (zipStatus) {
        upsertSystemStatusMessage(zipStatus);
      }
      upsertSystemStatusMessage("ZIP extraction complete. Classifying extracted files for analysis.");
    }
    const attachmentId = upload?.attachmentId;
    if (!attachmentId) {
      throw new Error(
        data?.failedUploads?.length
          ? data.failedUploads.map((failure) => failure.reason ?? "Upload failed.").join("; ")
          : "Upload response missing attachmentId."
      );
    }
    const returnedActiveCaseId =
      typeof upload?.caseContinuity?.activeCaseId === "string"
        ? upload.caseContinuity.activeCaseId
        : null;
    const activeCaseIdBeforeUpload = analysisReportIdRef.current;
    if (!analysisReportIdRef.current && returnedActiveCaseId) {
      analysisReportIdRef.current = returnedActiveCaseId;
    }
    const returnedUploads = data?.successfulUploads?.length ? data.successfulUploads : [upload];
    const filename: string = upload?.filename || file.name;
    const mime: string = upload?.type || file.type;
    const text: string = upload?.text || "";
    const imageDataUrl: string | undefined =
      typeof upload?.imageDataUrl === "string" ? upload.imageDataUrl : undefined;
    const pageCount: number | undefined =
      typeof upload?.pageCount === "number" ? upload.pageCount : undefined;
    const hasVision: boolean = Boolean(upload?.hasVision) && mime.startsWith("image/");
    const previewUrl =
      returnedUploads.length === 1 && (mime === "application/pdf" || isLikelyImageFile(file))
        ? URL.createObjectURL(file)
        : undefined;

    console.info("[attachments] upload complete", {
      activeCaseId: analysisReportIdRef.current,
      activeCaseIdBeforeUpload,
      activeCaseIdAfterUpload: analysisReportIdRef.current,
      reportId: analysisReportIdRef.current,
      attachmentId,
      filename,
      mimeType: mime || file.type || "unknown",
      source,
      hasVision,
      hasImageDataUrl: Boolean(imageDataUrl),
      pageCount: pageCount ?? null,
      replaceId: replaceId ?? null,
      sameCaseFollowUp: Boolean(upload?.caseContinuity?.sameCaseFollowUp),
    });

    if (analysisReportIdRef.current) {
      console.info("[attachments] merged into existing case", {
        activeCaseIdBefore: activeCaseIdBeforeUpload,
        activeCaseIdAfter: analysisReportIdRef.current,
        reportIdBefore: activeCaseIdBeforeUpload,
        reportIdAfter: analysisReportIdRef.current,
        attachmentId,
        messageCount: messages.length,
      });
    }

    setAttachments((prev) => {
      const nextAttachments = returnedUploads
        .filter((item): item is UploadSuccessResult & { attachmentId: string } =>
          typeof item?.attachmentId === "string"
        )
        .map((item, itemIndex) => {
          const itemMime = item.type || file.type;
          return {
            attachmentId: item.attachmentId,
            filename: item.filename || file.name,
            mime: itemMime,
            text: item.text || "",
            sizeBytes: typeof item.sizeBytes === "number"
              ? item.sizeBytes
              : returnedUploads.length === 1
                ? file.size
                : 0,
            imageDataUrl:
              typeof item.imageDataUrl === "string" ? item.imageDataUrl : undefined,
            previewUrl: itemIndex === 0 ? previewUrl : undefined,
            pageCount: typeof item.pageCount === "number" ? item.pageCount : undefined,
            source,
            uploadSource: item.source,
            sourceArchive: item.sourceArchive,
            classification: item.classification,
            hasVision: Boolean(item.hasVision) && itemMime.startsWith("image/"),
            usedInAnalysis: false,
          };
        });

      if (!nextAttachments.length) {
        return prev;
      }

      if (!replaceId) {
        return [...prev, ...nextAttachments];
      }

      const [replacement, ...additional] = nextAttachments;
      return prev.map((attachment) => {
        if (attachment.attachmentId !== replaceId) {
          return attachment;
        }

        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }

        return replacement;
      }).concat(additional);
    });

    onAttachmentChange?.(filename);
    onAttachmentsChange?.((prev) => {
      const nextItems = returnedUploads
        .filter((item): item is UploadSuccessResult & { attachmentId: string } =>
          typeof item?.attachmentId === "string"
        )
        .map((item) => ({
          attachmentId: item.attachmentId,
          filename: item.filename || file.name,
          hasVision: Boolean(item.hasVision),
        }));

      if (!nextItems.length) {
        return prev;
      }

      if (!replaceId) {
        return [...prev, ...nextItems];
      }

      const [replacement, ...additional] = nextItems;
      return prev.map((attachment) =>
        attachment.attachmentId === replaceId ? replacement : attachment
      ).concat(additional);
    });
    invalidateStructuredAnalysis();
    if (options?.openPreview ?? true) {
      openAttachmentPreview(replaceId ?? attachmentId);
    }
    setReplaceAttachmentId(null);
    firstAttachmentAtRef.current ??= Date.now();
    return attachmentId;
  }

  async function handleFilesSelected(fileList: FileList | null) {
    if (disabled) return;
    if (!fileList || fileList.length === 0) return;

    try {
      const { acceptedFiles, rejectedFiles } = prepareFilesForUpload(fileList, "file");
      if (!acceptedFiles.length) {
        if (rejectedFiles.length) {
          upsertSystemStatusMessage(buildUploadFailureStatus(rejectedFiles));
        }
        return;
      }

      const files = acceptedFiles;
      console.info("[attachments] upload batch selected", {
        source: "file",
        fileCount: files.length,
        rejectedCount: rejectedFiles.length,
        totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      });
      upsertSystemStatusMessage(buildAttachmentBatchStatus(files, "uploading"));
      const largeUploadWarning = buildLargeUploadWarning(files);
      if (largeUploadWarning) {
        upsertSystemStatusMessage(largeUploadWarning);
      }
      const zipProgressStatus = buildZipProgressStatus(files);
      if (zipProgressStatus) {
        upsertSystemStatusMessage(zipProgressStatus);
      }
      const newAttachmentIds: string[] = [];
      const replacementTargetId = replaceAttachmentId;
      const uploadFailures = [...rejectedFiles];
      let successfulUploadCount = 0;

      for (const file of files) {
        try {
          const attachmentId = await uploadSingleFile(file, "file", replacementTargetId, {
            openPreview: Boolean(replacementTargetId) || files.length === 1,
          });
          successfulUploadCount += 1;
          if (!replacementTargetId) {
            newAttachmentIds.push(attachmentId);
          }
        } catch (error) {
          console.error(error);
          uploadFailures.push({
            filename: file.name,
            reason: error instanceof Error ? error.message : "Upload failed.",
          });
        }
      }
      if (!replacementTargetId && newAttachmentIds[0]) {
        openAttachmentPreview(newAttachmentIds[0]);
      }
      const completionStatus = buildUploadCompletionStatus(
        successfulUploadCount,
        uploadFailures
      );
      if (completionStatus) {
        upsertSystemStatusMessage(completionStatus);
      } else {
        upsertSystemStatusMessage("Upload processing complete. Preparing files for analysis.");
        upsertSystemStatusMessage(buildAttachmentBatchStatus(files, "analysis_starting"));
      }
    } catch (err) {
      console.error(err);
      upsertSystemStatusMessage("File upload could not start.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleCameraSelected(fileList: FileList | null) {
    if (disabled) return;
    if (!fileList || fileList.length === 0) return;

    try {
      const { acceptedFiles, rejectedFiles } = prepareFilesForUpload(fileList, "camera");
      if (!acceptedFiles.length) {
        if (rejectedFiles.length) {
          upsertSystemStatusMessage(buildUploadFailureStatus(rejectedFiles));
        }
        return;
      }

      const files = acceptedFiles;
      console.info("[attachments] upload batch selected", {
        source: "camera",
        fileCount: files.length,
        rejectedCount: rejectedFiles.length,
        totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      });
      upsertSystemStatusMessage(buildAttachmentBatchStatus(files, "uploading"));
      const largeUploadWarning = buildLargeUploadWarning(files);
      if (largeUploadWarning) {
        upsertSystemStatusMessage(largeUploadWarning);
      }
      const zipProgressStatus = buildZipProgressStatus(files);
      if (zipProgressStatus) {
        upsertSystemStatusMessage(zipProgressStatus);
      }
      const newAttachmentIds: string[] = [];
      const replacementTargetId = replaceAttachmentId;
      const uploadFailures = [...rejectedFiles];
      let successfulUploadCount = 0;

      for (const file of files) {
        try {
          const attachmentId = await uploadSingleFile(file, "camera", replacementTargetId, {
            openPreview: Boolean(replacementTargetId) || files.length === 1,
          });
          successfulUploadCount += 1;
          if (!replacementTargetId) {
            newAttachmentIds.push(attachmentId);
          }
        } catch (error) {
          console.error(error);
          uploadFailures.push({
            filename: file.name,
            reason: error instanceof Error ? error.message : "Upload failed.",
          });
        }
      }
      if (!replacementTargetId && newAttachmentIds[0]) {
        openAttachmentPreview(newAttachmentIds[0]);
      }
      const completionStatus = buildUploadCompletionStatus(
        successfulUploadCount,
        uploadFailures
      );
      if (completionStatus) {
        upsertSystemStatusMessage(completionStatus);
      } else {
        upsertSystemStatusMessage("Upload processing complete. Preparing files for analysis.");
        upsertSystemStatusMessage(buildAttachmentBatchStatus(files, "analysis_starting"));
      }
    } catch (err) {
      console.error(err);
      upsertSystemStatusMessage("Camera upload could not start.");
    } finally {
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  }

  function removeAttachment(attachmentId: string) {
    if (disabled) return;
    const target = attachments.find((attachment) => attachment.attachmentId === attachmentId);
    if (target?.previewUrl) {
      URL.revokeObjectURL(target.previewUrl);
    }

    const remaining = attachments.filter((attachment) => attachment.attachmentId !== attachmentId);
    setAttachments(remaining);
    if (previewAttachmentId === attachmentId) {
      const nextPreviewAttachmentId = resolveNextPreviewAttachmentId(attachments, attachmentId);
      setPreviewAttachmentId(nextPreviewAttachmentId);
    }

    onAttachmentChange?.(
      remaining.length ? remaining[remaining.length - 1].filename : null
    );
    onAttachmentsChange?.(
      remaining.map((attachment) => ({
        attachmentId: attachment.attachmentId,
        filename: attachment.filename,
        hasVision: attachment.hasVision,
      }))
    );
    clearActiveSystemStatusMessage();
    invalidateStructuredAnalysis();
  }

  function clearAllAttachments() {
    if (disabled) return;
    attachments.forEach((attachment) => {
      if (attachment.previewUrl) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    });
    setAttachments([]);
    closeAttachmentPreview();
    setReplaceAttachmentId(null);
    onAttachmentChange?.(null);
    onAttachmentsChange?.([]);
    clearActiveSystemStatusMessage();
    invalidateStructuredAnalysis();
  }

  function handleReplaceAttachment(attachmentId: string) {
    if (disabled) return;
    invalidateStructuredAnalysis();
    setReplaceAttachmentId(attachmentId);
    fileInputRef.current?.click();
  }

  function handlePreviewNavigation(direction: "previous" | "next") {
    if (previewAttachmentIndex < 0) return;

    const nextIndex =
      direction === "previous" ? previewAttachmentIndex - 1 : previewAttachmentIndex + 1;
    const nextAttachment = attachments[nextIndex];
    if (!nextAttachment) return;
    setPreviewAttachmentId(nextAttachment.attachmentId);
  }

  async function handleDownloadRedactedChat() {
    if (disabled || loading || isExportingChat) return;

    const exportMessages = buildExportMessages(messages);
    const analysisText = analysisTextRef.current.trim();

    if (!hasExportContent(exportMessages, analysisText)) {
      pushSystemStatusMessage("There is no chat content available to download yet.");
      return;
    }

    setIsExportingChat(true);

    try {
      const response = await fetch("/api/chat/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildChatExportPayload(exportMessages, analysisText)),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        pushSystemStatusMessage(resolveExportErrorMessage(response.status, data?.error));
        return;
      }

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const filename = getDownloadFilename(response.headers.get("Content-Disposition"));
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.warn("[chat-export] download failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      pushSystemStatusMessage("The redacted chat download ran into a temporary issue. Please try again.");
    } finally {
      setIsExportingChat(false);
    }
  }

  function stopSpeaking() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }

    if (!BROWSER_TTS_ENABLED || !canUseBrowserReadAloud()) {
      setSpeakingMessageId(null);
      setIsSpeaking(false);
      utteranceRef.current = null;
      return;
    }

    window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setSpeakingMessageId(null);
    setIsSpeaking(false);
    setIsSpeechPaused(false);
  }

  function pauseSpeaking() {
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      setIsSpeechPaused(true);
      return;
    }
    if (BROWSER_TTS_ENABLED && canUseBrowserReadAloud() && window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      window.speechSynthesis.pause();
      setIsSpeechPaused(true);
    }
  }

  function resumeSpeaking() {
    if (audioRef.current && audioRef.current.paused) {
      void audioRef.current.play();
      setIsSpeechPaused(false);
      return;
    }
    if (BROWSER_TTS_ENABLED && canUseBrowserReadAloud() && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setIsSpeechPaused(false);
    }
  }

  async function playServerSpeech(message: Message, plainText: string) {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: plainText,
        voice: SERVER_TTS_VOICE,
        instructions: TTS_STYLE_PROMPT,
      }),
    });

    if (!response.ok) {
      throw new Error(`Server TTS failed (${response.status})`);
    }

    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);

    audioRef.current = audio;
    audioUrlRef.current = audioUrl;

    audio.onplay = () => {
      setSpeakingMessageId(message.id);
      setIsSpeaking(true);
    };
    audio.onended = () => {
      if (audioRef.current === audio) {
        stopSpeaking();
      }
    };
    audio.onerror = () => {
      if (audioRef.current === audio) {
        stopSpeaking();
      }
    };

    await audio.play();
  }

  function playBrowserSpeech(message: Message, plainText: string) {
    if (!BROWSER_TTS_ENABLED || !canUseBrowserReadAloud()) {
      throw new Error("Browser speech is unavailable.");
    }

    // Chunk long text into paragraphs so the browser doesn't drop words mid-read
    const chunks = plainText
      .split(/\n{2,}/)
      .map((c) => c.trim())
      .filter(Boolean);
    const speakChunks = chunks.length > 0 ? chunks : [plainText];

    let chunkIndex = 0;

    function speakNext() {
      if (chunkIndex >= speakChunks.length) {
        setSpeakingMessageId(null);
        setIsSpeaking(false);
        setIsSpeechPaused(false);
        utteranceRef.current = null;
        return;
      }
      const text = speakChunks[chunkIndex++];
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = selectedVoicePreset.rate;
      utterance.pitch = selectedVoicePreset.pitch;
      utterance.volume = 1;

      const browserVoices = window.speechSynthesis.getVoices();
      if (ttsVoiceName) {
        const match = browserVoices.find((v) => v.name === ttsVoiceName);
        if (match) utterance.voice = match;
      }

      utterance.onstart = () => {
        setSpeakingMessageId(message.id);
        setIsSpeaking(true);
        setIsSpeechPaused(false);
      };
      utterance.onend = () => {
        if (utteranceRef.current === utterance) {
          speakNext();
        }
      };
      utterance.onerror = () => {
        if (utteranceRef.current === utterance) {
          utteranceRef.current = null;
          setSpeakingMessageId(null);
          setIsSpeaking(false);
          setIsSpeechPaused(false);
        }
      };

      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    }

    speakNext();
  }

  async function handleSpeakMessage(message: Message) {
    if (disabled || message.kind === "system_status") return;
    if (speakingMessageId === message.id && isSpeaking) {
      stopSpeaking();
      return;
    }

    const plainText = toSpeechText(message.content);
    if (!plainText) {
      return;
    }

    stopSpeaking();

    if (SERVER_TTS_ENABLED) {
      try {
        await playServerSpeech(message, plainText);
        return;
      } catch (error) {
        console.warn("[tts] server playback failed, falling back to browser speech", {
          messageId: message.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!BROWSER_TTS_ENABLED || !canUseBrowserReadAloud()) {
      pushSystemStatusMessage(
        SERVER_TTS_ENABLED
          ? "Voiceover is temporarily unavailable."
          : "Voiceover is disabled until premium server speech is enabled."
      );
      return;
    }

    playBrowserSpeech(message, plainText);
  }

  const canReadAloud = SERVER_TTS_ENABLED || (BROWSER_TTS_ENABLED && canUseBrowserReadAloud());

  const userBubble = "border border-[#b86a2d]/35 bg-card text-foreground";

  return (
    <div
      className={`relative flex h-full min-h-0 flex-col overflow-hidden border-t border-border bg-card text-card-foreground ${disabled ? "opacity-75" : ""}`}
      onClick={() => {
        if (!disabled) {
          onChatEngagement?.();
        }
      }}
    >
      {!disabled && previewAttachment ? (
        <AttachmentPreviewModal
          key={previewAttachment.attachmentId}
          attachment={previewAttachment as PreviewAttachment}
          attachments={attachments as PreviewAttachment[]}
          currentIndex={previewAttachmentIndex}
          onClose={closeAttachmentPreview}
          onNavigate={handlePreviewNavigation}
          onRemove={(attachmentId) => removeAttachment(attachmentId)}
          onReplace={(attachmentId) => handleReplaceAttachment(attachmentId)}
        />
      ) : null}

      <div className="absolute inset-0 pointer-events-none bg-[url('/brand/logos/Logo-grey.png')] bg-no-repeat bg-center bg-[length:48%] opacity-[0.018] dark:opacity-[0.035]" />
      <div className="pointer-events-none absolute inset-0 bg-background/70 dark:bg-background/78" />

      <div className="relative z-10 flex flex-col flex-1 min-h-0">
        <div
          ref={scrollRef}
          className="
          overflow-y-auto
          flex-1
          px-3 sm:px-4
          min-h-0
          pt-3 sm:pt-4
          pb-4
          space-y-4
        "
        >
          {messages.length === 1 && messages[0].role === "assistant" && (
            <div className="flex flex-col items-center justify-center space-y-4 py-10 text-center">
              {showOpeningDisclaimer && !openingDisclaimerDismissed && (
                <div className="mx-auto max-w-[860px] border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                  <div className="flex items-start justify-between gap-3">
                  <div className="leading-7">
                      {OPENING_DISCLAIMER}
                    </div>
                    <button
                      type="button"
                      onClick={dismissOpeningDisclaimer}
                      className="shrink-0 rounded-lg bg-card p-2 text-muted-foreground transition hover:bg-background hover:text-foreground"
                      aria-label="Dismiss disclaimer"
                      title="Dismiss disclaimer"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              )}
              <div className="space-y-2 text-center">
                <div className="text-base font-semibold text-foreground">
                  Start a repair analysis
                </div>
                <div className="text-[13px] leading-5 text-muted-foreground">
                  Upload an estimate, procedure, or photo set and we&apos;ll turn it into a cleaner repair decision read.
                </div>
                <div className="mx-auto mt-2 max-w-[680px] text-xs leading-5 text-muted-foreground">
                  {uploadBatchGuidance}
                </div>
              </div>

              <div className="grid w-full max-w-[760px] grid-cols-1 gap-3 sm:grid-cols-3">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled}
                  className="border border-border bg-card px-3 py-2 text-left text-xs font-medium text-foreground transition hover:border-[#b86a2d]/45 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Upload Estimate
                </button>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled}
                  className="border border-border bg-card px-3 py-2 text-left text-xs font-medium text-foreground transition hover:border-[#b86a2d]/45 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Upload OEM Procedure
                </button>

                <button
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={disabled}
                  className="border border-border bg-card px-3 py-2 text-left text-xs font-medium text-foreground transition hover:border-[#b86a2d]/45 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Upload Photos
                </button>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${
                msg.role === "user"
                  ? "justify-end"
                  : msg.kind === "system_status"
                    ? "justify-center"
                    : "justify-start"
              }`}
            >
              <div
                className={`${
                  msg.kind === "system_status"
                    ? "max-w-[560px] border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground"
                    : "px-3.5 py-3"
                } ${
                  msg.role === "user"
                    ? `${userBubble} max-w-[min(72%,820px)] overflow-hidden break-words`
                    : msg.kind === "system_status"
                      ? ""
                      : "min-w-0 max-w-full overflow-hidden break-words border border-border bg-card sm:max-w-[860px]"
                }`}
              >
                {msg.role === "assistant" && msg.kind !== "system_status" ? (
                  <div>
                    <div className="mb-3 flex items-center justify-end gap-1">
                      {/* Browser voice selector — explicit fallback only; server TTS is the launch-quality path */}
                      {BROWSER_TTS_ENABLED && !SERVER_TTS_ENABLED && speakingMessageId !== msg.id && (
                        <div className="flex flex-col items-end gap-1">
                          <select
                            value={ttsVoiceName ? `voice:${ttsVoiceName}` : `preset:${ttsPresetId}`}
                            onChange={(e) => {
                              const value = e.target.value;
                              if (value.startsWith("voice:")) {
                                setTtsVoiceName(value.slice("voice:".length) || null);
                                return;
                              }
                              setTtsPresetId(value.replace(/^preset:/, "") || "default");
                              setTtsVoiceName(null);
                            }}
                            aria-label="Select voice"
                            title={selectedVoiceDescription}
                            className="rounded-xl border border-input bg-background px-2 py-1.5 text-[11px] font-medium text-foreground shadow-sm transition hover:bg-muted focus:border-ring focus:outline-none"
                          >
                            {VOICE_PRESETS.map((preset) => (
                              <option key={preset.id} value={`preset:${preset.id}`} className="bg-background text-foreground">
                                {preset.label}
                              </option>
                            ))}
                            {availableVoices.map((v) => (
                              <option key={v.name} value={`voice:${v.name}`} className="bg-background text-foreground">{v.name}</option>
                            ))}
                          </select>
                          {browserVoiceNotice || selectedVoiceDescription ? (
                            <span className="max-w-[220px] text-right text-[10px] leading-4 text-muted-foreground">
                              {browserVoiceNotice ?? selectedVoiceDescription}
                            </span>
                          ) : null}
                        </div>
                      )}
                      {/* Read button — shown when not currently speaking this message */}
                      {speakingMessageId !== msg.id && (
                        <button
                          type="button"
                          onClick={() => handleSpeakMessage(msg)}
                          disabled={!canReadAloud || disabled}
                          aria-label="Read aloud"
                          title={
                            canReadAloud
                              ? SERVER_TTS_ENABLED
                                ? "Read aloud"
                                : "Basic browser reader"
                              : "Voiceover requires server speech"
                          }
                          className="rounded-xl bg-muted p-2 text-muted-foreground transition hover:bg-muted/70 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Volume2 size={14} />
                        </button>
                      )}
                      {/* Pause / Resume — shown when this message is speaking */}
                      {speakingMessageId === msg.id && isSpeaking && !isSpeechPaused && (
                        <button
                          type="button"
                          onClick={pauseSpeaking}
                          aria-label="Pause"
                          title="Pause"
                          className="rounded-xl bg-muted p-2 text-muted-foreground transition hover:bg-muted/70 hover:text-foreground"
                        >
                          <Pause size={14} />
                        </button>
                      )}
                      {speakingMessageId === msg.id && isSpeechPaused && (
                        <button
                          type="button"
                          onClick={resumeSpeaking}
                          aria-label="Resume"
                          title="Resume"
                          className="rounded-xl bg-muted p-2 text-orange-600 transition hover:bg-muted/70 hover:text-orange-500"
                        >
                          <Play size={14} />
                        </button>
                      )}
                      {/* Stop — shown whenever something is speaking */}
                      {speakingMessageId === msg.id && (
                        <button
                          type="button"
                          onClick={stopSpeaking}
                          aria-label="Stop reading"
                          title="Stop"
                          className="rounded-xl bg-muted p-2 text-muted-foreground transition hover:bg-muted/70 hover:text-red-500"
                        >
                          <StopCircle size={14} />
                        </button>
                      )}
                    </div>
                    <div className="analysis-report min-w-0 overflow-hidden break-words text-[14px] leading-6 text-card-foreground">
                    <ReactMarkdown
                      components={{
                        h2: ({ children }) => (
                          <div className="mb-2 mt-5 border-b border-border pb-1 text-[13px] font-semibold uppercase tracking-[0.08em] text-[#b86a2d]">
                            {children}
                          </div>
                        ),
                        h3: ({ children }) => (
                          <div className="mb-1 mt-4 text-[13px] font-semibold text-[#b86a2d]">
                            {children}
                          </div>
                        ),
                        p: ({ children }) => (
                          <p className="mt-3 leading-6 text-card-foreground">{children}</p>
                        ),
                        ul: ({ children }) => (
                          <ul className="mt-2 ml-5 list-disc space-y-1.5 text-muted-foreground">
                            {children}
                          </ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="mt-2 ml-5 list-decimal space-y-1.5 text-muted-foreground">
                            {children}
                          </ol>
                        ),
                        strong: ({ children }) => (
                          <span className="font-semibold text-foreground">{children}</span>
                        ),
                      }}
                    >
                      {formatAssistantMessage(msg.content)}
                    </ReactMarkdown>
                    </div>
                  </div>
                ) : msg.kind === "system_status" ? (
                  <div className="text-center tracking-[0.02em]">{msg.content}</div>
                ) : (
                  <div className="whitespace-pre-wrap text-sm leading-6 text-current">
                    {msg.content}
                  </div>
                )}
              </div>
            </div>
          ))}

          <div ref={bottomRef} />
        </div>

        <div className="z-20 shrink-0 border-t border-border bg-card px-3 py-2">
          <div className="mx-auto w-full max-w-[1120px]">
            <div className="border border-border bg-muted px-2 py-2">
                <div className="flex items-center gap-2.5">
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".pdf,image/*"
                multiple
                disabled={disabled}
                title="Attach files"
                onChange={(e) => handleFilesSelected(e.target.files)}
              />

              <input
                type="file"
                ref={cameraInputRef}
                className="hidden"
                accept="image/*"
                {...(isLikelyMobileCaptureDevice && { capture: "environment" })}
                disabled={disabled}
                title="Take photo"
                onChange={(e) => handleCameraSelected(e.target.files)}
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled}
                className="rounded-md p-2 text-muted-foreground transition hover:bg-card hover:text-[#C65A2A] disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Attach files"
              >
                <Paperclip size={20} />
              </button>

              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={disabled}
                className="rounded-md p-2 text-muted-foreground transition hover:bg-card hover:text-[#C65A2A] disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Take photo"
              >
                <Camera size={20} />
              </button>

              <button
                type="button"
                onClick={handleMicClick}
                disabled={isTranscribing || disabled}
                className={`rounded-md p-2 transition ${
                  isRecording
                    ? "text-red-400 hover:text-red-300"
                    : "text-muted-foreground hover:bg-card hover:text-[#C65A2A]"
                } disabled:cursor-not-allowed disabled:opacity-50`}
                aria-label={
                  isRecording
                    ? "Stop recording"
                    : isTranscribing
                      ? "Transcribing audio"
                      : "Start voice recording"
                }
                title={
                  isRecording
                    ? "Stop recording"
                    : isTranscribing
                      ? "Transcribing audio"
                      : "Start voice recording"
                }
              >
                {isTranscribing ? (
                  <LoaderCircle size={20} className="animate-spin" />
                ) : isRecording ? (
                  <Square size={20} />
                ) : (
                  <Mic size={20} />
                )}
              </button>

              <textarea
                ref={textareaRef}
                value={input}
                onFocus={() => onChatEngagement?.()}
                onChange={(e) => {
                  onChatEngagement?.();
                  setInput(e.target.value);
                }}
                disabled={disabled}
                rows={1}
                placeholder={
                  hasAnyAttachment
                    ? "Ask about the attached case file or add context..."
                    : "Enter a repair analysis command or upload documentation..."
                }
                className="chat-composer-textarea min-h-[38px] max-h-[88px] flex-1 resize-none overflow-y-auto border border-input bg-background px-3 py-2 text-sm leading-5 text-foreground outline-none transition placeholder:text-muted-foreground focus:border-[#b86a2d] focus:ring-1 focus:ring-[#b86a2d]/30 disabled:cursor-not-allowed disabled:opacity-50"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />

              <button
                type="button"
                onClick={handleDownloadRedactedChat}
                disabled={disabled || loading || isTranscribing || isExportingChat}
                className="rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isExportingChat ? "Preparing..." : "Download Chat"}
              </button>

              <button
                onClick={handleSend}
                disabled={loading || isTranscribing || disabled}
                className="rounded-md border border-[#b86a2d] bg-[#b86a2d] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#c57934] disabled:opacity-50 sm:px-5"
              >
                {loading ? "..." : "Send"}
              </button>

              <button
                type="button"
                onClick={handleEndChat}
                className="rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-red-500/80 transition hover:bg-red-500/8 hover:text-red-500 disabled:opacity-50 dark:text-red-300/75 dark:hover:text-red-200"
                disabled={disabled || (loading && messages.length <= 1)}
                aria-label="End chat"
                title="End chat"
              >
                End
              </button>
                </div>

                {(isRecording || isTranscribing || recordingError) && (
                  <div
                    className={`mt-3 px-1 text-xs ${
                      recordingError ? "text-red-500" : "text-muted-foreground"
                    }`}
                  >
                    {recordingError
                      ? recordingError
                      : isTranscribing
                        ? "Transcribing your recording..."
                        : "Recording... click the mic again to stop."}
                  </div>
                )}
              </div>

              {attachments.length > 0 && (
                <div className="mt-2 border border-border bg-card p-2">
                <button
                  type="button"
                  className="flex w-full items-center justify-between bg-muted px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted/70"
                  onClick={() => setAttachmentsOpen((value) => !value)}
                  disabled={disabled}
                  aria-label="Toggle attachments"
                >
                  <span>
                    Attachments ({attachments.length})
                    <span className="ml-2 text-muted-foreground">
                      {visionAttachmentCount > 0
                        ? `- Vision: ${visionAttachmentCount}`
                        : ""}
                    </span>
                    <span className="ml-2 text-muted-foreground">
                      Files reviewed so far: {totalFilesReviewed}
                    </span>
                  </span>
                  {effectiveAttachmentsOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                </button>

                {effectiveAttachmentsOpen && (
                  <div className="mt-2 space-y-2">
                    <div className="border border-border bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
                      {uploadBatchGuidance}
                    </div>
                    {attachments.map((attachment) => (
                      <div
                        key={attachment.attachmentId}
                        className="flex items-center justify-between gap-3 border border-border bg-card px-3 py-2 text-sm text-muted-foreground"
                      >
                        <button
                          type="button"
                          onClick={() => handlePreviewAttachment(attachment.attachmentId)}
                          disabled={disabled}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="truncate pr-3 font-medium text-foreground">
                            {attachment.filename}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {formatAttachmentKind(attachment)} · {attachment.source === "camera" ? "Photo" : "File"}
                            {attachment.hasVision ? " · Vision" : ""}
                            {attachment.usedInAnalysis ? " · Used in analysis" : ""}
                          </div>
                        </button>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handlePreviewAttachment(attachment.attachmentId)}
                            aria-label="Preview attachment"
                            disabled={disabled}
                            className="rounded-xl bg-muted p-2 text-muted-foreground transition hover:bg-muted/70 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Eye size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReplaceAttachment(attachment.attachmentId)}
                            aria-label="Replace attachment"
                            disabled={disabled}
                            className="rounded-xl bg-muted p-2 text-muted-foreground transition hover:bg-muted/70 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <RefreshCcw size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeAttachment(attachment.attachmentId)}
                            aria-label="Remove attachment"
                            disabled={disabled}
                            className="rounded-xl bg-muted p-2 text-muted-foreground transition hover:bg-muted/70 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <X size={15} />
                          </button>
                        </div>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={clearAllAttachments}
                      disabled={disabled}
                      className="text-xs text-muted-foreground transition hover:text-[#C65A2A] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Clear all
                    </button>
                  </div>
                )}
                </div>
              )}
            </div>
          </div>
        </div>
    </div>
  );
}

function resolveNextPreviewAttachmentId(
  attachments: Attachment[],
  removedAttachmentId: string
): string | null {
  const removedIndex = attachments.findIndex(
    (attachment) => attachment.attachmentId === removedAttachmentId
  );
  if (removedIndex === -1) {
    return null;
  }

  const remaining = attachments.filter((attachment) => attachment.attachmentId !== removedAttachmentId);
  if (remaining.length === 0) {
    return null;
  }

  return (
    remaining[Math.min(removedIndex, remaining.length - 1)]?.attachmentId ?? null
  );
}
