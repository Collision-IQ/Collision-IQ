"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import ChatWidget, { ChatWidgetApi } from "@/components/ChatWidget";
import { useSessionStore } from "@/lib/sessionStore";

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
      {children}
    </span>
  );
}

export default function ChatShell() {
  const docs = useSessionStore((s) => s.documents);
  const clearDocs = useSessionStore((s) => s.clearDocuments);

  const [api, setApi] = useState<ChatWidgetApi | null>(null);

  const promptList = useMemo(
    () => [
      "Analyze this estimate for missing operations and likely supplements.",
      "Summarize OEM procedure implications and safety-critical steps.",
      "Identify ADAS triggers, required scans, and calibrations.",
      "Draft a neutral, professional message to the insurer requesting OEM-aligned steps.",
    ],
    []
  );

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      {/* background glow */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-[color:var(--accent)] blur-[200px] opacity-[0.10]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.06),rgba(0,0,0,0.85)_60%,rgba(0,0,0,1))]" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1500px] gap-6 px-4 py-6">
        {/* LEFT SIDEBAR */}
        <aside className="hidden w-[260px] flex-shrink-0 lg:block">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm font-semibold text-white/80">
                Collision Academy
              </div>
              <div className="h-2 w-2 rounded-full bg-emerald-400/80" />
            </div>

            <button
              onClick={() => api?.openUpload()}
              className="w-full rounded-xl bg-[color:var(--accent)] px-4 py-3 text-center font-semibold text-black hover:opacity-90"
            >
              Upload docs
            </button>

            <div className="mt-5 border-t border-white/10 pt-5">
              <div className="text-xs font-semibold text-white/50">
                Quick prompts
              </div>

              <div className="mt-3 flex flex-col gap-2 text-sm">
                {promptList.map((t) => (
                  <button
                    key={t}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-white/80 hover:bg-white/10"
                    type="button"
                    onClick={() => {
                      api?.setDraft(t);
                      api?.sendText(t);
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 border-t border-white/10 pt-5">
              <div className="text-xs font-semibold text-white/50">Tools</div>
              <div className="mt-3 flex flex-col gap-2 text-sm text-white/75">
                <button
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left hover:bg-white/10"
                  onClick={() =>
                    api?.sendText(
                      "Give me a checklist of documents and photos to support a claim dispute."
                    )
                  }
                >
                  Claim dispute checklist
                </button>
                <button
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left hover:bg-white/10"
                  onClick={() =>
                    api?.sendText(
                      "Explain the difference between policy language and insurance law, and what I should ask for."
                    )
                  }
                >
                  Policy vs insurance law
                </button>
              </div>
            </div>
          </div>
        </aside>

        {/* CENTER */}
        <main className="flex min-w-0 flex-1 flex-col gap-4">
          {/* TOP BAR */}
          <header className="rounded-3xl border border-white/10 bg-white/5 px-5 py-4 backdrop-blur-xl">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <Image
                  src="/brand/logos/Logo-grey.png"
                  alt="Collision Academy"
                  width={160}
                  height={40}
                  className="opacity-90"
                  priority
                />
                <div>
                  <div className="text-lg font-semibold leading-tight">
                    Collision-IQ
                  </div>
                  <div className="text-sm text-white/60">
                    Workspace mode — uploads + context stay in sync.
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Chip>{docs.length ? `${docs.length} doc(s)` : "No docs yet"}</Chip>
                <Chip>Streaming</Chip>
                <Chip>OEM-aware</Chip>

                <button
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white/80 hover:bg-white/10"
                  onClick={() => api?.sendText("Start a new chat context.")}
                >
                  New Chat
                </button>

                <button
                  className="rounded-lg bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
                  onClick={() => api?.openUpload()}
                >
                  Upload
                </button>
              </div>
            </div>
          </header>

          {/* CHAT PANEL */}
          <section className="relative flex-1 min-h-[70vh] rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl overflow-hidden">
            {/* top accent */}
            <div className="h-1 w-full bg-gradient-to-r from-transparent via-[color:var(--accent)] to-transparent opacity-70" />

            <div className="relative h-full p-4 md:p-6">
              {/* Watermark */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.06]">
                <Image
                  src="/brand/logos/Logo-grey.png"
                  alt="Watermark"
                  width={520}
                  height={200}
                  className="object-contain"
                />
              </div>

              <div className="relative z-10 h-full">
                <ChatWidget onApiReady={setApi} />
              </div>
            </div>
          </section>
        </main>

        {/* RIGHT WORKSPACE */}
        <aside className="hidden w-[340px] flex-shrink-0 xl:block">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
            <div className="mb-2 text-base font-semibold">Workspace</div>
            <div className="mb-4 text-sm text-white/60">
              Uploaded documents available to the assistant
            </div>

            <div className="space-y-2">
              {docs.length ? (
                docs.map((d) => (
                  <div
                    key={`${d.filename}-${d.type}`}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm"
                  >
                    <span className="truncate">{d.filename}</span>
                    <span className="ml-3 rounded-full bg-emerald-400/20 px-2 py-0.5 text-xs text-emerald-200">
                      Ready
                    </span>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white/70">
                  No documents uploaded yet.
                </div>
              )}
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => api?.openUpload()}
                className="flex-1 rounded-xl bg-[color:var(--accent)] px-4 py-3 text-center font-semibold text-black hover:opacity-90"
              >
                Upload documents
              </button>
              <button
                onClick={() => clearDocs()}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/80 hover:bg-white/10"
              >
                Clear
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
