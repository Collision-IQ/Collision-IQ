"use client";

import React, { useCallback, useMemo, useState } from "react";
import FileUpload from "@/components/FileUpload";
import { useSessionStore, type UploadedDocument } from "@/lib/sessionStore";

type ChatRole = "user" | "assistant";
type ChatMessage = { role: ChatRole; content: string };

export default function ChatWidget() {
  // ✅ Select fields individually to avoid snapshot identity churn
  const documents = useSessionStore((s) => s.documents);
  const workspaceNotes = useSessionStore((s) => s.workspaceNotes);
  const setWorkspaceNotes = useSessionStore((s) => s.setWorkspaceNotes);
  const addDocuments = useSessionStore((s) => s.addDocuments);
  const clearDocuments = useSessionStore((s) => s.clearDocuments);

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
    if (documents.length === 0) return "No documents attached";
    if (documents.length === 1) return "1 document attached";
    return `${documents.length} documents attached`;
  }, [documents.length]);

  const handleUploadComplete = useCallback(
    (newDocs: UploadedDocument[]) => {
      addDocuments(newDocs);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Uploaded ${newDocs.length} document${
            newDocs.length === 1 ? "" : "s"
          }. Ask a question and I’ll use them as context.`,
        },
      ]);
    },
    [addDocuments]
  );

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    setInput("");

    // append user + placeholder assistant (stream target)
    setMessages((prev) => [
      ...prev,
      { role: "user" as const, content: text },
      { role: "assistant" as const, content: "" },
    ]);

    try {
      // Build history based on *current* messages plus the new user turn
      const history: ChatMessage[] = [
        ...messages,
        { role: "user" as const, content: text },
      ];

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          documents,
          workspaceNotes,
        }),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new Error(errText || `Chat failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let assistantText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        let buffer = "";

while (true) {
  const { value, done } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });

  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.startsWith("data:")) continue;

    const json = line.replace("data:", "").trim();
    if (!json || json === "[DONE]") continue;

    try {
      const parsed = JSON.parse(json);

      // ✅ Only extract assistant text delta
      if (parsed.type === "response.output_text.delta") {
        assistantText += parsed.delta ?? "";
      }

      setMessages((prev) => {
        const copy = [...prev];
        const lastIndex = copy.length - 1;

        if (copy[lastIndex]?.role === "assistant") {
          copy[lastIndex] = {
            role: "assistant",
            content: assistantText,
          };
        }

        return copy;
      });
    } catch {
      // ignore partial JSON chunks
    }
  }
}

        setMessages((prev) => {
          const copy = [...prev];
          const lastIndex = copy.length - 1;
          if (lastIndex >= 0 && copy[lastIndex]?.role === "assistant") {
            copy[lastIndex] = { role: "assistant", content: assistantText };
          }
          return copy;
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setMessages((prev) => {
        const copy = [...prev];
        const lastIndex = copy.length - 1;
        if (lastIndex >= 0 && copy[lastIndex]?.role === "assistant") {
          copy[lastIndex] = { role: "assistant", content: `⚠️ ${msg}` };
        } else {
          copy.push({ role: "assistant", content: `⚠️ ${msg}` });
        }
        return copy;
      });
    } finally {
      setSending(false);
    }
  }, [documents, input, messages, sending, workspaceNotes]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex-1 space-y-3 overflow-y-auto">
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "rounded bg-orange-600 px-4 py-3 text-black"
                : "rounded bg-neutral-900 px-4 py-3 text-neutral-100"
            }
          >
            {m.content}
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <FileUpload onUploadComplete={handleUploadComplete} />

        <div className="text-xs text-neutral-400">{docCountLabel}</div>

        <label className="sr-only" htmlFor="workspace-notes">
          Workspace notes
        </label>
        <textarea
          id="workspace-notes"
          className="w-full rounded bg-neutral-900 p-3 text-neutral-100"
          placeholder="Workspace notes (optional)"
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
            className="flex-1 rounded bg-neutral-900 px-3 py-2 text-neutral-100"
            placeholder="Ask a question..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void sendMessage();
            }}
          />

          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={sending}
            className="rounded bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            Send
          </button>

          <button
            type="button"
            onClick={() => {
              clearDocuments();
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: "Cleared attached documents." },
              ]);
            }}
            className="rounded bg-neutral-700 px-4 py-2 font-semibold text-white"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
