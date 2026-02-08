"use client";

import { useCallback, useState } from "react";
import { useSessionStore } from "@/lib/sessionStore";
import FileUpload from "./FileUpload";

/* ============================= */
/* Types */
/* ============================= */

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type UploadedDocument = {
  filename: string;
  type: string;
  text: string;
};

/* ============================= */
/* Component */
/* ============================= */

export default function ChatWidget() {
  /** ✅ IMPORTANT:
   * Select fields individually from Zustand
   * Prevents infinite render loop
   */
  const documents = useSessionStore((s) => s.documents ?? []);
  const setDocuments = useSessionStore((s) => s.setDocuments);
  const clearDocuments = useSessionStore((s) => s.clearDocuments);

  const workspaceNotes = useSessionStore((s) => s.workspaceNotes ?? "");
  const setWorkspaceNotes = useSessionStore((s) => s.setWorkspaceNotes);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hello! Upload an estimate, OEM procedure, or photo and I'll provide structured analysis for supplements, missing ops, and OEM-aligned steps.",
    },
  ]);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  /* ============================= */
  /* Upload Handler */
  /* ============================= */

  const handleUploaded = useCallback(
    (newDocs: UploadedDocument[]) => {
      setDocuments([...documents, ...newDocs]);
    },
    [documents, setDocuments]
  );

  /* ============================= */
  /* Streaming Send */
  /* ============================= */

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;

    setInput("");

    /** ✅ FIX: role must be typed literal */
    const next: ChatMessage[] = [
      ...messages,
      { role: "user" as const, content: text },
    ];

    setMessages(next);
    setSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: next,
          documents,
          workspaceNotes,
        }),
      });

      if (!res.body) {
        setSending(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let assistant = "";

      /** placeholder assistant message */
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "" },
      ]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        assistant += decoder.decode(value);

        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = {
            role: "assistant",
            content: assistant,
          };
          return copy;
        });
      }
    } catch (err) {
      console.error(err);
    }

    setSending(false);
  }

  /* ============================= */
  /* UI */
  /* ============================= */

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Chat */}
      <div className="flex-1 overflow-y-auto space-y-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "bg-orange-600 text-white p-3 rounded-lg ml-auto max-w-[80%]"
                : "bg-neutral-800 p-3 rounded-lg max-w-[80%]"
            }
          >
            {m.content}
          </div>
        ))}
      </div>

      {/* Upload */}
      <FileUpload onUploadComplete={handleUploaded} />

      {/* Workspace Notes */}
      <textarea
        aria-label="Workspace notes"
        placeholder="Workspace notes (optional)"
        value={workspaceNotes}
        onChange={(e) => setWorkspaceNotes(e.target.value)}
        className="w-full rounded bg-neutral-900 p-2"
      />

      {/* Input */}
      <div className="flex gap-2">
        <input
          aria-label="Chat message input"
          className="flex-1 bg-neutral-900 p-2 rounded"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question..."
        />

        <button
          onClick={sendMessage}
          className="px-4 py-2 bg-blue-600 rounded"
        >
          Send
        </button>

        <button
          onClick={() => clearDocuments()}
          className="px-4 py-2 bg-neutral-700 rounded"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
