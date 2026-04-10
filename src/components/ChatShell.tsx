"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";

type Props = {
  title?: string;
  left?: ReactNode;
  center: ReactNode;
  right?: ReactNode;
};

function Drawer({
  open,
  onClose,
  side,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  side: "left" | "right";
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] lg:hidden">
      <button
        aria-label="Close overlay"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      <div
        className={[
          "absolute top-0 h-full w-[88vw] max-w-sm border-l border-white/7 bg-card/95 shadow-2xl backdrop-blur-xl",
          side === "left" ? "left-0" : "right-0",
        ].join(" ")}
      >
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
          <div className="text-[1.05rem] font-semibold text-text">{title}</div>

          <button
            onClick={onClose}
            className="rounded-lg border border-white/7 bg-white/5 px-2 py-1 text-xs text-white/65 transition hover:bg-white/10 hover:text-white/85"
          >
            Close
          </button>
        </div>

        <div className="h-[calc(100%-52px)] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export default function ChatShell({
  title = "Collision IQ",
  left,
  center,
  right,
}: Props) {
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  const hasLeft = useMemo(() => Boolean(left), [left]);
  const hasRight = useMemo(() => Boolean(right), [right]);

  return (
    <div className="min-h-[100svh] bg-bg text-text">

      {/* Background accent */}
      <div className="pointer-events-none fixed inset-0 opacity-70">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl" />
        <div className="absolute bottom-[-280px] right-[-220px] h-[520px] w-[520px] rounded-full bg-white/5 blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-border/60 bg-black/20 backdrop-blur-xl">
        <div className="mx-auto flex h-[58px] max-w-[1480px] items-center justify-between px-4 md:px-5">

          <div className="flex items-center gap-3">
            <div className="text-[1.08rem] font-semibold tracking-[-0.02em] text-white/85">
              {title}

              <span className="ml-2 rounded-full border border-white/7 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-white/40">
                Beta
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">

            {hasLeft && (
              <button
                onClick={() => setLeftOpen(true)}
                className="lg:hidden rounded-lg border border-white/7 bg-white/5 px-3 py-1.5 text-xs text-text hover:bg-white/10"
              >
                Workspace
              </button>
            )}

            {hasRight && (
              <button
                onClick={() => setRightOpen(true)}
                className="lg:hidden rounded-lg border border-white/7 bg-white/5 px-3 py-1.5 text-xs text-text hover:bg-white/10"
              >
                Inspector
              </button>
            )}

          </div>
        </div>
      </header>

      {/* Accent divider */}
      <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-[#C65A2A]/60 to-transparent" />

      {/* Main layout */}
      <div className="relative z-10 mx-auto max-w-[1480px] px-4 py-4 md:px-5 md:py-5">

        <div className="grid h-full grid-cols-1 gap-5 lg:grid-cols-[1.04fr_1.38fr_1.04fr]">

          {/* Left panel */}
          {hasLeft && (
            <div className="hidden rounded-[24px] border border-white/7 bg-white/[0.04] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.2)] backdrop-blur-md lg:block">
              {left}
            </div>
          )}

          {/* Center panel */}
          <div className="min-w-0 rounded-[28px] border border-white/7 bg-white/[0.03] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
            {center}
          </div>

          {/* Right panel */}
          {hasRight && (
            <div className="hidden rounded-[24px] border border-white/7 bg-white/[0.04] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.2)] backdrop-blur-md lg:block">
              {right}
            </div>
          )}

        </div>

      </div>

      {/* Mobile drawers */}

      {hasLeft && (
        <Drawer
          open={leftOpen}
          onClose={() => setLeftOpen(false)}
          side="left"
          title="Workspace"
        >
          {left}
        </Drawer>
      )}

      {hasRight && (
        <Drawer
          open={rightOpen}
          onClose={() => setRightOpen(false)}
          side="right"
          title="Inspector"
        >
          {right}
        </Drawer>
      )}

    </div>
  );
}
