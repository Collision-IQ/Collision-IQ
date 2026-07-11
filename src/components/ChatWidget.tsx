"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Dispatch, SetStateAction } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import {
  Paperclip,
  X,
  Camera,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Eye,
  RefreshCcw,
  Volume2,
  LoaderCircle,
  Pause,
  StopCircle,
} from "lucide-react";
import { diffTypoSpans, requestTypoFix, type TypoSpan } from "@/lib/ai/typeHelper";
import ComposerTypoUnderline from "@/components/ComposerTypoUnderline";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import { upload as uploadBlob } from "@vercel/blob/client";
import { uploadFileViaChunkedRelay } from "@/lib/chunkedBlobUpload";
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
import {
  resolveUploadTransport,
  validateDirectUploadCandidate,
} from "@/lib/uploadSafety/directUploadRouting";
import {
  ZIP_UPLOAD_PROGRESS_MESSAGE,
  buildZipExtractedReviewStartMessage,
  isUploadBlockingAnalysis,
  shouldFlushQueuedReviewPrompt,
  type QueuedReviewPrompt,
  type UploadLifecycleItem,
  type UploadLifecyclePhase,
} from "@/lib/uploadSafety/queuedReviewPrompt";
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
import {
  extractEstimateTotalCandidate,
  resolveTriageRoles,
  scoreEstimateRoleSignals,
} from "@/lib/reports/estimateTriageClassifier";
import { classifyCitationDensityDocument } from "@/lib/reports/citationDensityDocumentClassifier";
import {
  FalVisionClientError,
  getFalVisionResult,
  getFalVisionStatus,
  submitFalVision,
} from "@/lib/falVision";
import {
  buildPartImageSearchQuery,
  extractPartNumberFromImagePrompt,
  type PartImageSearchResponse,
} from "@/lib/ai/partImageReference";
import {
  FalImageGenerationClientError,
  firstImageUrl,
  getFalImageGenerationResult,
  getFalImageGenerationStatus,
  submitFalImageGeneration,
} from "@/lib/falImageGenerationClient";
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

// ── FAL queue polling helpers (shared by vision + image generation) ──────────
const FAL_QUEUE_POLL_ATTEMPTS = 20;
const FAL_QUEUE_POLL_INTERVAL_MS = 1500;
const FAL_IMAGE_COMMAND_PREFIXES = ["/image", "/generate-image", "/design-car"];
const FAL_IMAGE_VISUAL_AID_DISCLAIMER =
  "AI-generated visual aid. Not a forensic reconstruction. Not a substitute for inspection, measurement, scan, calibration, OEM procedure, or repair documentation.";

function falQueueDelay(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== "undefined") {
      window.setTimeout(resolve, FAL_QUEUE_POLL_INTERVAL_MS);
    } else {
      resolve();
    }
  });
}

function readFalQueueStatusValue(status: unknown): string {
  if (!status || typeof status !== "object") return "";
  const candidate = status as { status?: unknown; state?: unknown };
  if (typeof candidate.status === "string") return candidate.status;
  if (typeof candidate.state === "string") return candidate.state;
  return "";
}

function isFalQueueCompleted(status: unknown): boolean {
  return /^(completed|complete|success|succeeded|ok)$/i.test(readFalQueueStatusValue(status));
}

function isFalQueueFailed(status: unknown): boolean {
  return /^(failed|error|cancelled|canceled)$/i.test(readFalQueueStatusValue(status));
}

/** Strip a recognized /image-style command prefix; returns null if none match. */
function parseFalImageCommand(message: string): string | null {
  const trimmed = message.trimStart();
  for (const prefix of FAL_IMAGE_COMMAND_PREFIXES) {
    if (trimmed.toLowerCase().startsWith(prefix)) {
      const rest = trimmed.slice(prefix.length);
      // Require a separator so "/images" or "/imagex" do not match.
      if (rest.length === 0 || /^[\s:]/.test(rest)) {
        return rest.replace(/^[\s:]+/, "").trim();
      }
    }
  }
  return null;
}

// Detects a natural-language request to mark up / annotate an uploaded photo
// (e.g. "annotate the attached image to highlight damage", "circle the dents",
// "mark up the photo", "create a heat map"). Only acted on when a ready image
// attachment exists, so a loose noun match is safe. Routes to the deterministic
// overlay annotator (/api/vision/annotate) instead of the estimate-review flow.
type AnnotationStyle = "callout" | "heatmap" | "combined";

const ANNOTATE_ACTION_PATTERN =
  /\b(annotate|mark[\s-]?ups?|marking|circle|outline|highlight|label|draw\s+on|point\s+out|damage\s+map|report\s+visual|negotiation)\b/i;
const ANNOTATE_TARGET_PATTERN =
  /\b(damage|dents?|dinged?|scratch(?:es)?|scrapes?|creases?|image|photo|picture|pic|panel|map|negotiations?)\b/i;
const HEATMAP_PATTERN =
  /\b(heat\s?map|heat-map|damage\s+intensity|intensity\s+map|worst\s+damage|where\s+the\s+damage\s+is\s+concentrated|damage\s+concentrat)/i;
const CALLOUT_ONLY_PATTERN = /\b(callouts?|call\s?outs?|labels?\s+only|outlines?\s+only)\b/i;
const ANNOTATE_BATCH_PATTERN =
  /\b(all\s+(?:the\s+)?photos|all\s+images|same\s+photos|these\s+photos|each\s+photo|every\s+photo|already\s+uploaded|batch)\b/i;

function isPhotoAnnotationRequest(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (HEATMAP_PATTERN.test(trimmed)) return true;
  return ANNOTATE_ACTION_PATTERN.test(trimmed) && ANNOTATE_TARGET_PATTERN.test(trimmed);
}

// "annotate" defaults to combined (heat map + callouts); explicit heat-map or
// callout requests pick their style.
function resolveAnnotationStyle(message: string): AnnotationStyle {
  if (HEATMAP_PATTERN.test(message)) return "heatmap";
  if (CALLOUT_ONLY_PATTERN.test(message)) return "callout";
  return "combined";
}

function isBatchAnnotationRequest(message: string): boolean {
  return ANNOTATE_BATCH_PATTERN.test(message);
}

// react-markdown strips data: URLs by default. Allow inline base64 image data
// URLs (the annotated-photo artifacts) while keeping every other URL on the
// safe default transform.
function annotationSafeUrlTransform(url: string): string {
  if (/^data:image\/(?:png|jpe?g|webp);base64,/i.test(url)) return url;
  return defaultUrlTransform(url);
}

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
    "Hi there — upload an estimate, OEM procedure, or photo, and I'll produce a structured repair analysis.",
};

