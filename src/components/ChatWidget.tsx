"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { DecisionPanel } from "@/lib/ai/builders/buildDecisionPanel";
import type { RepairIntelligenceReport } from "@/lib/ai/types/analysis";
import AttachmentPreviewModal, {
  type PreviewAttachment,
} from "@/components/AttachmentPreviewModal";

type Role = "user" | "assistant";
type AssistantMessageKind = "analysis" | "system_status";

interface Message {
  id: string;
  role: Role;
  content: string;
  kind?: AssistantMessageKind;
}

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
  onAnalysisChange?: (text: string) => void;
  onAnalysisResultChange?: (data: RepairIntelligenceReport | null) => void;
  onAnalysisPanelChange?: (panel: DecisionPanel | null) => void;
  onAnalysisLoadingChange?: (loading: boolean) => void;
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

const VALUATION_URL_PATTERN = /For a full valuation, continue at https:\/\/www\.collision\.academy\/?/gi;
const MAX_UPLOAD_BATCH_FILES = 6;
const UPLOAD_CAP_MESSAGE = "You can upload up to 6 files at once for now.";
const SERVER_TTS_ENABLED =
  process.env.NEXT_PUBLIC_COLLISION_IQ_ENABLE_SERVER_TTS === "true";
const SERVER_TTS_VOICE = process.env.NEXT_PUBLIC_COLLISION_IQ_TTS_VOICE?.trim() || undefined;
const TTS_STYLE_PROMPT =
  "Female voice. Warm, confident, conversational, and natural. Subtle Northeast energy, lightly textured tone, dry wit, smart and grounded. Clear, expressive delivery with brisk but easy pacing. Human and easy on the ears. Avoid parody, caricature, or celebrity imitation.";

