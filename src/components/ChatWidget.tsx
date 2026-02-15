"use client";

import { useRef, useState } from "react";
import { Paperclip } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function ChatWidget() {
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function handleSend() {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      role: "user",
      content: input,
    };

    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: updatedMessages,
        }),
      });

      const data = await response.json();

      setMessages([
        ...updatedMessages,
        {
          role: "assistant",
          content: data.reply || "No response received.",
        },
      ]);
    } catch {
      setMessages([
        ...updatedMessages,
        {
          role: "assistant",
          content: "Error connecting to AI.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleFileUpload(file: File) {
    const formData = new FormData();
    formData.append("file", file);

    try {
      await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      setSelectedFile(file.name);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `File "${file.name}" uploaded successfully.`,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "File upload failed.",
        },
      ]);
    }
  }

  return (
    <div className="flex flex-col h-full">

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`max-w-[75%] px-5 py-4 rounded-2xl backdrop-blur-xl shadow-lg ${
              msg.role === "user"
                ? "ml-auto bg-orange-500 text-black"
                : "bg-black/60 border border-white/10 text-white"
            }`}
          >
            {msg.content}
          </div>
        ))}
      </div>

      {/* Input Area */}
      <div className="border-t border-white/10 p-4">
        <div className="flex items-center gap-3">

          {/* Hidden File Input */}
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleFileUpload(e.target.files[0]);
              }
            }}
          />

          {/* Paperclip Button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Upload file"
            className="text-white/50 hover:text-orange-400 transition"
          >
            <Paperclip size={18} />
          </button>

          {/* Text Input */}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about a repair, upload a file, or paste an estimate..."
            className="flex-1 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-orange-500"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
          />

          {/* Send Button */}
          <button
            onClick={handleSend}
            disabled={loading}
            className="rounded-xl bg-orange-500 px-5 py-3 text-black font-semibold hover:bg-orange-600 disabled:opacity-50"
          >
            {loading ? "..." : "Send"}
          </button>
        </div>

        {selectedFile && (
          <div className="text-xs text-white/50 mt-2">
            Attached: {selectedFile}
          </div>
        )}
      </div>
    </div>
  );
}
