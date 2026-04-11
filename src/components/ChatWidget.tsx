"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Paperclip,
  X,
  Camera,
  Volume2,
  Square,
  Mic,
  LoaderCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { DecisionPanel } from "@/lib/ai/builders/buildDecisionPanel";
import type { RepairIntelligenceReport } from "@/lib/ai/types/analysis";
import { buildWorkspaceDataFromAnalysisText } from "@/lib/workspaceAdapter";
import type { WorkspaceData } from "@/types/workspaceTypes";
import {
  buildAttachmentBatchStatus,
  buildAttachmentSummary,
  isLikelyImageFile,
  MAX_UPLOAD_BATCH_FILES,
  summarizeAttachmentStats,
  UPLOAD_CAP_MESSAGE,
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
  hasVision: boolean;
  usedInAnalysis?: boolean;
}

interface ChatWidgetProps {
  onAttachmentChange?: (filename: string | null) => void;
  onAttachmentsChange?: (attachments: Attachment[]) => void;
  onAnalysisChange?: (text: string) => void;
  onPrimaryAnalysisChange?: (data: { messageId: string; content: string } | null) => void;
  onAnalysisResultChange?: (data: RepairIntelligenceReport | null) => void;
  onAnalysisPanelChange?: (panel: DecisionPanel | null) => void;
  onAnalysisLoadingChange?: (loading: boolean) => void;
  onWorkspaceDataChange?: (data: WorkspaceData | null) => void;
  onSessionReset?: () => void;
  onSessionControlsReady?: (
    controls: {
      focusComposer: () => void;
      resetSession: () => void;
    } | null
  ) => void;
  suppressedMessageIds?: string[];
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
const SERVER_TTS_VOICE = process.env.NEXT_PUBLIC_COLLISION_IQ_TTS_VOICE?.trim() || undefined;
const TTS_STYLE_PROMPT =
  "Female voice. Warm, confident, quick-witted, conversational, and natural. Subtle Northeast energy. Smart, grounded, expressive, and slightly dry in tone. Brisk pacing with clear articulation. Sounds like a sharp, street-smart professional explaining something clearly under pressure. Avoid parody, caricature, or celebrity imitation.";

export default function ChatWidget({
  onAttachmentChange,
  onAttachmentsChange,
  onAnalysisChange,
  onPrimaryAnalysisChange,
  onAnalysisResultChange,
  onAnalysisPanelChange,
  onAnalysisLoadingChange,
  onWorkspaceDataChange,
  onSessionReset,
  onSessionControlsReady,
  suppressedMessageIds = [],
  disabled = false,
}: ChatWidgetProps) {
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isExportingChat, setIsExportingChat] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null);
  const [replaceAttachmentId, setReplaceAttachmentId] = useState<string | null>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
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
  const suppressedMessageIdSet = useMemo(() => new Set(suppressedMessageIds), [suppressedMessageIds]);
  const visibleMessages = useMemo(
    () => messages.filter((message) => !suppressedMessageIdSet.has(message.id)),
    [messages, suppressedMessageIdSet]
  );

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    onAttachmentsChange?.(attachments);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments]);

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
      setIsRecording(false);
    }

    setIsTranscribing(false);
    setRecordingError(null);
    setPreviewAttachmentId(null);
    setReplaceAttachmentId(null);
    stopSpeaking();
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

    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 112)}px`;
  }, [input]);

  useEffect(() => {
    onSessionControlsReady?.({
      focusComposer,
      resetSession: handleEndChat,
    });

    return () => {
      onSessionControlsReady?.(null);
    };
  });

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

  function clearStructuredAnalysisState() {
    analysisTextRef.current = "";
    workspaceDataRef.current = null;
    onAnalysisChange?.("");
    onPrimaryAnalysisChange?.(null);
    onAnalysisResultChange?.(null);
    onAnalysisPanelChange?.(null);
    onWorkspaceDataChange?.(null);
  }

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

  function invalidateStructuredAnalysis() {
    analysisRunRef.current += 1;
    clearStructuredAnalysisState();
    onAnalysisLoadingChange?.(false);
  }

  function beginStructuredAnalysisRun() {
    const runId = analysisRunRef.current + 1;
    analysisRunRef.current = runId;
    clearStructuredAnalysisState();
    onAnalysisLoadingChange?.(true);
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

  function rejectOversizedBatch(fileList: FileList | null, source: "file" | "camera") {
    if (!fileList || fileList.length <= MAX_UPLOAD_BATCH_FILES) {
      return false;
    }

    console.info("[attachments] batch rejected", {
      source,
      fileCount: fileList.length,
      totalBytes: Array.from(fileList).reduce((sum, file) => sum + file.size, 0),
    });
    upsertSystemStatusMessage(UPLOAD_CAP_MESSAGE);
    return true;
  }

  function dismissOpeningDisclaimer() {
    setShowOpeningDisclaimer(false);
    setOpeningDisclaimerDismissed(true);
  }

  function focusComposer() {
    if (disabled) return;

    shouldAutoScrollRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });

    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      textarea.focus({ preventScroll: true });
      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
    });
  }

  function handleEndChat() {
    abortRef.current?.abort();
    abortRef.current = null;
    stopSpeaking();
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
    setPreviewAttachmentId(null);
    setReplaceAttachmentId(null);
    firstAttachmentAtRef.current = null;
    activeSystemStatusMessageIdRef.current = null;
    setShowOpeningDisclaimer(true);
    setOpeningDisclaimerDismissed(false);
    analysisTextRef.current = "";

    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";

    onAttachmentChange?.(null);
    invalidateStructuredAnalysis();
    onSessionReset?.();

    shouldAutoScrollRef.current = true;
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 50);
  }

  async function handleSend() {
    if (disabled) return;
    if (loading) return;
    if (!input.trim() && attachments.length === 0) return;

    stopSpeaking();
    setLoading(true);
    shouldAutoScrollRef.current = true;

    const mySession = sessionRef.current;
    const messageToSend = input.trim() || buildAttachmentSummary(attachments);
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

    try {
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

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: updatedMessages,
          attachmentIds: attachments.map((attachment) => attachment.attachmentId),
          attachments: attachments.map((attachment) => ({
            filename: attachment.filename,
            type: attachment.mime,
            text: attachment.text,
            pageCount: attachment.pageCount,
            imageDataUrl: attachment.imageDataUrl,
          })),
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
          }
        }
        return;
      }

      const contentType = response.headers.get("content-type") || "";
      if (hasAttachmentsInTurn) {
        console.info("[attachments] analysis request assembled", {
          attachmentCount: attachments.length,
          visionAttachmentCount: attachments.filter((attachment) => attachment.hasVision).length,
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
                onAnalysisLoadingChange?.(false);
              }
              return;
            }

            const analysisData = (await analysisResponse.json()) as {
              report?: RepairIntelligenceReport;
              panel?: DecisionPanel;
              workspaceData?: WorkspaceData;
              retrievalAttempted?: boolean;
              retrievalCompleted?: boolean;
              retrievalMatchCount?: number;
              refinedWithRetrieval?: boolean;
              analysisCompletedAt?: string;
            };
            // Backend workspaceData is the primary source of truth for Workspace rendering.
            setWorkspaceData(analysisData.workspaceData ?? null);
            onAnalysisResultChange?.(analysisData.report ?? null);
            onAnalysisPanelChange?.(analysisData.panel ?? null);
            onAnalysisLoadingChange?.(false);
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
            upsertSystemStatusMessage("Analysis complete.");
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

          assistantText += decoder.decode(value, { stream: true });

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
          if (hasAttachmentsInTurn) {
            onPrimaryAnalysisChange?.({
              messageId: streamingAssistantMessage.id,
              content: assistantText,
            });
          }
        }
      } else {
        const data = await response.json();
        const reply = (data.reply as string) || "No response received.";

        if (sessionRef.current === mySession) {
          stopSpeaking();
          messageCounterRef.current += 1;
          const assistantMessage = createMessage(messageCounterRef.current, "assistant", reply);
          setMessages((prev) => [
            ...prev,
            assistantMessage,
          ]);
          if (!hasAttachmentsInTurn || analysisRunRef.current === activeAnalysisRunId) {
            updateAnalysisText(reply);
            if (hasAttachmentsInTurn) {
              onPrimaryAnalysisChange?.({
                messageId: assistantMessage.id,
                content: reply,
              });
            }
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
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/upload", { method: "POST", body: formData });
    if (!res.ok) {
      let message = `Upload failed (${res.status})`;

      try {
        const data = (await res.json()) as { error?: string } | null;
        if (data?.error) {
          message = `Upload failed (${res.status}): ${data.error}`;
        }
      } catch {
        // Keep the fallback message when the response is not JSON.
      }

      throw new Error(message);
    }

    const data = await res.json();
    const attachmentId: string = data.attachmentId;
    const filename: string = data.filename || file.name;
    const mime: string = data.type || file.type;
    const text: string = data.text || "";
    const imageDataUrl: string | undefined =
      typeof data.imageDataUrl === "string" ? data.imageDataUrl : undefined;
    const pageCount: number | undefined =
      typeof data.pageCount === "number" ? data.pageCount : undefined;
    const hasVision: boolean = Boolean(data.hasVision) && isLikelyImageFile(file);
    const previewUrl =
      mime === "application/pdf" || isLikelyImageFile(file) ? URL.createObjectURL(file) : undefined;

    console.info("[attachments] upload complete", {
      filename,
      mimeType: mime || file.type || "unknown",
      source,
      hasVision,
      hasImageDataUrl: Boolean(imageDataUrl),
      pageCount: pageCount ?? null,
      replaceId: replaceId ?? null,
    });

    setAttachments((prev) => {
      const nextAttachment = {
        attachmentId,
        filename,
        mime,
        text,
        sizeBytes: file.size,
        imageDataUrl,
        previewUrl,
        pageCount,
        source,
        hasVision,
        usedInAnalysis: false,
      };

      if (!replaceId) {
        return [...prev, nextAttachment];
      }

      return prev.map((attachment) => {
        if (attachment.attachmentId !== replaceId) {
          return attachment;
        }

        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }

        return nextAttachment;
      });
    });

    onAttachmentChange?.(filename);
    invalidateStructuredAnalysis();
    if (options?.openPreview ?? true) {
      setPreviewAttachmentId(replaceId ?? attachmentId);
    }
    setReplaceAttachmentId(null);
    firstAttachmentAtRef.current ??= Date.now();
    return attachmentId;
  }

  async function handleFilesSelected(fileList: FileList | null) {
    if (disabled) return;
    if (!fileList || fileList.length === 0) return;
    if (rejectOversizedBatch(fileList, "file")) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    try {
      const files = Array.from(fileList);
      console.info("[attachments] upload batch selected", {
        source: "file",
        fileCount: fileList.length,
        totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      });
      upsertSystemStatusMessage(buildAttachmentBatchStatus(files, "uploading"));
      const newAttachmentIds: string[] = [];
      const replacementTargetId = replaceAttachmentId;

      for (const [index, file] of files.entries()) {
        const attachmentId = await uploadSingleFile(file, "file", replacementTargetId, {
          openPreview: Boolean(replacementTargetId) || files.length === 1,
        });
        if (!replacementTargetId && index === 0) {
          newAttachmentIds.push(attachmentId);
        }
      }
      if (!replacementTargetId && newAttachmentIds[0]) {
        setPreviewAttachmentId(newAttachmentIds[0]);
      }
      upsertSystemStatusMessage(buildAttachmentBatchStatus(files, "analysis_starting"));
    } catch (err) {
      console.error(err);
      upsertSystemStatusMessage("Some files could not be attached.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleCameraSelected(fileList: FileList | null) {
    if (disabled) return;
    if (!fileList || fileList.length === 0) return;
    if (rejectOversizedBatch(fileList, "camera")) {
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      return;
    }

    try {
      const files = Array.from(fileList);
      console.info("[attachments] upload batch selected", {
        source: "camera",
        fileCount: fileList.length,
        totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      });
      upsertSystemStatusMessage(buildAttachmentBatchStatus(files, "uploading"));
      const newAttachmentIds: string[] = [];
      const replacementTargetId = replaceAttachmentId;

      for (const [index, file] of files.entries()) {
        const attachmentId = await uploadSingleFile(file, "camera", replacementTargetId, {
          openPreview: Boolean(replacementTargetId) || files.length === 1,
        });
        if (!replacementTargetId && index === 0) {
          newAttachmentIds.push(attachmentId);
        }
      }
      if (!replacementTargetId && newAttachmentIds[0]) {
        setPreviewAttachmentId(newAttachmentIds[0]);
      }
      upsertSystemStatusMessage(buildAttachmentBatchStatus(files, "analysis_starting"));
    } catch (err) {
      console.error(err);
      upsertSystemStatusMessage("Camera upload failed.");
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
      setPreviewAttachmentId(resolveNextPreviewAttachmentId(attachments, attachmentId));
    }

    onAttachmentChange?.(
      remaining.length ? remaining[remaining.length - 1].filename : null
    );
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

    if (!canUseBrowserReadAloud()) {
      setSpeakingMessageId(null);
      setIsSpeaking(false);
      utteranceRef.current = null;
      return;
    }

    window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setSpeakingMessageId(null);
    setIsSpeaking(false);
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
    if (!canUseBrowserReadAloud()) {
      throw new Error("Browser speech is unavailable.");
    }

    const utterance = new SpeechSynthesisUtterance(plainText);
    utteranceRef.current = utterance;
    utterance.onstart = () => {
      setSpeakingMessageId(message.id);
      setIsSpeaking(true);
    };
    utterance.onend = () => {
      if (utteranceRef.current === utterance) {
        utteranceRef.current = null;
        setSpeakingMessageId(null);
        setIsSpeaking(false);
      }
    };
    utterance.onerror = () => {
      if (utteranceRef.current === utterance) {
        utteranceRef.current = null;
        setSpeakingMessageId(null);
        setIsSpeaking(false);
      }
    };

    window.speechSynthesis.speak(utterance);
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

    if (!canUseBrowserReadAloud()) {
      pushSystemStatusMessage("Read aloud is not available in this browser.");
      return;
    }

    playBrowserSpeech(message, plainText);
  }

  const canReadAloud = SERVER_TTS_ENABLED || canUseBrowserReadAloud();

  const userBubble = "border border-orange-500/24 bg-[#1a120d]/88 text-orange-300 shadow-[0_14px_32px_rgba(0,0,0,0.16)]";

  return (
    <div className={`relative flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-white/6 bg-white/[0.035] shadow-[0_22px_70px_rgba(0,0,0,0.32)] ${disabled ? "opacity-75" : ""}`}>
      <AttachmentPreviewModal
        attachment={disabled ? null : (previewAttachment as PreviewAttachment | null)}
        attachments={disabled ? [] : (attachments as PreviewAttachment[])}
        currentIndex={disabled ? -1 : previewAttachmentIndex}
        onClose={() => setPreviewAttachmentId(null)}
        onNavigate={handlePreviewNavigation}
        onRemove={(attachmentId) => removeAttachment(attachmentId)}
        onReplace={(attachmentId) => handleReplaceAttachment(attachmentId)}
      />

      <div className="absolute inset-0 pointer-events-none bg-[url('/brand/logos/Logo-grey.png')] bg-no-repeat bg-center bg-[length:60%] opacity-[0.06]" />
      <div className="absolute inset-0 bg-[#040404]/74 pointer-events-none" />

      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <div
          ref={scrollRef}
          className="
          overflow-y-auto
          flex-1
          px-5 sm:px-6
          min-h-0
          pt-5 sm:pt-7
          pb-[210px]
          space-y-4
        "
        >
          {visibleMessages.length === 1 && visibleMessages[0].role === "assistant" && (
            <div className="flex flex-col items-center justify-center space-y-6 py-20 text-center">
              {showOpeningDisclaimer && !openingDisclaimerDismissed && (
                <div className="mx-auto max-w-[860px] rounded-[24px] border border-white/7 bg-white/[0.045] px-5 py-4 text-sm text-white/65 shadow-[0_16px_40px_rgba(0,0,0,0.18)]">
                  <div className="flex items-start justify-between gap-3">
                  <div className="leading-7">
                      {OPENING_DISCLAIMER}
                    </div>
                    <button
                      type="button"
                      onClick={dismissOpeningDisclaimer}
                      className="shrink-0 rounded-lg bg-white/5 p-2 text-white/65 transition hover:bg-white/10 hover:text-white/85"
                      aria-label="Dismiss disclaimer"
                      title="Dismiss disclaimer"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              )}
              <div className="space-y-2 text-center">
                <div className="text-[1.08rem] font-semibold tracking-[-0.02em] text-white/85">
                  Start a repair analysis
                </div>
                <div className="text-sm leading-6 text-white/65">
                  Upload an estimate, procedure, or photo set and we&apos;ll turn it into a cleaner repair decision read.
                </div>
              </div>

              <div className="grid w-full max-w-[720px] grid-cols-1 gap-3 sm:grid-cols-3">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled}
                  className="rounded-2xl border border-white/7 bg-white/[0.045] px-4 py-3 text-sm text-white/85 transition hover:bg-white/[0.075] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Upload Estimate
                </button>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled}
                  className="rounded-2xl border border-white/7 bg-white/[0.045] px-4 py-3 text-sm text-white/85 transition hover:bg-white/[0.075] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Upload OEM Procedure
                </button>

                <button
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={disabled}
                  className="rounded-2xl border border-white/7 bg-white/[0.045] px-4 py-3 text-sm text-white/85 transition hover:bg-white/[0.075] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Upload Photos
                </button>
              </div>
            </div>
          )}

          {visibleMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${
                msg.role === "user"
                  ? "justify-end"
                  : msg.kind === "system_status"
                    ? "justify-center"
                    : "justify-start"
              } mb-5`}
            >
              <div
                className={`${
                  msg.kind === "system_status"
                    ? "max-w-[560px] rounded-full bg-white/[0.045] px-4 py-2 text-xs text-white/40"
                    : "rounded-[24px] px-5 py-4"
                } ${
                  msg.role === "user"
                    ? `${userBubble} max-w-[65%]`
                    : msg.kind === "system_status"
                      ? ""
                      : "max-w-[720px] bg-white/[0.045] shadow-[0_14px_34px_rgba(0,0,0,0.14)] backdrop-blur-md"
                }`}
              >
                {msg.role === "assistant" && msg.kind !== "system_status" ? (
                  <div>
                    <div className="mb-3 flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => handleSpeakMessage(msg)}
                        disabled={!canReadAloud || disabled}
                        aria-label={
                          speakingMessageId === msg.id && isSpeaking
                            ? "Stop reading aloud"
                            : "Read aloud"
                        }
                        title={
                          canReadAloud
                            ? speakingMessageId === msg.id && isSpeaking
                              ? "Stop reading aloud"
                              : "Read aloud"
                            : "Read aloud unavailable"
                        }
                        className="rounded-xl bg-white/[0.045] p-2 text-white/65 transition hover:bg-white/[0.075] hover:text-white/85 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {speakingMessageId === msg.id && isSpeaking ? (
                          <Square size={14} />
                        ) : (
                          <Volume2 size={14} />
                        )}
                      </button>
                    </div>
                    <div className="analysis-report text-[15px] leading-[1.8] text-white/85">
                    <ReactMarkdown
                      components={{
                        h2: ({ children }) => (
                          <div className="mb-2 mt-6 text-[1.08rem] font-semibold tracking-[-0.02em] text-[#D27A51]">
                            {children}
                          </div>
                        ),
                        h3: ({ children }) => (
                          <div className="mb-1 mt-4 text-[15px] font-medium text-[#D27A51]">
                            {children}
                          </div>
                        ),
                        p: ({ children }) => (
                          <p className="mt-2 text-white/85 leading-[1.8]">{children}</p>
                        ),
                        ul: ({ children }) => (
                          <ul className="mt-2 ml-5 list-disc space-y-1.5 text-white/65">
                            {children}
                          </ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="mt-2 ml-5 list-decimal space-y-1.5 text-white/65">
                            {children}
                          </ol>
                        ),
                        strong: ({ children }) => (
                          <span className="font-semibold text-white">{children}</span>
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
                  <div className="whitespace-pre-wrap text-sm sm:text-base text-current">
                    {msg.content}
                  </div>
                )}
              </div>
            </div>
          ))}

          <div ref={bottomRef} />
        </div>

        <div className="sticky inset-x-0 bottom-0 z-20 mt-auto px-4 pb-4 pt-3 sm:px-5">
          <div className="mx-auto w-full max-w-[980px] rounded-[24px] border border-white/7 bg-[#090909]/74 shadow-[0_20px_80px_rgba(0,0,0,0.38)] backdrop-blur-2xl">
            <div className="p-3">
              <div className="rounded-[20px] bg-white/[0.035] px-3 py-2">
                <div className="flex items-end gap-2.5">
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
                className="rounded-xl p-2 text-white/65 transition hover:bg-white/[0.05] hover:text-[#C65A2A] disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Attach files"
              >
                <Paperclip size={20} />
              </button>

              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={disabled}
                className="rounded-xl p-2 text-white/65 transition hover:bg-white/[0.05] hover:text-[#C65A2A] disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Take photo"
              >
                <Camera size={20} />
              </button>

              <button
                type="button"
                onClick={handleMicClick}
                disabled={isTranscribing || disabled}
                className={`rounded-xl p-2 transition ${
                  isRecording
                    ? "text-red-400 hover:text-red-300"
                    : "text-white/65 hover:bg-white/[0.05] hover:text-[#C65A2A]"
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
                onChange={(e) => setInput(e.target.value)}
                disabled={disabled}
                rows={1}
                placeholder={
                  hasAnyAttachment
                    ? "Ask about the attachments, or add more context..."
                    : "Ask about a repair, upload files, or take a photo..."
                }
                className="chat-composer-textarea min-h-[42px] max-h-[104px] flex-1 resize-none overflow-y-auto rounded-[18px] bg-black/28 px-4 py-3 text-sm text-white/85 outline-none transition focus:bg-black/34 disabled:cursor-not-allowed disabled:opacity-50 sm:text-[15px]"
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
                className="rounded-[18px] bg-white/[0.04] px-3.5 py-3 text-sm text-white/65 transition hover:bg-white/[0.07] hover:text-white/85 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isExportingChat ? "Preparing..." : "Download Chat"}
              </button>

              <button
                onClick={handleSend}
                disabled={loading || isTranscribing || disabled}
                className="rounded-[18px] bg-[#C65A2A] px-4 py-3 text-sm font-semibold text-black transition hover:bg-[#C65A2A]/92 disabled:opacity-50 sm:px-5"
              >
                {loading ? "..." : "Send"}
              </button>

              <button
                type="button"
                onClick={handleEndChat}
                className="rounded-[18px] border border-red-500/16 bg-transparent px-3.5 py-3 text-sm text-red-300/75 transition hover:bg-red-500/8 hover:text-red-200 disabled:opacity-50"
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
                      recordingError ? "text-red-300" : "text-white/40"
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

            </div>
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
