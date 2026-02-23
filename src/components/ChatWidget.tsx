"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Paperclip, X, Camera, ChevronDown, ChevronUp } from "lucide-react";
import ReactMarkdown from "react-markdown";
// Optional: if you have remark-gfm installed, uncomment:
// import remarkGfm from "remark-gfm";

type Role = "user" | "assistant";

interface Message {
  role: Role;
  content: string;
}

interface DocumentData {
  filename: string;
  text: string;
}

type VisionImage = {
  filename: string;
  dataUrl: string; // base64 data URL
};

interface Attachment {
  filename: string;
  documents: DocumentData[];
  source: "file" | "camera";
  isImage: boolean;
}

interface ChatWidgetProps {
  onAttachmentChange?: (filename: string | null) => void;
  onAnalysisChange?: (text: string) => void;
}

export default function ChatWidget({
  onAttachmentChange,
  onAnalysisChange,
}: ChatWidgetProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hi there — upload an estimate, OEM procedure, or photo and I’ll produce a structured repair analysis.",
    },
  ]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [documents, setDocuments] = useState<DocumentData[]>([]);
  const [images, setImages] = useState<VisionImage[]>([]);

  // Mobile-friendly: collapse attachments tray by default once there are several
  const [attachmentsOpen, setAttachmentsOpen] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Scroll container + anchor
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Smart auto-scroll: only follow if user is near bottom
  const shouldAutoScrollRef = useRef(true);

  const hasAnyAttachment = useMemo(() => attachments.length > 0, [attachments]);

  // If attachments become many, auto-collapse on mobile feel (still user controllable)
  useEffect(() => {
    if (attachments.length >= 3) setAttachmentsOpen(false);
    if (attachments.length === 0) setAttachmentsOpen(true);
  }, [attachments.length]);

  // Track user scroll position so we don't "yank" them while reading
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      const thresholdPx = 140; // “near bottom” threshold
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      shouldAutoScrollRef.current = distanceFromBottom < thresholdPx;
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-scroll when new content arrives ONLY if user is near bottom
  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  function buildAttachmentSummary(list: Attachment[]) {
    if (!list.length) return "";
    if (list.length === 1)
      return `Please analyze the attached file: ${list[0].filename}`;
    return `Please analyze the attached files (${list.length}): ${list
      .map((a) => a.filename)
      .join(", ")}`;
  }

  function isLikelyImageFile(file: File) {
    return file.type.startsWith("image/");
  }

  async function fileToDataUrl(file: File): Promise<string> {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleSend() {
    if (loading) return;
    if (!input.trim() && attachments.length === 0) return;

    setLoading(true);

    // If user is sending, we should follow the stream
    shouldAutoScrollRef.current = true;

    const messageToSend = input.trim() || buildAttachmentSummary(attachments);

    const userMessage: Message = {
      role: "user",
      content: messageToSend,
    };

    const updatedMessages: Message[] = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages,
          documents,
          images, // ✅ true vision payload
        }),
      });

      if (!response.ok) throw new Error("Chat API failed");

      const contentType = response.headers.get("content-type") || "";

      // Streaming plain text
      if (contentType.includes("text/plain") && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let assistantText = "";

        // Add assistant placeholder
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
        const assistantIndex = updatedMessages.length;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          assistantText += chunk;

          // Streaming: keep following unless user intentionally scrolled away
          setMessages((prev) => {
            const next = [...prev];
            next[assistantIndex] = { role: "assistant", content: assistantText };
            return next;
          });
        }

        onAnalysisChange?.(assistantText);
      } else {
        // Non-stream fallback
        const data = await response.json();
        const reply = (data.reply as string) || "No response received.";

        setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
        onAnalysisChange?.(reply);
      }
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Error connecting to AI." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  // Upload ONE file to existing /api/upload route (supports multi-select by looping)
  async function uploadSingleFile(file: File, source: "file" | "camera") {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/upload", { method: "POST", body: formData });
    if (!res.ok) throw new Error("Upload failed");

    const data = await res.json();

    const filename: string = data.filename || file.name;
    const docs: DocumentData[] = Array.isArray(data.documents) ? data.documents : [];

    const isImage = isLikelyImageFile(file);

    // ✅ If image: store base64 for GPT-4o vision
    if (isImage) {
      const dataUrl = await fileToDataUrl(file);

      const MAX_DATAURL_CHARS = 2_500_000;
      if (dataUrl.length <= MAX_DATAURL_CHARS) {
        setImages((prev) => [...prev, { filename, dataUrl }]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              `⚠️ Photo "${filename}" is very large and may not send reliably. ` +
              `Try a lower-resolution photo or crop the image.`,
          },
        ]);
      }
    }

    // Append attachment
    setAttachments((prev) => [
      ...prev,
      { filename, documents: docs, source, isImage },
    ]);

    // Merge docs for /api/chat
    if (docs.length) setDocuments((prev) => [...prev, ...docs]);

    // Callback (last uploaded)
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
    const remaining = attachments.filter((a) => a.filename !== filename);
    setAttachments(remaining);

    // Rebuild docs/images from remaining attachments
    const nextDocs = remaining.flatMap((a) => a.documents || []);
    setDocuments(nextDocs);

    const nextImages = images.filter((img) => img.filename !== filename);
    setImages(nextImages);

    onAttachmentChange?.(
      remaining.length ? remaining[remaining.length - 1].filename : null
    );
  }

  function clearAllAttachments() {
    setAttachments([]);
    setDocuments([]);
    setImages([]);
    onAttachmentChange?.(null);
  }

  // Responsive bubble widths: more readable on mobile
  const userBubble =
    "ml-auto bg-orange-500 text-black max-w-[90%] sm:max-w-[75%]";
  const assistantBubble =
    "bg-black/60 border border-white/10 text-white max-w-[95%] sm:max-w-[75%]";

  return (
    // ✅ Keep chat container (NOT fixed / inset)
    <div className="flex flex-col h-full min-h-0">
      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6 pt-4 sm:pt-6 pb-32 space-y-4 sm:space-y-6"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`px-4 sm:px-5 py-3 sm:py-4 rounded-2xl shadow-lg ${
              msg.role === "user" ? userBubble : assistantBubble
            }`}
          >
            {msg.role === "assistant" ? (
              <div className="prose prose-invert max-w-none text-sm sm:text-base leading-relaxed">
                <ReactMarkdown
                  // If remark-gfm is available:
                  // remarkPlugins={[remarkGfm]}
                >
                  {msg.content}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="whitespace-pre-wrap text-sm sm:text-base">
                {msg.content}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Composer + Attachments (Immersive Mobile) */}
      <div
        className="sticky bottom-0 left-0 right-0 border-t border-white/10 bg-black/85 backdrop-blur"
        style={{
          paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
        }}
      >
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
              className="text-white/60 hover:text-orange-400 transition"
              aria-label="Attach files"
            >
              <Paperclip size={20} />
            </button>

            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="text-white/60 hover:text-orange-400 transition"
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
                // Enter to send, Shift+Enter to newline (future-friendly)
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />

            <button
              onClick={handleSend}
              disabled={loading}
              className="rounded-xl bg-orange-500 px-4 sm:px-5 py-3 text-black font-semibold transition hover:bg-orange-600 disabled:opacity-50"
            >
              {loading ? "..." : "Send"}
            </button>
          </div>

          {/* Attachments tray (collapsible, mobile-friendly) */}
          {attachments.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                className="w-full flex items-center justify-between rounded-xl border border-white/10 bg-black/40 px-4 py-2 text-sm text-white/80"
                onClick={() => setAttachmentsOpen((v) => !v)}
                aria-label="Toggle attachments"
              >
                <span>
                  Attachments ({attachments.length})
                  <span className="ml-2 text-white/40">
                    {images.length > 0 ? `• Vision: ${images.length}` : ""}
                  </span>
                </span>
                {attachmentsOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              </button>

              {attachmentsOpen && (
                <div className="mt-2 space-y-2">
                  {attachments.map((a) => (
                    <div
                      key={a.filename}
                      className="flex items-center justify-between bg-black/40 border border-white/10 px-4 py-2 rounded-xl text-sm text-white/80"
                    >
                      <span className="truncate pr-3">
                        {a.filename}
                        <span className="ml-2 text-white/40">
                          ({a.source === "camera" ? "photo" : "file"}
                          {a.isImage ? ", vision" : ""})
                        </span>
                      </span>

                      <button
                        type="button"
                        onClick={() => removeAttachment(a.filename)}
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
                    className="text-xs text-white/60 hover:text-orange-400 transition"
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
}