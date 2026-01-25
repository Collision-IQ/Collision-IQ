"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

export default function WidgetPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);

  const bufferRef = useRef("");
  const flushTimer = useRef<number | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

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
      }, 40); // ~25fps
    }
  }

  async function sendMessage() {
    if (!input.trim() || streaming) return;

    const sessionKey =
      sessionStorage.getItem("sessionKey") ??
      (() => {
        const id = crypto.randomUUID();
        sessionStorage.setItem("sessionKey", id);
        return id;
      })();

    setMessages((m) => [
      ...m,
      { role: "user", content: input },
      { role: "assistant", content: "" },
    ]);

    setInput("");
    setStreaming(true);

    const source = new EventSource(
      `/api/session/chat?sessionKey=${sessionKey}&message=${encodeURIComponent(
        input
      )}`
    );

    sourceRef.current = source;

    source.addEventListener("delta", (e: any) => {
      handleDelta(JSON.parse(e.data).text);
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
  }

  useEffect(() => {
    return () => {
      sourceRef.current?.close();
    };
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#0b0f14] text-white">
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={m.role === "user" ? "text-right" : "text-left"}
          >
            <span className="inline-block px-3 py-2 rounded-lg bg-[#1f2937]">
              {m.content || (streaming && m.role === "assistant" ? "…" : "")}
            </span>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-gray-700">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Ask something…"
          className="w-full px-3 py-2 rounded bg-[#111827] text-white"
        />
      </div>
    </div>
  );
}
