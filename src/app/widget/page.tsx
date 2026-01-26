"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

export default function WidgetPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bufferRef = useRef("");
  const flushTimer = useRef<number | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  // ✅ Create/ensure session once
  useEffect(() => {
    const sessionKey =
      sessionStorage.getItem("sessionKey") ??
      (() => {
        const id = crypto.randomUUID();
        sessionStorage.setItem("sessionKey", id);
        return id;
      })();

    fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionKey }),
    }).catch(() => {});
  }, []);

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

  function closeStream() {
    sourceRef.current?.close();
    sourceRef.current = null;
  }

  async function sendMessage() {
    if (!input.trim() || streaming) return;

    setError(null);

    const sessionKey = sessionStorage.getItem("sessionKey");
    if (!sessionKey) {
      setError("Missing sessionKey. Refresh the page.");
      return;
    }

    const msg = input;
    setInput("");
    setStreaming(true);

    setMessages((m) => [
      ...m,
      { role: "user", content: msg },
      { role: "assistant", content: "" },
    ]);

    const source = new EventSource(
      `/api/session/chat?sessionKey=${encodeURIComponent(sessionKey)}&message=${encodeURIComponent(msg)}`
    );
    sourceRef.current = source;

    source.addEventListener("delta", (e: MessageEvent) => {
      const payload = JSON.parse(e.data);
      handleDelta(payload.text ?? "");
    });

    // server: event: error
    source.addEventListener("error", (e: any) => {
      // Browser also uses onerror; we keep this simple.
      // If server sent an "error" event with JSON, it would arrive here as MessageEvent in some browsers,
      // but most of the time network errors also trigger this.
      setStreaming(false);
      closeStream();
      flushBuffer();
    });

    source.addEventListener("done", () => {
      flushBuffer();
      setStreaming(false);
      closeStream();
    });

    source.onerror = () => {
      setStreaming(false);
      closeStream();
      flushBuffer();
      setError("Stream disconnected. If this keeps happening, check /api/session/chat logs.");
    };
  }

  useEffect(() => {
    return () => closeStream();
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#0b0f14] text-white">
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
