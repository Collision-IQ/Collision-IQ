"use client";

import React, { useState } from "react";
import ChatWidget from "@/components/ChatWidget";
import { MessageSquare, X } from "lucide-react";

export default function FloatingChatWidget() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Launcher button */}
      <button
        onClick={() => setOpen(true)}
        className="
          fixed bottom-6 right-6 z-[60]
          rounded-full px-4 py-3
          bg-[var(--accent)] text-black
          shadow-[0_20px_60px_rgba(0,0,0,0.6)]
          hover:brightness-110 transition
          flex items-center gap-2
        "
        aria-label="Open Collision IQ Chat"
      >
        <MessageSquare size={18} />
        <span className="text-sm font-semibold">Chat</span>
      </button>

      {/* Overlay + panel */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          <div
            className="
              fixed bottom-5 right-5 z-[70]
              w-[420px] max-w-[calc(100vw-2rem)]
              h-[720px] max-h-[calc(100dvh-2rem)]
              rounded-3xl overflow-hidden
              border border-[var(--surface-border)] bg-[var(--surface)] backdrop-blur-2xl
              shadow-[0_30px_100px_rgba(0,0,0,0.75)]
            "
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-black/40">
              <div>
                <div className="text-xs tracking-[0.35em] text-white/60 uppercase">
                  Collision IQ
                </div>
                <div className="text-[10px] tracking-[0.3em] text-white/30 uppercase mt-1">
                  AI Repair Analysis Workstation
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-full p-2 hover:bg-white/10 transition"
                aria-label="Close chat"
              >
                <X size={18} />
              </button>
            </div>

            {/* Chat */}
            <div className="h-[calc(100%-52px)]">
              <ChatWidget />
            </div>
          </div>
        </>
      )}
    </>
  );
}
