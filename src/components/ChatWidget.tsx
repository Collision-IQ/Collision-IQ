"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import FileUpload from "./FileUpload";
import { useSessionStore } from "../lib/sessionStore";

type Role = "user" | "assistant" | "system";

type ChatMessage = {
  id: string;
  role: Role;
  content: string;
};

type UploadedDocument = {
  filename: string;
  type: string;
  text: string;
};

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function safeErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "Something went wrong.";
}

async function readStreamToText(
  res: Response,
  onDelta: (t: string) => void
): Promise<void> {
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `Request failed (${res.status})`);
  }
  if (!res.body) throw new Error("No response stream.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    const chunk = decoder.decode(value, { stream: true });
    if (chunk) onDelta(chunk);
  }
}

export default function ChatWidget() {
  const { documents, setDocuments, clearDocuments } = useSessionStore((s) => ({
    documents: (s.documents ?? []) as UploadedDocument[],
    setDocuments: s.setDocuments as (docs: UploadedDocument[]) => void,
    clearDocuments: s.clearDocuments as () => void,
  }));

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: uid(),
      role: "assistant",
      content:
        "Hello! Upload an estimate, OEM procedure, or photo and I'll provide structured analysis for supplements, missing ops, and OEM-aligned steps.",
    },
  ]);

  const [input, setInput] = useState("");
  const [workspaceNotes, setWorkspaceNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    });
  }, []);

  const sendText = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || sending) return;

      setError(null);
      setSending(true);

      const userMsg: ChatMessage = { id: uid(), role: "user", content: text };
      const assistantId = uid();
      const assistantMsg: ChatMessage = { id: assistantId, role: "assistant", content: "" };

      // Optimistic UI
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput("");
      scrollToBottom();

      try {
        // Only send user+assistant messages (system stays server-side)
        const outbound = [...messages, userMsg]
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role, content: m.content }));

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: outbound,
            workspaceNotes,
            documents,
          }),
        });

        await readStreamToText(res, (delta) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + delta } : m
            )
          );
          scrollToBottom();
        });

        // If model streamed nothing, show a fallback
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId && !m.content.trim()
              ? { ...m, content: "I’m here — what would you like me to review?" }
              : m
          )
        );
      } catch (e: unknown) {
        const msg = safeErrorMessage(e);
        setError(msg);

        // Put error into assistant bubble (so UI doesn’t look “dead”)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `Error: ${msg}` }
              : m
          )
        );
      } finally {
        setSending(false);
      }
    },
    [documents, messages, scrollToBottom, sending, workspaceNotes]
  );

  const clearChat = useCallback(() => {
    setMessages([
      {
        id: uid(),
        role: "assistant",
        content:
          "Hello! Upload an estimate, OEM procedure, or photo and I'll provide structured analysis for supplements, missing ops, and OEM-aligned steps.",
      },
    ]);
    setWorkspaceNotes("");
    setError(null);
    clearDocuments();
  }, [clearDocuments]);

  const onUploadComplete = useCallback(
    (newDocs: UploadedDocument[]) => {
      setDocuments([...documents, ...newDocs]);
      // Optional: add a small assistant note that docs are available
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          content: `Got it — I can see ${newDocs.length} uploaded document(s). Ask your question when ready.`,
        },
      ]);
    },
    [setDocuments, documents]
  );

  const headerChips = useMemo(
    () => (
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
          Streaming
        </span>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
          Workspace-aware
        </span>
      </div>
    ),
    []
  );

  return (
    <div className="flex h-full min-h-0 flex-col rounded-3xl border border-white/10 bg-white/5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
        <div>
          <div className="text-sm font-semibold text-white">Collision-IQ</div>
          <div className="text-xs text-white/60">Workspace mode — uploads + context stay in sync.</div>
        </div>
        {headerChips}
      </div>

      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-auto p-4">
        {error && (
          <div className="mb-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-3">
          {messages.map((m) => (
            <div
              key={m.id}
              className={[
                "max-w-[90%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed",
                m.role === "user"
                  ? "ml-auto bg-[color:var(--accent)] text-black"
                  : "bg-white/10 text-white",
              ].join(" ")}
            >
              {m.content || (m.role === "assistant" && sending ? "…" : "")}
            </div>
          ))}
        </div>
      </div>

      {/* Workspace controls */}
      <div className="border-t border-white/10 p-4">
        <div className="mb-3 flex gap-2">
          <FileUpload
            buttonLabel="Upload documents"
            onUploadComplete={onUploadComplete}
          />
          <button
            type="button"
            onClick={clearChat}
            className="w-40 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/10"
          >
            Clear
          </button>
        </div>

        <div className="mb-3">
          <div className="mb-1 text-xs text-white/60">Workspace notes (optional)</div>
          <textarea
            value={workspaceNotes}
            onChange={(e) => setWorkspaceNotes(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
            placeholder="Add claim notes, insurer/state, repair concerns, target outcome…"
          />
          {documents.length > 0 && (
            <div className="mt-2 text-xs text-white/60">
              Attached:{" "}
              <span className="text-white/80">
                {documents.map((d) => d.filename).join(", ")}
              </span>
            </div>
          )}
        </div>

        {/* Input row */}
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendText(input);
              }
            }}
            className="h-11 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
            placeholder="Ask a question..."
            aria-label="Chat input"
          />
          <button
            type="button"
            onClick={() => void sendText(input)}
            disabled={sending || !input.trim()}
            className="h-11 w-20 rounded-xl bg-blue-600 text-sm font-semibold text-white disabled:opacity-60"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
