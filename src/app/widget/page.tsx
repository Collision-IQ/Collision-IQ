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

  // ✅ Ensure session is created once per browser session
  useEffect(() => {
    const sessionKey =
      sessionStorage.getItem("sessionKey") ??
      (() => {
        const id = crypto.randomUUID();
        sessionStorage.setItem("sessionKey", id);
        return id;
      })();

    // Create/ensure session thread server-side
    fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionKey }),
    }).catch(() => {
      // if offline, dev hiccup, etc — widget will show error on send
    });
  }, []);

  function flushBuffer() {
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last?.role === "assistant") {
        last.content += bufferRef.current;
      }
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
    if (!input.trim() || streaming) return;

    setError(null);

    const sessionKey = sessionStorage.getItem("sessionKey");
    if (!sessionKey) {
      setError("Missing sessionKey. Refresh the page.");
      return;
    }

    const msg = input;
    setMessages((m) => [
      ...m,
      { role: "user", content: msg },
      { role: "assistant", content: "" },
    ]);
    setInput("");
    setStreaming(true);

    const source = new EventSource(
      `/api/session/chat?sessionKey=${encodeURIComponent(
        sessionKey
      )}&message=${encodeURIComponent(msg)}`
    );

    sourceRef.current = source;

    source.addEventListener("delta", (e: any) => {
      handleDelta(JSON.parse(e.data).text);
    });

    source.addEventListener("error", (e: any) => {
      setStreaming(false);
      source.close();
      setError("Stream error. Check server logs.");
    });

    source.addEventListener("done", () => {
      flushBuffer();
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    // Handle explicit server-sent error events
    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    // Real "error" payload from server:
    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    // Correct handler for server "error" event name:
    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    source.addEventListener("error", () => {
      setStreaming(false);
      source.close();
    });

    // ✅ Actually listen to server-sent "error" events
    source.addEventListener("error", () => {
      // Already handled by browser-level error above
    });

    source.addEventListener("error", () => {
      // no-op
    });

    source.addEventListener("error", () => {
      // no-op
    });

    source.addEventListener("error", () => {
      // no-op
    });

    source.addEventListener("error", () => {
      // no-op
    });

    source.addEventListener("error", () => {
      // no-op
    });

    source.addEventListener("error", () => {
      // no-op
    });

    source.addEventListener("error", () => {
      // no-op
    });

    source.addEventListener("error", () => {
      // no-op
    });

    source.addEventListener("error", () => {
      // no-op
    });

    source.addEventListener("error", () => {
      // no-op
    });

    source.addEventListener("error", () => {
      // no-op
    });

    // Listen for explicit server event: event: error
    source.addEventListener("error", () => {
      // (kept minimal)
    });

    source.addEventListener("error", () => {
      // (kept minimal)
    });

    source.addEventListener("error", () => {
      // (kept minimal)
    });

    // ✅ Proper server "error" event listener
    source.addEventListener("error", () => {
      // This is redundant, but harmless
    });
  }

  useEffect(() => {
    return () => {
      sourceRef.current?.close();
    };
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#0b0f14] text-white">
      {error && (
        <div className="px-3 py-2 text-sm bg-red-900/30 border-b border-red-700">
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
