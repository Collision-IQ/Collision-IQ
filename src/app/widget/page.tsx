"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

export default function WidgetPage() {
  // ✅ Prevent hydration mismatch on interactive UI
  const [mounted, setMounted] = useState(false);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bufferRef = useRef("");
  const flushTimer = useRef<number | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  // mount guard
  useEffect(() => {
    setMounted(true);
  }, []);

  // ✅ Create/ensure session once per browser session
  useEffect(() => {
    if (!mounted) return;

    const sessionKey =
      sessionStorage.getItem("sessionKey") ??
      (() => {
        const id = crypto.randomUUID();
        sessionStorage.setItem("sessionKey", id);
        return id;
      })();

    // Ensure server session exists (thread created)
    fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionKey }),
    }).catch(() => {
      // We'll surface errors when sending a message if needed
    });
  }, [mounted]);

  function closeStream() {
    sourceRef.current?.close();
    sourceRef.current = null;
  }

  function flushBuffer() {
    const chunk = bufferRef.current;
    if (!chunk) return;

    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last?.role === "assistant") last.content += chunk;
      return copy;
    });

    bufferRef.current = "";
  }

  function handleDelta(text: string) {
    bufferRef.current += text;

    if (!flushTimer.current) {
      flushTimer.current = window.setTimeout(() => {
        flushBuffer();
        flushTimer.current = null;
      }, 40);
    }
  }

  async function sendMessage() {
    if (!mounted || streaming) return;

    const msg = input.trim();
    if (!msg) return;

    setError(null);

    const sessionKey = sessionStorage.getItem("sessionKey");
    if (!sessionKey) {
      setError("Missing sessionKey. Refresh /widget.");
      return;
    }

    setInput("");
    setStreaming(true);

    setMessages((m) => [
      ...m,
      { role: "user", content: msg },
      { role: "assistant", content: "" },
    ]);

    // ✅ EventSource must call a GET SSE route
    const url = `/api/session/chat?sessionKey=${encodeURIComponent(
      sessionKey
    )}&message=${encodeURIComponent(msg)}`;

    const source = new EventSource(url);
    sourceRef.current = source;

    source.addEventListener("delta", (e: MessageEvent) => {
      const payload = JSON.parse(e.data);
      handleDelta(payload.text ?? "");
    });

    source.addEventListener("done", () => {
      flushBuffer();
      setStreaming(false);
      closeStream();
    });

    // Browser-level SSE error (disconnect, 500, etc.)
    source.onerror = () => {
      flushBuffer();
      setStreaming(false);
      closeStream();
      setError(
        "Stream disconnected. Check that /api/session/chat supports GET SSE and that /api/session created a thread."
      );
    };
  }

  useEffect(() => {
    return () => closeStream();
  }, []);

  if (!mounted) return null;

  return (
    <div className="flex flex-col h-screen bg-[#0b0f14] text-white">
      {error && (
        <div className="px-3 py-2 text-sm border-b border-red-700 bg-red-900/30">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
            <span className="inline-block px-3 py-2 rounded-lg bg-[#1f2937]">
              {m.content || (streaming && m.role === "assistant" ? "…" : "")}
            </span>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-gray-700 flex gap-2">
        <input
          suppressHydrationWarning
          autoComplete="off"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Ask something…"
          className="flex-1 px-3 py-2 rounded bg-[#111827] text-white"
        />
        <button
          onClick={sendMessage}
          disabled={streaming}
          className="px-4 py-2 rounded bg-orange-500 text-black font-semibold disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
