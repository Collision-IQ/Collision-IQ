"use client";

import React, { useRef } from "react";
import ChatShell from "@/components/ChatShell";
import ChatWidget, { type ChatWidgetApi } from "@/components/ChatWidget";

function LeftPanel({ api }: { api: React.MutableRefObject<ChatWidgetApi | null> }) {
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="text-sm text-white/80">Collision Academy</div>

      <button
        type="button"
        onClick={() => api.current?.openUpload()}
        className="w-full rounded-xl bg-[color:var(--accent)] px-4 py-3 text-sm font-semibold text-black hover:opacity-90"
      >
        Upload docs
      </button>

      <div className="mt-2">
        <div className="mb-2 text-xs uppercase tracking-wide text-white/40">
          Quick prompts
        </div>

        <div className="grid gap-2">
          {[
            "Analyze this estimate for missing ops & likely supplements.",
            "Summarize OEM procedure implications & safety-critical steps.",
            "Identify ADAS triggers, required scans, and calibrations.",
            "Draft a neutral insurer message requesting OEM-aligned steps.",
          ].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => api.current?.sendText(t)}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-left text-sm text-white/90 hover:bg-white/10"
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-auto">
        <div className="mb-2 text-xs uppercase tracking-wide text-white/40">
          Tools
        </div>
        <div className="grid gap-2">
          {["Claim dispute checklist", "Policy vs insurance law"].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => api.current?.sendText(t)}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-sm text-white/90 hover:bg-white/10"
            >
              {t}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function HeaderBar({ api }: { api: React.MutableRefObject<ChatWidgetApi | null> }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="text-base font-semibold">Collision-IQ</div>
        <div className="text-sm text-white/50">Workspace mode — uploads + context stay in sync.</div>
      </div>

      <div className="flex items-center gap-2">
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
          Streaming
        </span>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
          OEM-aware
        </span>

        <button
          type="button"
          onClick={() => api.current?.sendText("")}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
        >
          New Chat
        </button>

        <button
          type="button"
          onClick={() => api.current?.openUpload()}
          className="rounded-xl bg-[color:var(--accent)] px-3 py-2 text-sm font-semibold text-black hover:opacity-90"
        >
          Upload
        </button>
      </div>
    </div>
  );
}

function WorkspacePanel({ api }: { api: React.MutableRefObject<ChatWidgetApi | null> }) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <div className="text-sm font-semibold">Workspace</div>
        <div className="text-xs text-white/50">Uploaded documents available to the assistant</div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/70">
        No documents uploaded yet.
      </div>

      <div className="mt-auto flex gap-2">
        <button
          type="button"
          onClick={() => api.current?.openUpload()}
          className="flex-1 rounded-xl bg-[color:var(--accent)] px-4 py-3 text-sm font-semibold text-black hover:opacity-90"
        >
          Upload documents
        </button>

        <button
          type="button"
          onClick={() => api.current?.sendText("Clear workspace context")}
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm hover:bg-white/10"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

export default function ChatbotPage() {
  const apiRef = useRef<ChatWidgetApi | null>(null);

  return (
    <ChatShell
      left={<LeftPanel api={apiRef} />}
      header={<HeaderBar api={apiRef} />}
      right={<WorkspacePanel api={apiRef} />}
      center={
        <div className="flex h-full min-h-0 flex-col">
          {/* ChatWidget must be able to fill available height */}
          <ChatWidget onApiReady={(api) => (apiRef.current = api)} />
        </div>
      }
    />
  );
}
