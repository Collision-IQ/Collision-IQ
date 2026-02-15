"use client";

import React, { useMemo, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";

type Role = "user" | "assistant";

export interface Message {
  role: Role;
  content: string;
}

type ChatWidgetProps = {
  /** Called whenever assistant text changes (including streaming) */
  onAnalysisChange?: (text: string) => void;
  /** Called whenever attachment changes */
  onAttachmentChange?: (filename: string | null) => void;
};

export default function ChatWidget({
  onAnalysisChange,
  onAttachmentChange,
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

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const latestAssistant = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].content;
    }
    return "";
  }, [messages]);

  // Keep side-panel in sync with latest assistant output
  React.useEffect(() => {
    onAnalysisChange?.(latestAssistant);
  }, [latestAssistant, onAnalysisChange]);

  async function handleSend() {
  const hasTyped = input.trim().length > 0;
  const hasAttachment = !!selectedFile;

  if ((!hasTyped && !hasAttachment) || loading) return;

  setLoading(true);

  const messageToSend = hasTyped
    ? input
    : `Please analyze the attached file: ${selectedFile}`;

  const userMessage: Message = {
    role: "user",
    content: messageToSend,
  };

  const updatedMessages = [...messages, userMessage];
  setMessages(updatedMessages);
  setInput("");

  // Insert placeholder assistant message
  const assistantIndex = updatedMessages.length;
  setMessages(prev => [...prev, { role: "assistant", content: "" }]);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: updatedMessages }),
    });

    if (!response.ok || !response.body) {
      throw new Error("Chat API failed");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let done = false;

    while (!done) {
      const { value, done: doneReading } = await reader.read();
      done = doneReading;

      const chunk = decoder.decode(value || new Uint8Array());

      setMessages(prev => {
        const next = [...prev];
        next[assistantIndex] = {
          role: "assistant",
          content: next[assistantIndex].content + chunk,
        };
        return next;
      });
    }

  } catch {
    setMessages(prev => {
      const next = [...prev];
      next[assistantIndex] = {
        role: "assistant",
        content: "Error connecting to AI.",
      };
      return next;
    });
  } finally {
    setLoading(false);
  }
}

  async function handleFileUpload(file: File) {
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const errText = await safeReadText(res);
        throw new Error(
          `Upload failed (${res.status}). ${errText || ""}`.trim()
        );
      }

      setSelectedFile(file.name);
      onAttachmentChange?.(file.name);

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `File "${file.name}" uploaded successfully.` },
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "File upload failed.";
      setMessages((prev) => [...prev, { role: "assistant", content: msg }]);
    } finally {
      // allow re-uploading the same file name again
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function clearAttachment() {
    setSelectedFile(null);
    onAttachmentChange?.(null);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`max-w-[75%] px-5 py-4 rounded-2xl shadow-lg ${
              msg.role === "user"
                ? "ml-auto bg-orange-500 text-black"
                : "bg-black/60 border border-white/10 text-white"
            }`}
          >
            {msg.content}
          </div>
        ))}
      </div>

      {/* Input Bar */}
      <div className="border-t border-white/10 p-4">
        <div className="flex items-center gap-3">
          {/* Hidden file input */}
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".pdf,image/*"
            aria-label="Attach file"
            title="Attach file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFileUpload(f);
            }}
          />

          {/* Paperclip */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-white/50 hover:text-orange-400 transition"
            aria-label="Attach file"
          >
            <Paperclip size={20} />
          </button>

          {/* Text input */}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about a repair, upload a file, or paste an estimate..."
            className="flex-1 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-orange-500 transition"
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSend();
            }}
          />

          {/* Send */}
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={loading}
            className="rounded-xl bg-orange-500 px-5 py-3 text-black font-semibold transition hover:bg-orange-600 disabled:opacity-50"
            aria-label="Send message"
          >
            {loading ? "..." : "Send"}
          </button>
        </div>

        {/* Attachment chip */}
        {selectedFile && (
          <div className="mt-3 flex items-center justify-between bg-black/40 border border-white/10 px-4 py-2 rounded-xl text-sm text-white/80">
            <span>Attached: {selectedFile}</span>
            <button
              type="button"
              onClick={clearAttachment}
              className="text-white/70 hover:text-white transition"
              aria-label="Remove attachment"
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Stream reader for text/plain streamed responses */
async function consumeTextStream(
  response: Response,
  onDelta: (delta: string) => void
) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) onDelta(decoder.decode(value, { stream: true }));
  }
}

async function safeReadText(res: Response) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
