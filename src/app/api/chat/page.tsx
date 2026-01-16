"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export default function ChatbotPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hi — I’m Collision-IQ. Tell me your year/make/model, your state, and what you’re trying to solve (OEM repair planning, DV, total loss, RTA, etc.).",
    },
  ]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const canSend = useMemo(
    () => input.trim().length > 0 && !isSending,
    [input, isSending]
  );

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({
        top: listRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  };

  const send = async () => {
    const text = input.trim();
    if (!text || isSending) return;

    setIsSending(true);
    setInput("");

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages(nextMessages);
    scrollToBottom();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || data?.error || "Request failed");

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply ?? data.text ?? "" },
      ]);
      scrollToBottom();
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "I hit an error sending that. Please try again. If it keeps happening, use Upload Docs and we’ll handle it offline.",
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex flex-col gap-6 lg:flex-row">
        <section className="lg:w-[420px]">
          <h1 className="text-3xl font-semibold">Collision-IQ</h1>
          <p className="mt-2 text-[color:var(--muted)]">
            OEM documentation + claim strategy guidance for policyholders and repair
            centers.
          </p>

          <div className="mt-6 grid gap-3">
            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-5">
              <div className="font-semibold">Best results if you include</div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[color:var(--muted)]">
                <li>Year/Make/Model (VIN if available)</li>
                <li>State + carrier</li>
                <li>What you want (OEM plan, DV, total loss, RTA)</li>
                <li>Any estimate / supplement notes</li>
              </ul>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Link
                  href="/upload"
                  className="rounded-xl bg-[color:var(--accent)] px-4 py-2 text-center text-sm font-semibold text-black hover:opacity-90 transition"
                >
                  Upload Docs
                </Link>
                <Link
                  href="/services"
                  className="rounded-xl border border-[color:var(--border)] px-4 py-2 text-center text-sm hover:bg-white/5 transition"
                >
                  View Packages
                </Link>
              </div>
            </div>

            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-5">
              <div className="font-semibold">Note</div>
              <p className="mt-2 text-sm text-[color:var(--muted)]">
                Collision-IQ provides informational guidance and documentation strategy — not legal advice.
              </p>
            </div>
          </div>
        </section>

        <section className="flex-1">
          <div className="rounded-3xl border border-[color:var(--border)] bg-[color:var(--card)]">
            <div className="flex items-center justify-between border-b border-[color:var(--border)] px-5 py-4">
              <div>
                <div className="font-semibold">Chat</div>
                <div className="text-xs text-[color:var(--muted)]">
                  Ask about OEM compliance + claim strategy
                </div>
              </div>
              <button
                onClick={() => setMessages(messages.slice(0, 1))}
                className="rounded-xl border border-[color:var(--border)] px-3 py-2 text-xs hover:bg-white/5 transition"
                type="button"
              >
                Clear
              </button>
            </div>

            <div ref={listRef} className="h-[520px] overflow-auto px-5 py-4">
              <div className="flex flex-col gap-3">
                {messages.map((m, idx) => (
                  <div
                    key={idx}
                    className={[
                      "max-w-[90%] rounded-2xl border border-[color:var(--border)] px-4 py-3 text-sm leading-relaxed",
                      m.role === "user" ? "ml-auto bg-white/5" : "mr-auto bg-black/20",
                    ].join(" ")}
                  >
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-[color:var(--muted)]">
                      {m.role === "user" ? "You" : "Collision-IQ"}
                    </div>
                    <div className="whitespace-pre-wrap">{m.content}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-[color:var(--border)] p-4">
              <div className="flex gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Type your question…"
                  className="min-h-[48px] flex-1 resize-none rounded-2xl border border-[color:var(--border)] bg-black/20 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-white/10"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />
                <button
                  onClick={send}
                  disabled={!canSend}
                  className="rounded-2xl bg-[color:var(--accent)] px-5 py-3 text-sm font-semibold text-black disabled:opacity-40"
                  type="button"
                >
                  {isSending ? "Sending…" : "Send"}
                </button>
              </div>
              <div className="mt-2 text-xs text-[color:var(--muted)]">
                Tip: Enter to send • Shift+Enter for a new line
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
