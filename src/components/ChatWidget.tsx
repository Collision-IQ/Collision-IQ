"use client";

import { useCallback, useRef, useState } from "react";

type Role = "user" | "assistant" | "system";

export type ChatMessage = {
  id: string;
  role: Role;
  content: string;
};

function uid() {
  return Math.random().toString(36).slice(2);
}

export default function ChatWidget() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: uid(),
      role: "assistant",
      content:
        "Hello! Upload an estimate, OEM procedure, or photo and I'll provide structured analysis for supplements, missing ops, and OEM-aligned steps.",
    },
  ]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * STREAMING SEND FUNCTION
   * Works with 2025 streaming route.ts (plain text stream)
   */
  const sendText = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setInput("");
    setLoading(true);

    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: trimmed,
    };

    const assistantId = uid();

    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: "assistant", content: "" },
    ]);

    try {
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      const res = await fetch("/api/chat", {
        method: "POST",
        signal: abortRef.current.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!res.body) {
        throw new Error("No stream returned from API");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let done = false;

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;

        const chunk = decoder.decode(value || new Uint8Array());

        if (chunk) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + chunk }
                : m
            )
          );
        }
      }
    } catch (err) {
      console.error("Chat stream error:", err);
    } finally {
      setLoading(false);
    }
  }, [loading, messages]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void sendText(input);
    },
    [input, sendText]
  );

  return (
    <div className="flex h-full min-h-0 flex-col rounded-3xl border border-white/10 bg-white/5">
      {/* HEADER */}
      <div className="border-b border-white/10 px-5 py-4">
        <h2 className="text-sm font-semibold text-white">Collision-IQ</h2>
        <p className="text-xs opacity-60">Streaming • OEM-aware</p>
      </div>

      {/* MESSAGES */}
      <div className="flex-1 space-y-3 overflow-y-auto p-5">
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "user"
                ? "ml-auto max-w-[75%] rounded-2xl bg-orange-500 px-4 py-2 text-sm text-white"
                : "mr-auto max-w-[75%] rounded-2xl bg-white/10 px-4 py-2 text-sm text-white"
            }
          >
            {m.content || (loading && m.role === "assistant" ? "…" : "")}
          </div>
        ))}
      </div>

      {/* INPUT */}
      <form
        onSubmit={handleSubmit}
        className="flex gap-2 border-t border-white/10 p-4"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question..."
          className="flex-1 rounded-xl bg-black/40 px-4 py-2 text-sm text-white outline-none"
        />

        <button
          type="submit"
          disabled={loading}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
