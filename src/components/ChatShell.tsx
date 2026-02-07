"use client";

import React from "react";

type ChatShellProps = {
  left?: React.ReactNode;
  header?: React.ReactNode;
  center: React.ReactNode;
  right?: React.ReactNode;
};

export default function ChatShell({ left, header, center, right }: ChatShellProps) {
  return (
    <div className="min-h-[100svh] w-full bg-black text-white overflow-hidden">
      {/* soft vignette */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.10),transparent_55%)]" />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_center,rgba(0,0,0,0.55),transparent_55%)]" />

      <div className="relative mx-auto grid h-[100svh] max-w-7xl grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[280px_1fr_320px]">
        {/* LEFT */}
        <aside className="hidden lg:block min-h-0">
          <div className="h-full min-h-0 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl">
            <div className="h-full min-h-0 p-4">{left}</div>
          </div>
        </aside>

        {/* CENTER */}
        <main className="min-h-0">
          <div className="flex h-full min-h-0 flex-col rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl">
            {header ? (
              <div className="shrink-0 border-b border-white/10 p-4">{header}</div>
            ) : null}

            {/* IMPORTANT: min-h-0 so the message list can scroll */}
            <div className="min-h-0 flex-1 p-4">{center}</div>
          </div>
        </main>

        {/* RIGHT */}
        <aside className="hidden lg:block min-h-0">
          <div className="h-full min-h-0 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl">
            <div className="h-full min-h-0 p-4">{right}</div>
          </div>
        </aside>
      </div>
    </div>
  );
}
