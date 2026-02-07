"use client";

import React from "react";

type ChatShellProps = {
  left?: React.ReactNode;
  header?: React.ReactNode;
  center: React.ReactNode;
  right?: React.ReactNode;
};

export default function ChatShell({
  left,
  header,
  center,
  right,
}: ChatShellProps) {
  return (
    <div className="mx-auto grid max-w-7xl grid-cols-[260px_1fr_300px] gap-6 p-6">
      {/* LEFT PANEL */}
      <aside className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl">
        {left}
      </aside>

      {/* CENTER */}
      <main className="flex min-h-[80vh] flex-col rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl">
        {header && (
          <div className="border-b border-white/10 p-4">{header}</div>
        )}
        <div className="flex min-h-0 flex-1 flex-col">{center}</div>
      </main>

      {/* RIGHT PANEL */}
      <aside className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl">
        {right}
      </aside>
    </div>
  );
}
