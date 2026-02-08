"use client";

import * as React from "react";
import FileUpload, { UploadedDocument } from "./FileUpload";
import { useSessionStore } from "@/lib/sessionStore";

type ChatRole = "user" | "assistant" | "system";
type ChatMessage = { role: ChatRole; content: string };

export default function ChatWidget() {
  // ✅ IMPORTANT: select fields individually (prevents getServerSnapshot infinite loop)
  const documents = useSessionStore((s) => s.documents);
  const addDocuments = useSessionStore((s) => s.addDocuments);
  const clearDocuments = useSessionStore((s) => s.clearDocuments);

  const workspaceNotes = useSessionStore((s) => s.workspaceNotes);
  const setWorkspaceNotes = useSessionStore((s) => s.setWorkspaceNotes);
  const clearWorkspaceNotes = useSessionStore((s) => s.clearWorkspaceNotes);

  const [messages, setMessages] = React.useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hello! Upload an estimate, OEM procedure, or photo and I'll provide structured analysis for supplements, missing ops, and OEM-aligned steps.",
    },
  ]);

  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);

  const handleUploadComplete = React.useCallback(
    (newDocs: UploadedDocument[]) => {
      if (newDocs.length) addDocuments(newDocs);
    },
    [addDocuments]
  );

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
    setSending(true);

    const userMsg: ChatMessage = { role: "user" as const, content: text };

    // optimistic UI
    setMessages((prev) => [...prev, userMsg, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg],
          documents,
          workspaceNotes,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(errText || `Chat failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let acc = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        acc += decoder.decode(value, { stream: true });

        // update last assistant message
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = { role: "assistant", content: acc };
          }
          return next;
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${msg}` }]);
    } finally {
      setSending(false);
    }
  }

  function clearAll() {
    clearDocuments();
    clearWorkspaceNotes();
    setMessages((prev) => prev.slice(0, 1));
    setInput("");
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {messages.map((m, i) => (
          <div
            key={i}
            className={[
              "max-w-[90%] rounded px-3 py-2 text-sm leading-relaxed",
              m.role === "user"
                ? "ml-auto bg-orange-500 text-black"
                : "mr-auto bg-neutral-800 text-white",
            ].join(" ")}
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

        <label htmlFor="workspace-notes" className="sr-only">
          Workspace notes
        </label>
        <textarea
          id="workspace-notes"
          aria-label="Workspace notes"
          placeholder="Workspace notes (optional)"
          value={workspaceNotes}
          onChange={(e) => setWorkspaceNotes(e.target.value)}
          className="w-full rounded bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-500"
          rows={3}
        />

        <div className="flex gap-2">
          <label htmlFor="chat-input" className="sr-only">
            Chat message
          </label>
          <input
            id="chat-input"
            aria-label="Chat message input"
            placeholder="Ask a question..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
            className="flex-1 rounded bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-500"
          />

          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={sending}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {sending ? "…" : "Send"}
          </button>

          <button
            type="button"
            onClick={clearAll}
            className="rounded bg-neutral-800 px-4 py-2 text-sm font-medium text-white"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
