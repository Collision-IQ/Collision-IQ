// src/components/ChatShell.tsx
"use client";

import type { ReactNode } from "react";

type Props = {
  left?: ReactNode;
  center: ReactNode;
  right?: ReactNode;
};

export default function ChatShell({ left, center, right }: Props) {
  return (
    <div className="min-h-[100svh] bg-black text-white">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[280px_1fr_320px]">
        <aside className="rounded-3xl border border-white/10 bg-white/5 p-5">
          {left ?? <div className="text-sm opacity-70">Left panel</div>}
        </aside>

        <main className="min-h-0 rounded-3xl border border-white/10 bg-white/5">
          {/* Ensure center can manage its own internal scrolling */}
          <div className="h-[calc(100svh-3rem)] min-h-0">{center}</div>
        </main>

        <aside className="rounded-3xl border border-white/10 bg-white/5 p-5">
          {right ?? <div className="text-sm opacity-70">Workspace panel</div>}
        </aside>
      </div>
    </div>
  );
}
