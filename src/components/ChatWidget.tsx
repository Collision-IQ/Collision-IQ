"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import FileUpload, { UploadedFileContext } from "./FileUpload";

type Role = "system" | "user" | "assistant";
type Message = { role: Role; content: string };

export default function ChatWidget() {
  const { theme } = useTheme();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileContext, setFileContext] = useState<UploadedFileContext[]>([]);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const logoSrc = useMemo(
    () =>
      theme === "light"
        ? "/brand/logos/Logo-dark.png"
        : "/brand/logos/Logo-grey.png",
    [theme]
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    if (!input.trim() || sending) return;

    setSending(true);
    setError(null);

    const systemDocs =
      fileContext.length > 0
        ? [
            {
              role: "system" as Role,
              content:
                "The user uploaded the following documents for reference:\n\n" +
                fileContext
                  .map((f) =>
                    f.type === "pdf"
                      ? `--- ${f.filename} ---\n${f.text}`
                      : `--- ${f.filename} (image uploaded)`
                  )
                  .join("\n\n"),
            },
          ]
        : [];

    const nextMessages: Message[] = [
      ...systemDocs,
      ...messages,
      { role: "user", content: input },
      { role: "assistant", content: "" },
    ];

    setMessages(nextMessages);
    setInput("");
    setFileContext([]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.filter((m) => m.role !== "assistant"),
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error("Chat request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        assistantText += decoder.decode(value, { stream: true });

        setMessages((prev) => {
          const updated = [...prev];
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].role === "assistant") {
              updated[i] = { role: "assistant", content: assistantText };
              break;
            }
          }
          return updated;
        });
      }
    } catch (err: any) {
      setError(err?.message || "Something went wrong");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="w-full h-full flex flex-col bg-white dark:bg-[#0B1220] text-black dark:text-white">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-black/10 dark:border-white/10">
        <img src={logoSrc} alt="Collision Academy" className="h-7 w-auto" />
        <div className="font-semibold">Collision IQ</div>
        <div className="ml-auto text-xs opacity-70">
          {sending ? "Thinking…" : "Online"}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m, idx) => (
          <div
            key={idx}
            className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
              m.role === "user"
                ? "ml-auto bg-orange-500 text-black"
                : "mr-auto bg-black/5 dark:bg-white/10"
            }`}
          >
            {m.content}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="px-4 pb-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="p-3 border-t border-black/10 dark:border-white/10 space-y-2">
        <FileUpload onUploadComplete={setFileContext} />

        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message…"
            className="flex-1 rounded-xl px-3 py-2 bg-white dark:bg-[#111827] border border-black/10 dark:border-white/10 outline-none"
          />
          <button
            onClick={sendMessage}
            disabled={sending}
            className="rounded-xl px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
