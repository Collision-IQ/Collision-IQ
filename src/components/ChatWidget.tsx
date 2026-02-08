"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import FileUpload from "@/components/FileUpload";
import { useSessionStore, type UploadedDocument } from "@/lib/sessionStore";

type ChatRole = "user" | "assistant" | "system";
type ChatMessage = { role: ChatRole; content: string };

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function ChatWidget() {
  // ✅ Select fields individually to avoid zustand snapshot infinite loops
  const documents = useSessionStore((s) => s.documents);
  const addDocuments = useSessionStore((s) => s.addDocuments);
  const clearDocuments = useSessionStore((s) => s.clearDocuments);

  const workspaceNotes = useSessionStore((s) => s.workspaceNotes);
  const setWorkspaceNotes = useSessionStore((s) => s.setWorkspaceNotes);
  const clearWorkspaceNotes = useSessionStore((s) => s.clearWorkspaceNotes);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hello! Upload an estimate, OEM procedure, or photo and I'll provide structured analysis for supplements, missing ops, and OEM-aligned steps.",
    },
  ]);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);

  const hasDocs = documents.length > 0;

  const docBadge = useMemo(() => {
    if (!hasDocs) return null;
    return (
      <div className="text-xs opacity-70">
        {documents.length} document{documents.length === 1 ? "" : "s"} attached
      </div>
    );
  }, [documents.length, hasDocs]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    });
  }, []);

  const handleUploadComplete = useCallback(
    (newDocs: UploadedDocument[]) => {
      addDocuments(newDocs);
      // Optional UX message: show that docs are attached
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Uploaded ${newDocs.length} document${
            newDocs.length === 1 ? "" : "s"
          }. Ask a question and I’ll use them as context.`,
        },
      ]);
      scrollToBottom();
    },
    [addDocuments, scrollToBottom]
  );

  const clearAll = useCallback(() => {
    clearDocuments();
    clearWorkspaceNotes();
    setMessages((prev) => {
      // keep only the initial assistant message
      const first = prev[0];
      return first ? [first] : [];
    });
    setInput("");
    setError(null);
  }, [clearDocuments, clearWorkspaceNotes]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    setError(null);
    setSending(true);

    // Build next messages with correct literal role typing
    const next: ChatMessage[] = [
      ...messages,
      { role: "user" as const, content: text },
    ];

    // Insert placeholder assistant message we will stream into
    const assistantIndex = next.length;
    const withPlaceholder: ChatMessage[] = [
      ...next,
      { role: "assistant" as const, content: "" },
    ];

    setMessages(withPlaceholder);
    setInput("");
    scrollToBottom();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          documents,
          workspaceNotes,
        }),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `Chat failed (${res.status})`);
      }

      if (!res.body) {
        throw new Error("No response stream");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let full = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) continue;

        full += chunk;

        setMessages((prev) => {
          // update only the placeholder assistant message
          if (prev.length <= assistantIndex) return prev;
          const copy = prev.slice();
          const msg = copy[assistantIndex];
          if (!msg || msg.role !== "assistant") return prev;
          copy[assistantIndex] = { role: "assistant", content: full };
          return copy;
        });

        scrollToBottom();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Chat failed";
      setError(msg);

      // Replace placeholder with an error bubble
      setMessages((prev) => {
        const copy = prev.slice();
        if (copy[assistantIndex]?.role === "assistant") {
          copy[assistantIndex] = {
            role: "assistant",
            content: `⚠️ ${msg}`,
          };
        }
        return copy;
      });
    } finally {
      setSending(false);
    }
  }, [documents, input, messages, scrollToBottom, sending, workspaceNotes]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto space-y-3 rounded-xl bg-black/20 p-3"
      >
        {messages.map((m, i) => (
          <div
            key={i}
            className={cx(
              "max-w-[92%] whitespace-pre-wrap rounded-xl px-4 py-3 text-sm",
              m.role === "user"
                ? "ml-auto bg-orange-500 text-black"
                : "bg-neutral-800 text-white"
            )}
          >
            {m.content}
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <FileUpload
          buttonLabel="Upload documents"
          onUploadComplete={handleUploadComplete}
        />

        {docBadge}

        <label className="block text-xs opacity-70" htmlFor="workspace-notes">
          Workspace notes (optional)
        </label>
        <textarea
          id="workspace-notes"
          aria-label="Workspace notes"
          className="w-full rounded-lg bg-neutral-900 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-white/20"
          placeholder="Anything important the assistant should remember for this job…"
          value={workspaceNotes}
          onChange={(e) => setWorkspaceNotes(e.target.value)}
          rows={3}
        />

        <div className="flex gap-2">
          <label className="sr-only" htmlFor="chat-input">
            Chat message
          </label>
          <input
            id="chat-input"
            aria-label="Chat message input"
            className="flex-1 rounded-lg bg-neutral-900 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-white/20"
            placeholder="Ask a question…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
          />

          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={sending || input.trim().length === 0}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {sending ? "…" : "Send"}
          </button>

          <button
            type="button"
            onClick={clearAll}
            className="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-white"
          >
            Clear
          </button>
        </div>

        {error ? (
          <div className="rounded bg-red-500/15 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
