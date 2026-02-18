"use client";

import { useState, useRef } from "react";
import { Paperclip, X } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface DocumentData {
  filename: string;
  text: string;
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
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentData[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSend() {
    if (!input.trim() && !selectedFile) return;
    if (loading) return;

    setLoading(true);

    const messageToSend =
      input.trim() || `Please analyze the attached file: ${selectedFile}`;

    const userMessage: Message = {
      role: "user",
      content: messageToSend,
    };

    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages,
          documents, // 🔥 critical addition
        }),
      });

      if (!response.ok) {
        throw new Error("Chat API failed");
      }

      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("text/plain") && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let assistantText = "";

        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "" },
        ]);

        const assistantIndex = updatedMessages.length;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          assistantText += chunk;

          setMessages((prev) => {
            const next = [...prev];
            next[assistantIndex] = {
              role: "assistant",
              content: assistantText,
            };
            return next;
          });
        }

        onAnalysisChange?.(assistantText);
      } else {
        const data = await response.json();
        const reply = data.reply || "No response received.";

        setMessages([
          ...updatedMessages,
          { role: "assistant", content: reply },
        ]);

        onAnalysisChange?.(reply);
      }
    } catch {
      setMessages([
        ...updatedMessages,
        { role: "assistant", content: "Error connecting to AI." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleFileUpload(file: File) {
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error("Upload failed");
      }

      const data = await res.json();

      // 🔥 Store full document text
      if (data.documents) {
        setDocuments(data.documents);
      }

      setSelectedFile(data.filename);
      onAttachmentChange?.(data.filename);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `File "${data.filename}" uploaded successfully.`,
        },
      ]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "File upload failed.",
        },
      ]);
    }
  }

  function clearAttachment() {
    setSelectedFile(null);
    setDocuments([]);
    onAttachmentChange?.(null);
  }

  return (
    <div className="flex flex-col h-full">
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

      <div className="border-t border-white/10 p-4">
        <div className="flex items-center gap-3">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".pdf,image/*"
            title="Attach a file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(file);
            }}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-white/50 hover:text-orange-400 transition"
            aria-label="Attach file"
          >
            <Paperclip size={20} />
          </button>

          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about a repair, upload a file, or paste an estimate..."
            className="flex-1 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-orange-500 transition"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
          />

          <button
            onClick={handleSend}
            disabled={loading}
            className="rounded-xl bg-orange-500 px-5 py-3 text-black font-semibold transition hover:bg-orange-600 disabled:opacity-50"
          >
            {loading ? "..." : "Send"}
          </button>
        </div>

        {selectedFile && (
          <div className="mt-3 flex items-center justify-between bg-black/40 border border-white/10 px-4 py-2 rounded-xl text-sm text-white/80">
            <span>Attached: {selectedFile}</span>
            <button
              type="button"
              onClick={clearAttachment}
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
