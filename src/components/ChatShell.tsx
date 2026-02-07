import React from "react";
import Link from "next/link";

type Props = {
  title: string;
  subtitle?: string;
  logo?: React.ReactNode;
  children: React.ReactNode;
};

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
      {children}
    </span>
  );
}

function ActionButton({
  children,
  variant = "ghost",
}: {
  children: React.ReactNode;
  variant?: "ghost" | "solid";
}) {
  const base =
    "rounded-lg px-3 py-2 text-sm font-semibold transition whitespace-nowrap";
  if (variant === "solid") {
    return (
      <button className={`${base} bg-[color:var(--accent)] text-black hover:opacity-90`}>
        {children}
      </button>
    );
  }
  return (
    <button className={`${base} border border-white/10 bg-white/5 text-white/80 hover:bg-white/10`}>
      {children}
    </button>
  );
}

export default function ChatShell({ title, subtitle, logo, children }: Props) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      {/* Background video (optional). If you keep a space in filename, keep %20 here. */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.18]">
        <video
          className="h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          // If you renamed the file, update this path:
          src="/brand/logos/logo-video.mp4"
        />
      </div>

      {/* Vignette + glow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.06),rgba(0,0,0,0.85)_60%,rgba(0,0,0,1))]" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[900px] -translate-x-1/2 rounded-full bg-[color:var(--accent)] blur-[180px] opacity-[0.10]" />

      {/* Layout */}
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1400px] gap-6 px-4 py-6">
        {/* LEFT SIDEBAR */}
        <aside className="hidden w-[260px] flex-shrink-0 lg:block">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm font-semibold text-white/80">Collision Academy</div>
              <div className="h-2 w-2 rounded-full bg-emerald-400/80" />
            </div>

            <div className="space-y-2">
              <Link
                href="/"
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10"
              >
                ← Home
              </Link>

              <a
                href="/upload"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-xl bg-[color:var(--accent)] px-3 py-2 text-sm font-semibold text-black hover:opacity-90"
              >
                Upload docs
              </a>
            </div>

            <div className="mt-5 border-t border-white/10 pt-5">
              <div className="text-xs font-semibold text-white/50">Quick prompts</div>
              <div className="mt-3 flex flex-col gap-2 text-sm">
                {[
                  "Analyze this estimate for missing operations",
                  "Explain OEM procedure implications",
                  "Find ADAS triggers & calibration needs",
                ].map((t) => (
                  <button
                    key={t}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-white/80 hover:bg-white/10"
                    type="button"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 border-t border-white/10 pt-5">
              <div className="text-xs font-semibold text-white/50">Recent chats</div>
              <div className="mt-3 space-y-2 text-sm text-white/70">
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                  ADAS calibration basics
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                  Estimate review: front-end hit
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                  SOP: blueprinting
                </div>
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
                <div className="hidden sm:block">{logo}</div>
                <div>
                  <div className="text-lg font-semibold leading-tight">{title}</div>
                  {subtitle ? (
                    <div className="text-sm text-white/60">{subtitle}</div>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Chip>Docs</Chip>
                <Chip>History</Chip>
                <Chip>Workspace</Chip>
                <ActionButton variant="ghost">New Chat</ActionButton>
                <ActionButton variant="solid">Start</ActionButton>
              </div>
            </div>
          </header>

          {/* CHAT GLASS PANEL */}
          <section className="relative min-h-[70vh] rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl">
            {/* subtle top accent */}
            <div className="h-1 w-full rounded-t-3xl bg-gradient-to-r from-transparent via-[color:var(--accent)] to-transparent opacity-70" />

            <div className="p-4 md:p-6">
              {/* Watermark logo behind chat area */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.08]">
                <div className="translate-y-6 scale-110">
                  {logo}
                </div>
              </div>

              <div className="relative z-10">{children}</div>
            </div>
          </section>

          <div className="pb-6" />
        </main>

        {/* RIGHT WORKSPACE */}
        <aside className="hidden w-[340px] flex-shrink-0 xl:block">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
            <div className="mb-4">
              <div className="text-base font-semibold">Workspace</div>
              <div className="text-sm text-white/60">Documents + context used in answers</div>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Uploaded documents</div>
                  <span className="text-xs text-white/50">…</span>
                </div>

                <div className="mt-3 space-y-2 text-sm text-white/75">
                  <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <span>Estimate_1248.pdf</span>
                    <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-xs text-emerald-200">
                      Ready
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <span>OEM_Procedure_Bumper.pdf</span>
                    <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs text-amber-200">
                      Indexing
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <span>Shop_SOP_Blueprinting.docx</span>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/70">
                      Queued
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-sm font-semibold">Quick actions</div>
                <div className="mt-3 space-y-2 text-sm text-white/75">
                  <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <div className="font-semibold">Supplement scan</div>
                    <div className="text-xs text-white/60">
                      Find missing operations — likely adds.
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <div className="font-semibold">Risk flags</div>
                    <div className="text-xs text-white/60">
                      Safety, OEM, ADAS, hidden damage.
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <div className="font-semibold">Training outline</div>
                    <div className="text-xs text-white/60">
                      Turn this doc into a module.
                    </div>
                  </div>
                </div>
              </div>

              <a
                href="/upload"
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-xl bg-[color:var(--accent)] px-4 py-3 text-center font-semibold text-black hover:opacity-90"
              >
                Upload documents
              </a>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
