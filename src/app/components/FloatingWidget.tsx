// src/app/components/FloatingWidget.tsx
"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "collision_sessionKey";

function safeUUID() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getOrCreateSessionKey() {
  const existing = sessionStorage.getItem(STORAGE_KEY)?.trim();
  if (existing) return existing;
  const sk = safeUUID();
  sessionStorage.setItem(STORAGE_KEY, sk);
  return sk;
}

export default function FloatingWidget() {
  const [open, setOpen] = useState(false);
  const [sessionKey, setSessionKey] = useState<string>("");

  useEffect(() => {
    setSessionKey(getOrCreateSessionKey());
  }, []);

  if (!sessionKey) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[9999]">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="rounded-full bg-[color:var(--accent)] px-5 py-3 text-sm font-semibold text-black shadow-lg hover:opacity-90 transition"
        >
          Collision IQ
        </button>
      ) : (
        <div className="w-[420px] max-w-[94vw] h-[72vh] max-h-[740px] rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg)] shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--border)]">
            <div className="font-semibold">Collision IQ</div>

            <div className="flex items-center gap-2">
              <button
                className="text-xs text-[color:var(--muted)] border border-[color:var(--border)] rounded-lg px-2 py-1 hover:bg-white/5"
                onClick={() => {
                  sessionStorage.removeItem(STORAGE_KEY);
                  window.location.reload();
                }}
                title="Reset session"
              >
                Reset
              </button>

              <button
                className="text-sm text-[color:var(--muted)] hover:text-[color:var(--text)]"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
          </div>

          <iframe
            title="Collision IQ Widget"
            src={`/widget?sessionKey=${encodeURIComponent(sessionKey)}`}
            className="w-full h-[calc(100%-48px)]"
          />
        </div>
      )}
    </div>
  );
}
