"use client";

import { useEffect, useMemo, useState } from "react";

type ChatReply = {
  text: string;
  conversationId: string | null;
};

export default function FloatingWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [loading, setLoading] = useState(false);

  const storageKey = useMemo(() => "collisioniq_conversation_id", []);
  const [conversationId, setConversationId] = useState<string | null>(null);

  useEffect(() => {
    const id = window.localStorage.getItem(storageKey);
    if (id) setConversationId(id);
  }, [storageKey]);

  async function send() {
    const msg = input.trim();
    if (!msg || loading) return;

    setMessages((m) => [...m, { role: "user", text: msg }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, conversationId }),
      });

      const data: ChatReply = await res.json();

      if (!res.ok) throw new Error((data as any)?.error ?? "Request failed");

      if (data.conversationId && data.conversationId !== conversationId) {
        setConversationId(data.conversationId);
        window.localStorage.setItem(storageKey, data.conversationId);
      }

      setMessages((m) => [...m, { role: "assistant", text: data.text }]);
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "Sorry — I ran into an error sending that. Try again." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed bottom-6 right-6 z-[9999]">
      {!open ? (
        <button
          className="rounded-full px-4 py-3 bg-[color:var(--accent)] text-black font-semibold shadow-lg hover:opacity-90 transition"
          onClick={() => setOpen(true)}
        >
          Ask Collision IQ
        </button>
      ) : (
        <div className="w-[360px] max-w-[90vw] rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg)] shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--border)]">
            <div className="font-semibold">Collision IQ</div>
            <button
              className="text-sm text-[color:var(--muted)] hover:text-[color:var(--text)]"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>

          <div className="max-h-[420px] overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 ? (
              <div className="text-sm text-[color:var(--muted)]">
                Ask a question about estimating, refinish, blend, procedures, or documentation.
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                  <div
                    className={
                      "inline-block rounded-2xl px-3 py-2 text-sm " +
                      (m.role === "user"
                        ? "bg-white/10"
                        : "bg-black/20 border border-[color:var(--border)]")
                    }
                  >
                    {m.text}
                  </div>
                </div>
              ))
            )}

            {loading && (
              <div className="text-sm text-[color:var(--muted)]">Thinking…</div>
            )}
          </div>

          <div className="flex gap-2 p-3 border-t border-[color:var(--border)]">
            <input
              className="flex-1 rounded-xl bg-transparent border border-[color:var(--border)] px-3 py-2 text-sm outline-none"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") send();
              }}
              placeholder="Type your question…"
            />
            <button
              className="rounded-xl bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-black hover:opacity-90 transition disabled:opacity-50"
              onClick={send}
              disabled={loading}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
