// src/app/components/FloatingWidget.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

function getSessionKey(): string {
  const KEY = "collision_sessionKey";

  // Prefer sessionStorage for widgets/iframes
  const stored =
    typeof window !== "undefined" ? window.sessionStorage.getItem(KEY) : null;
  if (stored) return stored;

  const sk =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  if (typeof window !== "undefined") window.sessionStorage.setItem(KEY, sk);
  return sk;
}

export default function FloatingWidget() {
  const [open, setOpen] = useState(false);
  const sessionKey = useMemo(() => getSessionKey(), []);

  // Close on ESC
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="fixed bottom-5 right-5 z-[9999]">
      {!open ? (
        <button
          className="rounded-full px-4 py-3 bg-[color:var(--accent)] text-black font-semibold shadow-lg hover:opacity-90 transition"
          onClick={() => setOpen(true)}
          aria-label="Open Collision IQ"
        >
          Ask Collision IQ
        </button>
      ) : (
        <div className="w-[420px] max-w-[94vw] h-[72vh] max-h-[740px] rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg)] shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--border)]">
            <div className="font-semibold">Collision IQ</div>
            <div className="flex items-center gap-2">
              <button
                className="text-xs text-[color:var(--muted)] border border-[color:var(--border)] rounded-lg px-2 py-1 hover:bg-white/5"
                onClick={() => {
                  // reset session for this tab
                  window.sessionStorage.removeItem("collision_sessionKey");
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

          {/* iframe isolates UI and makes it embeddable elsewhere */}
          <iframe
            title="Collision IQ Widget"
            src={`/widget?session=${encodeURIComponent(sessionKey)}`}
            className="w-full h-[calc(100%-48px)]"
          />
        </div>
      )}
    </div>
  );
}