export default function ChatWidget({
  onAttachmentChange,
  onAnalysisChange,
  onAnalysisResultChange,
  onAnalysisPanelChange,
  onAnalysisLoadingChange,
  disabled = false,
}: ChatWidgetProps) {
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
  const visionAttachmentCount = useMemo(
    () => attachments.filter((attachment) => attachment.hasVision).length,
    [attachments]
  );
  const previewAttachment = useMemo(
    () => attachments.find((attachment) => attachment.attachmentId === previewAttachmentId) ?? null,
    [attachments, previewAttachmentId]
  );

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    if (attachments.length >= 3) setAttachmentsOpen(false);
    if (attachments.length === 0) setAttachmentsOpen(true);
  }, [attachments.length]);

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

      return [...prev, createMessage("assistant", feedback)];
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

  function buildAttachmentSummary(list: Attachment[]) {
    if (!list.length) return "";
    if (list.length === 1) {
      return `Please analyze the attached file: ${list[0].filename}`;
    }

    return `Please analyze the attached files (${list.length}): ${list
      .map((attachment) => attachment.filename)
      .join(", ")}`;
  }

  function isLikelyImageFile(file: File) {
    return file.type.startsWith("image/");
  }

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

      const nextMessage = createMessage("assistant", content, "system_status");
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
      if (
        prev[prev.length - 1]?.role === "assistant" &&
        prev[prev.length - 1]?.kind === "system_status" &&
        prev[prev.length - 1]?.content === content
      ) {
        return prev;
      }

      return [...prev, createMessage("assistant", content, "system_status")];
    });
  }

  function clearStructuredAnalysisState() {
    analysisTextRef.current = "";
    onAnalysisChange?.("");
    onAnalysisResultChange?.(null);
    onAnalysisPanelChange?.(null);
  }

  function updateAnalysisText(text: string) {
    analysisTextRef.current = text;
    onAnalysisChange?.(text);
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

  function summarizeAttachmentStats(list: Attachment[]) {
    return {
      fileCount: list.length,
      totalBytes: list.reduce((sum, attachment) => sum + attachment.sizeBytes, 0),
      totalPdfPages: list.reduce((sum, attachment) => sum + (attachment.pageCount ?? 0), 0),
    };
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
    setAttachmentsOpen(true);
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
    const attachmentStats = summarizeAttachmentStats(attachments);
    const analysisStartMs = Date.now();
    const userMessage: Message = createMessage("user", messageToSend);

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
              retrievalAttempted?: boolean;
              retrievalCompleted?: boolean;
              retrievalMatchCount?: number;
              refinedWithRetrieval?: boolean;
              analysisCompletedAt?: string;
            };
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
        const streamingAssistantMessage = createMessage("assistant", "");
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
        }
      } else {
        const data = await response.json();
        const reply = (data.reply as string) || "No response received.";

        if (sessionRef.current === mySession) {
          stopSpeaking();
          setMessages((prev) => [...prev, createMessage("assistant", reply)]);
          if (!hasAttachmentsInTurn || analysisRunRef.current === activeAnalysisRunId) {
            updateAnalysisText(reply);
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
            createMessage(
              "assistant",
              "The analysis service had a temporary issue. Please retry.",
              "system_status"
            ),
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
    replaceId?: string | null
  ) {
    if (disabled) return;
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
    setPreviewAttachmentId(replaceId ?? attachmentId);
    setReplaceAttachmentId(null);
    firstAttachmentAtRef.current ??= Date.now();
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
      for (const file of files) {
        await uploadSingleFile(file, "file", replaceAttachmentId);
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
      for (const file of files) {
        await uploadSingleFile(file, "camera", replaceAttachmentId);
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
      setPreviewAttachmentId(null);
    }

    onAttachmentChange?.(
      remaining.length ? remaining[remaining.length - 1].filename : null
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
    setPreviewAttachmentId(null);
    setReplaceAttachmentId(null);
    onAttachmentChange?.(null);
    clearActiveSystemStatusMessage();
    invalidateStructuredAnalysis();
  }

  function handleReplaceAttachment(attachmentId: string) {
    if (disabled) return;
    invalidateStructuredAnalysis();
    setReplaceAttachmentId(attachmentId);
    fileInputRef.current?.click();
  }

  async function handleDownloadRedactedChat() {
    if (disabled || loading || isExportingChat) return;

    const exportMessages = messages
      .filter((message) => message.kind !== "system_status")
      .map((message) => ({
        role: message.role,
        content: message.content,
      }))
      .filter((message) => message.content.trim().length > 0);
    const analysisText = analysisTextRef.current.trim();

    if (exportMessages.length === 0 && !analysisText) {
      pushSystemStatusMessage("There is no chat content available to download yet.");
      return;
    }

    setIsExportingChat(true);

    try {
      const response = await fetch("/api/chat/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: exportMessages,
          analysisText: analysisText || undefined,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        pushSystemStatusMessage(resolveExportErrorMessage(response.status, data?.error));
        return;
      }

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const disposition = response.headers.get("Content-Disposition");
      const filename =
        disposition?.match(/filename="([^"]+)"/i)?.[1] ?? "chat-export-redacted.txt";
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

  function createMessage(
    role: Role,
    content: string,
    kind?: AssistantMessageKind
  ): Message {
    messageCounterRef.current += 1;
    return {
      id: `${role}-${messageCounterRef.current}`,
      role,
      content,
      kind,
    };
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

    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
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
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
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

    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      pushSystemStatusMessage("Read aloud is not available in this browser.");
      return;
    }

    playBrowserSpeech(message, plainText);
  }

  const canReadAloud =
    SERVER_TTS_ENABLED || (typeof window !== "undefined" && "speechSynthesis" in window);

  const userBubble = "bg-black/70 border border-orange-500/30 text-orange-400";

  return (
    <div className={`relative flex flex-col h-full min-h-0 overflow-hidden ${disabled ? "opacity-75" : ""}`}>
      <AttachmentPreviewModal
        attachment={disabled ? null : (previewAttachment as PreviewAttachment | null)}
        onClose={() => setPreviewAttachmentId(null)}
        onRemove={(attachmentId) => removeAttachment(attachmentId)}
        onReplace={(attachmentId) => handleReplaceAttachment(attachmentId)}
      />

      <div className="absolute inset-0 pointer-events-none bg-[url('/brand/logos/Logo-grey.png')] bg-no-repeat bg-center bg-[length:60%] opacity-[0.06]" />
      <div className="absolute inset-0 bg-black/70 pointer-events-none" />

      <div className="relative z-10 flex flex-col flex-1 min-h-0">
        <div
          ref={scrollRef}
          className="
          overflow-y-auto
          flex-1
          px-4 sm:px-6
          min-h-0
          pt-4 sm:pt-6
          pb-[240px]
          space-y-4
        "
        >
          {messages.length === 1 && messages[0].role === "assistant" && (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-6">
              {showOpeningDisclaimer && !openingDisclaimerDismissed && (
                <div className="mx-auto max-w-[920px] rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-sm text-white/75">
                  <div className="flex items-start justify-between gap-3">
                    <div className="leading-[1.6]">
                      {OPENING_DISCLAIMER}
                    </div>
                    <button
                      type="button"
                      onClick={dismissOpeningDisclaimer}
                      className="shrink-0 rounded-lg border border-white/10 bg-white/5 p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
                      aria-label="Dismiss disclaimer"
                      title="Dismiss disclaimer"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              )}
              <div className="text-white/60 text-sm">Start a repair analysis</div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-xl w-full">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled}
                  className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Upload Estimate
                </button>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled}
                  className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Upload OEM Procedure
                </button>

                <button
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={disabled}
                  className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-40"
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
              } mb-3`}
            >
              <div
                className={`${
                  msg.kind === "system_status"
                    ? "max-w-[560px] rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs text-white/55"
                    : "rounded-2xl px-5 py-4"
                } ${
                  msg.role === "user"
                    ? `${userBubble} max-w-[65%]`
                    : msg.kind === "system_status"
                      ? ""
                      : "max-w-[760px] bg-glass border-glass backdrop-blur-md"
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
                        className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/65 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {speakingMessageId === msg.id && isSpeaking ? (
                          <Square size={14} />
                        ) : (
                          <Volume2 size={14} />
                        )}
                      </button>
                    </div>
                    <div className="analysis-report text-[15px] leading-[1.65] text-white/90">
                    <ReactMarkdown
                      components={{
                        h2: ({ children }) => (
                          <div className="mt-6 mb-2 text-[#C65A2A] text-[16px] font-semibold">
                            {children}
                          </div>
                        ),
                        h3: ({ children }) => (
                          <div className="mt-4 mb-1 text-[#C65A2A] text-[14px] font-medium">
                            {children}
                          </div>
                        ),
                        p: ({ children }) => (
                          <p className="mt-2 text-white/85 leading-[1.65]">{children}</p>
                        ),
                        ul: ({ children }) => (
                          <ul className="mt-2 ml-5 list-disc space-y-1 text-white/80">
                            {children}
                          </ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="mt-2 ml-5 list-decimal space-y-1 text-white/80">
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

        <div className="absolute bottom-0 left-0 right-0 border-t border-white/10 bg-black/85 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
          <div className="p-4">
            <div className="flex items-end gap-3">
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
                className="text-white/60 hover:text-[#C65A2A] transition disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Attach files"
              >
                <Paperclip size={20} />
              </button>

              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={disabled}
                className="text-white/60 hover:text-[#C65A2A] transition disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Take photo"
              >
                <Camera size={20} />
              </button>

              <button
                type="button"
                onClick={handleMicClick}
                disabled={isTranscribing || disabled}
                className={`transition ${
                  isRecording
                    ? "text-red-400 hover:text-red-300"
                    : "text-white/60 hover:text-[#C65A2A]"
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
                className="flex-1 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-orange-500 transition text-sm sm:text-base disabled:cursor-not-allowed disabled:opacity-50 resize-none overflow-y-auto min-h-[48px] max-h-[112px]"
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
                className="rounded-xl border border-white/10 bg-white/5 px-4 sm:px-5 py-3 text-white/80 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isExportingChat ? "Preparing..." : "Download Chat"}
              </button>

              <button
                onClick={handleSend}
                disabled={loading || isTranscribing || disabled}
                className="rounded-xl bg-[#C65A2A] px-4 sm:px-5 py-3 text-black font-semibold transition hover:bg-[#C65A2A]/90 disabled:opacity-50"
              >
                {loading ? "..." : "Send"}
              </button>

              <button
                type="button"
                onClick={handleEndChat}
                className="rounded-xl border border-red-500/40 px-4 sm:px-5 py-3 text-red-400 hover:bg-red-500/10 transition font-semibold disabled:opacity-50"
                disabled={disabled || (loading && messages.length <= 1)}
                aria-label="End chat"
                title="End chat"
              >
                End
              </button>
            </div>

            {(isRecording || isTranscribing || recordingError) && (
              <div
                className={`mt-3 text-xs ${
                  recordingError ? "text-red-300" : "text-white/55"
                }`}
              >
                {recordingError
                  ? recordingError
                  : isTranscribing
                    ? "Transcribing your recording..."
                    : "Recording... click the mic again to stop."}
              </div>
            )}

            {attachments.length > 0 && (
              <div className="mt-3">
                <button
                  type="button"
                  className="w-full flex items-center justify-between rounded-xl border border-white/10 bg-black/40 px-4 py-2 text-sm text-white/80"
                  onClick={() => setAttachmentsOpen((value) => !value)}
                  disabled={disabled}
                  aria-label="Toggle attachments"
                >
                  <span>
                    Attachments ({attachments.length})
                    <span className="ml-2 text-white/40">
                      {visionAttachmentCount > 0
                        ? `- Vision: ${visionAttachmentCount}`
                        : ""}
                    </span>
                  </span>
                  {attachmentsOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                </button>

                {attachmentsOpen && (
                  <div className="mt-2 space-y-2">
                    {attachments.map((attachment) => (
                      <div
                        key={attachment.attachmentId}
                        className="flex items-center justify-between gap-3 bg-black/40 border border-white/10 px-4 py-3 rounded-xl text-sm text-white/80"
                      >
                        <button
                          type="button"
                          onClick={() => setPreviewAttachmentId(attachment.attachmentId)}
                          disabled={disabled}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="truncate pr-3 font-medium text-white">
                            {attachment.filename}
                          </div>
                          <div className="mt-1 text-xs text-white/45">
                            {formatAttachmentKind(attachment)} · {attachment.source === "camera" ? "Photo" : "File"}
                            {attachment.hasVision ? " · Vision" : ""}
                            {attachment.usedInAnalysis ? " · Used in analysis" : ""}
                          </div>
                        </button>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => setPreviewAttachmentId(attachment.attachmentId)}
                            aria-label="Preview attachment"
                            disabled={disabled}
                            className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/65 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Eye size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReplaceAttachment(attachment.attachmentId)}
                            aria-label="Replace attachment"
                            disabled={disabled}
                            className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/65 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <RefreshCcw size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeAttachment(attachment.attachmentId)}
                            aria-label="Remove attachment"
                            disabled={disabled}
                            className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/65 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
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
                      className="text-xs text-white/60 transition hover:text-[#C65A2A] disabled:cursor-not-allowed disabled:opacity-40"
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

function formatAttachmentKind(attachment: Attachment): string {
  if (attachment.mime === "application/pdf") {
    return attachment.pageCount
      ? `PDF (${attachment.pageCount} page${attachment.pageCount === 1 ? "" : "s"})`
      : "PDF";
  }
  if (attachment.mime.startsWith("image/")) return "Image";
  if (attachment.text?.trim()) return "Text";
  return attachment.mime || "Unknown";
}

function buildAttachmentBatchStatus(
  files: Array<Pick<File, "type">>,
  verb: "attached" | "updated" | "uploading" | "analysis_starting"
): string {
  const imageCount = files.filter((file) => file.type.startsWith("image/")).length;
  const pdfCount = files.filter((file) => file.type === "application/pdf").length;
  const otherCount = files.length - imageCount - pdfCount;
  const parts = [
    imageCount > 0 ? `${imageCount} ${imageCount === 1 ? "photo" : "photos"}` : null,
    pdfCount > 0 ? `${pdfCount} ${pdfCount === 1 ? "PDF" : "PDFs"}` : null,
    otherCount > 0 ? `${otherCount} ${otherCount === 1 ? "file" : "files"}` : null,
  ].filter(Boolean) as string[];

  if (verb === "uploading") {
    return `Uploading & assessing ${files.length} ${files.length === 1 ? "file" : "files"}...`;
  }

  if (verb === "analysis_starting") {
    const lead = files.length === 1 ? "1 file attached" : `${files.length} files attached`;
    return `${lead}: ${parts.join(", ")}. Analysis starting.`;
  }

  if (files.length === 1) {
    return `1 file ${verb}.`;
  }

  return `${files.length} files ${verb}: ${parts.join(", ")}.`;
}

function formatAssistantMessage(content: string): string {
  return content.replace(
    VALUATION_URL_PATTERN,
    "[Continue for full valuation](https://www.collision.academy/)"
  );
}

function toSpeechText(content: string): string {
  return formatAssistantMessage(content)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/[`*_>#-]+/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveExportErrorMessage(status: number, fallback?: string): string {
  if (status === 401) {
    return "Please sign in to download a redacted chat export.";
  }

  if (status === 403) {
    return "Redacted chat download is not available on this account yet.";
  }

  if (status === 400) {
    return fallback || "There was not enough chat content to build a redacted export.";
  }

  if (status === 501) {
    return "Redacted chat download is not ready yet.";
  }

  return fallback || `Redacted chat download failed (${status}).`;
}
