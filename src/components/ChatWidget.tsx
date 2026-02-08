"use client";

import { useState, useCallback } from "react";
import FileUpload from "./FileUpload";
import { useSessionStore } from "@/lib/sessionStore";

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

export default function ChatWidget() {
  /** ✅ Level-4 safe store selection (no infinite loop) */
  const documents = useSessionStore((s) => s.documents ?? []);
  const setDocuments = useSessionStore((s) => s.setDocuments);
  const clearDocuments = useSessionStore((s) => s.clearDocuments);
  const workspaceNotes = useSessionStore((s) => s.workspaceNotes ?? "");
  const setWorkspaceNotes = useSessionStore((s) => s.setWorkspaceNotes);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hello! Upload an estimate, OEM procedure, or photo and I'll provide structured analysis.",
    },
  ]);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  /** ✅ Upload handler */
  const handleUploaded = useCallback(
    (newDocs: UploadedDocument[]) => {
      setDocuments([...documents, ...newDocs]);
    },
    [documents, setDocuments]
  );

  /** ✅ LEVEL-4 STREAM FIX */
  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
    ];

    setMessages(nextMessages);
    setInput("");
    setSending(true);

    const res = await fetch("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        messages: nextMessages,
        documents,
        workspaceNotes,
      }),
    });

    const reader = res.body?.getReader();
    const decoder = new TextDecoder();

    let assistantText = "";

    /** add empty assistant message */
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;

        try {
          const json = JSON.parse(line.replace("data:", "").trim());

          /** ✅ ONLY capture delta text */
          if (json.type === "response.output_text.delta") {
            assistantText += json.delta;

            setMessages((prev) => {
              const copy = [...prev];
              copy[copy.length - 1] = {
                role: "assistant",
                content: assistantText,
              };
              return copy;
            });
          }
        } catch {}
      }
    }

    setSending(false);
  }

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex-1 overflow-y-auto space-y-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`rounded p-3 ${
              m.role === "user" ? "bg-orange-500" : "bg-neutral-800"
            }`}
          >
            {m.content}
          </div>
        ))}
      </div>

      <FileUpload onUploadComplete={handleUploaded} />

      <textarea
        aria-label="workspace notes"
        placeholder="Workspace notes (optional)"
        value={workspaceNotes}
        onChange={(e) => setWorkspaceNotes(e.target.value)}
        className="bg-neutral-900 rounded p-2"
      />

      <div className="flex gap-2">
        <input
          aria-label="Chat message input"
          placeholder="Ask a question..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 bg-neutral-900 rounded px-3"
        />
        <button onClick={sendMessage} className="bg-blue-600 px-3 rounded">
          Send
        </button>
        <button onClick={() => clearDocuments()} className="bg-neutral-700 px-3 rounded">
          Clear
        </button>
      </div>
    </div>
  );
}
