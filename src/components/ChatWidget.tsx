"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
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
  isLikelyVideoFile,
  MAX_UPLOAD_FILE_BYTES,
  summarizeAttachmentStats,
  validateSelectedVideoDurations,
} from "@/components/chatWidget/attachmentUtils";
import {
  formatAssistantDisplayMessage,
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
import { isNative, saveAndShareBlob } from "@/lib/native";
import { buildPlanRecommendationGuard, canAccessFeature } from "@/lib/featureAccess";
import { emitSafeCrmEventFromClient } from "@/lib/crm/events";
import { buildNextBatchPrompt, buildUploadBatchGuidance } from "@/lib/uploadBatching";
import {
  getUploadBatchLimitMessage,
  resolveUploadPlanLimits,
  VIDEO_UPLOAD_ACCEPT,
} from "@/lib/uploadSafety/uploadLimits";
import { VIDEO_MAX_BYTES } from "@/lib/uploadSafety/videoSafety";
import {
  buildReviewCompletenessMessage,
  type ExcludedFromReviewFileDiagnostic,
  type ExcludedFromReviewReason,
} from "@/lib/reviewCompleteness";
import {
  isRetryableProviderMessage,
  RETRYABLE_PROVIDER_USER_MESSAGE,
} from "@/lib/ai/providerRetryableError";
import {
  resolveAnnotatedCitationDensityTarget,
  shouldGenerateAnnotatedCitationDensityEstimate,
} from "@/lib/reports/citationDensityIntent";
import { speak, TtsClientError, type SpeakResult, type TtsProvider, type TtsVoiceSymbol } from "@/lib/tts";

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
  classification?: "image" | "video" | "pdf" | "text" | "docx";
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
  classification?: "image" | "video" | "pdf" | "text" | "docx";
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
    entryCount?: number;
    acceptedEntries?: string[];
    rejectedEntries?: Array<{
      filename?: string;
      reason?: string;
      code?: string;
    }>;
  }>;
  telemetry?: {
    extractedFileCount?: number;
    rejectedFileCount?: number;
  };
  error?: string;
};

type PrimaryAnalysis = {
  messageId: string;
  content: string;
};

type AnalysisStatus = "idle" | "processing" | "complete" | "error";
type UploadUiState = "idle" | "uploading" | "uploaded" | "error";

type ChatSessionControls = {
  focusComposer: () => void;
  resetSession: () => void;
  sendPrompt: (prompt: string) => Promise<void>;
};

