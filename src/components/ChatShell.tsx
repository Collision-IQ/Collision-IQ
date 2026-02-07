"use client";

import type { ReactNode } from "react";

type ChatShellProps = {
  left?: ReactNode;
  center: ReactNode; // required
  right?: ReactNode;
};

export default function ChatShell({
  left,
  center,
  right,
}: ChatShellProps) {
  return (
    <div className="relative mx-auto h-[100svh] max-w-7xl px-4 py-6">
      <div className="grid h-full grid-cols-1 gap-6 lg:grid-cols-[280px_1fr_320px]">
        {/* LEFT PANEL */}
        <aside className="hidden lg:block">
          {left}
        </aside>

        {/* CENTER CHAT */}
        <main className="min-h-0">
          {center}
        </main>

        {/* RIGHT PANEL */}
        <aside className="hidden lg:block">
          {right}
        </aside>
      </div>
    </div>
  );
}
