'use client';

import React from 'react';

type ChatShellProps = {
  left?: React.ReactNode;
  center: React.ReactNode;
  right?: React.ReactNode;
};

export default function ChatShell({ left, center, right }: ChatShellProps) {
  return (
    <div className="min-h-screen w-full bg-black text-white">
      {/* soft vignette / glow */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_55%)]" />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_center,rgba(255,120,40,0.10),transparent_60%)]" />

      <div className="relative mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[320px_1fr_320px]">
        {/* LEFT */}
        <aside className="hidden lg:block">
          <div className="h-[calc(100vh-3rem)] rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl">
            <div className="h-full overflow-hidden p-4">{left}</div>
          </div>
        </aside>

        {/* CENTER */}
        <main className="min-h-0">
          <div className="flex h-[calc(100vh-3rem)] min-h-0 flex-col rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl">
            {center}
          </div>
        </main>

        {/* RIGHT */}
        <aside className="hidden lg:block">
          <div className="h-[calc(100vh-3rem)] rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl">
            <div className="h-full overflow-hidden p-4">{right}</div>
          </div>
        </aside>
      </div>
    </div>
  );
}