export type ReviewProgress = {
  uploaded: number;
  indexed: number;
  visionProcessed: number;
  reviewedForDetermination: number;
  reviewableFileCount: number;
  excludedFromReviewCount: number;
  excludedFromReviewReasons: ExcludedFromReviewReason[];
  excludedFromReviewFiles: ExcludedFromReviewFileDiagnostic[];
  totalKnownFiles: number;
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

type AnalysisFailureResponse = {
  retryable?: boolean;
  stage?: string;
  provider?: string;
  status?: number;
  statusCode?: number;
  message?: string;
  error?: string;
  contextBudget?: Record<string, unknown> | null;
  toolUsageTrace?: Array<Record<string, unknown>>;
};

const RETRYABLE_ANALYSIS_MESSAGE = "Analysis provider is busy. Please retry shortly.";

async function resolveAnalysisFailure(response: Response) {
  let payload: AnalysisFailureResponse | null = null;

  try {
    payload = (await response.json()) as AnalysisFailureResponse;
  } catch {
    payload = null;
  }

  const detail = payload?.message || payload?.error || `Analysis failed (${response.status})`;
  const retryable =
    payload?.retryable === true ||
    response.status === 429 ||
    response.status === 503 ||
    isRetryableProviderMessage(detail);

  return {
    retryable,
    detail: retryable ? RETRYABLE_ANALYSIS_MESSAGE : detail,
    stage: payload?.stage ?? "analysis",
    provider: payload?.provider ?? "openai",
    status: payload?.status ?? response.status,
    statusCode: payload?.statusCode ?? response.status,
  };
}

async function resolveProviderFailure(response: Response, fallbackLabel: string) {
  let payload: AnalysisFailureResponse | null = null;

  try {
    payload = (await response.json()) as AnalysisFailureResponse;
  } catch {
    payload = null;
  }

  const detail = payload?.message || payload?.error || `${fallbackLabel} failed (${response.status})`;
  const retryable =
    payload?.retryable === true ||
    response.status === 429 ||
    response.status === 503 ||
    isRetryableProviderMessage(detail);

  return {
    retryable,
    detail: retryable ? RETRYABLE_PROVIDER_USER_MESSAGE : detail,
    stage: payload?.stage ?? "chat",
    provider: payload?.provider ?? "openai",
    status: payload?.status ?? response.status,
    statusCode: payload?.statusCode ?? response.status,
  };
}

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
  onReviewProgressChange?: Dispatch<SetStateAction<ReviewProgress>>;
  viewerAccess?: AccountEntitlements | null;
  suppressedMessageIds?: string[];
  caseChatEnabled?: boolean;
  activeCaseId?: string | null;
  caseIntent?: string;
  assistanceProfile?: string | null;
  transcriptSummary?: string | null;
  exportModel?: unknown;
  followUpFiles?: Array<{ id: string; name: string; type?: string; url?: string }>;
  followUpExports?: Array<{ label: string; type?: string; url?: string }>;
  layoutScrollKey?: string;
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

const TTS_ALLOW_BROWSER_FALLBACK =
  process.env.NEXT_PUBLIC_TTS_ALLOW_BROWSER_FALLBACK === "true";
const ZIP_MAX_BYTES = 50 * 1024 * 1024;
const CHAT_SESSION_STORAGE_PREFIX = "collision-iq.chat-widget.session";
const DRAFT_CHAT_SESSION_KEY = `${CHAT_SESSION_STORAGE_PREFIX}:draft`;
const INTRO_DISMISSAL_SESSION_KEY = "collision-iq.chat-widget.introDismissed";
const LARGE_UPLOAD_WARNING_BYTES = 10 * 1024 * 1024;
type ServerTtsVoiceOptionId = TtsVoiceSymbol;
type ServerTtsVoiceOption = {
  id: ServerTtsVoiceOptionId;
  label: string;
};
const DEFAULT_SERVER_TTS_VOICE: ServerTtsVoiceOptionId = "voice_1";
const SERVER_TTS_VOICE_OPTIONS: [ServerTtsVoiceOption, ServerTtsVoiceOption] = [
  {
    id: "voice_1",
    label: "Voice 1",
  },
  {
    id: "voice_2",
    label: "Voice 2",
  },
];

class StaleTtsPlaybackError extends Error {
  constructor(message = "Stale TTS playback ignored.") {
    super(message);
    this.name = "StaleTtsPlaybackError";
  }
}

function buildTtsMessageDiagnostics(message: Message) {
  return {
    messageId: message.id,
    messageRole: message.role,
    messageKind: message.kind ?? "analysis",
  };
}

function resolveTtsStatusMessage(voice: ServerTtsVoiceOption, error: unknown) {
  if (error instanceof TtsClientError) {
    if (error.code === "TTS_NOT_CONFIGURED") {
      return `ElevenLabs is not configured (${error.missing?.join(", ") || "missing env"}).`;
    }
    if (error.code === "TTS_UNKNOWN_VOICE") {
      return `${voice.label} is not a supported ElevenLabs voice.`;
    }
    return `${voice.label} is unavailable (${error.code}).`;
  }

  return "ElevenLabs voiceover is unavailable.";
}

const DEFAULT_UPLOAD_LIMIT_ENTITLEMENTS: Pick<
  AccountEntitlements,
  "plan" | "billingPlan" | "isPlatformAdmin" | "entitlementSource"
> = {
  plan: "starter",
  billingPlan: "starter",
  isPlatformAdmin: false,
  entitlementSource: "starter_subscription",
};
const FALLBACK_UPLOAD_BATCH_FILE_LIMIT = 50;

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
  const maxFileFailures = namedFailures.filter(
    (failure) => failure.code === "MAX_FILES_REACHED"
  );
  const otherFailures = namedFailures.filter(
    (failure) => failure.code !== "MAX_FILES_REACHED"
  );

  if (!namedFailures.length) {
    return "No files could be attached.";
  }

  const parts: string[] = [];

  if (maxFileFailures.length) {
    parts.push(
      `${maxFileFailures.length} files were skipped because you can upload up to 6 files at a time.`
    );
  }

  if (otherFailures.length) {
    parts.push(
      `Could not attach ${otherFailures
        .map((failure) => {
          if (failure.code === "RUNTIME_BODY_LIMIT_EXCEEDED") {
            return `${failure.filename}: This file is within your plan limit, but exceeds the current platform upload limit. Direct large-file upload support is coming soon. For now, split ZIPs over 20 MB into smaller uploads.`;
          }

          return `${failure.filename}: ${failure.reason ?? "Upload failed."}`;
        })
        .join("; ")}`
    );
  }

  return parts.join(" ");
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

function countKnownFilesFromUploadResponse(data: UploadResponse | null, returnedUploads: UploadSuccessResult[]) {
  const telemetryKnown =
    (data?.telemetry?.extractedFileCount ?? 0) + (data?.telemetry?.rejectedFileCount ?? 0);
  const zipKnown = (data?.zipSummaries ?? []).reduce(
    (sum, summary) => sum + (summary.acceptedFiles ?? 0) + (summary.rejectedFiles ?? 0),
    0
  );
  return Math.max(telemetryKnown, zipKnown, returnedUploads.length + (data?.failedUploads?.length ?? 0));
}

function buildReviewCompletionMessage(progress: ReviewProgress) {
  return buildReviewCompletenessMessage({
    reviewed: progress.reviewedForDetermination,
    total: progress.reviewableFileCount || progress.totalKnownFiles,
  });
}

function mergeExcludedFromReviewFiles(
  current: ExcludedFromReviewFileDiagnostic[],
  next: ExcludedFromReviewFileDiagnostic[]
) {
  const seen = new Set<string>();
  return [...current, ...next].filter((item) => {
    const key = `${item.filename}:${item.detectedType}:${item.reason}:${item.indexed}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getChatSessionStorageKey(activeCaseId: string | null | undefined) {
  const normalized = activeCaseId?.trim();
  return normalized
    ? `${CHAT_SESSION_STORAGE_PREFIX}:case:${normalized}`
    : DRAFT_CHAT_SESSION_KEY;
}

function isInitialOnlyMessages(messages: Message[]) {
  return messages.length === 1 && messages[0]?.id === INITIAL_MESSAGE.id;
}

function readStoredChatMessages(storageKey: string): Message[] | null {
  if (typeof window === "undefined") return null;

  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null") as unknown;
    if (!Array.isArray(parsed)) return null;
    const messages = parsed.filter((item): item is Message => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Partial<Message>;
      return (
        typeof candidate.id === "string" &&
        (candidate.role === "user" || candidate.role === "assistant") &&
        typeof candidate.content === "string"
      );
    });
    return messages.length ? messages : null;
  } catch {
    return null;
  }
}

function writeStoredChatMessages(storageKey: string, messages: Message[]) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(messages));
  } catch {
    // Session persistence is a best-effort remount guard.
  }
}

function removeStoredChatMessages(storageKey: string) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Ignore storage cleanup failures.
  }
}

function readIntroDismissedForSession() {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(INTRO_DISMISSAL_SESSION_KEY) === "true";
}

function writeIntroDismissedForSession() {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(INTRO_DISMISSAL_SESSION_KEY, "true");
  } catch {
    // Intro dismissal is a best-effort session preference.
  }
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

function isSupportedDropUploadFile(file: File) {
  const name = file.name.toLowerCase();
  return (
    file.type === "application/pdf" ||
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed" ||
    file.type === "video/mp4" ||
    file.type === "video/quicktime" ||
    file.type === "video/webm" ||
    file.type.startsWith("image/") ||
    /\.(pdf|jpe?g|png|webp|heic|zip|mp4|mov|webm)$/i.test(name)
  );
}

function isVideoAttachment(attachment: Pick<Attachment, "mime" | "filename" | "classification">) {
  return (
    attachment.classification === "video" ||
    attachment.mime.startsWith("video/") ||
    /\.(?:mp4|mov|webm)$/i.test(attachment.filename)
  );
}

function buildVideoDocumentationStatus(attachments: Array<Pick<Attachment, "filename">>) {
  const count = attachments.length;
  const names = attachments.map((attachment) => attachment.filename).join(", ");

  return `${count} short ${count === 1 ? "video was" : "videos were"} attached as damage documentation${names ? `: ${names}` : ""}. Still images remain preferred for direct AI visual analysis.`;
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

function buildUploadSuccessStatus(count: number, filenames: string[], label: "file" | "photo") {
  const noun = count === 1 ? label : label === "photo" ? "photos" : "files";
  const visibleNames = filenames.filter(Boolean).slice(0, 3);
  const namesText = visibleNames.length
    ? `: ${visibleNames.join(", ")}${filenames.length > visibleNames.length ? `, +${filenames.length - visibleNames.length} more` : ""}`
    : "";
  return `${count} ${noun} uploaded${namesText}.`;
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
  if (/(umpire|appraisal|appraiser|award|amount of loss|amount-of-loss|which amount|decide between estimates|which estimate)/i.test(lower)) {
    return "appraisal award recommendation";
  }
  if (/(doi|department of insurance|insurance department|regulator|complaint|bad faith|unfair claim)/i.test(lower)) {
    return "DOI preparation";
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
  onReviewProgressChange,
  viewerAccess = null,
  caseChatEnabled = false,
  activeCaseId = null,
  caseIntent = "Continue with this case",
  assistanceProfile = null,
  layoutScrollKey,
  disabled = false,
}: ChatWidgetProps) {
  const router = useRouter();
  const { isLoaded: isUserLoaded, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const [chatSessionStorageKey, setChatSessionStorageKey] = useState(() =>
    getChatSessionStorageKey(activeCaseId)
  );
  const [messages, setMessages] = useState<Message[]>(() => {
    const stored = readStoredChatMessages(getChatSessionStorageKey(activeCaseId));
    return stored ?? [INITIAL_MESSAGE];
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isExportingChat, setIsExportingChat] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentsOpen, setAttachmentsOpen] = useState(true);
  const [mobileAttachmentsOpen, setMobileAttachmentsOpen] = useState(true);
  const [isNativeClient, setIsNativeClient] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null);
  const [replaceAttachmentId, setReplaceAttachmentId] = useState<string | null>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSpeechPaused, setIsSpeechPaused] = useState(false);
  const [ttsGeneratingMessageId, setTtsGeneratingMessageId] = useState<string | null>(null);
  const [serverTtsVoiceId, setServerTtsVoiceId] =
    useState<ServerTtsVoiceOptionId>(DEFAULT_SERVER_TTS_VOICE);
  const [messageVoiceSelections, setMessageVoiceSelections] = useState<Record<string, ServerTtsVoiceOptionId>>({});
  const [ttsPlaybackProvider, setTtsPlaybackProvider] = useState<TtsProvider | null>(null);
  const [totalFilesReviewed, setTotalFilesReviewed] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [introDismissed, setIntroDismissed] = useState(false);
  const [fetchedViewerAccess, setFetchedViewerAccess] = useState<AccountEntitlements | null>(null);
  const [entitlementLoadAttempted, setEntitlementLoadAttempted] = useState(false);
  const [uploadUiState, setUploadUiState] = useState<UploadUiState>("idle");
  const [selectedUploadNames, setSelectedUploadNames] = useState<string[]>([]);
  const [uploadUiMessage, setUploadUiMessage] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

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
  const reviewProgressRef = useRef<ReviewProgress>({
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
  const firstAttachmentAtRef = useRef<number | null>(null);
  const speechPlaybackTokenRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const ttsFetchAbortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const handleSendRef = useRef<(promptOverride?: string) => Promise<void>>(async () => {});
  const messageCounterRef = useRef(0);
  const activeSystemStatusMessageIdRef = useRef<string | null>(null);
  const currentCaseTopicRef = useRef(DEFAULT_CASE_TOPIC);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const recordingMimeTypeRef = useRef("audio/webm");
  const chatSessionStorageKeyRef = useRef(chatSessionStorageKey);
  const mobileAttachmentsUserToggledRef = useRef(false);

  const updateReviewProgress = useCallback(
    (update: SetStateAction<ReviewProgress>) => {
      const next =
        typeof update === "function"
          ? (update as (current: ReviewProgress) => ReviewProgress)(reviewProgressRef.current)
          : update;
      reviewProgressRef.current = next;
      onReviewProgressChange?.(next);
      return next;
    },
    [onReviewProgressChange]
  );

  const hasAnyAttachment = useMemo(() => attachments.length > 0, [attachments]);
  const hasAssistantResponse = useMemo(
    () =>
      messages.some(
        (message) =>
          message.role === "assistant" &&
          message.id !== INITIAL_MESSAGE.id &&
          !isSystemStatusMessage(message)
      ),
    [messages]
  );
  const shouldCompactMobileChat =
    (isNativeClient || isMobileViewport) && hasAssistantResponse;
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
  const effectiveAttachmentsOpen = attachments.length === 0 ? true : attachmentsOpen;
  const attachmentTraySummary = useMemo(() => {
    const parts = [
      `Attachments (${attachments.length})`,
      visionAttachmentCount > 0 ? `Vision: ${visionAttachmentCount}` : null,
      `Files reviewed so far: ${totalFilesReviewed}`,
    ].filter(Boolean);
    return parts.join(" · ");
  }, [attachments.length, totalFilesReviewed, visionAttachmentCount]);
  const selectedUploadStatusText =
    selectedUploadNames.length > 20
      ? `${selectedUploadNames.length} files selected`
      : selectedUploadNames.join(", ");
  const hasUploadStatus = selectedUploadNames.length > 0 || uploadUiState !== "idle";
  const showMobileUploadStatus =
    uploadUiState === "uploading" || uploadUiState === "error";
  const previousAttachmentCountRef = useRef(0);

  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 1023px)");

    function syncMobileRuntime() {
      setIsNativeClient(isNative());
      setIsMobileViewport(mobileQuery.matches);
    }

    const frame = window.requestAnimationFrame(syncMobileRuntime);
    mobileQuery.addEventListener("change", syncMobileRuntime);

    return () => {
      window.cancelAnimationFrame(frame);
      mobileQuery.removeEventListener("change", syncMobileRuntime);
    };
  }, []);

  useEffect(() => {
    const previousCount = previousAttachmentCountRef.current;
    if (attachments.length > 20 && previousCount <= 20) {
      setAttachmentsOpen(false);
    }
    previousAttachmentCountRef.current = attachments.length;
  }, [attachments.length]);

  useEffect(() => {
    if (!attachments.length || mobileAttachmentsUserToggledRef.current) return;
    setMobileAttachmentsOpen(!shouldCompactMobileChat);
  }, [attachments.length, shouldCompactMobileChat]);

  useEffect(() => {
    if (!loading || !shouldCompactMobileChat || mobileAttachmentsUserToggledRef.current) return;
    setMobileAttachmentsOpen(false);
  }, [loading, shouldCompactMobileChat]);
  useEffect(() => {
    if (viewerAccess) {
      return;
    }

    if (!isUserLoaded || !isSignedIn) {
      return;
    }

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
        if (!response.ok) {
          console.warn("ENTITLEMENTS_RESPONSE_FAILED", response.status);
          return;
        }

        const entitlements = (await response.json()) as AccountEntitlements;
        console.log("ENTITLEMENTS_RESPONSE", entitlements);
        console.log("DERIVED_UPLOAD_CAP", entitlements.uploadCap);
        console.log("DERIVED_IS_ADMIN", entitlements.isPlatformAdmin === true);
        if (!cancelled) {
          setFetchedViewerAccess(entitlements);
          setEntitlementLoadAttempted(true);
        }
      } catch (error) {
        console.warn("ENTITLEMENTS_LOAD_FAILED", error);
        // Server-side upload limits remain authoritative if entitlement loading fails.
      } finally {
        if (!cancelled) {
          setEntitlementLoadAttempted(true);
        }
      }
    }

    void loadViewerAccess();
    return () => {
      cancelled = true;
    };
  }, [getToken, isSignedIn, isUserLoaded, viewerAccess]);

  const resolvedViewerAccess = isSignedIn ? viewerAccess ?? fetchedViewerAccess : null;
  const productPlan = resolvedViewerAccess?.plan ?? "none";
  const hasProChatRecommendations = canAccessFeature(productPlan, "chat_report_recommendations");
  const uploadPlanLimits = useMemo(
    () => resolveUploadPlanLimits(resolvedViewerAccess ?? DEFAULT_UPLOAD_LIMIT_ENTITLEMENTS),
    [resolvedViewerAccess]
  );
  const uploadLimitsLoading = isSignedIn && !resolvedViewerAccess && !entitlementLoadAttempted;
  const uploadLimitsUnavailable = isSignedIn && !resolvedViewerAccess && entitlementLoadAttempted;
  const effectiveUploadPlanLimits = uploadLimitsUnavailable
    ? {
        ...uploadPlanLimits,
        maxFilesPerReview: FALLBACK_UPLOAD_BATCH_FILE_LIMIT,
      }
    : uploadPlanLimits;
  const maxUploadBatchFiles = uploadLimitsLoading ? 0 : effectiveUploadPlanLimits.maxFilesPerReview;
  const uploadBatchGuidance = uploadLimitsLoading
    ? "Loading upload limits..."
    : uploadLimitsUnavailable
      ? "Upload limits are unavailable; the server will validate your upload access."
    : buildUploadBatchGuidance(
        totalFilesReviewed,
        attachments.length,
        maxUploadBatchFiles,
        effectiveUploadPlanLimits.plan
      );

  useEffect(() => {
    if (!isSignedIn || uploadLimitsLoading) return;
    console.log("FINAL_DERIVED_UPLOAD_CAP", resolvedViewerAccess?.uploadCap);
    console.log("FINAL_DERIVED_IS_ADMIN", resolvedViewerAccess?.isPlatformAdmin === true);
    console.log("FINAL_MAX_UPLOAD_BATCH_FILES", maxUploadBatchFiles);
  }, [isSignedIn, maxUploadBatchFiles, resolvedViewerAccess, uploadLimitsLoading]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setIntroDismissed(readIntroDismissedForSession());
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    chatSessionStorageKeyRef.current = chatSessionStorageKey;
    writeStoredChatMessages(chatSessionStorageKey, messages);
  }, [chatSessionStorageKey, messages]);

  useEffect(() => {
    if (!introDismissed || !isInitialOnlyMessages(messages)) return;
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [introDismissed, messages]);

  useEffect(() => {
    if (!layoutScrollKey || !shouldAutoScrollRef.current) return;
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
  }, [layoutScrollKey]);

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
    const nextStorageKey = getChatSessionStorageKey(activeCaseId);
    if (chatSessionStorageKeyRef.current === nextStorageKey) return;

    const previousStorageKey = chatSessionStorageKeyRef.current;
    const storedMessages = readStoredChatMessages(nextStorageKey);

    setMessages((current) => {
      if (storedMessages) return storedMessages;
      if (previousStorageKey === DRAFT_CHAT_SESSION_KEY && !isInitialOnlyMessages(current)) {
        return current;
      }
      return [INITIAL_MESSAGE];
    });
    setChatSessionStorageKey(nextStorageKey);
  }, [activeCaseId]);

  /* eslint-disable react-hooks/exhaustive-deps */
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
  /* eslint-enable react-hooks/exhaustive-deps */

  /* eslint-disable react-hooks/exhaustive-deps */
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
  /* eslint-enable react-hooks/exhaustive-deps */

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
    if (data && shouldCompactMobileChat && !mobileAttachmentsUserToggledRef.current) {
      setMobileAttachmentsOpen(false);
    }
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

  async function prepareFilesForUpload(fileList: FileList | File[] | null, source: "file" | "camera") {
    const selectedFiles = Array.from(fileList ?? []);
    const rejectedFiles: UploadFailureResult[] = [];

    const filesWithinCount = selectedFiles.filter((file, index) => {
      if (index < maxUploadBatchFiles) {
        return true;
      }

      rejectedFiles.push({
        filename: file.name,
        reason: getUploadBatchLimitMessage(effectiveUploadPlanLimits),
        code: "MAX_FILES_REACHED",
      });
      return false;
    });

    const acceptedFiles = filesWithinCount.filter((file) => {
      if (!isSupportedDropUploadFile(file)) {
        rejectedFiles.push({
          filename: file.name,
          reason: "Only PDF, image, short video, and ZIP archive uploads are supported here.",
          code: "UNSUPPORTED_EXTENSION",
        });
        return false;
      }

      if (isZipFile(file) && file.size > ZIP_MAX_BYTES) {
        rejectedFiles.push({
          filename: file.name,
          reason: `ZIP archive is ${formatBytes(file.size)}. Max size is ${formatBytes(ZIP_MAX_BYTES)}.`,
          code: "ZIP_TOO_LARGE",
        });
        return false;
      }

      const maxFileBytes = isLikelyVideoFile(file)
        ? Math.min(MAX_UPLOAD_FILE_BYTES, VIDEO_MAX_BYTES)
        : MAX_UPLOAD_FILE_BYTES;

      if (file.size <= maxFileBytes) {
        return true;
      }

      rejectedFiles.push({
        filename: file.name,
        reason: `File is ${formatBytes(file.size)}. Max size is ${formatBytes(maxFileBytes)}.`,
        code: "FILE_TOO_LARGE",
      });
      return false;
    });

    const videoFailures = await validateSelectedVideoDurations(acceptedFiles);
    if (videoFailures.length) {
      for (const failure of videoFailures) {
        rejectedFiles.push(failure);
      }
    }

    const videoRejectedNames = new Set(videoFailures.map((failure) => failure.filename));
    const durationValidatedFiles = acceptedFiles.filter((file) => !videoRejectedNames.has(file.name));

    if (rejectedFiles.length) {
      console.info("[attachments] files rejected before upload", {
        source,
        selectedCount: selectedFiles.length,
        acceptedCount: durationValidatedFiles.length,
        rejectedFiles,
      });
    }

    return { acceptedFiles: durationValidatedFiles, rejectedFiles };
  }

  function dismissOpeningDisclaimer() {
    writeIntroDismissedForSession();
    setIntroDismissed(true);
  }

  function dismissIntroForComposerEngagement() {
    if (introDismissed) return;
    writeIntroDismissedForSession();
    setIntroDismissed(true);
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
    removeStoredChatMessages(chatSessionStorageKeyRef.current);
    if (analysisReportIdRef.current) {
      removeStoredChatMessages(getChatSessionStorageKey(analysisReportIdRef.current));
    } else {
      removeStoredChatMessages(DRAFT_CHAT_SESSION_KEY);
    }
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

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

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
    updateReviewProgress({
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
    setAttachmentsOpen(true);
    setPreviewAttachmentId(null);
    setReplaceAttachmentId(null);
    setUploadUiState("idle");
    setSelectedUploadNames([]);
    setUploadUiMessage(null);
    setIsDragActive(false);
    firstAttachmentAtRef.current = null;
    currentCaseTopicRef.current = DEFAULT_CASE_TOPIC;
    activeSystemStatusMessageIdRef.current = null;
    setIntroDismissed(readIntroDismissedForSession());

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
    updateReviewProgress,
  ]);

  const handleEndChatRequest = useCallback(() => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("End this chat? This will clear the current conversation.")
    ) {
      return;
    }

    handleEndChat();
  }, [handleEndChat]);

  handleSendRef.current = handleSend;

  useEffect(() => {
    onSessionControlsReady?.({
      focusComposer: () => textareaRef.current?.focus(),
      resetSession: handleEndChat,
      sendPrompt: (prompt) => handleSendRef.current(prompt),
    });
  }, [onSessionControlsReady, handleEndChat]);

  async function handleSend(promptOverride?: string) {
    if (disabled) return;
    if (loading) return;
    const pendingAttachmentsForTurn = attachments.filter((attachment) => !attachment.usedInAnalysis);
    const documentationVideoAttachments = pendingAttachmentsForTurn.filter(isVideoAttachment);
    const attachmentsForTurn = pendingAttachmentsForTurn.filter(
      (attachment) => !isVideoAttachment(attachment)
    );
    const trimmedInput = (promptOverride ?? input).trim();
    if (!trimmedInput && pendingAttachmentsForTurn.length === 0) return;

    if (documentationVideoAttachments.length > 0) {
      upsertSystemStatusMessage(buildVideoDocumentationStatus(documentationVideoAttachments));
      setAttachments((prev) =>
        prev.map((attachment) =>
          documentationVideoAttachments.some((video) => video.attachmentId === attachment.attachmentId)
            ? { ...attachment, usedInAnalysis: true }
            : attachment
        )
      );
    }

    if (!trimmedInput && attachmentsForTurn.length === 0) {
      return;
    }

    // Collapse the review workspace from the real send path so typed prompts always focus chat.
    onUserPromptSent?.();
    onChatEngagement?.();
    stopSpeaking();
    if (shouldCompactMobileChat && !mobileAttachmentsUserToggledRef.current) {
      setMobileAttachmentsOpen(false);
    }
    setLoading(true);
    shouldAutoScrollRef.current = true;

    const mySession = sessionRef.current;
    const messageToSend = trimmedInput || buildAttachmentSummary(attachmentsForTurn);
    const activeCaseTopic = updateCaseTopic(messageToSend);
    const hasAttachmentsInTurn = attachmentsForTurn.length > 0;
    const activeAnalysisRunId = hasAttachmentsInTurn ? beginStructuredAnalysisRun() : null;
    const attachmentStats = {
      ...summarizeAttachmentStats(attachmentsForTurn),
      totalPdfPages: attachmentsForTurn.reduce((sum, attachment) => sum + (attachment.pageCount ?? 0), 0),
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
      if (shouldGenerateAnnotatedCitationDensityEstimate(messageToSend)) {
        const activeCaseId = analysisReportIdRef.current;

        if (!activeCaseId) {
          const reply = "I need an active analyzed case before I can generate an annotated Citation Density estimate PDF.";

          if (sessionRef.current === mySession) {
            clearActiveSystemStatusMessage();
            stopSpeaking();
            messageCounterRef.current += 1;
            const assistantMessage = createMessage(messageCounterRef.current, "assistant", reply);
            setMessages((prev) => [...prev, assistantMessage]);
            updateAnalysisText(reply);
            onPrimaryAnalysisChange?.({
              messageId: assistantMessage.id,
              content: reply,
            });
          }

          return;
        }

        if (activeCaseId) {
          upsertSystemStatusMessage("Generating annotated citation density estimate PDF...");
          const exportResponse = await fetch("/api/reports/citation-density/annotated-estimate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              caseId: activeCaseId,
              targetEstimate: resolveAnnotatedCitationDensityTarget(messageToSend),
              annotationMode: "both",
              includeLegend: true,
              includeSummaryPage: false,
              redactSensitive: true,
            }),
          });

          if (!exportResponse.ok) {
            const data = (await exportResponse.json().catch(() => null)) as {
              error?: string;
              userMessage?: string;
            } | null;
            throw new Error(data?.userMessage || data?.error || "Annotated estimate export failed.");
          }

          const data = (await exportResponse.json()) as {
            downloadUrl?: string;
            outputs?: Array<{ estimateRole?: string; downloadUrl?: string; unresolvedAnchorCount?: number }>;
            annotatedFindingCount?: number;
            unresolvedAnchorCount?: number;
            warnings?: string[];
          };
          const unanchoredText =
            (data.unresolvedAnchorCount ?? 0) > 0
              ? " Unanchored items were placed in the appendix."
              : "";
          const warningText = data.warnings?.length ? `\n\nWarnings: ${data.warnings.join(" ")}` : "";
          const downloadLinks = data.outputs?.length
            ? data.outputs
                .filter((output) => typeof output.downloadUrl === "string")
                .map((output) => `[Download Citation Density PDF${output.estimateRole ? ` (${output.estimateRole})` : ""}](${output.downloadUrl})`)
                .join("\n")
            : `[Download Citation Density PDF](${data.downloadUrl ?? "#"})`;
          const allUnanchored = data.warnings?.includes("all_findings_unanchored") ?? false;
          const reply = allUnanchored
            ? `The annotated Citation Density estimate PDF was generated with a warning: no line-level or page-level anchors were placed. Do not treat this as a fully successful markup.${unanchoredText}\n\n${downloadLinks}${warningText}`
            : `Done — I generated the annotated citation-density estimate PDF. It preserves the original estimate layout and overlays citation/proof callouts.${unanchoredText}\n\n${downloadLinks}${warningText}`;

          if (sessionRef.current === mySession) {
            clearActiveSystemStatusMessage();
            stopSpeaking();
            messageCounterRef.current += 1;
            const assistantMessage = createMessage(messageCounterRef.current, "assistant", reply);
            setMessages((prev) => [...prev, assistantMessage]);
            updateAnalysisText(reply);
            onPrimaryAnalysisChange?.({
              messageId: assistantMessage.id,
              content: reply,
            });
          }

          return;
        }
      }

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
            assistanceProfile,
          }),
        });

        if (!caseChatResponse.ok) {
          const failure = await resolveProviderFailure(caseChatResponse, "Case chat");
          throw new Error(failure.detail);
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
            attachmentsForTurn.map((attachment) => ({ type: attachment.mime })),
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
            artifactIds: attachmentsForTurn.map((attachment) => attachment.attachmentId),
            activeCaseId,
            userIntent: messageToSend,
            assistanceProfile,
            reviewProgress: reviewProgressRef.current,
          }),
        });
        const analysisDurationMs = Date.now() - analysisStartMs;

        if (
          !analysisResponse.ok ||
          sessionRef.current !== mySession ||
          analysisRunRef.current !== activeAnalysisRunId
        ) {
          const analysisFailure = !analysisResponse.ok
            ? await resolveAnalysisFailure(analysisResponse)
            : null;
          console.info("[attachments] active-case reassessment failure", {
            fileCount: attachmentStats.fileCount,
            totalBytes: attachmentStats.totalBytes,
            totalPdfPages: attachmentStats.totalPdfPages,
            analysisDurationMs,
            status: analysisResponse.status,
            retryable: analysisFailure?.retryable ?? false,
            stage: analysisFailure?.stage ?? null,
            provider: analysisFailure?.provider ?? null,
          });
          if (analysisRunRef.current === activeAnalysisRunId) {
            onAnalysisStatusChange?.(
              "error",
              analysisFailure?.detail ?? `Analysis failed (${analysisResponse.status})`
            );
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
          contextBudgetMessage?: string | null;
          contextBudget?: Record<string, unknown> | null;
          toolUsageTrace?: Array<Record<string, unknown>>;
          analysisCompletedAt?: string;
          caseContinuity?: {
            activeCaseId?: string;
            mode?: "new_case" | "active_case_update";
            evidenceRegistryCount?: number;
          };
          reassessmentDelta?: RepairIntelligenceReport["reassessmentDelta"];
          artifactRefreshPolicy?: RepairIntelligenceReport["artifactRefreshPolicy"];
          reviewProgress?: ReviewProgress;
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
        onAnalysisStatusChange?.("complete", analysisData.contextBudgetMessage ?? null);
        onAnalysisLoadingChange?.(false);
        const nextReviewProgress = updateReviewProgress((current) => {
          const reviewedForDetermination =
            analysisData.reviewProgress?.reviewedForDetermination ??
            current.reviewedForDetermination + attachmentStats.fileCount;
          const reviewableFileCount = Math.max(
            current.reviewableFileCount,
            analysisData.reviewProgress?.reviewableFileCount ?? 0,
            reviewedForDetermination
          );
          return {
            uploaded: Math.max(current.uploaded, analysisData.reviewProgress?.uploaded ?? 0),
            indexed: Math.max(current.indexed, analysisData.reviewProgress?.indexed ?? 0),
            visionProcessed: Math.max(
              current.visionProcessed,
              analysisData.reviewProgress?.visionProcessed ?? 0
            ),
            reviewedForDetermination,
            reviewableFileCount,
            excludedFromReviewCount: Math.max(
              current.excludedFromReviewCount,
              analysisData.reviewProgress?.excludedFromReviewCount ?? 0,
              Math.max(0, (analysisData.reviewProgress?.indexed ?? current.indexed) - reviewableFileCount)
            ),
            excludedFromReviewReasons: [
              ...new Set([
                ...current.excludedFromReviewReasons,
                ...(analysisData.reviewProgress?.excludedFromReviewReasons ?? []),
              ]),
            ],
            excludedFromReviewFiles: mergeExcludedFromReviewFiles(
              current.excludedFromReviewFiles,
              analysisData.reviewProgress?.excludedFromReviewFiles ?? []
            ),
            totalKnownFiles: Math.max(
              current.totalKnownFiles,
              analysisData.reviewProgress?.totalKnownFiles ?? 0,
              reviewedForDetermination
            ),
          };
        });
        setTotalFilesReviewed(nextReviewProgress.reviewedForDetermination);
        setAttachmentsOpen(false);
        setMobileAttachmentsOpen(false);
        emitSafeCrmEventFromClient({
          event: "upload_batch_completed",
          plan: productPlan,
          fileCount: attachmentStats.fileCount,
          totalFilesReviewed: nextReviewProgress.reviewedForDetermination,
        });
        console.info("[attachments] upload completion case state", {
          activeCaseId,
          activeCaseIdAfter: nextActiveCaseId,
          reportId: nextActiveCaseId,
          attachmentIds: attachmentsForTurn.map((attachment) => attachment.attachmentId),
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
        upsertSystemStatusMessage(
          `${analysisData.contextBudgetMessage ? `${analysisData.contextBudgetMessage} ` : ""}${formatCaseUpdateStatus(
            analysisData.reassessmentDelta,
            analysisData.artifactRefreshPolicy
          )} ${buildReviewCompletionMessage(nextReviewProgress)} ${buildNextBatchPrompt(nextReviewProgress.reviewedForDetermination, maxUploadBatchFiles)}`
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
          const failure = await resolveProviderFailure(caseChatResponse, "Case chat");
          throw new Error(failure.detail);
        }

        const data = (await caseChatResponse.json()) as { reply?: string };
        const reply = redactExternalDocumentUrls(
          data.reply?.trim() || "Case reassessment complete."
        );
        const replyWithReviewProgress = `${reply}\n\n${buildReviewCompletionMessage(nextReviewProgress)}`;

        if (sessionRef.current === mySession) {
          stopSpeaking();
          messageCounterRef.current += 1;
          const assistantMessage = createMessage(
            messageCounterRef.current,
            "assistant",
            replyWithReviewProgress
          );
          setMessages((prev) => [...prev, assistantMessage]);
          updateAnalysisText(replyWithReviewProgress);
          onPrimaryAnalysisChange?.({
            messageId: assistantMessage.id,
            content: replyWithReviewProgress,
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
          attachmentIds: attachmentsForTurn.map((attachment) => attachment.attachmentId),
          attachments: attachmentsForTurn.map((attachment) => ({
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
          assistanceProfile,
        }),
      });

      if (!response.ok) {
        const failure = await resolveProviderFailure(response, "Chat API");
        const errorMessage = failure.detail;

        console.warn("[chat] request failed", {
          status: failure.status,
          retryable: failure.retryable,
          stage: failure.stage,
          provider: failure.provider,
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
            emitSafeCrmEventFromClient({
              event: "upload_batch_completed",
              plan: productPlan,
              fileCount: attachmentStats.fileCount,
              totalFilesReviewed: reviewProgressRef.current.reviewedForDetermination,
            });
          }
        }
        return;
      }

      const contentType = response.headers.get("content-type") || "";
      if (hasAttachmentsInTurn) {
        console.info("[attachments] analysis request assembled", {
          attachmentCount: attachmentsForTurn.length,
          visionAttachmentCount: attachmentsForTurn.filter((attachment) => attachment.hasVision).length,
          attachments: attachmentsForTurn.map((attachment) => ({
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
            artifactIds: attachmentsForTurn.map((attachment) => attachment.attachmentId),
            activeCaseId: analysisReportIdRef.current,
            userIntent: messageToSend,
            assistanceProfile,
            reviewProgress: reviewProgressRef.current,
          }),
        })
          .then(async (analysisResponse) => {
            const analysisDurationMs = Date.now() - analysisStartMs;
            if (
              !analysisResponse.ok ||
              sessionRef.current !== mySession ||
              analysisRunRef.current !== activeAnalysisRunId
            ) {
              const analysisFailure = !analysisResponse.ok
                ? await resolveAnalysisFailure(analysisResponse)
                : null;
              console.info("[attachments] analysis failure", {
                fileCount: attachmentStats.fileCount,
                totalBytes: attachmentStats.totalBytes,
                totalPdfPages: attachmentStats.totalPdfPages,
                analysisDurationMs,
                status: analysisResponse.status,
                retryable: analysisFailure?.retryable ?? false,
                stage: analysisFailure?.stage ?? null,
                provider: analysisFailure?.provider ?? null,
              });
              if (analysisRunRef.current === activeAnalysisRunId) {
                onAnalysisStatusChange?.(
                  "error",
                  analysisFailure?.detail ?? `Analysis failed (${analysisResponse.status})`
                );
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
              contextBudgetMessage?: string | null;
              contextBudget?: Record<string, unknown> | null;
              toolUsageTrace?: Array<Record<string, unknown>>;
              analysisCompletedAt?: string;
              caseContinuity?: {
                activeCaseId?: string;
                mode?: "new_case" | "active_case_update";
                evidenceRegistryCount?: number;
              };
              reassessmentDelta?: RepairIntelligenceReport["reassessmentDelta"];
              artifactRefreshPolicy?: RepairIntelligenceReport["artifactRefreshPolicy"];
              reviewProgress?: ReviewProgress;
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
            onAnalysisStatusChange?.("complete", analysisData.contextBudgetMessage ?? null);
            onAnalysisLoadingChange?.(false);
            const nextReviewProgress = updateReviewProgress((current) => {
              const reviewedForDetermination =
                analysisData.reviewProgress?.reviewedForDetermination ??
                current.reviewedForDetermination + attachmentStats.fileCount;
              const reviewableFileCount = Math.max(
                current.reviewableFileCount,
                analysisData.reviewProgress?.reviewableFileCount ?? 0,
                reviewedForDetermination
              );
              return {
                uploaded: Math.max(current.uploaded, analysisData.reviewProgress?.uploaded ?? 0),
                indexed: Math.max(current.indexed, analysisData.reviewProgress?.indexed ?? 0),
                visionProcessed: Math.max(
                  current.visionProcessed,
                  analysisData.reviewProgress?.visionProcessed ?? 0
                ),
                reviewedForDetermination,
                reviewableFileCount,
                excludedFromReviewCount: Math.max(
                  current.excludedFromReviewCount,
                  analysisData.reviewProgress?.excludedFromReviewCount ?? 0,
                  Math.max(0, (analysisData.reviewProgress?.indexed ?? current.indexed) - reviewableFileCount)
                ),
                excludedFromReviewReasons: [
                  ...new Set([
                    ...current.excludedFromReviewReasons,
                    ...(analysisData.reviewProgress?.excludedFromReviewReasons ?? []),
                  ]),
                ],
                excludedFromReviewFiles: mergeExcludedFromReviewFiles(
                  current.excludedFromReviewFiles,
                  analysisData.reviewProgress?.excludedFromReviewFiles ?? []
                ),
                totalKnownFiles: Math.max(
                  current.totalKnownFiles,
                  analysisData.reviewProgress?.totalKnownFiles ?? 0,
                  reviewedForDetermination
                ),
              };
            });
            setTotalFilesReviewed(nextReviewProgress.reviewedForDetermination);
            setAttachmentsOpen(false);
            setMobileAttachmentsOpen(false);
            console.info("[attachments] upload completion case state", {
              activeCaseId: analysisReportIdRef.current,
              reportId: analysisData.reportId ?? null,
              attachmentIds: attachmentsForTurn.map((attachment) => attachment.attachmentId),
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
            upsertSystemStatusMessage(
              `${analysisData.contextBudgetMessage ? `${analysisData.contextBudgetMessage} ` : ""}${analysisData.caseContinuity?.mode === "active_case_update"
                ? formatCaseUpdateStatus(
                    analysisData.reassessmentDelta,
                    analysisData.artifactRefreshPolicy
                  )
                : "Analysis complete."} ${buildReviewCompletionMessage(nextReviewProgress)} ${buildNextBatchPrompt(nextReviewProgress.reviewedForDetermination, maxUploadBatchFiles)}`
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
  ): Promise<{ attachmentIds: string[]; filenames: string[] }> {
    if (disabled) return { attachmentIds: [], filenames: [] };
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

    const token = await getToken();
    console.log("UPLOAD_HAS_CLERK_TOKEN", !!token);
    const res = await fetch("/api/upload", {
      method: "POST",
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
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
    const returnedAttachmentIds = returnedUploads
      .map((item) => item?.attachmentId)
      .filter((id): id is string => typeof id === "string");
    const returnedFilenames = returnedUploads
      .map((item) => item?.filename)
      .filter((name): name is string => typeof name === "string" && name.length > 0);
    const indexedCount = returnedUploads.filter((item) => typeof item.attachmentId === "string").length;
    const visionProcessedCount = returnedUploads.filter((item) => Boolean(item.hasVision)).length;
    const knownFileCount = countKnownFilesFromUploadResponse(data, returnedUploads);
    const filename: string = upload?.filename || file.name;
    const mime: string = upload?.type || file.type;
    const imageDataUrl: string | undefined =
      typeof upload?.imageDataUrl === "string" ? upload.imageDataUrl : undefined;
    const pageCount: number | undefined =
      typeof upload?.pageCount === "number" ? upload.pageCount : undefined;
    const hasVision: boolean = Boolean(upload?.hasVision) && mime.startsWith("image/");
    const previewUrl =
      returnedUploads.length === 1 && (mime === "application/pdf" || isLikelyImageFile(file) || isLikelyVideoFile(file))
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

    updateReviewProgress((current) => ({
      uploaded: current.uploaded + 1,
      indexed: current.indexed + indexedCount,
      visionProcessed: current.visionProcessed + visionProcessedCount,
      reviewedForDetermination: current.reviewedForDetermination,
      reviewableFileCount: current.reviewableFileCount,
      excludedFromReviewCount: current.excludedFromReviewCount,
      excludedFromReviewReasons: current.excludedFromReviewReasons,
      excludedFromReviewFiles: current.excludedFromReviewFiles,
      totalKnownFiles: current.totalKnownFiles + knownFileCount,
    }));

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
    return {
      attachmentIds: returnedAttachmentIds.length ? returnedAttachmentIds : [attachmentId],
      filenames: returnedFilenames.length ? returnedFilenames : [filename],
    };
  }

  async function handleFilesSelected(fileList: FileList | File[] | null) {
    if (disabled || uploadLimitsLoading) return;
    if (!fileList || fileList.length === 0) return;

    try {
      const selectedFiles = Array.from(fileList);
      setSelectedUploadNames(selectedFiles.map((file) => file.name));
      setUploadUiState("uploading");
      setUploadUiMessage(
        `Uploading ${selectedFiles.length} ${selectedFiles.length === 1 ? "file" : "files"}...`
      );

      const { acceptedFiles, rejectedFiles } = await prepareFilesForUpload(fileList, "file");
      if (!acceptedFiles.length) {
        if (rejectedFiles.length) {
          upsertSystemStatusMessage(buildUploadFailureStatus(rejectedFiles));
        }
        setUploadUiState("error");
        setUploadUiMessage(rejectedFiles[0]?.reason ?? "No supported files selected.");
        return;
      }

      const files = acceptedFiles;
      setSelectedUploadNames(files.map((file) => file.name));
      setUploadUiMessage(
        `Uploading ${files.length} ${files.length === 1 ? "file" : "files"}...`
      );
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
      const uploadedDisplayNames: string[] = [];
      const replacementTargetId = replaceAttachmentId;
      const uploadFailures = [...rejectedFiles];
      let successfulUploadCount = 0;

      for (const file of files) {
        try {
          const uploadResult = await uploadSingleFile(file, "file", replacementTargetId, {
            openPreview: Boolean(replacementTargetId) || files.length === 1,
          });
          successfulUploadCount += uploadResult.attachmentIds.length || 1;
          uploadedDisplayNames.push(...uploadResult.filenames);
          if (!replacementTargetId) {
            newAttachmentIds.push(...uploadResult.attachmentIds);
          }
        } catch (error) {
          console.error(error);
          uploadFailures.push({
            filename: file.name,
            reason: error instanceof Error ? error.message : "Upload failed.",
          });
        }
      }
      if (uploadedDisplayNames.length) {
        setSelectedUploadNames(uploadedDisplayNames);
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
        setUploadUiState(successfulUploadCount > 0 ? "uploaded" : "error");
        setUploadUiMessage(completionStatus);
      } else {
        const successStatus = buildUploadSuccessStatus(successfulUploadCount, uploadedDisplayNames, "file");
        upsertSystemStatusMessage(successStatus);
        upsertSystemStatusMessage(buildAttachmentBatchStatus(files, "analysis_starting"));
        setUploadUiState("uploaded");
        setUploadUiMessage(successStatus);
      }
      if (successfulUploadCount > 0) {
        setSelectedUploadNames([]);
        setAttachmentsOpen(false);
        setMobileAttachmentsOpen(false);
      }
    } catch (err) {
      console.error(err);
      upsertSystemStatusMessage("File upload could not start.");
      setUploadUiState("error");
      setUploadUiMessage("File upload could not start.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleCameraSelected(fileList: FileList | null) {
    if (disabled || uploadLimitsLoading) return;
    if (!fileList || fileList.length === 0) return;

    try {
      const selectedFiles = Array.from(fileList);
      setSelectedUploadNames(selectedFiles.map((file) => file.name));
      setUploadUiState("uploading");
      setUploadUiMessage(
        `Uploading ${selectedFiles.length} ${selectedFiles.length === 1 ? "photo" : "photos"}...`
      );

      const { acceptedFiles, rejectedFiles } = await prepareFilesForUpload(fileList, "camera");
      if (!acceptedFiles.length) {
        if (rejectedFiles.length) {
          upsertSystemStatusMessage(buildUploadFailureStatus(rejectedFiles));
        }
        setUploadUiState("error");
        setUploadUiMessage(rejectedFiles[0]?.reason ?? "No supported photos selected.");
        return;
      }

      const files = acceptedFiles;
      setSelectedUploadNames(files.map((file) => file.name));
      setUploadUiMessage(
        `Uploading ${files.length} ${files.length === 1 ? "photo" : "photos"}...`
      );
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
      const uploadedDisplayNames: string[] = [];
      const replacementTargetId = replaceAttachmentId;
      const uploadFailures = [...rejectedFiles];
      let successfulUploadCount = 0;

      for (const file of files) {
        try {
          const uploadResult = await uploadSingleFile(file, "camera", replacementTargetId, {
            openPreview: Boolean(replacementTargetId) || files.length === 1,
          });
          successfulUploadCount += uploadResult.attachmentIds.length || 1;
          uploadedDisplayNames.push(...uploadResult.filenames);
          if (!replacementTargetId) {
            newAttachmentIds.push(...uploadResult.attachmentIds);
          }
        } catch (error) {
          console.error(error);
          uploadFailures.push({
            filename: file.name,
            reason: error instanceof Error ? error.message : "Upload failed.",
          });
        }
      }
      if (uploadedDisplayNames.length) {
        setSelectedUploadNames(uploadedDisplayNames);
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
        setUploadUiState(successfulUploadCount > 0 ? "uploaded" : "error");
        setUploadUiMessage(completionStatus);
      } else {
        const successStatus = buildUploadSuccessStatus(successfulUploadCount, uploadedDisplayNames, "photo");
        upsertSystemStatusMessage(successStatus);
        upsertSystemStatusMessage(buildAttachmentBatchStatus(files, "analysis_starting"));
        setUploadUiState("uploaded");
        setUploadUiMessage(successStatus);
      }
      if (successfulUploadCount > 0) {
        setSelectedUploadNames([]);
        setAttachmentsOpen(false);
        setMobileAttachmentsOpen(false);
      }
    } catch (err) {
      console.error(err);
      upsertSystemStatusMessage("Camera upload could not start.");
      setUploadUiState("error");
      setUploadUiMessage("Camera upload could not start.");
    } finally {
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  }

  function handleUploadDragEnter(event: React.DragEvent<HTMLElement>) {
    if (disabled) return;
    if (!Array.from(event.dataTransfer.items ?? []).some((item) => item.kind === "file")) {
      return;
    }

    event.preventDefault();
    setIsDragActive(true);
  }

  function handleUploadDragOver(event: React.DragEvent<HTMLElement>) {
    if (disabled || uploadLimitsLoading) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragActive(true);
  }

  function handleUploadDragLeave(event: React.DragEvent<HTMLElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    setIsDragActive(false);
  }

  function handleUploadDrop(event: React.DragEvent<HTMLElement>) {
    if (disabled || uploadLimitsLoading) return;
    event.preventDefault();
    setIsDragActive(false);
    void handleFilesSelected(Array.from(event.dataTransfer.files));
  }

  function removeAttachment(attachmentId: string) {
    if (disabled) return;
    const target = attachments.find((attachment) => attachment.attachmentId === attachmentId);
    if (target?.previewUrl) {
      URL.revokeObjectURL(target.previewUrl);
    }

    const remaining = attachments.filter((attachment) => attachment.attachmentId !== attachmentId);
    setAttachments(remaining);
    if (!remaining.length) {
      setUploadUiState("idle");
      setSelectedUploadNames([]);
      setUploadUiMessage(null);
    }
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
    setUploadUiState("idle");
    setSelectedUploadNames([]);
    setUploadUiMessage(null);
    onAttachmentChange?.(null);
    onAttachmentsChange?.([]);
    clearActiveSystemStatusMessage();
    invalidateStructuredAnalysis();
  }

  function handleReplaceAttachment(attachmentId: string) {
    if (disabled || uploadLimitsLoading) return;
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
      console.info("[native-pdf-export] handleDownloadRedactedChat before await fetch", {
        native: isNative(),
        messageCount: exportMessages.length,
        analysisTextLength: analysisText.length,
      });
      const response = await fetch("/api/chat/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildChatExportPayload(exportMessages, analysisText)),
      });
      console.info("[native-pdf-export] handleDownloadRedactedChat after await fetch", {
        native: isNative(),
        ok: response.ok,
        status: response.status,
        contentType: response.headers.get("Content-Type"),
        contentDisposition: response.headers.get("Content-Disposition"),
      });

      if (!response.ok) {
        console.info("[native-pdf-export] handleDownloadRedactedChat before await response.json");
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        console.info("[native-pdf-export] handleDownloadRedactedChat after await response.json", {
          status: response.status,
          hasError: Boolean(data?.error),
        });
        pushSystemStatusMessage(resolveExportErrorMessage(response.status, data?.error));
        return;
      }

      console.info("[native-pdf-export] handleDownloadRedactedChat before await response.blob");
      const blob = await response.blob();
      console.info("[native-pdf-export] handleDownloadRedactedChat after await response.blob", {
        blobSize: blob.size,
        blobType: blob.type || "unknown",
      });
      const filename = getDownloadFilename(response.headers.get("Content-Disposition"));
      if (isNative()) {
        console.info("[native-pdf-export] handleDownloadRedactedChat before await saveAndShareBlob", {
          filename,
          blobSize: blob.size,
        });
        const shared = await saveAndShareBlob(blob, filename, "Download Chat");
        console.info("[native-pdf-export] handleDownloadRedactedChat after await saveAndShareBlob", {
          filename,
          blobSize: blob.size,
          shared,
        });
      } else {
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(downloadUrl);
      }
    } catch (error) {
      console.warn("[chat-export] download failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      pushSystemStatusMessage("The redacted chat download ran into a temporary issue. Please try again.");
    } finally {
      setIsExportingChat(false);
    }
  }

  function cancelBrowserSpeech() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  function stopSpeaking() {
    speechPlaybackTokenRef.current += 1;
    ttsFetchAbortRef.current?.abort();
    ttsFetchAbortRef.current = null;
    cancelBrowserSpeech();

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }

    setSpeakingMessageId(null);
    setIsSpeaking(false);
    setIsSpeechPaused(false);
    setTtsPlaybackProvider(null);
  }

  function pauseSpeaking() {
    stopSpeaking();
  }

  async function handleSpeakMessage(
    message: Message,
    voice: ServerTtsVoiceOption = SERVER_TTS_VOICE_OPTIONS[0]
  ) {
    if (disabled || message.kind === "system_status") return;
    if (speakingMessageId === message.id && isSpeaking) {
      stopSpeaking();
      return;
    }

    const plainText = toSpeechText(message.content);
    if (!plainText) return;

    stopSpeaking();
    const playbackToken = speechPlaybackTokenRef.current;
    const controller = new AbortController();
    ttsFetchAbortRef.current = controller;
    const audio = new Audio();
    audioRef.current = audio;
    setTtsGeneratingMessageId(message.id);

    try {
      const result: SpeakResult = await speak({
        messageId: message.id,
        text: plainText,
        voice: voice.id,
        audioEl: audio,
        signal: controller.signal,
        allowBrowserFallback: TTS_ALLOW_BROWSER_FALLBACK,
      });

      if (speechPlaybackTokenRef.current !== playbackToken || audioRef.current !== audio) {
        if (result.objectUrl) {
          URL.revokeObjectURL(result.objectUrl);
        }
        throw new StaleTtsPlaybackError();
      }

      audioUrlRef.current = result.objectUrl ?? null;
      setSpeakingMessageId(message.id);
      setIsSpeaking(true);
      setIsSpeechPaused(false);
      setTtsPlaybackProvider(result.provider);

      console.info(
        `[tts] msg=${message.id} role=${message.role} voice=${voice.id} voiceId=${result.voiceId ?? "n/a"} model=${result.model ?? "n/a"} server.status=${result.status} provider=${result.provider} t.firstByteMs=${Math.round(result.firstByteMs ?? -1)} t.playingMs=${Math.round(result.playingMs ?? -1)}`
      );

      audio.onended = () => {
        if (audioRef.current === audio) {
          stopSpeaking();
        }
      };
      audio.onerror = () => {
        if (audioRef.current === audio) {
          stopSpeaking();
          pushSystemStatusMessage("ElevenLabs playback failed.");
        }
      };
    } catch (error) {
      if (
        error instanceof StaleTtsPlaybackError ||
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        return;
      }

      pushSystemStatusMessage(resolveTtsStatusMessage(voice, error));
      console.warn("[tts] playback failed", {
        ...buildTtsMessageDiagnostics(message),
        selectedVoice: voice.id,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (ttsFetchAbortRef.current === controller) {
        ttsFetchAbortRef.current = null;
      }
      setTtsGeneratingMessageId((current) => (current === message.id ? null : current));
    }
  }

  const canReadAloud = true;

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

      <div className="absolute inset-0 pointer-events-none bg-[url('/brand/logos/Logo-grey.png')] bg-no-repeat bg-[length:430px] bg-[position:center_58%] opacity-[0.045] dark:opacity-[0.07] sm:bg-center sm:bg-[length:360px] sm:opacity-[0.018] sm:dark:opacity-[0.035] md:bg-[length:420px]" />
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
          {messages.length === 1 && messages[0].role === "assistant" && !introDismissed && (
            <div
              className="flex min-h-0 flex-col items-center justify-start space-y-0 py-2 text-center transition-[opacity,visibility] duration-200 sm:min-h-[360px] sm:justify-center sm:space-y-4 sm:py-10"
            >
              <div className="min-h-[88px] w-full sm:min-h-[136px]">
                <div className="mx-auto max-w-[860px] border border-border bg-card px-3 py-2.5 text-[12px] text-muted-foreground sm:px-4 sm:py-3 sm:text-sm">
                  <div className="flex items-start justify-between gap-2 sm:gap-3">
                  <div className="leading-5 sm:leading-7">
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
              </div>
              <div className="hidden space-y-1.5 text-center sm:block sm:space-y-2">
                <div className="text-sm font-semibold text-foreground sm:text-base">
                  Start a repair analysis
                </div>
                <div className="text-[12px] leading-4 text-muted-foreground sm:text-[13px] sm:leading-5">
                  Upload an estimate, procedure, or photo set and we&apos;ll turn it into a cleaner repair decision read.
                </div>
                <div className="mx-auto mt-1 max-w-[680px] text-[11px] leading-4 text-muted-foreground sm:mt-2 sm:text-xs sm:leading-5">
                  {uploadBatchGuidance}
                </div>
              </div>

              <div
                onDragEnter={handleUploadDragEnter}
                onDragOver={handleUploadDragOver}
                onDragLeave={handleUploadDragLeave}
                onDrop={handleUploadDrop}
                className={[
                  "hidden w-full max-w-[760px] border border-dashed p-2.5 transition sm:block sm:p-3",
                  isDragActive
                    ? "border-[#b86a2d] bg-[#b86a2d]/10"
                    : "border-border bg-muted/40",
                ].join(" ")}
              >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled || uploadLimitsLoading}
                  className="min-h-10 border border-border bg-card px-3 py-2 text-left text-xs font-medium text-foreground transition hover:border-[#b86a2d]/45 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-11 sm:py-2.5"
                >
                  Upload Estimate
                </button>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled || uploadLimitsLoading}
                  className="min-h-10 border border-border bg-card px-3 py-2 text-left text-xs font-medium text-foreground transition hover:border-[#b86a2d]/45 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-11 sm:py-2.5"
                >
                  Upload OEM Procedure
                </button>

                <button
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={disabled || uploadLimitsLoading}
                  className="min-h-10 border border-border bg-card px-3 py-2 text-left text-xs font-medium text-foreground transition hover:border-[#b86a2d]/45 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-11 sm:py-2.5"
                >
                  Upload Photos
                </button>
              </div>

              <div className="mt-2 text-[11px] leading-4 text-muted-foreground sm:mt-3 sm:text-xs sm:leading-5">
                Drop PDFs, images, or ZIP archives here, or use the upload buttons.
                {selectedUploadNames.length > 0 && (
                  <div className="mt-2 truncate">
                    Selected: {selectedUploadNames.join(", ")}
                  </div>
                )}
                <div
                  className={[
                    "mt-1 font-mono uppercase tracking-[0.08em]",
                    uploadUiState === "error"
                      ? "text-red-500"
                      : uploadUiState === "uploaded"
                        ? "text-emerald-600 dark:text-emerald-300"
                        : "text-muted-foreground",
                  ].join(" ")}
                >
                  {uploadUiState}{uploadUiMessage ? ` - ${uploadUiMessage}` : ""}
                </div>
              </div>
              </div>
            </div>
          )}

          {messages.map((msg, index) => {
            const selectedMessageVoiceId = messageVoiceSelections[msg.id] ?? serverTtsVoiceId;
            const selectedMessageVoice =
              SERVER_TTS_VOICE_OPTIONS.find((option) => option.id === selectedMessageVoiceId) ??
              SERVER_TTS_VOICE_OPTIONS[0];

            return (
            <div
              key={`${msg.id ?? msg.role}-${index}`}
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
                    ? `${userBubble} max-w-[88%] overflow-hidden break-words sm:max-w-[min(72%,820px)]`
                    : msg.kind === "system_status"
                      ? ""
                      : "min-w-0 max-w-full overflow-hidden break-words border border-border bg-card sm:max-w-[860px]"
                }`}
              >
                {msg.role === "assistant" && msg.kind !== "system_status" ? (
                  <div>
                    <div className="mb-3 flex items-center justify-end gap-1">
                      <select
                        value={selectedMessageVoice.id}
                        onChange={(event) => {
                          stopSpeaking();
                          const nextVoice = event.target.value as ServerTtsVoiceOptionId;
                          setServerTtsVoiceId(nextVoice);
                          setMessageVoiceSelections((current) => ({
                            ...current,
                            [msg.id]: nextVoice,
                          }));
                        }}
                        disabled={disabled || ttsGeneratingMessageId === msg.id}
                        aria-label="Select voice"
                        title="Select voice"
                        className="min-h-9 max-w-[120px] rounded-xl border border-input bg-background px-2 py-1.5 text-[11px] font-medium text-foreground shadow-sm transition hover:bg-muted focus:border-ring focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {SERVER_TTS_VOICE_OPTIONS.map((option) => (
                          <option key={option.id} value={option.id} className="bg-background text-foreground">
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {/* Browser voice selector — explicit fallback only; server TTS is the launch-quality path */}
                      {speakingMessageId === msg.id && ttsPlaybackProvider === "browser" ? (
                        <span className="text-[10px] font-medium text-amber-600">
                          (browser voice)
                        </span>
                      ) : null}
                      {/* Read button — shown when not currently speaking this message */}
                      {speakingMessageId !== msg.id && (
                        <button
                          type="button"
                          onClick={() => handleSpeakMessage(msg, selectedMessageVoice)}
                          disabled={!canReadAloud || disabled || ttsGeneratingMessageId === msg.id}
                          aria-label={ttsGeneratingMessageId === msg.id ? "Generating voice" : "Play voice"}
                          title={
                            ttsGeneratingMessageId === msg.id
                              ? "Generating voice"
                              : canReadAloud
                              ? "Play voice"
                              : "Voiceover requires server speech"
                          }
                          className="rounded-xl bg-muted p-2 text-muted-foreground transition hover:bg-muted/70 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {ttsGeneratingMessageId === msg.id ? (
                            <LoaderCircle size={14} className="animate-spin" />
                          ) : (
                            <Volume2 size={14} />
                          )}
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
                      {formatAssistantDisplayMessage(msg.content)}
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
            );
          })}

          <div ref={bottomRef} />
        </div>

        <div
          className={[
            "z-20 shrink-0 border-t border-border bg-card px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:px-3",
            shouldCompactMobileChat ? "min-h-[56px] py-1.5 lg:min-h-[74px] lg:py-2" : "min-h-[74px] py-2",
          ].join(" ")}
        >
          <div className="mx-auto w-full max-w-none">
            <div
              onDragEnter={handleUploadDragEnter}
              onDragOver={handleUploadDragOver}
              onDragLeave={handleUploadDragLeave}
              onDrop={handleUploadDrop}
              className={[
                "border transition",
                shouldCompactMobileChat ? "px-1.5 py-1.5 lg:px-2 lg:py-2" : "px-2 py-2",
                isDragActive
                  ? "border-[#b86a2d] bg-[#b86a2d]/10"
                  : "border-border bg-muted",
              ].join(" ")}
            >
                <div
                  className={[
                    "flex items-center",
                    shouldCompactMobileChat ? "flex-nowrap gap-1.5 lg:flex-wrap lg:gap-2" : "flex-wrap gap-2",
                  ].join(" ")}
                >
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept={`.pdf,image/*,application/zip,application/x-zip-compressed,.zip,${VIDEO_UPLOAD_ACCEPT}`}
                multiple
                disabled={disabled || uploadLimitsLoading}
                title="Attach PDF, image, short video, or ZIP archive"
                onChange={(e) => handleFilesSelected(e.target.files)}
              />

              <input
                type="file"
                ref={cameraInputRef}
                className="hidden"
                accept="image/*"
                disabled={disabled || uploadLimitsLoading}
                title="Take or choose photo"
                onChange={(e) => handleCameraSelected(e.target.files)}
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || uploadLimitsLoading}
                className={[
                  "order-2 min-h-10 min-w-10 rounded-md p-2 text-muted-foreground transition hover:bg-card hover:text-[#C65A2A] disabled:cursor-not-allowed disabled:opacity-40 lg:order-none",
                  shouldCompactMobileChat ? "hidden lg:inline-flex lg:items-center lg:justify-center" : "",
                ].join(" ")}
                aria-label="Attach PDF, image, short video, or ZIP archive"
              >
                <Paperclip size={20} />
              </button>

              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={disabled || uploadLimitsLoading}
                className={[
                  "order-2 rounded-md text-muted-foreground transition hover:bg-card hover:text-[#C65A2A] disabled:cursor-not-allowed disabled:opacity-40 lg:order-none",
                  shouldCompactMobileChat ? "min-h-9 min-w-9 p-1.5 lg:min-h-10 lg:min-w-10 lg:p-2" : "min-h-10 min-w-10 p-2",
                ].join(" ")}
                aria-label="Take or choose photo"
              >
                <Camera size={shouldCompactMobileChat ? 18 : 20} />
              </button>

              <button
                type="button"
                onClick={handleMicClick}
                disabled={isTranscribing || disabled}
                className={`order-2 rounded-md transition lg:order-none ${
                  shouldCompactMobileChat ? "min-h-9 min-w-9 p-1.5 lg:min-h-10 lg:min-w-10 lg:p-2" : "min-h-10 min-w-10 p-2"
                } ${
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
                  <LoaderCircle size={shouldCompactMobileChat ? 18 : 20} className="animate-spin" />
                ) : isRecording ? (
                  <Square size={shouldCompactMobileChat ? 18 : 20} />
                ) : (
                  <Mic size={shouldCompactMobileChat ? 18 : 20} />
                )}
              </button>

              <textarea
                ref={textareaRef}
                value={input}
                onFocus={() => {
                  dismissIntroForComposerEngagement();
                  onChatEngagement?.();
                }}
                onChange={(e) => {
                  dismissIntroForComposerEngagement();
                  onChatEngagement?.();
                  setInput(e.target.value);
                }}
                disabled={disabled}
                rows={1}
                placeholder={
                  hasAnyAttachment
                    ? shouldCompactMobileChat
                      ? "Ask about files..."
                      : "Ask about the attached case file or add context..."
                    : "Enter a repair analysis command or upload documentation..."
                }
                className={[
                  "chat-composer-textarea min-w-0 resize-none overflow-y-auto border border-input bg-background text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-[#b86a2d] focus:ring-1 focus:ring-[#b86a2d]/30 disabled:cursor-not-allowed disabled:opacity-50 lg:order-none lg:min-w-[280px] lg:flex-[1_1_420px]",
                  shouldCompactMobileChat
                    ? "order-2 min-h-9 max-h-16 flex-1 px-2.5 py-1.5 leading-5 lg:min-h-11 lg:max-h-[88px] lg:px-3 lg:py-2"
                    : "order-1 min-h-11 max-h-[88px] flex-[1_1_100%] px-3 py-2 leading-5",
                ].join(" ")}
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
                className="hidden min-h-10 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 lg:inline-flex"
              >
                {isExportingChat ? "Preparing..." : "Download Chat"}
              </button>

              <button
                onClick={() => void handleSend()}
                disabled={loading || isTranscribing || disabled}
                className={[
                  "order-3 rounded-md border border-[#b86a2d] bg-[#b86a2d] text-sm font-semibold text-black transition hover:bg-[#c57934] disabled:opacity-50 lg:order-none lg:flex-none",
                  shouldCompactMobileChat ? "min-h-9 flex-none px-3 py-1.5 lg:min-h-10 lg:px-4 lg:py-2" : "min-h-10 flex-1 px-4 py-2 sm:px-5",
                ].join(" ")}
              >
                {loading ? "..." : "Send"}
              </button>

              <button
                type="button"
                onClick={handleEndChatRequest}
                className="hidden min-h-10 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-red-500/80 transition hover:bg-red-500/8 hover:text-red-500 disabled:opacity-50 lg:inline-flex dark:text-red-300/75 dark:hover:text-red-200"
                disabled={disabled || (loading && messages.length <= 1)}
                aria-label="End chat"
                title="End chat"
              >
                End
              </button>
                </div>

                {(messages.length > 1 || hasAnyAttachment) && (
                  <div className="mt-2 flex justify-end gap-2 lg:hidden">
                    <button
                      type="button"
                      onClick={handleDownloadRedactedChat}
                      disabled={disabled || loading || isTranscribing || isExportingChat}
                      className="min-h-9 rounded-md border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isExportingChat ? "Preparing..." : "Download"}
                    </button>
                    <button
                      type="button"
                      onClick={handleEndChatRequest}
                      disabled={disabled || (loading && messages.length <= 1)}
                      className="min-h-9 rounded-md border border-red-500/30 bg-card px-3 py-1.5 text-[11px] font-medium text-red-500/80 transition hover:bg-red-500/8 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300/75 dark:hover:text-red-200"
                      aria-label="End chat"
                      title="End chat"
                    >
                      End
                    </button>
                  </div>
                )}

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
                {showMobileUploadStatus && (
                  <div
                    className={`mt-2 px-1 text-xs lg:hidden ${
                      uploadUiState === "error"
                        ? "text-red-500"
                        : "text-muted-foreground"
                    }`}
                  >
                    <span className="font-mono uppercase tracking-[0.08em]">
                      {uploadUiState}
                    </span>
                    {uploadUiMessage ? ` - ${uploadUiMessage}` : ""}
                  </div>
                )}
                {hasUploadStatus && (
                  <div
                    className={`mt-3 hidden px-1 text-xs lg:block ${
                      uploadUiState === "error"
                        ? "text-red-500"
                        : uploadUiState === "uploaded"
                          ? "text-emerald-600 dark:text-emerald-300"
                          : "text-muted-foreground"
                    }`}
                  >
                    <span className="font-mono uppercase tracking-[0.08em]">
                      {uploadUiState}
                    </span>
                    {uploadUiMessage ? ` - ${uploadUiMessage}` : ""}
                    {selectedUploadNames.length > 0 ? (
                      <span className="ml-2 text-muted-foreground">
                        {selectedUploadStatusText}
                      </span>
                    ) : null}
                  </div>
                )}
              </div>

              {attachments.length > 0 && (
                <div
                  className={[
                    "border border-border bg-card p-1.5 lg:hidden",
                    shouldCompactMobileChat ? "mt-1" : "mt-2",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    onClick={() => {
                      mobileAttachmentsUserToggledRef.current = true;
                      setMobileAttachmentsOpen((value) => !value);
                    }}
                    disabled={disabled}
                    className="flex w-full items-center justify-between gap-2 bg-muted px-2.5 py-2 text-left text-xs text-muted-foreground transition hover:bg-muted/70 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-expanded={mobileAttachmentsOpen}
                    aria-label="Toggle uploaded files"
                  >
                    <span className="min-w-0 truncate">
                      {attachmentTraySummary}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-foreground">
                      {mobileAttachmentsOpen ? "Hide file list" : "Show file list"}
                      {mobileAttachmentsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </span>
                  </button>

                  {mobileAttachmentsOpen && (
                    <div className="mt-2 max-h-[132px] space-y-2 overflow-y-auto pr-1">
                      {attachments.map((attachment) => (
                        <div
                          key={attachment.attachmentId}
                          className="flex items-center justify-between gap-2 border border-border bg-card px-2.5 py-2 text-sm text-muted-foreground"
                        >
                          <button
                            type="button"
                            onClick={() => handlePreviewAttachment(attachment.attachmentId)}
                            disabled={disabled}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="truncate pr-2 text-xs font-medium text-foreground">
                              {attachment.filename}
                            </div>
                            <div className="mt-1 truncate text-[11px] text-muted-foreground">
                              {formatAttachmentKind(attachment)} - {attachment.source === "camera" ? "Photo" : "File"}
                              {attachment.hasVision ? " - Vision" : ""}
                            </div>
                          </button>

                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handlePreviewAttachment(attachment.attachmentId)}
                              aria-label="Preview attachment"
                              disabled={disabled}
                              className="rounded-lg bg-muted p-2 text-muted-foreground transition hover:bg-muted/70 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Eye size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeAttachment(attachment.attachmentId)}
                              aria-label="Remove attachment"
                              disabled={disabled}
                              className="rounded-lg bg-muted p-2 text-muted-foreground transition hover:bg-muted/70 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {attachments.length > 0 && (
                <div
                  className={[
                    "mt-2 hidden border border-border bg-card lg:block",
                    effectiveAttachmentsOpen ? "p-2" : "p-1",
                  ].join(" ")}
                >
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 bg-muted px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted/70"
                  onClick={() => setAttachmentsOpen((value) => !value)}
                  disabled={disabled}
                  aria-label="Toggle attachments"
                >
                  <span className="min-w-0 truncate text-left">
                    {attachmentTraySummary}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {effectiveAttachmentsOpen ? "Hide file list" : "Show file list"}
                    {effectiveAttachmentsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </span>
                </button>

                {effectiveAttachmentsOpen && (
                  <div className="mt-2 space-y-2">
                    <div className="border border-border bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
                      {uploadBatchGuidance}
                    </div>
                    <div className="max-h-[120px] space-y-2 overflow-y-auto pr-1 sm:max-h-[160px]">
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
                    </div>

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
