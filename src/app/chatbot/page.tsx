"use client";
import Image from "next/image";
import Link from "next/link";
import ChatShell from "@/components/ChatShell";
import ChatWidget from "@/components/ChatWidget";

export default function ChatbotPage() {
  return (
    <ChatShell
      left={
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Collision Academy</div>
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
          </div>

          <Link
            href="/"
            className="block rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
          >
            ← Home
          </Link>

          <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
            <div className="text-xs text-white/60">Quick prompts</div>
            <div className="mt-2 space-y-2">
              {[
                "Analyze this estimate for missing ops & likely supplements.",
                "Summarize OEM procedure implications & safety-critical steps.",
                "Identify ADAS triggers, required scans, and calibrations.",
                "Draft a neutral insurer message requesting OEM-aligned steps.",
              ].map((t) => (
                <button
                  key={t}
                  type="button"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-sm hover:bg-white/10"
                  onClick={() => {
                    // optional: you can wire this into ChatWidget later via a small API
                    navigator.clipboard?.writeText(t).catch(() => {});
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
            <div className="text-xs text-white/60">Tools</div>
            <div className="mt-2 space-y-2">
              {["Claim dispute checklist", "Policy vs insurance law"].map((t) => (
                <div
                  key={t}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80"
                >
                  {t}
                </div>
              ))}
            </div>
          </div>
        </div>
      }
      header={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Image
              src="/brand/logos/Logo-grey.png"
              alt="Collision Academy"
              width={120}
              height={28}
              className="opacity-80"
              priority
            />
            <div>
              <div className="text-sm font-semibold">Collision-IQ</div>
              <div className="text-xs text-white/60">
                Workspace mode — uploads + context stay in sync.
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
              Streaming
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
              OEM-aware
            </span>
          </div>
        </div>
      }
      center={
        // IMPORTANT: this wrapper must be min-h-0 and flex so ChatWidget can scroll internally
        <div className="h-full min-h-0">
          <ChatWidget />
        </div>
      }
      right={
        <div className="space-y-4">
          <div>
            <div className="text-sm font-semibold">Workspace</div>
            <div className="text-xs text-white/60">
              Uploaded documents available to the assistant
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
            <div className="text-sm font-semibold">Uploaded documents</div>
            <div className="mt-2 text-sm text-white/60">
              No documents uploaded yet.
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 rounded-xl bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
              onClick={() => {
                // ChatWidget exposes its upload button internally; this is just a placeholder UI.
                // If you want this button to trigger ChatWidget’s file picker,
                // I’ll show the 2-line “upload bus” hook next.
                const el = document.querySelector<HTMLInputElement>(
                  'input[type="file"][data-ciq-upload="true"]'
                );
                el?.click();
              }}
            >
              Upload documents
            </button>
            <button
              type="button"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
              onClick={() => {
                // optional: wire to clear docs later
              }}
            >
              Clear
            </button>
          </div>
        </div>
      }
    />
  );
}
