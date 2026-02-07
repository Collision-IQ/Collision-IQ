"use client";

import React from "react";

export type ChatShellProps = {
  left?: React.ReactNode;
  center: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
};

/**
 * ChatShell
 *
 * 2025 stable layout container.
 * - NO render props
 * - NO refs
 * - NO API wiring
 * - Pure layout only
 *
 * Eliminates:
 * ❌ "Cannot access refs during render"
 * ❌ implicit any
 * ❌ children(setApiReady) issues
 * ❌ center prop errors
 */
export default function ChatShell({
  left,
  center,
  right,
  className = "",
}: ChatShellProps) {
  return (
    <div className="relative min-h-[100svh] w-full">
      <div
        className={`mx-auto grid h-[100svh] max-w-7xl grid-cols-1 gap-6 px-4 py-6 
        lg:grid-cols-[280px_1fr_320px] ${className}`}
      >
        {/* LEFT PANEL */}
        <aside className="hidden min-h-0 rounded-3xl border border-white/10 bg-white/5 p-4 lg:block">
          {left}
        </aside>

        {/* CENTER CHAT */}
        <main className="min-h-0 rounded-3xl border border-white/10 bg-white/5">
          {center}
        </main>

        {/* RIGHT PANEL */}
        <aside className="hidden min-h-0 rounded-3xl border border-white/10 bg-white/5 p-4 lg:block">
          {right}
        </aside>
      </div>
    </div>
  );
}
