// src/components/ChatWidget.tsx
"use client";

import React, { useCallback, useMemo, useState } from "react";
import FileUpload from "@/components/FileUpload";
import { useSessionStore } from "@/lib/sessionStore";
import { shallow } from "zustand/shallow";

type ChatRole = "user" | "assistant" | "system";
type ChatMessage = { role: ChatRole; content: string };

export default function ChatWidget() {
  // ✅ HARDENED: shallow selector prevents getServerSnapshot/max depth issues
  const { documents, workspaceNotes, setWorkspaceNotes, clearDocuments } =
    useSessionStore(
      (s) => ({
        documents: s.documents,
        workspaceNotes: s.workspaceNotes,
        setWorkspaceNotes: s.setWorkspaceNotes,
        clearDocuments: s.clearDocuments,
      }),
      shallow
    );

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hello! Upload an estimate, OEM procedure, or photo and I'll provide structured analysis for supplements, missing ops, and OEM-aligned steps.",
    },
  ]);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const docCountLabel = useMemo(() => {
    const n = documents?.length ?? 0;
    return n === 0 ? "" : `${n} document${n === 1 ? "" : "s"} attached`;
  }, [documents]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    const next: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
      { role: "assistant", content: "" }, // placeholder for stream
    ];

    setMessages(next);
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next
            // don't send the blank placeholder as history
            .filter((m) => !(m.role === "assistant" && m.content === "")),
          documents,
          workspaceNotes,
        }),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `Chat failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let assistantText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        assistantText += decoder.decode(value, { stream: true });

        // Update only last assistant message
        setMessages((prev) => {
          const copy = [...prev];
          const lastIdx = copy.length - 1;
          if (lastIdx >= 0 && copy[lastIdx].role === "assistant") {
            copy[lastIdx] = { role: "assistant", content: assistantText };
          }
          return copy;
        });
      }
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `⚠️ ${String(e?.message ?? e)}` },
      ]);
    } finally {
      setSending(false);
    }
  }, [documents, input, messages, sending, workspaceNotes]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex-1 overflow-y-auto space-y-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "rounded bg-orange-600 px-3 py-2 text-sm text-white"
                : "rounded bg-neutral-800 px-3 py-2 text-sm text-neutral-100"
            }
          >
            {m.content}
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <FileUpload />

        {docCountLabel ? (
          <div className="text-xs text-neutral-300">{docCountLabel}</div>
        ) : null}

        <label className="block text-xs text-neutral-300" htmlFor="workspace-notes">
          Workspace notes (optional)
        </label>
        <textarea
          id="workspace-notes"
          className="w-full rounded bg-neutral-900 p-2 text-sm text-white outline-none"
          placeholder="Anything important the assistant should remember for this job..."
          value={workspaceNotes}
          onChange={(e) => setWorkspaceNotes(e.target.value)}
          rows={3}
        />

        <div className="flex gap-2">
          <label className="sr-only" htmlFor="chat-input">
            Chat message input
          </label>
          <input
            id="chat-input"
            className="flex-1 rounded bg-neutral-900 px-3 py-2 text-sm text-white outline-none"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question..."
            aria-label="Chat message input"
            onKeyDown={(e) => {
              if (e.key === "Enter") sendMessage();
            }}
          />
          <button
            className="rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            onClick={sendMessage}
            disabled={sending}
          >
            {sending ? "Sending…" : "Send"}
          </button>
          <button
            className="rounded bg-neutral-700 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-600"
            onClick={() => clearDocuments()}
          >
            Clear docs
          </button>
        </div>
      </div>
    </div>
  );
}
