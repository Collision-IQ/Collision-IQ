"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ClerkProvider, SignInButton, UserButton, useUser } from "@clerk/nextjs";
import { ThemeToggle } from "@/components/theme-toggle";

function HeaderAuth() {
  const { isLoaded, isSignedIn } = useUser();

  return (
    <div className="flex min-h-10 shrink-0 items-center gap-2">
      {isLoaded && isSignedIn ? (
        <UserButton />
      ) : isLoaded ? (
        <SignInButton
          mode="modal"
          forceRedirectUrl={typeof window !== "undefined" ? window.location.href : "/"}
        >
          <button
            type="button"
            className="rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-background"
          >
            Sign in
          </button>
        </SignInButton>
      ) : (
        <div className="h-8 w-[62px] shrink-0" aria-hidden />
      )}
    </div>
  );
}

type Props = {
  title?: string;
  left?: ReactNode;
  center: ReactNode;
  right?: ReactNode;
  planLabel?: string | null;
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
        className="absolute inset-0 bg-foreground/60"
        onClick={onClose}
      />

      <div
        className={[
          "absolute top-0 h-full max-h-[100svh] w-[min(92vw,390px)] max-w-sm border-l border-border bg-card",
          side === "left" ? "left-0" : "right-0",
        ].join(" ")}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{title}</div>

          <button
            onClick={onClose}
            className="min-h-10 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground transition hover:bg-background hover:text-foreground"
          >
            Close
          </button>
        </div>

        <div className="h-[calc(100%-52px)] overflow-y-auto overscroll-contain p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:p-3">{children}</div>
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
    return "border-border bg-muted text-muted-foreground";
  }
  return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
}

export default function ChatShell({
  title = "Collision IQ",
  left,
  center,
  right,
  planLabel = null,
}: Props) {
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  const hasLeft = useMemo(() => Boolean(left), [left]);
  const hasRight = useMemo(() => Boolean(right), [right]);

  return (
    <ClerkProvider>
      <div className="ci-workstation flex h-[100svh] max-w-full flex-col overflow-hidden bg-background text-foreground">
      <header className="relative z-10 min-h-[64px] shrink-0 border-b border-border bg-card">
        <div className="relative mx-auto flex min-h-[64px] max-w-none items-center justify-between gap-2 px-2 py-2 sm:px-3 md:gap-4 md:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 min-w-[136px] items-center gap-2 sm:min-w-[166px]">
              <Image
                src="/iq/iq-favicon.png"
                alt="Collision IQ icon"
                width={28}
                height={28}
                className="h-6 w-6 rounded-sm object-contain"
                priority
              />
              <Image
                src="/iq/iq_logo-white.png"
                alt={title}
                width={150}
                height={30}
                className="h-[22px] w-[112px] object-contain invert dark:invert-0 sm:h-[24px] sm:w-[150px]"
                priority
              />
            </div>

            <span className="hidden font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground md:inline">
              Forensic repair intelligence
            </span>

            <span className="hidden h-6 min-w-[112px] items-center md:inline-flex">
              {planLabel ? (
                <span
                  className={[
                    "inline-flex h-6 items-center rounded-full border px-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em]",
                    getPlanTone(planLabel),
                  ].join(" ")}
                >
                  {planLabel}
                </span>
              ) : null}
            </span>
          </div>

          <div className="flex min-h-10 min-w-0 flex-wrap items-center justify-end gap-1 sm:gap-2">
            <Link
              href="/technical-systems"
              className="hidden min-h-10 items-center rounded-md border border-[#b86a2d] bg-[#b86a2d] px-3 py-2 text-xs font-semibold text-black transition hover:bg-[#c57934] sm:inline-flex"
            >
              Technical Systems
            </Link>

            <Link
              href="/the-academy"
              className="hidden min-h-10 items-center rounded-md border border-border bg-muted px-3 py-2 text-xs font-medium text-foreground transition hover:bg-background md:inline-flex"
            >
              Professional Services
            </Link>

            <ThemeToggle />

            <HeaderAuth />

            {hasLeft && (
              <button
                onClick={() => setLeftOpen(true)}
                className="min-h-9 rounded-md border border-border bg-muted px-2 py-1.5 text-[11px] text-foreground hover:bg-background sm:min-h-10 sm:px-3 sm:py-2 sm:text-xs lg:hidden"
              >
                Workspace
              </button>
            )}

            {hasRight && (
              <button
                onClick={() => setRightOpen(true)}
                className="min-h-9 rounded-md border border-border bg-muted px-2 py-1.5 text-[11px] text-foreground hover:bg-background sm:min-h-10 sm:px-3 sm:py-2 sm:text-xs lg:hidden"
              >
                <span className="sm:hidden">Rail</span>
                <span className="hidden sm:inline">Inspector</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="h-px w-full shrink-0 bg-border" />

      <div className="relative z-10 min-h-0 w-full max-w-none flex-1 overflow-hidden px-1.5 py-1.5 sm:px-2 sm:py-2 md:px-4 md:py-3">
        <div className="grid h-full min-h-0 grid-cols-1 gap-2 sm:gap-3 lg:grid-cols-[minmax(0,1fr)_390px] xl:grid-cols-[minmax(0,1fr)_410px]">
          <div className="flex h-full min-h-0 min-w-0 flex-col border border-border bg-card">
            <div className="hidden min-h-[45px] shrink-0 items-center justify-between gap-4 border-b border-border px-3 py-2 lg:flex">
              <div className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[#a35d26] dark:text-[#c57934]">
                <Image
                  src="/iq/iq-favicon.png"
                  alt="Collision IQ"
                  width={14}
                  height={14}
                  className="h-3.5 w-3.5 shrink-0 object-contain"
                />
                Collision IQ
              </div>

              <div className="hidden font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground sm:block">
                Analysis workspace
              </div>
            </div>

            {center}
          </div>

          {hasRight && (
            <div className="hidden h-full min-h-0 w-full flex-col border border-border bg-card lg:flex">
              <div className="min-h-[45px] shrink-0 border-b border-border px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                Evidence / Exports / Audit
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-3">{right}</div>
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
  </ClerkProvider>
  );
}
