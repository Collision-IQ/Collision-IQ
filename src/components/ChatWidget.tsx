"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";

type Role = "system" | "user" | "assistant";
type Message = { role: Role; content: string };

export default function ChatWidget() {
  const { theme } = useTheme();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
// Mount-only wrapper. Do NOT add chat logic here.
  const logoSrc = useMemo(() => {
    // Adjust paths to match your /public structure
    return theme === "light"
      ? "/brand/logos/Logo-dark.png"
      : "/brand/logos/Logo-grey.png";
  }, [theme]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;

    setError(null);
    setSending(true);
    setInput("");

    const nextMessages: Message[] = [
      ...messages,
      { role: "user", content: text },
      { role: "assistant", content: "" }, // placeholder for streaming response
    ];

    setMessages(nextMessages);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Send the full conversation for better continuity
        body: JSON.stringify({ messages: nextMessages.slice(0, -1) }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`API error (${res.status}): ${detail || "Unknown error"}`);
      }

      if (!res.body) {
        throw new Error("No response body (stream missing).");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        assistantText += decoder.decode(value, { stream: true });

        setMessages((prev) => {
          // Update the last assistant message in-place
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
    } catch (e: any) {
      setError(e?.message || "Something went wrong.");
      // Remove the empty assistant placeholder if we failed
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant" && last.content === "") {
          updated.pop();
        }
        return updated;
      });
    } finally {
      setSending(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMessage();
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
        {messages.length === 0 ? (
          <div className="opacity-70 text-sm">
            Ask a question to get started.
          </div>
        ) : null}

        {messages.map((m, idx) => {
          const isUser = m.role === "user";
          return (
            <div
              key={idx}
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                isUser
                  ? "ml-auto bg-orange-500 text-black"
                  : "mr-auto bg-black/5 dark:bg-white/10"
              }`}
            >
              {m.content}
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {error ? (
        <div className="px-4 pb-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="p-3 border-t border-black/10 dark:border-white/10">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message…"
            className="flex-1 rounded-xl px-3 py-2 bg-white dark:bg-[#111827] border border-black/10 dark:border-white/10 outline-none"
          />
          <button
            type="submit"
            disabled={sending}
            className="rounded-xl px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
