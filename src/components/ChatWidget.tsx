"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
      const message = e instanceof Error ? e.message : "Something went wrong.";
      setError(message);
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
    <div className="flex h-full min-h-0 flex-col">
      {error && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
      {/* messages: scroll only here */}
      <div className="min-h-0 flex-1 overflow-y-auto ...">
        {/* your existing messages render */}
        {messages.map((m, i) => (
          <div key={i} className="mb-3">
            {/* ...existing message bubble markup... */}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* footer: fixed */}
      <div className="mt-3 shrink-0 space-y-2">
        {/* upload button row */}
        <FileUpload
          onUploadComplete={(newDocs) => setDocs(newDocs)}
          buttonLabel="Upload documents"
          className="w-full"
          inputRef={fileInputRef}
        />

        {/* input row */}
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendDraft();
            }}
            placeholder="Ask a question..."
            className="flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40"
          />
          <button
            onClick={sendDraft}
            disabled={sending}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
