"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Msg = { role: "user" | "assistant" | "system"; text: string };

function getQueryParam(name: string) {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function safeUUID() {
  // crypto.randomUUID() supported in modern browsers
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // fallback
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function WidgetPage() {
  const [sessionKey, setSessionKey] = useState<string>("");
  const [status, setStatus] = useState<string>("Initializing...");
  const [messages, setMessages] = useState<Msg[]>([
    { role: "system", text: "Upload docs/photos, then ask questions. I’ll reference what you uploaded." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const effectiveSessionKey = useMemo(() => sessionKey, [sessionKey]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  // Session init:
  // Priority:
  // 1) ?session=claim-123
  // 2) localStorage
  // 3) randomUUID
  useEffect(() => {
    const fromQuery = getQueryParam("session");
    const stored = localStorage.getItem("collision_sessionKey");
    const sk = (fromQuery?.trim() || stored?.trim() || safeUUID()).toString();

    localStorage.setItem("collision_sessionKey", sk);
    setSessionKey(sk);

    (async () => {
      try {
        setStatus("Creating session...");
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionKey: sk }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Session error (${res.status})`);
        setStatus("Ready");
      } catch (e: any) {
        setStatus(`Session error: ${e?.message || String(e)}`);
        setMessages((m) => [...m, { role: "system", text: `Session error: ${e?.message || String(e)}` }]);
      }
    })();
  }, []);

  // Optional: allow parent page to override sessionKey via postMessage (advanced embedding)
  // Parent can send: { type: "SESSION_INIT", sessionKey: "claim-123" }
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const data = ev.data;
      if (!data || typeof data !== "object") return;
      if (data.type !== "SESSION_INIT") return;
      if (!data.sessionKey || typeof data.sessionKey !== "string") return;

      const sk = data.sessionKey.trim();
      if (!sk) return;

      localStorage.setItem("collision_sessionKey", sk);
      setSessionKey(sk);
      setMessages((m) => [...m, { role: "system", text: `Session set by parent: ${sk}` }]);

      // Ensure backend session exists for the new key
      fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionKey: sk }),
      }).catch(() => {});
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!effectiveSessionKey) return;

    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        setMessages((m) => [...m, { role: "system", text: `Uploading: ${file.name}` }]);

        const fd = new FormData();
        fd.append("sessionKey", effectiveSessionKey);
        fd.append("file", file);

        const res = await fetch("/api/session/upload", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          setMessages((m) => [
            ...m,
            { role: "system", text: `Upload failed for ${file.name}: ${data?.error || res.statusText}` },
          ]);
        } else {
          setMessages((m) => [
            ...m,
            { role: "system", text: `Attached: ${data?.filename || file.name} (${data?.status || "ok"})` },
          ]);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || !effectiveSessionKey || busy) return;

    setInput("");
    setBusy(true);

    // add user message
    setMessages((m) => [...m, { role: "user", text }]);

    // add placeholder assistant message we’ll stream into
    setMessages((m) => [...m, { role: "assistant", text: "" }]);

    // Abort previous stream if any
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch("/api/session/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionKey: effectiveSessionKey, message: text }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Chat error (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      // Very small SSE parser
      let sseBuffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const chunks = sseBuffer.split("\n\n");
        sseBuffer = chunks.pop() || "";

        for (const chunk of chunks) {
          const lines = chunk.split("\n");
          const eventLine = lines.find((l) => l.startsWith("event:"));
          const dataLine = lines.find((l) => l.startsWith("data:"));

          const event = eventLine?.slice("event:".length).trim();
          const dataStr = dataLine?.slice("data:".length).trim();

          if (!event || !dataStr) continue;

          if (event === "delta") {
            try {
              const payload = JSON.parse(dataStr);
              const deltaText = payload.text || "";
              if (!deltaText) continue;

              setMessages((m) => {
                const copy = [...m];
                // last message should be assistant placeholder
                const lastIdx = copy.length - 1;
                const last = copy[lastIdx];
                if (!last || last.role !== "assistant") return copy;
                copy[lastIdx] = { role: "assistant", text: (last.text || "") + deltaText };
                return copy;
              });
            } catch {
              // ignore parse errors
            }
          }

          if (event === "error") {
            try {
              const payload = JSON.parse(dataStr);
              setMessages((m) => [...m, { role: "system", text: `Error: ${payload?.message || "Unknown"}` }]);
            } catch {
              setMessages((m) => [...m, { role: "system", text: "Error: Unknown" }]);
            }
          }
        }
      }
    } catch (e: any) {
      setMessages((m) => [...m, { role: "system", text: `Chat failed: ${e?.message || String(e)}` }]);
    } finally {
      setBusy(false);
    }
  }

  function stopStreaming() {
    abortRef.current?.abort();
    setBusy(false);
  }

  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <div>
          <div style={styles.title}>Collision IQ</div>
          <div style={styles.subtle}>Docs & photo review assistant</div>
        </div>
        <div style={styles.badge}>{status}</div>
      </header>

      <section style={styles.tools}>
        <label style={styles.upload}>
          <input
            type="file"
            multiple
            onChange={(e) => uploadFiles(e.target.files)}
            style={{ display: "none" }}
          />
          <span style={styles.uploadBtn}>Upload docs/photos</span>
        </label>

        <div style={styles.session}>
          <span style={styles.subtle}>session:</span>{" "}
          <code style={styles.code}>{effectiveSessionKey || "…"}</code>
        </div>
      </section>

      <section style={styles.chat}>
        {messages.map((m, idx) => (
          <div
            key={idx}
            style={{
              ...styles.msg,
              ...(m.role === "user" ? styles.userMsg : m.role === "assistant" ? styles.assistantMsg : styles.sysMsg),
            }}
          >
            <div style={styles.msgRole}>
              {m.role === "user" ? "You" : m.role === "assistant" ? "Collision IQ" : "System"}
            </div>
            <div style={styles.msgText}>{m.text}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </section>

      <footer style={styles.footer}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Ask about the uploaded docs…"
          style={styles.input}
          disabled={!effectiveSessionKey}
        />
        <button onClick={sendMessage} style={styles.button} disabled={busy || !effectiveSessionKey}>
          Send
        </button>
        <button onClick={stopStreaming} style={styles.secondary} disabled={!busy}>
          Stop
        </button>
      </footer>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    maxWidth: 520,
    margin: "0 auto",
    padding: 14,
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
    color: "#e7e7e7",
    background: "#0b0f14",
    minHeight: "100vh",
    boxSizing: "border-box",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 10,
  },
  title: { fontSize: 18, fontWeight: 700 },
  subtle: { fontSize: 12, opacity: 0.75 },
  badge: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 999,
    background: "#111827",
    border: "1px solid #1f2937",
    whiteSpace: "nowrap",
  },
  tools: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  upload: { cursor: "pointer" },
  uploadBtn: {
    display: "inline-block",
    padding: "8px 10px",
    borderRadius: 10,
    background: "#f97316",
    color: "#111827",
    fontWeight: 700,
  },
  session: { fontSize: 12, opacity: 0.9 },
  code: { background: "#111827", padding: "2px 6px", borderRadius: 6, border: "1px solid #1f2937" },
  chat: {
    border: "1px solid #1f2937",
    borderRadius: 14,
    padding: 10,
    minHeight: 520,
    background: "#0a0e13",
    overflowY: "auto",
  },
  msg: { padding: 10, borderRadius: 12, marginBottom: 10, border: "1px solid transparent" },
  msgRole: { fontSize: 12, opacity: 0.75, marginBottom: 6 },
  msgText: { whiteSpace: "pre-wrap", lineHeight: 1.35 },
  userMsg: { background: "#111827", borderColor: "#1f2937" },
  assistantMsg: { background: "#0b1220", borderColor: "#1d4ed8" },
  sysMsg: { background: "#0f172a", borderColor: "#334155" },
  footer: { display: "flex", gap: 8, marginTop: 10 },
  input: {
    flex: 1,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #1f2937",
    background: "#0a0e13",
    color: "#e7e7e7",
    outline: "none",
  },
  button: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "none",
    background: "#f97316",
    color: "#111827",
    fontWeight: 800,
    cursor: "pointer",
  },
  secondary: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #1f2937",
    background: "#111827",
    color: "#e7e7e7",
    cursor: "pointer",
  },
};
