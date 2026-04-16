"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";

function HeaderAuth() {
  return (
    <div className="flex items-center gap-2">
      <SignedIn>
        <UserButton afterSignOutUrl="/" />
      </SignedIn>
      <SignedOut>
        <SignInButton
          mode="modal"
          forceRedirectUrl={typeof window !== "undefined" ? window.location.href : "/"}
        >
          <button
            type="button"
            className="rounded-xl border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-white/85 transition hover:bg-white/10"
          >
            Sign in
          </button>
        </SignInButton>
      </SignedOut>
    </div>
  );
}

type Props = {
  title?: string;
  left?: ReactNode;
  center: ReactNode;
  right?: ReactNode;
  planLabel?: string;
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

function getPlanTone(planLabel: string) {
  const value = planLabel.toLowerCase();
  if (value.includes("pro")) {
    return "border-[#C65A2A]/40 bg-[#C65A2A]/12 text-[#F3A37F]";
  }
  if (value.includes("starter")) {
    return "border-white/15 bg-white/5 text-white/80";
  }
  return "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";
}

export default function ChatShell({
  title = "Collision IQ",
  left,
  center,
  right,
  planLabel = "30-Day Trial",
}: Props) {
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  const hasLeft = useMemo(() => Boolean(left), [left]);
  const hasRight = useMemo(() => Boolean(right), [right]);

  return (
    <div className="flex h-[100svh] flex-col overflow-hidden bg-bg text-text">
      <div className="pointer-events-none fixed inset-0 opacity-70">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl" />
        <div className="absolute bottom-[-280px] right-[-220px] h-[520px] w-[520px] rounded-full bg-white/5 blur-3xl" />
      </div>

      <header className="relative z-10 border-b border-border/60 bg-black/20 backdrop-blur-xl">
        <div className="absolute inset-0 pointer-events-none bg-[url('/brand/logos/Background.png')] bg-cover opacity-[0.04]" />
        <div className="relative mx-auto flex h-[64px] max-w-[1480px] items-center justify-between px-4 md:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex items-center gap-2">
              <Image
                src="/iq/iq-favicon.png"
                alt="Collision IQ icon"
                width={28}
                height={28}
                className="h-7 w-7 rounded-md object-contain shadow-[0_6px_18px_rgba(0,0,0,0.28)]"
                priority
              />
              <Image
                src="/iq/iq_logo-white.png"
                alt={title}
                width={150}
                height={30}
                className="h-[30px] w-auto opacity-95"
                priority
              />
            </div>

            <span className="hidden text-[12px] text-white/40 md:inline">
              Powered by Collision Academy
            </span>

            <span
              className={[
                "hidden rounded-full border px-2.5 py-1 text-[11px] font-medium md:inline-flex",
                getPlanTone(planLabel),
              ].join(" ")}
            >
              {planLabel}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/technical-systems"
              className="rounded-xl bg-[#C65A2A] px-4 py-2 text-sm font-semibold text-black shadow-[0_8px_25px_rgba(198,90,42,0.35)] transition hover:opacity-90"
            >
              Technical Systems
            </Link>

            <Link
              href="/the-academy"
              className="rounded-xl border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-white/85 transition hover:bg-white/10"
            >
              Professional Services
            </Link>

            <HeaderAuth />

            {hasLeft && (
              <button
                onClick={() => setLeftOpen(true)}
                className="rounded-lg border border-white/7 bg-white/5 px-3 py-1.5 text-xs text-text hover:bg-white/10 lg:hidden"
              >
                Workspace
              </button>
            )}

            {hasRight && (
              <button
                onClick={() => setRightOpen(true)}
                className="rounded-lg border border-white/7 bg-white/5 px-3 py-1.5 text-xs text-text hover:bg-white/10 lg:hidden"
              >
                Inspector
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-[#C65A2A]/60 to-transparent" />

      <div className="relative z-10 min-h-0 w-full max-w-none flex-1 px-6 py-4 md:px-8 md:py-5 xl:px-10">
        <div className="grid h-full min-h-0 grid-cols-1 gap-5 lg:grid-cols-[1fr_420px]">
          <div className="flex h-full min-h-0 min-w-0 flex-col rounded-[28px] border border-white/7 bg-white/[0.03] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
            <div className="mb-3 flex items-center justify-between">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#C65A2A]/30 bg-[#C65A2A]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#E88A5F]">
                <Image
                  src="/iq/iq-favicon.png"
                  alt="Collision IQ"
                  width={14}
                  height={14}
                  className="h-3.5 w-3.5 object-contain"
                />
                Collision IQ
              </div>

              <div className="text-xs text-white/35">
                AI repair intelligence workspace
              </div>
            </div>

            {center}
          </div>

          {hasRight && (
            <div className="hidden h-full min-h-0 w-[420px] flex-col rounded-[24px] border border-white/7 bg-white/[0.04] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.2)] backdrop-blur-md lg:flex">
              <div className="flex-1 min-h-0 overflow-y-auto">{right}</div>
            </div>
          )}
        </div>
      </div>

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
