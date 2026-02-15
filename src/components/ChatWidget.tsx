"use client";

import { Paperclip } from "lucide-react";
import { useState } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  mode?: "page" | "widget";
}

export default function ChatWidget({ mode = "page" }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hi there — upload an estimate, OEM procedure, or photo and I’ll produce a structured repair analysis.",
    },
  ]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

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
        body: JSON.stringify({ messages: updatedMessages }),
      });

      const data = await response.json();

      const assistantMessage: Message = {
        role: "assistant",
        content: data.reply || "No response received.",
      };

      setMessages([...updatedMessages, assistantMessage]);
    } catch (error) {
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

  return (
    <div className="flex flex-col h-full">

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`max-w-[75%] rounded-2xl px-5 py-3 backdrop-blur-xl shadow-lg
              ${
                message.role === "user"
                  ? "ml-auto bg-[#C65A2A] text-black"
                  : "bg-black/40 border border-white/10 text-white"
              }`}
          >
            {message.content}
          </div>
        ))}
      </div>

      {/* Input Bar */}
      <div className="border-t border-white/10 p-4">
        <div className="flex items-center gap-3">

          {/* Upload Button */}
          <button
            type="button"
            aria-label="Attach file"
            className="text-white/50 hover:text-orange-400 transition"
          >
            <Paperclip size={18} />
          </button>

          {/* Text Input */}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question..."
            className="flex-1 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-orange-500 transition"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
          />

          {/* Send Button */}
          <button
            onClick={handleSend}
            disabled={loading}
            aria-label="Send message"
            className="rounded-xl bg-orange-500 px-5 py-3 text-black font-semibold transition hover:bg-orange-600 disabled:opacity-50"
          >
            {loading ? "..." : "Send"}
          </button>

        </div>
      </div>

    </div>
  );
}
