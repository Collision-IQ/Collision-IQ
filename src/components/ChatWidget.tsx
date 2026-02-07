"use client";

import { useEffect, useRef, useState } from "react";

type Role = "system" | "user" | "assistant";

type Message = {
  id: string;
  role: Role;
  content: string;
};

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function ChatWidget() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: uid(),
      role: "assistant",
      content:
        "Hello! Upload an estimate, OEM procedure, or photo and I'll provide structured analysis for supplements, missing ops, and OEM-aligned steps.",
    },
  ]);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setError(null);

    const userMsg: Message = { id: uid(), role: "user", content: trimmed };
    const assistantId = uid();

    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: "assistant", content: "" },
    ]);

    setInput("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg],
        }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || "Chat request failed");
      }

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + chunk } : m
          )
        );
      }
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : "Something went wrong during chat.";
      setError(msg);

      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant" && last.content === "") copy.pop();
        return copy;
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-white/10 px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Collision-IQ</div>
            <div className="text-xs text-white/60">
              Workspace mode — uploads + context stay in sync.
            </div>
          </div>
          <div className="flex gap-2 text-[11px] text-white/60">
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
              Streaming
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
              OEM-aware
            </span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {error && (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {messages.map((m) => (
            <div
              key={m.id}
              className={[
                "max-w-[92%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm",
                m.role === "user"
                  ? "ml-auto bg-[#ff6a1a]/90 text-black"
                  : "mr-auto bg-white/10 text-white",
              ].join(" ")}
            >
              {m.content}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-white/10 px-5 py-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendText(input);
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question..."
            className="flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
