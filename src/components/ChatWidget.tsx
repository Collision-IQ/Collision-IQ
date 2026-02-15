"use client";

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
        body: JSON.stringify({
          messages: updatedMessages,
        }),
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
    <div className="relative flex h-full flex-col">
      {/* Messages */}
      <div className="flex-1 space-y-6 overflow-y-auto p-6">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`max-w-[75%] rounded-2xl px-4 py-3 backdrop-blur-xl shadow-lg ${
              msg.role === "user"
                ? "ml-auto bg-[#C65A2A]/90 text-black"
                : "border border-white/10 bg-black/40 text-white"
            }`}
          >
            {msg.content}
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-white/10 p-4">
        <div className="flex gap-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question..."
            className="flex-1 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none backdrop-blur-md"
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
          />
          <button
            onClick={handleSend}
            disabled={loading}
            className="rounded-xl bg-[#C65A2A] px-5 py-3 text-black font-semibold transition hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
