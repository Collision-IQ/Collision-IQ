"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Paperclip, X, Camera, ChevronDown, ChevronUp } from "lucide-react";
import ReactMarkdown from "react-markdown";

type Role = "user" | "assistant";

interface Message {
  role: Role;
  content: string;
}

interface Attachment {
  attachmentId: string;
  filename: string;
  source: "file" | "camera";
  hasVision: boolean;
}

export interface InspectorPanelData {
  riskScore: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  criticalIssues: number;
  evidenceQuality: "present" | "limited" | "none";
  keyRisks: string[];
  complianceIssues: string[];
  supplementOpportunities: string[];
  evidenceReferences: string[];
}

interface ChatWidgetProps {
  onAttachmentChange?: (filename: string | null) => void;
  onAnalysisChange?: (text: string) => void;
  onIntelligenceChange?: (data: InspectorPanelData | null) => void;
}

const INITIAL_MESSAGE: Message = {
  role: "assistant",
  content:
    "Hi there - upload an estimate, OEM procedure, or photo and I'll produce a structured repair analysis.",
};

export default function ChatWidget({
  onAttachmentChange,
  onAnalysisChange,
  onIntelligenceChange,
}: ChatWidgetProps) {
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentsOpen, setAttachmentsOpen] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<number>(0);

  const hasAnyAttachment = useMemo(() => attachments.length > 0, [attachments]);
  const visionAttachmentCount = useMemo(
    () => attachments.filter((attachment) => attachment.hasVision).length,
    [attachments]
  );

  useEffect(() => {
    if (attachments.length >= 3) setAttachmentsOpen(false);
    if (attachments.length === 0) setAttachmentsOpen(true);
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
    setMessages([INITIAL_MESSAGE]);
    setAttachments([]);
    setAttachmentsOpen(true);

    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";

    onAttachmentChange?.(null);
    onAnalysisChange?.("");
    onIntelligenceChange?.(null);

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
      const repairIntelligenceHeader = response.headers.get("x-repair-intelligence");

      if (repairIntelligenceHeader) {
        onIntelligenceChange?.(
          JSON.parse(decodeURIComponent(repairIntelligenceHeader)) as InspectorPanelData
        );
      } else {
        onIntelligenceChange?.(null);
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
      }
    } finally {
      if (sessionRef.current === mySession) {
        setLoading(false);
      }
    }
  }

  async function uploadSingleFile(file: File, source: "file" | "camera") {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/upload", { method: "POST", body: formData });
    if (!res.ok) throw new Error("Upload failed");

    const data = await res.json();
    const attachmentId: string = data.attachmentId;
    const filename: string = data.filename || file.name;
    const hasVision: boolean = Boolean(data.hasVision) && isLikelyImageFile(file);

    setAttachments((prev) => [
      ...prev,
      { attachmentId, filename, source, hasVision },
    ]);

    onAttachmentChange?.(filename);

    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: `File "${filename}" uploaded successfully.` },
    ]);
  }

  async function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;

    try {
      for (const file of Array.from(fileList)) {
        await uploadSingleFile(file, "file");
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
        await uploadSingleFile(file, "camera");
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

  function removeAttachment(filename: string) {
    const remaining = attachments.filter((attachment) => attachment.filename !== filename);
    setAttachments(remaining);

    onAttachmentChange?.(
      remaining.length ? remaining[remaining.length - 1].filename : null
    );
  }

  function clearAllAttachments() {
    setAttachments([]);
    onAttachmentChange?.(null);
  }

  const userBubble = "bg-black/70 border border-orange-500/30 text-orange-400";

  return (
    <div className="relative flex flex-col h-full min-h-0 overflow-hidden">
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
                      {msg.content}
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
                        className="flex items-center justify-between bg-black/40 border border-white/10 px-4 py-2 rounded-xl text-sm text-white/80"
                      >
                        <span className="truncate pr-3">
                          {attachment.filename}
                          <span className="ml-2 text-white/40">
                            ({attachment.source === "camera" ? "photo" : "file"}
                            {attachment.hasVision ? ", vision" : ""})
                          </span>
                        </span>

                        <button
                          type="button"
                          onClick={() => removeAttachment(attachment.filename)}
                          aria-label="Remove attachment"
                          className="shrink-0"
                        >
                          <X size={16} />
                        </button>
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
