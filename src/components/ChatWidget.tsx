"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import FileUpload from "./FileUpload";
import { useSessionStore, type UploadedDocument } from "@/lib/sessionStore";

type ChatRole = "user" | "assistant";
type ChatMessage = { role: ChatRole; content: string };

type StreamEvent = {
  type?: string;
  delta?: string | { text?: string };
};

type Props = {
  mode?: "page" | "widget";
};

export default function ChatWidget({ mode = "widget" }: Props) {
  const documents = useSessionStore((s) => s.documents);
  const workspaceNotes = useSessionStore((s) => s.workspaceNotes);
  const setWorkspaceNotes = useSessionStore((s) => s.setWorkspaceNotes);
  const addDocuments = useSessionStore((s) => s.addDocuments);
  const clearDocuments = useSessionStore((s) => s.clearDocuments);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hi there — upload an estimate, OEM procedure, or photo and I’ll produce a structured repair analysis (missing ops, OEM-required steps, supplement opportunities).",
    },
  ]);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const docCountLabel = useMemo(() => {
    if (documents.length === 0) return "No documents attached";
    if (documents.length === 1) return "1 document attached";
    return `${documents.length} documents attached`;
  }, [documents.length]);

  const scrollToBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  const handleUploadComplete = useCallback(
    (newDocs: UploadedDocument[]) => {
      addDocuments(newDocs);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Uploaded ${newDocs.length} document${newDocs.length === 1 ? "" : "s"}. Ask a question and I’ll use them as context.`,
        },
      ]);
      setTimeout(scrollToBottom, 50);
    },
    [addDocuments, scrollToBottom]
  );

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    setInput("");

    // Add user + placeholder assistant
    setMessages((prev) => [
      ...prev,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ]);

    try {
      const history: ChatMessage[] = [...messages, { role: "user", content: text }];

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
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        // If backend is plain text streaming, append directly.
        // If backend is SSE ("data: ..."), parse it.
        if (!chunk.includes("data:")) {
          assistantText += chunk;
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy.length - 1;
            if (copy[last]?.role === "assistant") {
              copy[last] = { role: "assistant", content: assistantText };
            }
            return copy;
          });
          continue;
        }

        buffer += chunk;
        const frames = buffer.split("\n");
        buffer = frames.pop() ?? "";

        for (const line of frames) {
          if (!line.startsWith("data:")) continue;
          const payload = line.replace("data:", "").trim();
          if (!payload || payload === "[DONE]") continue;

          try {
            const evt = JSON.parse(payload) as StreamEvent;

            if (evt.type === "response.output_text.delta") {
              const delta =
                typeof evt.delta === "string" ? evt.delta : evt.delta?.text;

              if (delta) assistantText += delta;

              setMessages((prev) => {
                const copy = [...prev];
                const last = copy.length - 1;
                if (copy[last]?.role === "assistant") {
                  copy[last] = { role: "assistant", content: assistantText };
                }
                return copy;
              });
            }
          } catch {
            // ignore partial JSON
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy.length - 1;
        if (copy[last]?.role === "assistant") {
          copy[last] = { role: "assistant", content: `⚠️ ${msg}` };
        } else {
          copy.push({ role: "assistant", content: `⚠️ ${msg}` });
        }
        return copy;
      });
    } finally {
      setSending(false);
      setTimeout(scrollToBottom, 50);
    }
  }, [documents, input, messages, sending, workspaceNotes, scrollToBottom]);

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-3">
        {messages.map((m, i) => {
          const isUser = m.role === "user";
          return (
            <div key={i} className={isUser ? "flex justify-end" : "flex justify-start"}>
              <div
                className={[
                  "max-w-[92%] lg:max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                  isUser
                    ? "bg-accent text-black shadow-lg"
                    : "bg-black/30 border border-border text-text shadow-sm",
                ].join(" ")}
              >
                {m.content || (sending && !isUser && i === messages.length - 1 ? "▍" : "")}
              </div>
            </div>
          );
        })}
      </div>

      {mode === "widget" ? (
        <div className="border-t border-border bg-black/20 p-4 space-y-3">
          <FileUpload onUploadComplete={handleUploadComplete} />

          <div className="text-xs text-muted">{docCountLabel}</div>

          <textarea
            className="w-full rounded-xl border border-border bg-black/30 p-3 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
            placeholder="Workspace notes (optional)"
            value={workspaceNotes}
            onChange={(e) => setWorkspaceNotes(e.target.value)}
            rows={3}
          />

          <div className="flex gap-2">
            <button
              type="button"
              onClick={clearDocuments}
              className="rounded-xl border border-border bg-white/5 px-3 py-2 text-sm text-text hover:bg-white/10"
            >
              Clear Docs
            </button>
          </div>
        </div>
      ) : null}

      <div className="sticky bottom-0 border-t border-border bg-black/30 backdrop-blur px-4 py-4">
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-xl border border-border bg-black/30 px-4 py-3 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
            placeholder="Ask a question…"
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
            className="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-black shadow-lg disabled:opacity-60"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
