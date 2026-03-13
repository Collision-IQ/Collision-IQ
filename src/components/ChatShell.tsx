"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";

type Props = {
  title?: string;
  subtitle?: string;
  logo?: ReactNode;
  left?: ReactNode;
  center?: ReactNode;
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
          "absolute top-0 h-full w-[88vw] max-w-sm bg-card border-border border",
          "shadow-2xl",
          side === "left" ? "left-0" : "right-0",
        ].join(" ")}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="text-sm font-semibold text-text">{title}</div>
          <button
            onClick={onClose}
            className="rounded-lg border border-border bg-white/5 px-2 py-1 text-xs text-text hover:bg-white/10"
          >
            Close
          </button>
        </div>
        <div className="h-[calc(100%-52px)] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export default function ChatShell({ title = "Collision IQ", left, center, right }: Props) {
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  const hasLeft = useMemo(() => Boolean(left), [left]);
  const hasRight = useMemo(() => Boolean(right), [right]);

  return (
    <div className="min-h-[100svh] bg-bg text-text">
      {/* Subtle premium background */}
      <div className="pointer-events-none fixed inset-0 opacity-70">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl" />
        <div className="absolute bottom-[-280px] right-[-220px] h-[520px] w-[520px] rounded-full bg-white/5 blur-3xl" />
      </div>

      {/* Top bar */}
      <header className="relative z-10 border-b border-border bg-black/20 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="text-sm font-semibold tracking-wide">
              {title}
              <span className="ml-2 rounded-full border border-border bg-white/5 px-2 py-0.5 text-[11px] font-medium text-muted">
                Beta
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {hasLeft ? (
              <button
                onClick={() => setLeftOpen(true)}
                className="lg:hidden rounded-lg border border-border bg-white/5 px-3 py-1.5 text-xs text-text hover:bg-white/10"
              >
                Workspace
              </button>
            ) : null}

            {hasRight ? (
              <button
                onClick={() => setRightOpen(true)}
                className="lg:hidden rounded-lg border border-border bg-white/5 px-3 py-1.5 text-xs text-text hover:bg-white/10"
              >
                Inspector
              </button>
            ) : null}
          </div>
        </div>
      </header>
        <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-[#C65A2A]/60 to-transparent" />

      {/* Main grid */}
      <div className="relative z-10 mx-auto max-w-[1440px] px-4 py-4">
        <div className="grid grid-cols-[1fr_1.5fr_1fr] gap-6 h-full">
          <div>{left}</div>
          <div>{center}</div>
          <div>{right}</div>
        </div>
      </div>

      {/* Mobile drawers */}
      {hasLeft ? (
        <Drawer
          open={leftOpen}
          onClose={() => setLeftOpen(false)}
          side="left"
          title="Workspace"
        >
          {left}
        </Drawer>
      ) : null}

      {hasRight ? (
        <Drawer
          open={rightOpen}
          onClose={() => setRightOpen(false)}
          side="right"
          title="Inspector"
        >
          {right}
        </Drawer>
      ) : null}
    </div>
  );
}
