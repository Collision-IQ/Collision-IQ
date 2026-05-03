"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { ThemeToggle } from "@/components/theme-toggle";

function HeaderAuth() {
  return (
    <div className="flex items-center gap-2">
      <Show when="signed-in">
        <UserButton />
      </Show>

      <Show when="signed-out">
        <SignInButton
          mode="modal"
          forceRedirectUrl={typeof window !== "undefined" ? window.location.href : "/"}
        >
          <button
            type="button"
            className="rounded-xl bg-muted/80 px-4 py-2 text-sm font-medium text-foreground shadow-sm ring-1 ring-border/60 transition hover:bg-muted"
          >
            Sign in
          </button>
        </SignInButton>
      </Show>
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
        className="absolute inset-0 bg-foreground/60"
        onClick={onClose}
      />

      <div
        className={[
          "absolute top-0 h-full w-[88vw] max-w-sm border-l border-border bg-card/95 shadow-2xl backdrop-blur-xl",
          side === "left" ? "left-0" : "right-0",
        ].join(" ")}
      >
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
          <div className="text-[1.05rem] font-semibold text-text">{title}</div>

          <button
            onClick={onClose}
            className="rounded-lg border border-border bg-muted px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted/80 hover:text-foreground"
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
    return "border-border bg-muted text-muted-foreground";
  }
  return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
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
    <div className="flex h-[100svh] flex-col overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 opacity-70">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl" />
        <div className="absolute bottom-[-280px] right-[-220px] h-[520px] w-[520px] rounded-full bg-white/5 blur-3xl" />
      </div>

      <header className="relative z-10 border-b border-border/60 bg-card/88 shadow-[0_10px_36px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:shadow-[0_10px_36px_rgba(0,0,0,0.18)]">
        <div className="absolute inset-0 pointer-events-none bg-[url('/brand/logos/Background.png')] bg-cover opacity-[0.04]" />
        <div className="relative mx-auto flex min-h-[64px] max-w-[1480px] items-center justify-between gap-4 px-4 py-2 md:px-5">
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
                className="h-[30px] w-auto invert dark:invert-0"
                priority
              />
            </div>

            <span className="hidden text-[12px] text-muted md:inline">
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

          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2.5">
            <Link
              href="/technical-systems"
              className="rounded-xl bg-[#C65A2A] px-4 py-2 text-sm font-semibold text-black shadow-[0_8px_25px_rgba(198,90,42,0.28)] transition hover:bg-[#D76835]"
            >
              Technical Systems
            </Link>

            <Link
              href="/the-academy"
              className="rounded-xl bg-muted/80 px-4 py-2 text-sm font-medium text-foreground shadow-sm ring-1 ring-border/60 transition hover:bg-muted"
            >
              Professional Services
            </Link>

            <ThemeToggle />

            <HeaderAuth />

            {hasLeft && (
              <button
                onClick={() => setLeftOpen(true)}
                className="rounded-lg border border-border bg-muted px-3 py-1.5 text-xs text-foreground hover:bg-muted/80 lg:hidden"
              >
                Workspace
              </button>
            )}

            {hasRight && (
              <button
                onClick={() => setRightOpen(true)}
                className="rounded-lg border border-border bg-muted px-3 py-1.5 text-xs text-foreground hover:bg-muted/80 lg:hidden"
              >
                Inspector
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="h-px w-full bg-gradient-to-r from-transparent via-[#C65A2A]/45 to-transparent" />

      <div className="relative z-10 min-h-0 w-full max-w-none flex-1 px-5 py-4 md:px-7 md:py-5 xl:px-9">
        <div className="grid h-full min-h-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="flex h-full min-h-0 min-w-0 flex-col rounded-[30px] bg-card/86 p-4 shadow-[0_22px_70px_rgba(15,23,42,0.10)] ring-1 ring-border/55 backdrop-blur-xl dark:shadow-[0_22px_70px_rgba(0,0,0,0.26)]">
            <div className="mb-3 flex items-center justify-between gap-4 px-1">
              <div className="inline-flex items-center gap-2 rounded-full bg-[#C65A2A]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#C65A2A] ring-1 ring-[#C65A2A]/20 dark:text-[#E88A5F]">
                <Image
                  src="/iq/iq-favicon.png"
                  alt="Collision IQ"
                  width={14}
                  height={14}
                  className="h-3.5 w-3.5 object-contain"
                />
                Collision IQ
              </div>

              <div className="text-xs text-muted-foreground">
                AI repair intelligence workspace
              </div>
            </div>

            {center}
          </div>

          {hasRight && (
            <div className="hidden h-full min-h-0 w-full flex-col rounded-[28px] bg-card/82 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.09)] ring-1 ring-border/55 backdrop-blur-xl dark:shadow-[0_18px_50px_rgba(0,0,0,0.22)] lg:flex">
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