const TTS_ALLOW_BROWSER_FALLBACK =
  process.env.NEXT_PUBLIC_TTS_ALLOW_BROWSER_FALLBACK === "true";
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
      `${maxFileFailures.length} files were skipped because ${maxFileFailures[0]?.reason ?? "this batch exceeds your plan file limit."}`
    );
  }

  if (otherFailures.length) {
    parts.push(
      `Could not attach ${otherFailures
        .map((failure) => {
          if (failure.code === "RUNTIME_BODY_LIMIT_EXCEEDED") {
            return `${failure.filename}: ${failure.reason ?? "This upload exceeds the plan limit for this file type."}`;
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

function getUploadLifecycleId(file: Pick<File, "name" | "size"> & { lastModified?: number }) {
  return `${file.name}:${file.size}:${file.lastModified ?? 0}`;
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

function formatPreliminaryCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}


function buildPreliminaryCategories(attachments: Attachment[]) {
  const text = attachments.map((attachment) => `${attachment.filename}\n${attachment.text}`).join("\n").toLowerCase();
  const categories: string[] = [];

  if (/\b(?:labor rate|body rate|paint rate|material rate|paint materials?|refinish rate)\b/.test(text)) {
    categories.push("labor/material rate difference");
  }
  if (/\b(?:oem|aftermarket|a\/m|lkq|recycled|rcy|reman|used part|part source)\b/.test(text)) {
    categories.push("OEM vs A/M/LKQ/RCY part posture");
  }
  if (/\b(?:adas|calibration|calibrate|pre-?scan|post-?scan|diagnostic|dtc|radar|camera|aiming)\b/.test(text)) {
    categories.push("scan/ADAS/calibration");
  }
  if (/\b(?:steering column|srs|airbag|seat belt|restraint|structural|frame|measure|safety)\b/.test(text)) {
    categories.push("steering/SRS/safety operations");
  }
  if (/\b(?:refinish|blend|clear coat|corrosion|seam sealer|feather|prime|block|mask|cover car)\b/.test(text)) {
    categories.push("refinish/process/manual lines");
  }

  return categories.slice(0, 5);
}

type PreliminaryReviewDraft = {
  message: string;
  hasUsefulTriage: boolean;
};

function buildPreliminaryReviewDraft(attachments: Attachment[]): PreliminaryReviewDraft {
  const pdfs = attachments.filter((attachment) =>
    attachment.mime === "application/pdf" || /\.pdf$/i.test(attachment.filename)
  );
  const reviewedFiles = pdfs.length ? pdfs : attachments;
  // Only true estimate / SOR / repair-estimate documents are eligible for the
  // shop-vs-carrier pair. Invoices, ADAS/scan reports, material/parts invoices,
  // work authorizations, photos, and procedure/support docs support findings
  // but must never be selected as an estimate. Fall back to all reviewed files
  // only when no estimate-like document is present (low confidence).
  const estimateLikeFiles = reviewedFiles.filter(
    (attachment) =>
      classifyCitationDensityDocument({ filename: attachment.filename, text: attachment.text })
        .isEstimateLike
  );
  const pairPool = estimateLikeFiles.length ? estimateLikeFiles : reviewedFiles;
  const estimates = pairPool.map((attachment) => ({
    filename: attachment.filename,
    scores: scoreEstimateRoleSignals(attachment.filename, attachment.text),
    total: extractEstimateTotalCandidate(attachment.text),
  }));
  // Resolve carrier vs shop to DISTINCT documents so the same file is never
  // reported as both roles (which previously produced a $0.00 gap).
  const { carrier: carrierEstimate, shop: shopEstimate } = resolveTriageRoles(estimates);
  const gap =
    typeof shopEstimate?.total === "number" && typeof carrierEstimate?.total === "number"
      ? Math.abs(shopEstimate.total - carrierEstimate.total)
      : null;
  const categories = buildPreliminaryCategories(reviewedFiles);
  const hasDetectedTotal = estimates.some((estimate) => typeof estimate.total === "number");
  const hasUsefulTriage = hasDetectedTotal || categories.length > 0;
  const fileLabel = `${reviewedFiles.length} ${reviewedFiles.length === 1 ? "file" : "files"}`;
  const pdfLabel = pdfs.length ? `${pdfs.length} PDF${pdfs.length === 1 ? "" : "s"}` : fileLabel;
  const lines = [
    `Preliminary review started. I found ${pdfLabel} and I am parsing the estimates now. The full line-by-line citation review is still running, but I will give you a fast triage first so you are not waiting on a blank screen.`,
    "",
    "Fast triage from the current upload:",
    `- Files: ${reviewedFiles.map((attachment) => attachment.filename).join(", ")}`,
  ];

  if (shopEstimate?.filename || carrierEstimate?.filename) {
    lines.push(`- Likely shop estimate: ${shopEstimate?.filename ?? "not clear yet"}${typeof shopEstimate?.total === "number" ? ` (${formatPreliminaryCurrency(shopEstimate.total)})` : ""}`);
    lines.push(`- Likely carrier/SOR estimate: ${carrierEstimate?.filename ?? "not clear yet"}${typeof carrierEstimate?.total === "number" ? ` (${formatPreliminaryCurrency(carrierEstimate.total)})` : ""}`);
  }

  if (gap !== null) {
    lines.push(`- Approximate total gap: ${formatPreliminaryCurrency(gap)}`);
  }

  if (categories.length) {
    lines.push(`- Early issue categories: ${categories.join("; ")}`);
  }

  lines.push("", "This is preliminary. Authority and citation review is still running.");
  return {
    message: lines.join("\n"),
    hasUsefulTriage,
  };
}

const CONVERSATIONAL_WAITING_FALLBACKS = [
  "I am still parsing the files. While I work, is your goal here to explain the gap to the vehicle owner, prepare a supplement package, or support an appraisal position?",
  "I am still building the line-by-line review. Quick question while I work: are you mainly trying to help the vehicle owner understand the gap, or prepare a supplement/appraisal position?",
  "I am still processing the files. While the deeper review runs, is this one mostly a repair-scope dispute, a parts dispute, or an appraisal issue?",
  "Review is still running. I am parsing the files now, but I am still here. If there is one issue you already know matters most, tell me and I will keep it in focus.",
  "I am still reviewing the estimate set. No freeze, just a heavy file pass. While I work, is the main concern safety, repair completeness, parts, or the final dollar gap?",
] as const;

function isCasualProcessingReply(message: string) {
  return /\b(?:how are you|keep you company|business|shop world|shop life|doing today|what's up|whats up|hanging in|waiting)\b/i.test(message);
}

function buildLongReviewFollowUpReply(message: string, attachments: Attachment[]) {
  if (isCasualProcessingReply(message)) {
    return [
      "I am here and working through it. The full citation review is still running in the background.",
      "",
      "Best use of the wait: tell me whether this is mainly for owner explanation, supplement prep, or appraisal support, and I will keep the response pointed that way.",
    ].join("\n");
  }

  const preliminaryDraft = buildPreliminaryReviewDraft(attachments.filter((attachment) => !attachment.usedInAnalysis));
  if (preliminaryDraft.hasUsefulTriage) {
    return [
      "The full citation review is still processing. Based on the preliminary parse:",
      "",
      preliminaryDraft.message.replace(/^Preliminary review started\.[^\n]*\n\n/, ""),
      "",
      "Authority matching, report generation, and final citation anchors may still change the result.",
    ].join("\n");
  }

  return [
    "The full citation review is still processing. I do not have enough parsed repair facts yet for a useful answer, but the file pass is active.",
    "",
    "While I work, is your goal here to explain the gap to the vehicle owner, prepare a supplement package, or support an appraisal position?",
  ].join("\n");
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
  const [endChatConfirmOpen, setEndChatConfirmOpen] = useState(false);
  // Type Helper: inline typo underlining. A debounced idle check (never per
  // keystroke) diffs the draft against the AI correction; typo words get a
  // wavy underline and a click-to-apply suggestion. Nothing is ever auto-sent.
  const [typoSpans, setTypoSpans] = useState<TypoSpan[]>([]);
  const lastTypoCheckRef = useRef<string | null>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSpeechPaused, setIsSpeechPaused] = useState(false);
  const [ttsGeneratingMessageId, setTtsGeneratingMessageId] = useState<string | null>(null);
  const [serverTtsVoiceId, setServerTtsVoiceId] =
    useState<ServerTtsVoiceOptionId>(DEFAULT_SERVER_TTS_VOICE);
  const [messageVoiceSelections, setMessageVoiceSelections] = useState<Record<string, ServerTtsVoiceOptionId>>({});
  const [ttsPlaybackProvider, setTtsPlaybackProvider] = useState<TtsProvider | null>(null);
  const [totalFilesReviewed, setTotalFilesReviewed] = useState(0);
  const [introDismissed, setIntroDismissed] = useState(false);
  const [fetchedViewerAccess, setFetchedViewerAccess] = useState<AccountEntitlements | null>(null);
  const [entitlementLoadAttempted, setEntitlementLoadAttempted] = useState(false);
  const [uploadUiState, setUploadUiState] = useState<UploadUiState>("idle");
  const [selectedUploadNames, setSelectedUploadNames] = useState<string[]>([]);
  const [uploadUiMessage, setUploadUiMessage] = useState<string | null>(null);
  const [, setUploadLifecycleItems] = useState<UploadLifecycleItem[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isAnalyzingPhoto, setIsAnalyzingPhoto] = useState(false);

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
  const uploadLifecycleItemsRef = useRef<UploadLifecycleItem[]>([]);
  const queuedReviewPromptRef = useRef<QueuedReviewPrompt | null>(null);
  const queuedReviewPromptIdRef = useRef(0);
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
  // Set when the user taps "Analyze photo for visible damage" without an image
  // already attached; the upload-completion handler runs FAL vision analysis once
  // a fresh image lands so the action is a single tap.
  const pendingFalVisionPhotoAnalysisRef = useRef(false);
  const isAnalyzingPhotoRef = useRef(false);
  const speechPlaybackTokenRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const ttsFetchAbortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const handleSendRef = useRef<(promptOverride?: string) => Promise<void>>(async () => {});
  const messageCounterRef = useRef(0);
  const activeSystemStatusMessageIdRef = useRef<string | null>(null);
  const reviewProgressTimerRefs = useRef<number[]>([]);
  const conversationalWaitingTimerRef = useRef<number | null>(null);
  const lastConversationalWaitingAtRef = useRef(0);
  const conversationalWaitingIndexRef = useRef(0);
  const longReviewActiveRef = useRef(false);
  const currentCaseTopicRef = useRef(DEFAULT_CASE_TOPIC);
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

  function setUploadLifecycle(next: UploadLifecycleItem[]) {
    uploadLifecycleItemsRef.current = next;
    setUploadLifecycleItems(next);
  }

  function upsertUploadLifecycleItem(item: UploadLifecycleItem) {
    setUploadLifecycle([
      ...uploadLifecycleItemsRef.current.filter((current) => current.id !== item.id),
      item,
    ]);
  }

  function updateUploadLifecyclePhase(id: string, phase: UploadLifecyclePhase) {
    setUploadLifecycle(
      uploadLifecycleItemsRef.current.map((item) =>
        item.id === id ? { ...item, phase } : item
      )
    );
  }

  function clearCompletedUploadLifecycleItems() {
    setUploadLifecycle(
      uploadLifecycleItemsRef.current.filter((item) =>
        item.phase !== "complete" && item.phase !== "failed" && item.phase !== "canceled"
      )
    );
  }

  function queueReviewPrompt(prompt: string) {
    queuedReviewPromptIdRef.current += 1;
    queuedReviewPromptRef.current = {
      id: queuedReviewPromptIdRef.current,
      prompt,
      status: "queued",
    };
  }

  function clearQueuedReviewPrompt() {
    queuedReviewPromptRef.current = null;
  }

  function flushQueuedReviewPromptIfReady(summary?: { totalFiles: number; pdfCount: number; imageCount: number }) {
    const queuedPrompt = queuedReviewPromptRef.current;
    if (
      !shouldFlushQueuedReviewPrompt({
        queuedPrompt,
        lifecycleItems: uploadLifecycleItemsRef.current,
        reviewableFileCount: reviewProgressRef.current.indexed || reviewProgressRef.current.reviewableFileCount,
      })
    ) {
      return;
    }

    queuedReviewPromptRef.current = {
      ...queuedPrompt!,
      status: "flushing",
    };
    if (summary) {
      pushAssistantMessage(buildZipExtractedReviewStartMessage(summary));
    }

    const prompt = queuedPrompt!.prompt;
    clearQueuedReviewPrompt();
    clearCompletedUploadLifecycleItems();
    window.setTimeout(() => {
      void handleSendRef.current(prompt);
    }, 0);
  }

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
  const hasRealChatActivity = messages.some((message) => message.id !== INITIAL_MESSAGE.id);
  const hasActiveChatWorkspace =
    hasRealChatActivity ||
    hasAnyAttachment ||
    loading ||
    hasUploadStatus ||
    uploadUiState !== "idle";
  const chatBodyFrameClass = "flex-1 min-h-0";
  const transcriptHeightClass = hasActiveChatWorkspace
    ? "flex-1 min-h-[220px] max-h-[calc(100svh-260px)] overflow-y-auto lg:min-h-[260px]"
    : "flex-1 min-h-[220px] overflow-y-auto lg:min-h-[240px]";
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

        const response = await fetch("/api/account/entitlements", {
          credentials: "same-origin",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!response.ok) {
          console.warn("ENTITLEMENTS_RESPONSE_FAILED", response.status);
          return;
        }

        const entitlements = (await response.json()) as AccountEntitlements;
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
      clearReviewProgressTimers();
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

    stopSpeaking();

    const resetTimer = window.setTimeout(() => {
      setPreviewAttachmentId(null);
      setReplaceAttachmentId(null);
    }, 0);

    return () => window.clearTimeout(resetTimer);
  }, [disabled]);
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

  function clearReviewProgressTimers() {
    longReviewActiveRef.current = false;
    if (typeof window === "undefined") {
      reviewProgressTimerRefs.current = [];
      conversationalWaitingTimerRef.current = null;
      return;
    }

    reviewProgressTimerRefs.current.forEach((timerId) => window.clearTimeout(timerId));
    reviewProgressTimerRefs.current = [];
    if (conversationalWaitingTimerRef.current !== null) {
      window.clearTimeout(conversationalWaitingTimerRef.current);
      conversationalWaitingTimerRef.current = null;
    }
  }

  function scheduleReviewProgressMessages(hasActiveCase: boolean) {
    if (typeof window === "undefined") return;

    clearReviewProgressTimers();
    longReviewActiveRef.current = true;
    const statuses = [
      "Parsing estimate PDFs...",
      "Detected candidate totals; comparing shop and carrier estimate rows...",
      hasActiveCase
        ? "Checking current case evidence and structured estimate rows..."
        : "Checking CCC Secure Share / structured estimate rows...",
      "Searching OEM/P-page/Drive authority...",
      "Generating citation reports...",
    ];

    reviewProgressTimerRefs.current = statuses.map((status, index) =>
      window.setTimeout(() => {
        upsertSystemStatusMessage(status);
      }, 1800 + index * 5500)
    );
  }

  function scheduleConversationalWaitingFallback(activeAnalysisRunId: number | null) {
    if (typeof window === "undefined" || activeAnalysisRunId === null) return;

    if (conversationalWaitingTimerRef.current !== null) {
      window.clearTimeout(conversationalWaitingTimerRef.current);
    }

    conversationalWaitingTimerRef.current = window.setTimeout(() => {
      conversationalWaitingTimerRef.current = null;
      if (!longReviewActiveRef.current) return;
      if (analysisRunRef.current !== activeAnalysisRunId) return;

      const now = Date.now();
      if (now - lastConversationalWaitingAtRef.current < 35000) return;

      const fallback =
        CONVERSATIONAL_WAITING_FALLBACKS[
          conversationalWaitingIndexRef.current % CONVERSATIONAL_WAITING_FALLBACKS.length
        ];
      conversationalWaitingIndexRef.current += 1;
      lastConversationalWaitingAtRef.current = now;
      pushAssistantMessage(fallback);
    }, 2600);
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

  function pushAssistantMessage(content: string) {
    setMessages((prev) => {
      if (prev[prev.length - 1]?.role === "assistant" && prev[prev.length - 1]?.content === content) {
        return prev;
      }

      messageCounterRef.current += 1;
      return [...prev, createMessage(messageCounterRef.current, "assistant", content)];
    });
  }

  // ── FAL vision photo analysis (Task 2) ──────────────────────────────────────
  // "Analyze photo for visible damage" runs a text-only visual analysis through
  // the FAL vision queue (/api/fal/vision). This is a visual AID, not a forensic
  // measurement, and is never claim evidence.
  //
  // Deterministic photo annotation lives at POST /api/vision/annotate and is
  // wired via runPhotoAnnotation() below: it is triggered by natural-language
  // "annotate / mark up / highlight the damage" requests (isPhotoAnnotationRequest)
  // when a ready image attachment exists. That path calls FAL/OpenRouter vision
  // for structured zones, renders a deterministic overlay on the ORIGINAL photo,
  // saves the annotated artifact, and labels it an AI visual aid. This "Analyze
  // photo" button stays text-only on purpose (a lighter, no-artifact summary).
  // Generative image replacement must never be used as claim evidence.
  const FAL_VISION_DAMAGE_PROMPT =
    "Analyze this vehicle damage photo for visible damage only. Return a concise repair/claim-support explanation for a policyholder. Identify visible damage zones, likely parts involved, safety-relevant observations, limits of what cannot be proven from the photo, and recommended next photos/documents. Do not claim hidden damage is proven. Do not provide legal conclusions.";

  async function runFalVisionPhotoAnalysis(imageDataUrl: string) {
    if (isAnalyzingPhotoRef.current) return;
    isAnalyzingPhotoRef.current = true;
    setIsAnalyzingPhoto(true);
    upsertSystemStatusMessage("Analyzing photo for visible damage…");
    try {
      const submit = await submitFalVision({
        imageUrls: [imageDataUrl],
        prompt: FAL_VISION_DAMAGE_PROMPT,
      });

      let completed = false;
      for (let attempt = 0; attempt < FAL_QUEUE_POLL_ATTEMPTS; attempt += 1) {
        const status = await getFalVisionStatus(submit.requestId, { logs: false });
        if (isFalQueueCompleted(status)) {
          completed = true;
          break;
        }
        if (isFalQueueFailed(status)) break;
        await falQueueDelay();
      }

      if (!completed) {
        pushAssistantMessage(
          "Image analysis is taking longer than expected. You can still ask me to review the uploaded photo through the normal chat workflow."
        );
        return;
      }

      const result = await getFalVisionResult(submit.requestId);
      const output = result.data?.output?.trim();
      if (!output) {
        pushAssistantMessage(
          "I couldn't get a visual analysis back for that photo. You can still ask me to review it through the normal chat workflow."
        );
        return;
      }

      pushAssistantMessage(`**AI visual analysis — not a forensic measurement.**\n\n${output}`);
    } catch (error) {
      const code = error instanceof FalVisionClientError ? error.code : "";
      const status = error instanceof FalVisionClientError ? error.status : undefined;
      if (code === "FAL_NOT_CONFIGURED" || status === 503) {
        pushAssistantMessage(
          "Image analysis is not configured right now. I can still review the image through the normal chat workflow."
        );
      } else {
        console.warn("[chat] FAL vision photo analysis failed", error);
        pushAssistantMessage(
          "I couldn't complete the image analysis. You can still ask me to review the uploaded photo through the normal chat workflow."
        );
      }
    } finally {
      isAnalyzingPhotoRef.current = false;
      setIsAnalyzingPhoto(false);
    }
  }

  function findLatestImageDataUrl(): string | undefined {
    return findLatestImageAttachment()?.imageDataUrl;
  }

  function findLatestImageAttachment(): Attachment | undefined {
    return [...attachmentsRef.current]
      .reverse()
      .find(
        (attachment) =>
          attachment.hasVision &&
          typeof attachment.imageDataUrl === "string" &&
          attachment.imageDataUrl.trim().length > 0
      );
  }

  type DamageAnnotationZone = {
    label?: string;
    description?: string;
    severity?: string;
    approximateLocation?: string;
  };
  type DamageAnnotationResponse = {
    ok?: boolean;
    summary?: string;
    annotationStyle?: AnnotationStyle;
    zones?: DamageAnnotationZone[];
    notEstablished?: string[];
    recommendedNextPhotos?: string[];
    annotatedImageDataUrl?: string | null;
    annotatedImageUrl?: string | null;
    disclaimer?: string;
  };

  function buildAnnotationMessage(
    data: DamageAnnotationResponse,
    style: AnnotationStyle,
    imageAlt: string
  ): string {
    const parts: string[] = [];
    // Prefer the hosted (blob) URL for a light chat payload; fall back to the
    // self-contained data URL so the artifact still renders if blob is off.
    const imageSrc = data.annotatedImageUrl || data.annotatedImageDataUrl;
    if (imageSrc) {
      parts.push(`![${imageAlt}](${imageSrc})`);
      if (data.annotatedImageUrl) parts.push(`[Open full image](${data.annotatedImageUrl})`);
    }
    const lead =
      style === "heatmap"
        ? "I created a visible-damage **heat map** from the uploaded photo. Red/orange areas show the strongest visible exterior deformation. This is an AI visual aid only, not a forensic measurement or proof of hidden damage."
        : style === "combined"
          ? "I created a visible-damage annotation (heat map + labeled callouts) from the uploaded photo. This is an AI visual aid, not a forensic measurement."
          : "I created a visible-damage annotation for the uploaded photo. This is an AI visual aid, not a forensic measurement.";
    parts.push(lead);
    if (data.summary) parts.push(data.summary.trim());
    const zoneLines = (data.zones ?? [])
      .map((zone) => {
        const label = (zone.label ?? "").trim();
        const description = (zone.description ?? "").trim();
        if (!label && !description) return "";
        return `- **${label || "Damage zone"}**${description ? ` — ${description}` : ""}`;
      })
      .filter(Boolean);
    if (zoneLines.length > 0) parts.push(`**Marked zones:**\n${zoneLines.join("\n")}`);
    if ((data.notEstablished ?? []).length > 0) {
      parts.push(
        `**Not established from this photo:**\n${data.notEstablished!.map((i) => `- ${i}`).join("\n")}`
      );
    }
    if ((data.recommendedNextPhotos ?? []).length > 0) {
      parts.push(
        `**Helpful next photos:**\n${data.recommendedNextPhotos!.map((i) => `- ${i}`).join("\n")}`
      );
    }
    if (!imageSrc) {
      parts.push(
        "_(I mapped the damage by location above; the marked-up image couldn't be saved this time, but the zones are accurate to the photo.)_"
      );
    }
    parts.push(`_${data.disclaimer || FAL_IMAGE_VISUAL_AID_DISCLAIMER}_`);
    return parts.join("\n\n");
  }

  // Deterministic photo annotation: FAL/OpenRouter vision → structured damage
  // zones → overlay drawn on the ORIGINAL photo (/api/vision/annotate). Returns
  // a real marked-up image (callout / heatmap / combined), unlike the text-only
  // FAL vision analysis. Always labeled an AI visual aid — never claim evidence.
  async function runPhotoAnnotation(
    attachment: Attachment,
    userPrompt: string,
    annotationStyle: AnnotationStyle
  ) {
    if (isAnalyzingPhotoRef.current) return;
    isAnalyzingPhotoRef.current = true;
    setIsAnalyzingPhoto(true);
    upsertSystemStatusMessage(
      annotationStyle === "heatmap"
        ? "Creating a visible-damage heat map from the uploaded photo…"
        : "Creating a visible-damage annotation from the uploaded photo…"
    );
    try {
      const response = await fetch("/api/vision/annotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attachmentId: attachment.attachmentId,
          prompt: userPrompt || undefined,
          annotationStyle,
        }),
      });

      if (!response.ok) {
        if (response.status === 503) {
          pushAssistantMessage(
            "Photo annotation isn't configured right now. I can still describe the visible damage by location — just ask me to analyze the photo."
          );
          return;
        }
        if (response.status === 401) {
          pushAssistantMessage(
            "You'll need to be signed in for me to mark up a photo. Once you sign in, upload the photo again and ask me to annotate it."
          );
          return;
        }
        console.warn("[chat] photo annotation failed", response.status);
        pushAssistantMessage(
          "I couldn't create the annotated image right now. I can still describe the visible damage zones in text — want me to do that instead?"
        );
        return;
      }

      const data = (await response.json()) as DamageAnnotationResponse;
      pushAssistantMessage(
        buildAnnotationMessage(data, data.annotationStyle ?? annotationStyle, "Annotated damage photo")
      );
    } catch (error) {
      console.warn("[chat] photo annotation error", error);
      pushAssistantMessage(
        "I couldn't create the annotated image right now. I can still describe the visible damage zones in text — want me to do that instead?"
      );
    } finally {
      isAnalyzingPhotoRef.current = false;
      setIsAnalyzingPhoto(false);
    }
  }

  // Batch annotation: reuse already-uploaded image attachments and post one
  // annotated artifact per photo (/api/vision/annotate/batch).
  async function runPhotoAnnotationBatch(
    attachments: Attachment[],
    userPrompt: string,
    annotationStyle: AnnotationStyle
  ) {
    if (isAnalyzingPhotoRef.current || attachments.length === 0) return;
    isAnalyzingPhotoRef.current = true;
    setIsAnalyzingPhoto(true);
    upsertSystemStatusMessage(
      `Creating visible-damage ${annotationStyle === "heatmap" ? "heat maps" : "annotations"} for ${attachments.length} photo${attachments.length === 1 ? "" : "s"}…`
    );
    try {
      const response = await fetch("/api/vision/annotate/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attachmentIds: attachments.map((a) => a.attachmentId),
          prompt: userPrompt || undefined,
          annotationStyle,
        }),
      });

      if (!response.ok) {
        if (response.status === 503) {
          pushAssistantMessage(
            "Photo annotation isn't configured right now. I can still describe the visible damage by location — just ask me to analyze the photos."
          );
          return;
        }
        pushAssistantMessage(
          "I couldn't create the annotated images right now. I can still describe the visible damage zones in text — want me to do that instead?"
        );
        return;
      }

      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        annotationStyle?: AnnotationStyle;
        results?: Array<DamageAnnotationResponse & { attachmentId?: string; ok?: boolean }>;
      };

      if (data.error === "TOO_MANY_IMAGES" && data.message) {
        pushAssistantMessage(data.message);
        return;
      }

      const style = data.annotationStyle ?? annotationStyle;
      const results = (data.results ?? []).filter((r) => r.ok);
      if (results.length === 0) {
        pushAssistantMessage(
          "I couldn't create annotated images for those photos. I can still describe the visible damage in text — want me to do that instead?"
        );
        return;
      }
      results.forEach((result, index) => {
        const filename =
          attachments.find((a) => a.attachmentId === result.attachmentId)?.filename ??
          `Photo ${index + 1}`;
        pushAssistantMessage(buildAnnotationMessage(result, style, `Annotated: ${filename}`));
      });
    } catch (error) {
      console.warn("[chat] batch photo annotation error", error);
      pushAssistantMessage(
        "I couldn't create the annotated images right now. I can still describe the visible damage zones in text — want me to do that instead?"
      );
    } finally {
      isAnalyzingPhotoRef.current = false;
      setIsAnalyzingPhoto(false);
    }
  }

  function findReadyImageAttachments(): Attachment[] {
    return attachmentsRef.current.filter(
      (attachment) =>
        attachment.hasVision &&
        typeof attachment.imageDataUrl === "string" &&
        attachment.imageDataUrl.trim().length > 0
    );
  }

  function handleAnalyzePhotoAction() {
    if (disabled || isAnalyzingPhotoRef.current) return;
    const latestImageDataUrl = findLatestImageDataUrl();
    if (latestImageDataUrl) {
      void runFalVisionPhotoAnalysis(latestImageDataUrl);
      return;
    }
    // No image attached yet — capture one, then analyze on upload completion.
    pendingFalVisionPhotoAnalysisRef.current = true;
    cameraInputRef.current?.click();
  }

  // ── Part-number reference image search ──────────────────────────────────────
  // A generative model cannot know the geometry of a specific OEM part number —
  // it will fabricate a visual. When the image request references a part
  // number, retrieve REAL internet images (Serper) and present them as sourced
  // references instead of generating.
  async function runPartImageReferenceSearch(prompt: string, partNumber: string) {
    upsertSystemStatusMessage(`Searching for reference images of part ${partNumber}…`);
    try {
      const response = await fetch("/api/parts/image-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ query: buildPartImageSearchQuery(prompt, partNumber) }),
      });
      const data = (await response.json().catch(() => null)) as PartImageSearchResponse | null;

      if (data?.status === "success" && data.results.length > 0) {
        const imageBlocks = data.results
          .map((item) => `[![${item.title}](${item.imageUrl})](${item.sourceUrl})\n_${item.title} — ${item.source}_`)
          .join("\n\n");
        pushAssistantMessage(
          `Here are internet-sourced reference images for part **${partNumber}**:\n\n${imageBlocks}\n\n_Internet-sourced reference images (research leads). These are not verified OEM diagrams — confirm fitment against the OEM or CCC parts catalog before relying on them._`
        );
        return;
      }

      // Never fall back to AI generation for an identifiable part: a fabricated
      // "diagram" is worse than no image.
      pushAssistantMessage(
        data?.status === "not_configured"
          ? `Internet image search is not configured on this server, and I won't generate an AI image for a specific part number — it would be a fabricated visual, not the real part. Check the OEM or CCC parts catalog for part ${partNumber}.`
          : `I couldn't find internet reference images for part ${partNumber} right now, and I won't generate an AI image for a specific part number — it would be a fabricated visual, not the real part. Check the OEM or CCC parts catalog diagram for this part.`
      );
    } catch (error) {
      console.warn("[chat] part image reference search failed", error);
      pushAssistantMessage(
        `I couldn't search for reference images of part ${partNumber} right now. Please try again shortly.`
      );
    }
  }

  // ── FAL image generation (Task 3) ───────────────────────────────────────────
  // Explicit command only (/image, /generate-image, /design-car). Never runs
  // automatically during estimate review. Output is an AI-generated visual aid,
  // never claim evidence or a forensic reconstruction.
  async function runFalImageGeneration(prompt: string) {
    upsertSystemStatusMessage("Generating an AI visual aid…");
    try {
      const submit = await submitFalImageGeneration({ prompt });

      let completed = false;
      for (let attempt = 0; attempt < FAL_QUEUE_POLL_ATTEMPTS; attempt += 1) {
        const status = await getFalImageGenerationStatus(submit.requestId, { logs: false });
        if (isFalQueueCompleted(status)) {
          completed = true;
          break;
        }
        if (isFalQueueFailed(status)) break;
        await falQueueDelay();
      }

      if (!completed) {
        pushAssistantMessage("Image generation is taking longer than expected. Please try again shortly.");
        return;
      }

      const result = await getFalImageGenerationResult(submit.requestId);
      const url = firstImageUrl(result);
      if (!url) {
        pushAssistantMessage("Image generation finished but returned no image. Please try again.");
        return;
      }

      pushAssistantMessage(
        `![AI-generated visual aid](${url})\n\n[Open full image](${url})\n\n_${FAL_IMAGE_VISUAL_AID_DISCLAIMER}_`
      );
    } catch (error) {
      const code = error instanceof FalImageGenerationClientError ? error.code : "";
      const status = error instanceof FalImageGenerationClientError ? error.status : undefined;
      if (code === "FAL_NOT_CONFIGURED" || status === 503) {
        pushAssistantMessage(
          "Image generation is not configured right now. This feature is an optional AI visual aid and does not affect estimate review."
        );
      } else {
        console.warn("[chat] FAL image generation failed", error);
        pushAssistantMessage("I couldn't generate that image right now. Please try again shortly.");
      }
    }
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

      if (isZipFile(file) && !effectiveUploadPlanLimits.zipAllowed) {
        rejectedFiles.push({
          filename: file.name,
          reason: "ZIP uploads are not included in your current plan. Upgrade to Starter, Pro, or Admin to upload ZIP archives.",
          code: "ZIP_DISALLOWED_TYPE",
        });
        return false;
      }

      if (isZipFile(file) && file.size > effectiveUploadPlanLimits.maxZipCompressedBytes) {
        rejectedFiles.push({
          filename: file.name,
          reason: `ZIP archive is ${formatBytes(file.size)}. Max size is ${formatBytes(effectiveUploadPlanLimits.maxZipCompressedBytes)} for your plan.`,
          code: "ZIP_TOO_LARGE",
        });
        return false;
      }

      if (isLikelyVideoFile(file) && !effectiveUploadPlanLimits.videoAllowed) {
        rejectedFiles.push({
          filename: file.name,
          reason: "Video uploads are available on Pro and Admin plans.",
          code: "VIDEO_PLAN_REQUIRED",
        });
        return false;
      }

      const maxFileBytes = isLikelyVideoFile(file)
        ? effectiveUploadPlanLimits.maxVideoBytes
        : effectiveUploadPlanLimits.maxUploadBytes || MAX_UPLOAD_FILE_BYTES;

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

    const videoFailures = await validateSelectedVideoDurations(acceptedFiles, {
      maxVideoBytes: effectiveUploadPlanLimits.maxVideoBytes || VIDEO_MAX_BYTES,
      videoAllowed: effectiveUploadPlanLimits.videoAllowed,
    });
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
    setUploadLifecycle([]);
    clearQueuedReviewPrompt();
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

  // Open a non-blocking in-app confirm instead of window.confirm(), which
  // synchronously blocks the main thread for as long as the native dialog is
  // open (a large INP / "blocked UI updates" hit).
  const handleEndChatRequest = useCallback(() => {
    setEndChatConfirmOpen(true);
  }, []);

  const confirmEndChat = useCallback(() => {
    setEndChatConfirmOpen(false);
    handleEndChat();
  }, [handleEndChat]);

  // Type Helper: debounced idle check of the unsent draft (never per
  // keystroke, empty drafts never hit the network). Failures are silent — the
  // underlines simply don't appear and the draft is untouched.
  useEffect(() => {
    if (disabled) return;
    const draft = input;
    if (!draft.trim() || draft.length > 6000) return;
    if (lastTypoCheckRef.current === draft) return;

    const timer = setTimeout(async () => {
      lastTypoCheckRef.current = draft;
      const result = await requestTypoFix(draft);
      // The user kept typing while we were checking — results are stale.
      if (textareaRef.current && textareaRef.current.value !== draft) return;
      setTypoSpans(result.status === "fixed" ? diffTypoSpans(draft, result.correctedText) : []);
    }, 2000);

    return () => clearTimeout(timer);
  }, [input, disabled]);

  // Apply one clicked suggestion into the draft. Never sends the message.
  const applyTypoFix = useCallback((span: TypoSpan) => {
    const delta = span.suggestion.length - (span.end - span.start);
    setInput((value) =>
      value.slice(0, span.start) + span.suggestion + value.slice(span.end)
    );
    setTypoSpans((prev) =>
      prev
        .filter((existing) => existing !== span)
        .map((existing) =>
          existing.start > span.start
            ? { ...existing, start: existing.start + delta, end: existing.end + delta }
            : existing
        )
    );
    lastTypoCheckRef.current = null;
  }, []);

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
    const promptText = (promptOverride ?? input).trim();

    // Explicit image-generation command (Task 3). Routes to FAL image generation
    // instead of /api/chat. Never triggers during normal estimate review.
    const imagePrompt = promptText ? parseFalImageCommand(promptText) : null;
    if (imagePrompt !== null) {
      onChatEngagement?.();
      shouldAutoScrollRef.current = true;
      messageCounterRef.current += 1;
      setMessages((prev) => [...prev, createMessage(messageCounterRef.current, "user", promptText)]);
      setInput("");
      if (!imagePrompt) {
        pushAssistantMessage(
          "Add a description after the command, e.g. `/image matte black 2020 Honda Civic coupe, bronze wheels, studio lighting`."
        );
        return;
      }
      // Specific part numbers divert to internet reference-image search — a
      // generated image of an identifiable part is always a fabrication.
      const partNumber = extractPartNumberFromImagePrompt(imagePrompt);
      if (partNumber) {
        void runPartImageReferenceSearch(imagePrompt, partNumber);
        return;
      }
      void runFalImageGeneration(imagePrompt);
      return;
    }

    // Natural-language "annotate / mark up / highlight / heat map the damage" on
    // uploaded photo(s). Routes to the deterministic overlay annotator instead of
    // the estimate-review chat flow. "annotate" => combined (heat map + callouts);
    // "heat map" => heatmap; "show callouts" => callout. Batch phrasing ("all/same
    // photos") annotates every ready image.
    if (promptText && isPhotoAnnotationRequest(promptText) && !isAnalyzingPhotoRef.current) {
      const readyImages = findReadyImageAttachments();
      const annotationStyle = resolveAnnotationStyle(promptText);
      const wantsBatch = isBatchAnnotationRequest(promptText) && readyImages.length > 1;
      const targets = wantsBatch ? readyImages : findLatestImageAttachment() ? [findLatestImageAttachment()!] : [];

      if (targets.length === 0) {
        onUserPromptSent?.();
        onChatEngagement?.();
        shouldAutoScrollRef.current = true;
        messageCounterRef.current += 1;
        setMessages((prev) => [...prev, createMessage(messageCounterRef.current, "user", promptText)]);
        setInput("");
        pushAssistantMessage(
          "Please upload a vehicle damage photo first, and I'll create a visible-damage annotation."
        );
        return;
      }

      onUserPromptSent?.();
      onChatEngagement?.();
      stopSpeaking();
      shouldAutoScrollRef.current = true;
      messageCounterRef.current += 1;
      setMessages((prev) => [...prev, createMessage(messageCounterRef.current, "user", promptText)]);
      setInput("");
      const targetIds = new Set(targets.map((t) => t.attachmentId));
      setAttachments((prev) =>
        prev.map((attachment) =>
          targetIds.has(attachment.attachmentId)
            ? { ...attachment, usedInAnalysis: true }
            : attachment
        )
      );
      if (wantsBatch) {
        void runPhotoAnnotationBatch(targets, promptText, annotationStyle);
      } else {
        void runPhotoAnnotation(targets[0], promptText, annotationStyle);
      }
      return;
    }

    if (promptText && isUploadBlockingAnalysis(uploadLifecycleItemsRef.current)) {
      onUserPromptSent?.();
      onChatEngagement?.();
      stopSpeaking();
      shouldAutoScrollRef.current = true;
      messageCounterRef.current += 1;
      const queuedUserMessage = createMessage(messageCounterRef.current, "user", promptText);
      setMessages((prev) => [...prev, queuedUserMessage]);
      setInput("");
      queueReviewPrompt(promptText);
      pushAssistantMessage(ZIP_UPLOAD_PROGRESS_MESSAGE);
      return;
    }

    if (loading) {
      if (!longReviewActiveRef.current) return;
      if (!promptText) return;
      onChatEngagement?.();
      shouldAutoScrollRef.current = true;
      messageCounterRef.current += 1;
      const followUpUserMessage = createMessage(messageCounterRef.current, "user", promptText);
      messageCounterRef.current += 1;
      const followUpReply = createMessage(
        messageCounterRef.current,
        "assistant",
        buildLongReviewFollowUpReply(promptText, attachmentsRef.current)
      );
      setMessages((prev) => [...prev, followUpUserMessage, followUpReply]);
      setInput("");
      return;
    }
    const pendingAttachmentsForTurn = attachments.filter((attachment) => !attachment.usedInAnalysis);
    const documentationVideoAttachments = pendingAttachmentsForTurn.filter(isVideoAttachment);
    const attachmentsForTurn = pendingAttachmentsForTurn.filter(
      (attachment) => !isVideoAttachment(attachment)
    );
    const trimmedInput = promptText;
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

    if (hasAttachmentsInTurn) {
      upsertSystemStatusMessage("Parsing estimate PDFs...");
      scheduleReviewProgressMessages(Boolean(analysisReportIdRef.current));
      const preliminaryDraft = buildPreliminaryReviewDraft(attachmentsForTurn);
      if (preliminaryDraft.hasUsefulTriage) {
        messageCounterRef.current += 1;
        const preliminaryMessage = createMessage(
          messageCounterRef.current,
          "assistant",
          preliminaryDraft.message
        );
        setMessages((prev) => [...prev, preliminaryMessage]);
        onPrimaryAnalysisChange?.({
          messageId: preliminaryMessage.id,
          content: preliminaryMessage.content,
        });
      } else {
        scheduleConversationalWaitingFallback(activeAnalysisRunId);
      }
    }

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
            credentials: "same-origin",
            signal: controller.signal,
            body: JSON.stringify({
              caseId: activeCaseId,
              activeCaseId,
              artifactIds: attachmentsRef.current.map((attachment) => attachment.attachmentId),
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
                .map((output) => `[Download Delta Citation Density Report${output.estimateRole ? ` (${output.estimateRole})` : ""}](${output.downloadUrl})`)
                .join("\n")
            : `[Download Delta Citation Density Report](${data.downloadUrl ?? "#"})`;
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
            clearReviewProgressTimers();
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
        clearReviewProgressTimers();
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
          pushAssistantMessage(
            [
              "Your review is ready — I've analyzed your files and updated the reports on the right.",
              `Reviewed ${nextReviewProgress.reviewedForDetermination} file${nextReviewProgress.reviewedForDetermination === 1 ? "" : "s"}.`,
              analysisData.contextBudgetMessage ? `Note: ${analysisData.contextBudgetMessage}` : null,
              "You'll find the generated reports in the right panel, and in the report viewer below.",
            ].filter(Boolean).join("\n")
          );
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
            clearReviewProgressTimers();
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
                clearReviewProgressTimers();
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
            clearReviewProgressTimers();
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
            pushAssistantMessage(
              [
                "Your review is ready — I've analyzed your files and updated the reports on the right.",
                `Reviewed ${nextReviewProgress.reviewedForDetermination} file${nextReviewProgress.reviewedForDetermination === 1 ? "" : "s"}.`,
                analysisData.contextBudgetMessage ? `Note: ${analysisData.contextBudgetMessage}` : null,
                "You'll find the generated reports in the right panel, and in the report viewer below.",
              ].filter(Boolean).join("\n")
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
              clearReviewProgressTimers();
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
            const assistantIndex = next.findIndex((message) => message.id === streamingAssistantMessage.id);
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
          clearReviewProgressTimers();
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
      router.push("/sign-in?next=/");
      throw new Error("Please sign in before uploading.");
    }

    onChatEngagement?.();
    const token = await getToken();
    const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;
    const transport = resolveUploadTransport(file, effectiveUploadPlanLimits);
    const activeCaseId = analysisReportIdRef.current;
    const lifecycleId = getUploadLifecycleId(file);

    console.info("[upload-client] selected upload route", {
      uploadMode: transport.uploadMode,
      reason: transport.reason,
      filename: file.name,
      sizeBytes: file.size,
      plan: effectiveUploadPlanLimits.plan,
      zipDetected: transport.zipDetected,
      videoDetected: transport.videoDetected,
      activeCaseId,
    });

    let res: Response;
    if (transport.uploadMode === "direct-storage") {
      upsertUploadLifecycleItem({
        id: lifecycleId,
        name: file.name,
        mimeType: file.type,
        phase: "requesting-direct-upload",
        directUpload: true,
      });
      const rejection = validateDirectUploadCandidate(file, effectiveUploadPlanLimits);
      if (rejection) {
        updateUploadLifecyclePhase(lifecycleId, "failed");
        throw new Error(rejection.reason);
      }

      updateUploadLifecyclePhase(lifecycleId, "uploading");
      console.info("[upload-client] directUploadStarted", {
        uploadMode: "direct-storage",
        filename: file.name,
        sizeBytes: file.size,
        plan: effectiveUploadPlanLimits.plan,
        zipDetected: transport.zipDetected,
        videoDetected: transport.videoDetected,
      });

      let blob: { url: string; downloadUrl: string; pathname: string; contentType?: string | null };
      try {
        blob = await uploadBlob(`uploads/${Date.now()}-${file.name}`, file, {
          access: "public",
          contentType: file.type || undefined,
          handleUploadUrl: "/api/upload/direct",
          clientPayload: JSON.stringify({
            filename: file.name,
            contentType: file.type,
            sizeBytes: file.size,
            activeCaseId,
          }),
          headers: authHeaders,
        });
      } catch (directError) {
        // Some environments cannot read the blob API's responses (CORS), so
        // every direct PUT reports as failed. Fall back to the chunked
        // server-relay, which never talks to the blob API from the browser.
        console.warn("[upload-client] directUploadFailed — falling back to chunked relay", {
          uploadMode: "direct-storage",
          filename: file.name,
          sizeBytes: file.size,
          message: directError instanceof Error ? directError.message : String(directError),
        });
        blob = await uploadFileViaChunkedRelay(file, {
          activeCaseId,
          headers: authHeaders,
        });
        console.info("[upload-client] chunkedRelayCompleted", {
          uploadMode: "chunked-relay",
          filename: file.name,
          sizeBytes: file.size,
          pathname: blob.pathname,
        });
      }

      console.info("[upload-client] directUploadCompleted", {
        uploadMode: "direct-storage",
        filename: file.name,
        sizeBytes: file.size,
        pathname: blob.pathname,
      });
      console.info("[upload-client] finalizeStarted", {
        uploadMode: "direct-storage",
        filename: file.name,
        sizeBytes: file.size,
        activeCaseId,
      });

      updateUploadLifecyclePhase(lifecycleId, "finalizing");
      res = await fetch("/api/upload/finalize", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(authHeaders ?? {}),
        },
        body: JSON.stringify({
          url: blob.url,
          downloadUrl: blob.downloadUrl,
          pathname: blob.pathname,
          filename: file.name,
          contentType: blob.contentType || file.type,
          sizeBytes: file.size,
          activeCaseId,
        }),
      });

      console.info("[upload-client] finalizeCompleted", {
        uploadMode: "direct-storage",
        filename: file.name,
        status: res.status,
      });
      updateUploadLifecyclePhase(lifecycleId, "extracting");
    } else {
      const formData = new FormData();
      formData.append("file", file);
      if (activeCaseId) {
        formData.append("activeCaseId", activeCaseId);
      }

      res = await fetch("/api/upload", {
        method: "POST",
        credentials: "include",
        headers: authHeaders,
        body: formData,
      });
    }

    if (res.status === 401) {
      router.push("/sign-in?next=/");
      throw new Error("Please sign in before uploading.");
    }
    const data = (await res.json().catch(() => null)) as UploadResponse | null;

    if (!res.ok) {
      if (transport.uploadMode === "direct-storage") {
        updateUploadLifecyclePhase(lifecycleId, "failed");
      }
      let message =
        res.status === 413
          ? "This file is too large for the current upload route or plan. ZIP and video uploads may require Starter, Pro, or Admin limits."
          : `Upload failed (${res.status})`;

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
      if (transport.uploadMode === "direct-storage") {
        updateUploadLifecyclePhase(lifecycleId, "failed");
      }
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
    if (transport.uploadMode === "direct-storage") {
      updateUploadLifecyclePhase(lifecycleId, "indexing");
    }
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
    if (transport.uploadMode === "direct-storage") {
      updateUploadLifecyclePhase(lifecycleId, "complete");
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
        const next = [...prev, ...nextAttachments];
        attachmentsRef.current = next;
        return next;
      }

      const [replacement, ...additional] = nextAttachments;
      const next = prev.map((attachment) => {
        if (attachment.attachmentId !== replaceId) {
          return attachment;
        }

        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }

        return replacement;
      }).concat(additional);
      attachmentsRef.current = next;
      return next;
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

    // If the user tapped "Analyze photo for visible damage" before attaching an
    // image, run FAL vision analysis now that a fresh image has landed.
    if (pendingFalVisionPhotoAnalysisRef.current) {
      const freshImageDataUrl = returnedUploads.find(
        (item) => Boolean(item?.hasVision) && typeof item?.imageDataUrl === "string" && item.imageDataUrl.trim()
      )?.imageDataUrl;
      if (freshImageDataUrl) {
        pendingFalVisionPhotoAnalysisRef.current = false;
        void runFalVisionPhotoAnalysis(freshImageDataUrl);
      }
    }

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
      files.forEach((file) => {
        const transport = resolveUploadTransport(file, effectiveUploadPlanLimits);
        if (transport.uploadMode === "direct-storage" || transport.zipDetected) {
          upsertUploadLifecycleItem({
            id: getUploadLifecycleId(file),
            name: file.name,
            mimeType: file.type,
            phase: "requesting-direct-upload",
            directUpload: transport.uploadMode === "direct-storage",
          });
        }
      });
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
          updateUploadLifecyclePhase(getUploadLifecycleId(file), "failed");
          clearQueuedReviewPrompt();
          pushAssistantMessage(
            "The ZIP upload did not finish, so I did not start the review. Please retry the ZIP upload or upload the key estimates directly."
          );
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
        flushQueuedReviewPromptIfReady(
          files.some(isZipFile)
            ? {
                totalFiles: successfulUploadCount,
                pdfCount: uploadedDisplayNames.filter((name) => /\.pdf$/i.test(name)).length,
                imageCount: uploadedDisplayNames.filter((name) => /\.(?:jpe?g|png|webp|heic)$/i.test(name)).length,
              }
            : undefined
        );
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
      files.forEach((file) => {
        const transport = resolveUploadTransport(file, effectiveUploadPlanLimits);
        if (transport.uploadMode === "direct-storage" || transport.zipDetected) {
          upsertUploadLifecycleItem({
            id: getUploadLifecycleId(file),
            name: file.name,
            mimeType: file.type,
            phase: "requesting-direct-upload",
            directUpload: transport.uploadMode === "direct-storage",
          });
        }
      });
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
          updateUploadLifecyclePhase(getUploadLifecycleId(file), "failed");
          clearQueuedReviewPrompt();
          pushAssistantMessage(
            "The upload did not finish, so I did not start the review. Please retry the upload or attach the key estimates directly."
          );
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
        flushQueuedReviewPromptIfReady();
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

  const userBubble =
    "rounded-2xl rounded-br-md border border-[var(--accent)]/25 bg-[var(--accent-soft)] text-foreground shadow-[var(--shadow-soft)]";

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

      {endChatConfirmOpen
        ? createPortal(
            <div
              // Inline position/zIndex override globals.css `body > *`
              // (position: relative; z-index: 1), which clamps portaled overlays.
              style={{ position: "fixed", zIndex: 10050 }}
              className="inset-0 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
              role="dialog"
              aria-modal="true"
              onClick={() => setEndChatConfirmOpen(false)}
            >
              <div
                className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-base font-semibold text-foreground">End this chat?</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  This will clear the current conversation. This can&apos;t be undone.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEndChatConfirmOpen(false)}
                    className="min-h-9 rounded-md border border-border bg-card px-3.5 py-1.5 text-sm font-medium text-foreground transition hover:bg-muted"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmEndChat}
                    className="min-h-9 rounded-md bg-red-500 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-red-600"
                  >
                    End chat
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      <div
        className="pointer-events-none absolute inset-0 bg-center bg-no-repeat opacity-[0.06] dark:opacity-[0.08]"
        style={{
          backgroundImage: "url('/brand/logos/logo-horizontal.png')",
          backgroundSize: "min(82%, 900px) auto",
        }}
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute inset-0 bg-background/70 dark:bg-background/78" />

      <div className={["relative z-10 flex flex-col min-h-0", chatBodyFrameClass].join(" ")}>
        <div
          ref={scrollRef}
          className={[
            "mx-auto w-full max-w-[1080px] min-h-0 px-3 pb-4 pt-3 sm:px-4 sm:pt-4 space-y-4",
            transcriptHeightClass,
          ].join(" ")}
        >
          {messages.length === 1 && messages[0].role === "assistant" && !introDismissed && (
            <div
              className="flex min-h-0 flex-col items-center justify-start space-y-2 py-2 text-center transition-[opacity,visibility] duration-200 sm:space-y-3 sm:py-3"
            >
              <div className="w-full">
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
              <div className="hidden space-y-1.5 text-center sm:block">
                <div className="flex justify-center">
                  <span className="ci-claude-badge">Powered by Claude</span>
                </div>
                <div className="text-sm font-semibold text-foreground sm:text-base">
                  Start a repair analysis
                </div>
                <div className="text-[12px] leading-4 text-muted-foreground sm:text-[13px] sm:leading-5">
                  Upload an estimate, procedure, or photo set and we&apos;ll turn it into a cleaner repair decision read.
                </div>
                <div className="mx-auto mt-1 max-w-[680px] text-[11px] leading-4 text-muted-foreground sm:text-xs sm:leading-5">
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
                    ? "border-[var(--accent)] bg-[var(--accent)]/10"
                    : "border-border bg-muted/40",
                ].join(" ")}
              >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled || uploadLimitsLoading}
                  className="min-h-10 border border-border bg-card px-3 py-2 text-left text-xs font-medium text-foreground transition hover:border-[var(--accent)]/45 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-11 sm:py-2.5"
                  data-tour="upload-button"
                >
                  Upload Estimate
                </button>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled || uploadLimitsLoading}
                  className="min-h-10 border border-border bg-card px-3 py-2 text-left text-xs font-medium text-foreground transition hover:border-[var(--accent)]/45 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-11 sm:py-2.5"
                  data-tour="upload-button"
                >
                  Upload OEM Procedure
                </button>

                <button
                  onClick={handleAnalyzePhotoAction}
                  disabled={disabled || uploadLimitsLoading || isAnalyzingPhoto}
                  className="min-h-10 border border-border bg-card px-3 py-2 text-left text-xs font-medium text-foreground transition hover:border-[var(--accent)]/45 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-11 sm:py-2.5"
                  data-tour="camera-button"
                >
                  {isAnalyzingPhoto ? "Analyzing photo…" : "Analyze photo for visible damage"}
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
                    ? "max-w-[560px] rounded-full border border-border/50 bg-muted px-3.5 py-1.5 text-xs text-muted-foreground"
                    : "px-4 py-3"
                } ${
                  msg.role === "user"
                    ? `${userBubble} max-w-[88%] overflow-hidden break-words sm:max-w-[min(72%,820px)]`
                    : msg.kind === "system_status"
                      ? ""
                      : "min-w-0 max-w-full overflow-hidden break-words rounded-2xl rounded-bl-md border border-border/55 bg-card shadow-[var(--shadow-soft)] sm:max-w-[980px]"
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
                      urlTransform={annotationSafeUrlTransform}
                      components={{
                        h2: ({ children }) => (
                          <div className="mb-2 mt-5 border-b border-border pb-1 text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--accent)]">
                            {children}
                          </div>
                        ),
                        h3: ({ children }) => (
                          <div className="mb-1 mt-4 text-[13px] font-semibold text-[var(--accent)]">
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
          <div className="mx-auto w-full max-w-[1080px]">
            <div
              onDragEnter={handleUploadDragEnter}
              onDragOver={handleUploadDragOver}
              onDragLeave={handleUploadDragLeave}
              onDrop={handleUploadDrop}
              className={[
                "rounded-2xl border shadow-[var(--shadow-soft)] transition",
                shouldCompactMobileChat ? "px-2 py-2 lg:px-2.5 lg:py-2.5" : "px-2.5 py-2.5",
                isDragActive
                  ? "border-[var(--accent)] bg-[var(--accent)]/10"
                  : "border-border/60 bg-card",
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
                  "order-2 min-h-10 min-w-10 rounded-md p-2 text-muted-foreground transition hover:bg-card hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 lg:order-none",
                  shouldCompactMobileChat ? "hidden lg:inline-flex lg:items-center lg:justify-center" : "",
                ].join(" ")}
                aria-label="Attach PDF, image, short video, or ZIP archive"
                data-tour="upload-button"
              >
                <Paperclip size={20} />
              </button>

              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={disabled || uploadLimitsLoading}
                className={[
                  "order-2 rounded-md text-muted-foreground transition hover:bg-card hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 lg:order-none",
                  shouldCompactMobileChat ? "min-h-9 min-w-9 p-1.5 lg:min-h-10 lg:min-w-10 lg:p-2" : "min-h-10 min-w-10 p-2",
                ].join(" ")}
                aria-label="Take or choose photo"
                data-tour="camera-button"
              >
                <Camera size={shouldCompactMobileChat ? 18 : 20} />
              </button>

              <button
                type="button"
                onClick={() => {
                  setInput((prev) => {
                    const trimmed = prev.trimStart();
                    if (/^\/(image|generate-image|design-car)\b/i.test(trimmed)) return prev;
                    return trimmed ? `/image ${trimmed}` : "/image ";
                  });
                  dismissIntroForComposerEngagement();
                  onChatEngagement?.();
                  textareaRef.current?.focus();
                }}
                disabled={disabled}
                className={[
                  "ci-ai-btn order-2 inline-flex items-center justify-center rounded-xl disabled:cursor-not-allowed disabled:opacity-40 lg:order-none",
                  shouldCompactMobileChat ? "min-h-9 min-w-9 p-1.5 lg:min-h-10 lg:min-w-10 lg:p-2" : "min-h-10 min-w-10 p-2",
                ].join(" ")}
                aria-label="Generate an AI visual aid image"
                title="Generate an AI visual aid (image)"
                data-tour="photo-generator-button"
              >
                <Sparkles size={shouldCompactMobileChat ? 18 : 20} />
              </button>


              <div
                className={[
                  "relative min-w-0 lg:order-none lg:min-w-[280px] lg:flex-[1_1_420px]",
                  shouldCompactMobileChat ? "order-2 flex-1" : "order-1 flex-[1_1_100%]",
                ].join(" ")}
              >
              <textarea
                ref={textareaRef}
                value={input}
                // Native squiggles are replaced by the AI typo underline overlay.
                spellCheck={false}
                autoCorrect="on"
                autoCapitalize="sentences"
                onFocus={() => {
                  dismissIntroForComposerEngagement();
                  onChatEngagement?.();
                }}
                onChange={(e) => {
                  dismissIntroForComposerEngagement();
                  onChatEngagement?.();
                  setInput(e.target.value);
                  // Manual edits invalidate the current typo underlines until
                  // the next idle re-check.
                  setTypoSpans((prev) => (prev.length ? [] : prev));
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
                  "chat-composer-textarea w-full min-w-0 resize-none overflow-y-auto rounded-xl border border-input/70 bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/25 disabled:cursor-not-allowed disabled:opacity-50",
                  shouldCompactMobileChat
                    ? "min-h-9 max-h-16 px-2.5 py-1.5 leading-5 lg:min-h-11 lg:max-h-[88px] lg:px-3 lg:py-2"
                    : "min-h-11 max-h-[88px] px-3 py-2 leading-5",
                ].join(" ")}
                data-tour="chat-input"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <ComposerTypoUnderline
                textareaRef={textareaRef}
                value={input}
                spans={typoSpans}
                onApply={applyTypoFix}
                // Mirror the textarea's metrics exactly (border + padding + type).
                mirrorClassName={[
                  "rounded-xl border border-transparent px-3 text-sm",
                  shouldCompactMobileChat
                    ? "px-2.5 py-1.5 leading-5 lg:px-3 lg:py-2"
                    : "px-3 py-2 leading-5",
                ].join(" ")}
              />
              </div>

              <button
                type="button"
                onClick={handleDownloadRedactedChat}
                disabled={disabled || loading || isExportingChat}
                className="hidden min-h-10 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 lg:inline-flex"
                data-tour="download-button"
              >
                {isExportingChat ? "Preparing..." : "Download Chat"}
              </button>

              <button
                onClick={() => void handleSend()}
                disabled={disabled}
                className={[
                  "ci-btn-primary order-3 rounded-xl text-sm font-semibold disabled:opacity-50 lg:order-none lg:flex-none",
                  shouldCompactMobileChat ? "min-h-9 flex-none px-3 py-1.5 lg:min-h-10 lg:px-4 lg:py-2" : "min-h-10 flex-1 px-4 py-2 sm:px-5",
                ].join(" ")}
                data-tour="send-button"
              >
                Send
              </button>

              <button
                type="button"
                onClick={handleEndChatRequest}
                className="hidden min-h-10 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-red-500/80 transition hover:bg-red-500/8 hover:text-red-500 disabled:opacity-50 lg:inline-flex dark:text-red-300/75 dark:hover:text-red-200"
                disabled={disabled || (loading && messages.length <= 1)}
                aria-label="End chat"
                title="End chat"
                data-tour="end-button"
              >
                End
              </button>
                </div>

                {(messages.length > 1 || hasAnyAttachment) && (
                  <div className="mt-2 flex justify-end gap-2 lg:hidden">
                    <button
                      type="button"
                      onClick={handleDownloadRedactedChat}
                      disabled={disabled || loading || isExportingChat}
                      className="min-h-9 rounded-md border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                      data-tour="download-button"
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
                      data-tour="end-button"
                    >
                      End
                    </button>
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
                      className="text-xs text-muted-foreground transition hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
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
