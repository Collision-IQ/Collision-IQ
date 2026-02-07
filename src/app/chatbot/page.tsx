"use client";

import ChatShell from "@/components/ChatShell";
import ChatWidget from "@/components/ChatWidget";

export default function ChatbotPage() {
  return (
    <ChatShell
      left={
        <div className="p-4">
          <h2 className="mb-4 text-sm font-semibold text-white/80">
            Collision Academy
          </h2>

          <button className="mb-4 w-full rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-black">
            Upload docs
          </button>

          <div className="space-y-2 text-xs text-white/70">
            <div className="rounded-lg border border-white/10 p-3">
              Analyze this estimate for missing ops & likely supplements.
            </div>
            <div className="rounded-lg border border-white/10 p-3">
              Summarize OEM procedure implications & safety-critical steps.
            </div>
            <div className="rounded-lg border border-white/10 p-3">
              Identify ADAS triggers, required scans, and calibrations.
            </div>
          </div>
        </div>
      }
      header={
        <div>
          <h1 className="text-sm font-semibold">Collision-IQ</h1>
          <p className="text-xs text-white/50">
            Workspace mode — uploads + context stay in sync.
          </p>
        </div>
      }
      center={<ChatWidget />}
      right={
        <div className="p-4 text-xs text-white/70">
          <h2 className="mb-3 font-semibold">Workspace</h2>
          <div className="rounded-lg border border-white/10 p-3">
            No documents uploaded yet.
          </div>

          <div className="mt-4 flex gap-2">
            <button className="flex-1 rounded-lg bg-orange-500 px-3 py-2 text-black">
              Upload documents
            </button>
            <button className="rounded-lg border border-white/20 px-3 py-2">
              Clear
            </button>
          </div>
        </div>
      }
    />
  );
}
