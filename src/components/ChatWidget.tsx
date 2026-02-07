"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { UploadedDocument } from "@/types/uploadedDocument";
import { useSessionStore } from "@/lib/sessionStore";
import FileUpload from "./FileUpload";

type Role = "system" | "user" | "assistant";
type Message = { role: Role; content: string };

export type ChatWidgetApi = {
  setDraft: (text: string) => void;
  sendDraft: () => void;
  sendText: (text: string) => void;
  openUpload: () => void;
};

type Props = {
  onApiReady?: (api: ChatWidgetApi) => void;
};

export default function ChatWidget({ onApiReady }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // shared docs across pages/panels
  const docs = useSessionStore((s) => s.documents);
  const setDocs = useSessionStore((s) => s.setDocuments);

  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null!);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // system injection from uploaded docs (same behavior you already had)
  const systemDocs = useMemo<Message[]>(() => {
    if (!docs.length) return [];
    const joined = docs
      .map(
        (d) =>
          `--- ${d.filename} (${d.type}) ---\n${(d.text ?? "").slice(0, 12000)}`
      )
      .join("\n\n");

    return [
      {
        role: "system",
        content: `
The user uploaded the following documents:

${joined}

Rules:
- Treat OEM procedures as manufacturer guidance, not legal advice
- Insurance policy language varies by carrier and state
- Ask if pages appear missing or incomplete
`.trim(),
      },
    ];
  }, [docs]);

  async function sendText(text: string) {
    const msg = text.trim();
    if (!msg || sending) return;

    setError(null);
    setSending(true);

    const userMsg: Message = { role: "user", content: msg };

    // optimistic append
    setMessages((prev) => [...prev, userMsg, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...systemDocs, ...messages, userMsg],
        }),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `Chat failed (${res.status})`);
      }

      // If your /api/chat is streaming text/plain, read stream; else fallback json.
      const contentType = res.headers.get("content-type") || "";
      if (res.body && !contentType.includes("application/json")) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let assistantText = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          assistantText += decoder.decode(value, { stream: true });

          setMessages((prev) => {
            const copy = [...prev];
            for (let i = copy.length - 1; i >= 0; i--) {
              if (copy[i].role === "assistant") {
                copy[i] = { role: "assistant", content: assistantText };
                break;
              }
            }
            return copy;
          });
        }
      } else {
        const data = await res.json();
        const textOut = data?.message ?? "";

        setMessages((prev) => {
          const copy = [...prev];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].role === "assistant") {
              copy[i] = { role: "assistant", content: textOut };
              break;
            }
          }
          return copy;
        });
      }
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : "Something went wrong.";
      setError(errorMsg);
      // remove empty assistant placeholder if any
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant" && !last.content) copy.pop();
        return copy;
      });
    } finally {
      setSending(false);
    }
  }

  function sendDraft() {
    const text = input;
    setInput("");
    sendText(text);
  }

  function openUpload() {
    fileInputRef.current?.click();
  }

  // expose API to shell (Pro Level 2)
  useEffect(() => {
    if (!onApiReady) return;
    const api: ChatWidgetApi = {
      setDraft: (t) => setInput(t),
      sendDraft,
      sendText: (t) => sendText(t),
      openUpload,
    };
    onApiReady(api);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onApiReady, input, docs, messages]);

  return (
    <div className="flex h-full flex-col rounded-2xl bg-black/30 text-white">
      {/* Header strip inside panel */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="text-sm font-semibold">Collision-IQ</div>
        <div className="text-xs text-white/60">
          {sending ? "Thinking…" : "Online"}
        </div>
      </div>

      {error ? (
        <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((m, i) => {
          const isUser = m.role === "user";
          return (
            <div
              key={i}
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                isUser
                  ? "ml-auto bg-[color:var(--accent)] text-black"
                  : "mr-auto bg-white/10 text-white"
              }`}
            >
              {m.content}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* Footer actions */}
      <div className="border-t border-white/10 p-3 space-y-2">
        {/* Upload button (uses hidden input) */}
        <FileUpload
          onUploadComplete={(newDocs: UploadedDocument[]) => setDocs(newDocs)}
          buttonLabel="Upload docs here"
          className="w-full"
          inputRef={fileInputRef}
        />

        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendDraft();
            }}
            placeholder="Ask a question…"
            className="flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40"
          />
          <button
            onClick={sendDraft}
            disabled={sending}
            className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
