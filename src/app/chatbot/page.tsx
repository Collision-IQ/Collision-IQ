"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
};

const STARTER: ChatMessage = {
  role: "assistant",
  content:
    "Hi — I’m Collision-IQ. Tell me your state, vehicle (year/make/model), and what you’re trying to solve (OEM repair plan, DV, total loss, RTA, etc.).",
  createdAt: Date.now(),
};

export default function ChatbotPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([STARTER]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const canSend = useMemo(() => input.trim().length > 0 && !sending, [input, sending]);

  const scrollToBottom = (smooth = true) => {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    });
  };

  // Always keep chat pinned to bottom when new messages appear
  useEffect(() => {
    scrollToBottom(true);
  }, [messages.length]);

  // Clear transient errors after a bit (premium UX)
  useEffect(() => {
    if (!errorBanner) return;
    const t = setTimeout(() => setErrorBanner(null), 6000);
    return () => clearTimeout(t);
  }, [errorBanner]);

  const clearChat = () => {
    // Cancel an in-flight request to avoid “ghost replies”
    abortRef.current?.abort();
    abortRef.current = null;

    setSending(false);
    setErrorBanner(null);
    setMessages([STARTER]);
    setInput("");
    scrollToBottom(false);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setErrorBanner(null);
    setSending(true);
    setInput("");

    // Optimistic user message
    const next: ChatMessage[] = [
      ...messages,
      { role: "user", content: text, createdAt: Date.now() },
    ];
    setMessages(next);

    // Abort any previous call (prevents overlap on mobile)
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ messages: next }),
      });

      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        // Show a clean, user-safe message; keep details server-side
        throw new Error(data?.error || data?.detail || "Request failed");
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply ?? "", createdAt: Date.now() },
      ]);
    } catch (e: any) {
      if (e?.name === "AbortError") return;

      setErrorBanner(
        "Couldn’t send that message. Please try again. If it keeps happening, use Upload Docs and we’ll handle it offline."
      );

      // Add a calm assistant fallback message (keeps trust)
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "I hit an error sending that. Please try again. If it keeps happening, use Upload Docs and we’ll handle it offline.",
          createdAt: Date.now(),
        },
      ]);
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Left rail */}
        <aside className="lg:w-[420px]">
          <h1 className="text-3xl font-semibold">Collision-IQ</h1>
          <p className="mt-2 text-[color:var(--muted)]">
            Documentation-first guidance for policyholders and repair centers.
          </p>

          <div className="mt-6 grid gap-3">
            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-5">
              <div className="font-semibold">Best results if you include</div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[color:var(--muted)]">
                <li>State + carrier</li>
                <li>Vehicle year/make/model (VIN optional)</li>
                <li>Goal: OEM plan / DV / total loss / RTA</li>
                <li>Any estimate or supplement notes</li>
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
              <div className="font-semibold">Legal note</div>
              <p className="mt-2 text-sm text-[color:var(--muted)]">
                Collision-IQ provides informational guidance and documentation strategy — not legal advice.
              </p>
            </div>
          </div>
        </aside>

        {/* Chat panel */}
        <section className="flex-1">
          <div className="rounded-3xl border border-[color:var(--border)] bg-[color:var(--card)]">
            <div className="flex items-center justify-between border-b border-[color:var(--border)] px-5 py-4">
              <div>
                <div className="font-semibold">Chat</div>
                <div className="text-xs text-[color:var(--muted)]">
                  OEM compliance • claim strategy • next steps
                </div>
              </div>

              <button
                type="button"
                onClick={clearChat}
                className="rounded-xl border border-[color:var(--border)] px-3 py-2 text-xs hover:bg-white/5 transition"
                disabled={sending}
                title={sending ? "Please wait…" : "Clear chat"}
              >
                Clear
              </button>
            </div>

            {errorBanner && (
              <div className="border-b border-[color:var(--border)] bg-black/20 px-5 py-3 text-sm text-[color:var(--muted)]">
                {errorBanner}
              </div>
            )}

            <div
              ref={listRef}
              className="h-[560px] overflow-auto px-5 py-4"
            >
              <div className="flex flex-col gap-3">
                {messages.map((m, idx) => (
                  <div
                    key={idx}
                    className={[
                      "max-w-[92%] rounded-2xl border border-[color:var(--border)] px-4 py-3 text-sm leading-relaxed",
                      m.role === "user" ? "ml-auto bg-white/5" : "mr-auto bg-black/20",
                    ].join(" ")}
                  >
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-[color:var(--muted)]">
                      {m.role === "user" ? "You" : "Collision-IQ"}
                    </div>
                    <div className="whitespace-pre-wrap">{m.content}</div>
                  </div>
                ))}

                {sending && (
                  <div className="mr-auto max-w-[92%] rounded-2xl border border-[color:var(--border)] bg-black/20 px-4 py-3 text-sm">
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-[color:var(--muted)]">
                      Collision-IQ
                    </div>
                    <div className="text-[color:var(--muted)]">Thinking…</div>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-[color:var(--border)] p-4">
              <div className="flex gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Type your question…"
                  className="min-h-[48px] flex-1 resize-none rounded-2xl border border-[color:var(--border)] bg-black/20 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-white/10"
                  disabled={sending}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />

                <button
                  type="button"
                  onClick={send}
                  disabled={!canSend}
                  className="rounded-2xl bg-[color:var(--accent)] px-5 py-3 text-sm font-semibold text-black disabled:opacity-40"
                >
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>

              <div className="mt-2 text-xs text-[color:var(--muted)]">
                Enter to send • Shift+Enter for a new line
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
