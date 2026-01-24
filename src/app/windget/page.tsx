"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; text: string };

export default function WidgetPage() {
  const [sessionKey, setSessionKey] = useState<string>("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Generate/persist a sessionKey for this browser
    let sk = localStorage.getItem("collision_sessionKey");
    if (!sk) {
      sk = crypto.randomUUID();
      localStorage.setItem("collision_sessionKey", sk);
    }
    setSessionKey(sk);

    // Create/reuse server session (thread + vector store)
    fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionKey: sk }),
    }).catch(console.error);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  async function sendMessage() {
    if (!input.trim() || !sessionKey) return;

    const userText = input.trim();
    setInput("");
    setMessages((m) => [...m, { role: "user", text: userText }]);

    // placeholder assistant message for streaming
    setMessages((m) => [...m, { role: "assistant", text: "" }]);
    setIsStreaming(true);

    const res = await fetch("/api/session/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionKey, message: userText }),
    });

    if (!res.ok || !res.body) {
      setIsStreaming(false);
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "assistant", text: "Error calling assistant." };
        return copy;
      });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE parsing: event: delta / data: {"text":"..."}
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        const lines = part.split("\n");
        const eventLine = lines.find((l) => l.startsWith("event:"));
        const dataLine = lines.find((l) => l.startsWith("data:"));
        const event = eventLine?.slice(6).trim();
        const data = dataLine?.slice(5).trim();

        if (event === "delta" && data) {
          try {
            const parsed = JSON.parse(data);
            const chunk = parsed.text || "";
            setMessages((m) => {
              const copy = [...m];
              const last = copy[copy.length - 1];
              copy[copy.length - 1] = { ...last, text: (last.text || "") + chunk };
              return copy;
            });
          } catch {}
        }
      }
    }

    setIsStreaming(false);
  }

  async function uploadFile(file: File) {
    if (!sessionKey) return;

    const fd = new FormData();
    fd.append("sessionKey", sessionKey);
    fd.append("file", file);

    const res = await fetch("/api/session/upload", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));

    setMessages((m) => [
      ...m,
      {
        role: "assistant",
        text: res.ok
          ? `Attached: ${data.filename || file.name}`
          : `Upload failed: ${data.error || res.statusText}`,
      },
    ]);
  }

  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: 16, fontFamily: "system-ui" }}>
      <h2 style={{ marginBottom: 8 }}>Collision IQ Chat</h2>

      <div style={{ marginBottom: 12 }}>
        <input
          type="file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadFile(f);
          }}
        />
      </div>

      <div style={{ border: "1px solid #333", borderRadius: 12, padding: 12, minHeight: 420 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ margin: "8px 0" }}>
            <b>{m.role === "user" ? "You" : "Assistant"}:</b> {m.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Ask about the uploaded docs..."
          style={{ flex: 1, padding: 10, borderRadius: 10, border: "1px solid #333" }}
        />
        <button onClick={sendMessage} disabled={isStreaming} style={{ padding: "10px 14px" }}>
          Send
        </button>
      </div>

      <p style={{ opacity: 0.7, marginTop: 10, fontSize: 12 }}>
        sessionKey: {sessionKey || "…"}
      </p>
    </main>
  );
}
