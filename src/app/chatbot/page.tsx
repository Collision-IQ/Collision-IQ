"use client";

import React from "react";
import ChatShell from "@/components/ChatShell";
import ChatWidget from "@/components/ChatWidget";
import type { ChatWidgetApi } from "@/components/ChatWidget";

function LeftPanel({ api }: { api: ChatWidgetApi | null }) {
  return (
    <aside className="hidden lg:block">
      <div className="h-full rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl">
        <div className="p-4">
          <div className="text-sm font-semibold">Collision Academy</div>

          <button
            type="button"
            onClick={() => api?.openUpload()}
            className="mt-3 w-full rounded-xl bg-[color:var(--accent)] px-4 py-3 text-sm font-semibold text-black hover:opacity-90"
          >
            Upload docs
          </button>

          <div className="mt-6 text-xs text-white/50">QUICK PROMPTS</div>
          <div className="mt-2 grid gap-2">
            {[
              "Analyze this estimate for missing ops & likely supplements.",
              "Summarize OEM procedure implications & safety-critical steps.",
              "Identify ADAS triggers, required scans, and calibrations.",
              "Draft a neutral insurer message requesting OEM-aligned steps.",
            ].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => api?.setDraft(t)}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-left text-sm hover:bg-white/10"
              >
                {t}
              </button>
            ))}
          </div>

          <div className="mt-6 text-xs text-white/50">TOOLS</div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => api?.setDraft("Claim dispute checklist")}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
            >
              Claim dispute checklist
            </button>
            <button
              type="button"
              onClick={() => api?.setDraft("Policy vs insurance law")}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
            >
              Policy vs insurance law
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function RightPanel({ api }: { api: ChatWidgetApi | null }) {
  return (
    <aside className="hidden lg:block">
      <div className="h-full rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl">
        <div className="p-4">
          <div className="text-sm font-semibold">Workspace</div>
          <div className="mt-1 text-xs text-white/50">
            Uploaded documents available to the assistant
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white/60">
            No documents uploaded yet.
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => api?.openUpload()}
              className="flex-1 rounded-xl bg-[color:var(--accent)] px-4 py-3 text-sm font-semibold text-black hover:opacity-90"
            >
              Upload documents
            </button>
            <button
              type="button"
              onClick={() => api?.clearChat?.()}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold hover:bg-white/10"
            >
              Clear
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default function ChatbotPage() {
  // Keep api in state so panels re-render when it becomes available
  const [api, setApiState] = React.useState<ChatWidgetApi | null>(null);

  return (
    <ChatShell>
      {(setApiFromShell) => (
        <>
          <LeftPanel api={api} />

          {/* CENTER CHAT */}
          <main className="min-h-0">
            <div className="flex h-full min-h-0 flex-col rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl">
              {/* top bar */}
              <div className="shrink-0 border-b border-white/10 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">Collision-IQ</div>
                    <div className="text-xs text-white/50">
                      Workspace mode — uploads + context stay in sync.
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-white/60">
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                      Streaming
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                      OEM-aware
                    </span>
                  </div>
                </div>
              </div>

              {/* The widget itself controls scroll + input */}
              <div className="min-h-0 flex-1">
                <ChatWidget
                  onApiReady={(a) => {
                    // store for panels
                    setApiState(a);
                    // store in shell ref (optional, but keeps your original intention)
                    setApiFromShell(a);
                  }}
                />
              </div>
            </div>
          </main>

          <RightPanel api={api} />
        </>
      )}
    </ChatShell>
  );
}
