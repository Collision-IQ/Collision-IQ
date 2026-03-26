"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Paperclip, X, Camera, ChevronDown, ChevronUp, Eye, RefreshCcw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { DecisionPanel } from "@/lib/ai/builders/buildDecisionPanel";
import type { RepairIntelligenceReport } from "@/lib/ai/types/analysis";
import {
  cleanPresentationMarkdown,
  cleanPresentationText,
} from "@/lib/ui/presentationText";
import AttachmentPreviewModal, {
  type PreviewAttachment,
} from "@/components/AttachmentPreviewModal";

type Role = "user" | "assistant";

interface Message {
  role: Role;
  content: string;
}

interface Attachment {
  attachmentId: string;
  filename: string;
  mime: string;
  text: string;
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
  analysisPanel?: DecisionPanel | null;
}

const INITIAL_MESSAGE: Message = {
  role: "assistant",
  content:
    "Hi there - upload an estimate, OEM procedure, or photo and I'll produce a structured repair analysis.",
};

export default function ChatWidget({
  onAttachmentChange,
  onAnalysisChange,
  onAnalysisResultChange,
  onAnalysisPanelChange,
  analysisPanel,
}: ChatWidgetProps) {
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentsOpen, setAttachmentsOpen] = useState(true);
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null);
  const [replaceAttachmentId, setReplaceAttachmentId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<number>(0);
  const attachmentsRef = useRef<Attachment[]>([]);

  const hasAnyAttachment = useMemo(() => attachments.length > 0, [attachments]);
  const visionAttachmentCount = useMemo(
    () => attachments.filter((attachment) => attachment.hasVision).length,
    [attachments]
  );
  const previewAttachment = useMemo(
    () => attachments.find((attachment) => attachment.attachmentId === previewAttachmentId) ?? null,
    [attachments, previewAttachmentId]
  );
  const atAGlance = useMemo(() => buildAtAGlanceSummary(analysisPanel), [analysisPanel]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    if (attachments.length >= 3) setAttachmentsOpen(false);
    if (attachments.length === 0) setAttachmentsOpen(true);
  }, [attachments.length]);

  useEffect(() => {
    return () => {
      for (const attachment of attachmentsRef.current) {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      }
    };
  }, []);

  useEffect(() => {
    if (attachments.length < 2) return;

    setMessages((prev) => {
      const feedback =
        "You’ve uploaded multiple files. I’ll focus on the most relevant ones to keep performance fast.";

      if (prev[prev.length - 1]?.role === "assistant" && prev[prev.length - 1]?.content === feedback) {
        return prev;
      }

      return [...prev, { role: "assistant", content: feedback }];
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

  function handleEndChat() {
    abortRef.current?.abort();
    abortRef.current = null;
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

    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";

    onAttachmentChange?.(null);
    onAnalysisChange?.("");
    onAnalysisResultChange?.(null);
    onAnalysisPanelChange?.(null);

    shouldAutoScrollRef.current = true;
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 50);
  }

  async function handleSend() {
    if (loading) return;
    if (!input.trim() && attachments.length === 0) return;

    setLoading(true);
    shouldAutoScrollRef.current = true;

    const mySession = sessionRef.current;
    const messageToSend = input.trim() || buildAttachmentSummary(attachments);
    const userMessage: Message = {
      role: "user",
      content: messageToSend,
    };

    const updatedMessages: Message[] = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
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

        throw new Error(errorMessage);
      }

      const contentType = response.headers.get("content-type") || "";
      if (attachments.length === 0) {
        onAnalysisResultChange?.(null);
        onAnalysisPanelChange?.(null);
      } else {
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
            if (!analysisResponse.ok || sessionRef.current !== mySession) {
              onAnalysisResultChange?.(null);
              onAnalysisPanelChange?.(null);
              return;
            }

            const analysisData = (await analysisResponse.json()) as {
              report?: RepairIntelligenceReport;
              panel?: DecisionPanel;
            };
            onAnalysisResultChange?.(analysisData.report ?? null);
            onAnalysisPanelChange?.(analysisData.panel ?? null);
            setAttachments((prev) =>
              prev.map((attachment) => ({
                ...attachment,
                usedInAnalysis: true,
              }))
            );
          })
          .catch(() => {
            if (sessionRef.current === mySession) {
              onAnalysisResultChange?.(null);
              onAnalysisPanelChange?.(null);
            }
          });
      }

      if (contentType.includes("text/plain") && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let assistantText = "";

        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
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
              next[assistantIndex] = { role: "assistant", content: assistantText };
            }
            return next;
          });
        }

        if (sessionRef.current === mySession) {
          onAnalysisChange?.(assistantText);
        }
      } else {
        const data = await response.json();
        const reply = (data.reply as string) || "No response received.";

        if (sessionRef.current === mySession) {
          setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
          onAnalysisChange?.(reply);
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }

      console.error(err);

      if (sessionRef.current === mySession) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Error connecting to AI." },
        ]);
        onAnalysisResultChange?.(null);
        onAnalysisPanelChange?.(null);
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
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/upload", { method: "POST", body: formData });
    if (!res.ok) throw new Error("Upload failed");

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

    setAttachments((prev) => {
      const nextAttachment = {
        attachmentId,
        filename,
        mime,
        text,
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
    onAnalysisResultChange?.(null);
    onAnalysisPanelChange?.(null);
    setPreviewAttachmentId(replaceId ?? attachmentId);
    setReplaceAttachmentId(null);

    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: replaceId
          ? `File "${filename}" replaced the previous attachment successfully.`
          : `File "${filename}" uploaded successfully.`,
      },
    ]);
  }

  async function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;

    try {
      for (const file of Array.from(fileList)) {
        await uploadSingleFile(file, "file", replaceAttachmentId);
      }
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "One or more uploads failed." },
      ]);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleCameraSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;

    try {
      for (const file of Array.from(fileList)) {
        await uploadSingleFile(file, "camera", replaceAttachmentId);
      }
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Camera upload failed." },
      ]);
    } finally {
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  }

  function removeAttachment(attachmentId: string) {
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
    onAnalysisResultChange?.(null);
    onAnalysisPanelChange?.(null);
  }

  function clearAllAttachments() {
    attachments.forEach((attachment) => {
      if (attachment.previewUrl) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    });
    setAttachments([]);
    setPreviewAttachmentId(null);
    setReplaceAttachmentId(null);
    onAttachmentChange?.(null);
    onAnalysisResultChange?.(null);
    onAnalysisPanelChange?.(null);
  }

  function handleReplaceAttachment(attachmentId: string) {
    setReplaceAttachmentId(attachmentId);
    fileInputRef.current?.click();
  }

  const userBubble = "bg-black/70 border border-orange-500/30 text-orange-400";

  return (
    <div className="relative flex flex-col h-full min-h-0 overflow-hidden">
      <AttachmentPreviewModal
        attachment={previewAttachment as PreviewAttachment | null}
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
              <div className="text-white/60 text-sm">Start a repair analysis</div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-xl w-full">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-3 text-sm"
                >
                  Upload Estimate
                </button>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-3 text-sm"
                >
                  Upload OEM Procedure
                </button>

                <button
                  onClick={() => cameraInputRef.current?.click()}
                  className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-3 text-sm"
                >
                  Upload Photos
                </button>
              </div>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} mb-3`}
            >
              <div
                className={`rounded-2xl px-5 py-4 ${
                  msg.role === "user"
                    ? `${userBubble} max-w-[65%]`
                    : "max-w-[760px] bg-glass border-glass backdrop-blur-md"
                }`}
              >
                {msg.role === "assistant" ? (
                  <div className="analysis-report text-[15px] leading-[1.65] text-white/90">
                    {atAGlance && idx === messages.length - 1 && msg.content.trim() !== INITIAL_MESSAGE.content && (
                      <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="text-[11px] uppercase tracking-[0.2em] text-white/45">
                          At a glance
                        </div>
                        <div className="mt-3 space-y-2 text-sm leading-6 text-white/82">
                          <p>
                            <span className="font-semibold text-white">Best overall conclusion:</span>{" "}
                            {cleanPresentationText(atAGlance.conclusion)}
                          </p>
                          <p>
                            <span className="font-semibold text-white">Top dispute areas:</span>{" "}
                            {cleanPresentationText(atAGlance.disputes)}
                          </p>
                          <p>
                            <span className="font-semibold text-white">Next recommended action:</span>{" "}
                            {cleanPresentationText(atAGlance.nextAction)}
                          </p>
                        </div>
                      </div>
                    )}
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
                        li: ({ children }) => (
                          <li className="text-white/80">
                            {children}
                          </li>
                        ),
                        strong: ({ children }) => (
                          <span className="font-semibold text-white">{children}</span>
                        ),
                      }}
                    >
                      {cleanPresentationMarkdown(msg.content)}
                    </ReactMarkdown>
                  </div>
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
            <div className="flex items-center gap-3">
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".pdf,image/*"
                multiple
                title="Attach files"
                onChange={(e) => handleFilesSelected(e.target.files)}
              />

              <input
                type="file"
                ref={cameraInputRef}
                className="hidden"
                accept="image/*"
                capture="environment"
                title="Take photo"
                onChange={(e) => handleCameraSelected(e.target.files)}
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-white/60 hover:text-[#C65A2A] transition"
                aria-label="Attach files"
              >
                <Paperclip size={20} />
              </button>

              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="text-white/60 hover:text-[#C65A2A] transition"
                aria-label="Take photo"
              >
                <Camera size={20} />
              </button>

              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  hasAnyAttachment
                    ? "Ask about the attachments, or add more context..."
                    : "Ask about a repair, upload files, or take a photo..."
                }
                className="flex-1 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-orange-500 transition text-sm sm:text-base"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />

              <button
                onClick={handleSend}
                disabled={loading}
                className="rounded-xl bg-[#C65A2A] px-4 sm:px-5 py-3 text-black font-semibold transition hover:bg-[#C65A2A]/90 disabled:opacity-50"
              >
                {loading ? "..." : "Send"}
              </button>

              <button
                type="button"
                onClick={handleEndChat}
                className="rounded-xl border border-red-500/40 px-4 sm:px-5 py-3 text-red-400 hover:bg-red-500/10 transition font-semibold disabled:opacity-50"
                disabled={loading && messages.length <= 1}
                aria-label="End chat"
                title="End chat"
              >
                End
              </button>
            </div>

            {attachments.length > 0 && (
              <div className="mt-3">
                <button
                  type="button"
                  className="w-full flex items-center justify-between rounded-xl border border-white/10 bg-black/40 px-4 py-2 text-sm text-white/80"
                  onClick={() => setAttachmentsOpen((value) => !value)}
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
                            className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/65 transition hover:bg-white/10 hover:text-white"
                          >
                            <Eye size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReplaceAttachment(attachment.attachmentId)}
                            aria-label="Replace attachment"
                            className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/65 transition hover:bg-white/10 hover:text-white"
                          >
                            <RefreshCcw size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeAttachment(attachment.attachmentId)}
                            aria-label="Remove attachment"
                            className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/65 transition hover:bg-white/10 hover:text-white"
                          >
                            <X size={15} />
                          </button>
                        </div>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={clearAllAttachments}
                      className="text-xs text-white/60 hover:text-[#C65A2A] transition"
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

function buildAtAGlanceSummary(panel?: DecisionPanel | null): {
  conclusion: string;
  disputes: string;
  nextAction: string;
} | null {
  if (!panel) return null;

  const conclusion = cleanPresentationText(panel.narrative?.trim());
  if (!conclusion) return null;

  const disputeTitles = panel.supplements
    .map((item) => cleanPresentationText(item.title?.trim()))
    .filter(Boolean)
    .slice(0, 3);

  const nextAction =
    cleanPresentationText((panel.appraisal?.triggered && panel.appraisal.reasoning?.trim()) || "") ||
    cleanPresentationText(panel.negotiationResponse?.trim()) ||
    cleanPresentationText(panel.stateLeverage?.[0]?.trim()) ||
    cleanPresentationText(panel.supplements[0]?.rationale?.trim()) ||
    "";

  return {
    conclusion,
    disputes:
      disputeTitles.length > 0
        ? disputeTitles.join("; ")
        : "No major dispute areas were clearly surfaced from the current analysis.",
    nextAction:
      nextAction || "Continue with the strongest supported repair position and document the key disputed items.",
  };
}
