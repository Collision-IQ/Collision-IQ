"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { SignInButton, UserButton, useUser } from "@clerk/nextjs";
import { ShoppingCart } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { getPlatform, isNative } from "@/lib/native";

const SIGN_IN_BUTTON_CLASS =
  "rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-background";

function HeaderAuth() {
  const { isLoaded, isSignedIn } = useUser();
  const [isNativeClient, setIsNativeClient] = useState(false);
  const [authFallbackReady, setAuthFallbackReady] = useState(false);
  const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setIsNativeClient(isNative());
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (isLoaded) {
      setAuthFallbackReady(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      setAuthFallbackReady(true);
    }, 1400);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [isLoaded]);

  if (!clerkPublishableKey || (!isLoaded && authFallbackReady)) {
    return (
      <div className="flex min-h-10 shrink-0 items-center gap-2">
        <Link href="/sign-in" className={SIGN_IN_BUTTON_CLASS}>
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-10 shrink-0 items-center gap-2">
      {isLoaded && isSignedIn ? (
        <UserButton />
      ) : isLoaded ? (
        <SignInButton
          mode={isNativeClient ? "redirect" : "modal"}
          forceRedirectUrl="/"
          fallbackRedirectUrl="/"
          oauthFlow={isNativeClient ? "redirect" : "auto"}
        >
          <button
            type="button"
            className={SIGN_IN_BUTTON_CLASS}
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
  bottom?: ReactNode;
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
    return "border-[var(--accent)]/40 bg-[var(--accent)]/12 text-[#F3A37F]";
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
  bottom,
  planLabel = null,
}: Props) {
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [isNativeAndroid, setIsNativeAndroid] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setIsNativeAndroid(isNative() && getPlatform() === "android");
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, []);

  async function openProductionSite() {
    const url = "https://www.collision-iq.ai/technical-systems";

    try {
      if (isNative()) {
        const { Browser } = await import("@capacitor/browser");
        await Browser.open({ url });
        return;
      }
    } catch (error) {
      console.warn("[native-site-open] Browser.open failed; falling back", {
        message: error instanceof Error ? error.message : String(error),
      });
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }

  const hasLeft = useMemo(() => Boolean(left), [left]);
  const effectiveRight = isNativeAndroid ? null : right;
  const hasRight = useMemo(() => Boolean(effectiveRight), [effectiveRight]);
  const reviewRowHeightClass = "lg:h-full lg:min-h-[520px]";
  const chatPanelHeightClass = "h-full min-h-0";
  const rightRailHeightClass = "h-full min-h-0";

  return (
    <div className="ci-workstation flex min-h-0 flex-1 ci-workstation flex-1 min-h-0 flex flex-col max-w-full overflow-x-hidden bg-background text-foreground">
      <header className="relative z-10 min-h-[52px] shrink-0 border-b border-border bg-card sm:min-h-[64px]">
        <div className="relative mx-auto flex min-h-[52px] max-w-none items-center justify-between gap-2 px-2 py-1.5 sm:min-h-[64px] sm:px-3 sm:py-2 md:gap-4 md:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex min-h-10 min-w-[176px] items-center gap-2.5 sm:min-w-[218px]">
              <Image
                src="/iq/iq-app.png"
                alt=""
                width={34}
                height={34}
                className="h-7 w-7 shrink-0 rounded-md object-contain sm:h-[34px] sm:w-[34px]"
                priority
                aria-hidden="true"
              />
              <span className="relative block h-[26px] w-[116px] shrink-0 sm:h-[34px] sm:w-[158px]">
                <Image
                  src="/iq/iq_logo.png"
                  alt={title}
                  fill
                  sizes="(min-width: 640px) 158px, 132px"
                  className="object-contain object-left dark:hidden"
                  priority
                />
                <Image
                  src="/iq/iq_logo-white.png"
                  alt={title}
                  fill
                  sizes="(min-width: 640px) 158px, 132px"
                  className="hidden object-contain object-left dark:block"
                  priority
                />
              </span>
            </div>

            <span className="hidden font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground md:inline">
              Forensic Repair Intelligence
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
            {!isNativeAndroid && (
              <>
                <Link
                  href="/technical-systems"
                  className="hidden min-h-10 items-center rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-black transition hover:bg-[var(--accent)] sm:inline-flex"
                >
                  Technical Systems
                </Link>

                <Link
                  href="/the-academy"
                  className="hidden min-h-10 items-center rounded-md border border-border bg-muted px-3 py-2 text-xs font-medium text-foreground transition hover:bg-background md:inline-flex"
                >
                  Professional Services
                </Link>
              </>
            )}

            <ThemeToggle />

            {isNativeAndroid && (
              <button
                type="button"
                onClick={openProductionSite}
                className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1.5 text-[11px] font-medium text-foreground transition hover:bg-background sm:min-h-10 sm:px-3 sm:py-2 sm:text-xs"
              >
                <ShoppingCart size={14} />
                Shop
              </button>
            )}

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

      <div
        className={[
          "relative z-10 flex flex-1 min-h-0 w-full max-w-none flex-col px-1.5 py-1.5 sm:px-2 sm:py-2 md:px-4 md:py-3",
        ].join(" ")}
      >
        <div
          className={[
            "grid flex-1 min-h-0 w-full grid-cols-1 items-stretch gap-2 overflow-hidden sm:gap-3 lg:grid-cols-[minmax(0,1fr)_390px] xl:grid-cols-[minmax(0,1fr)_410px]",
            reviewRowHeightClass,
          ].join(" ")}
        >
          <div
            className={[
              "ci-panel flex min-h-0 min-w-0 flex-col overflow-hidden",
              chatPanelHeightClass,
            ].join(" ")}
          >
            <div className="hidden min-h-[45px] shrink-0 items-center justify-between gap-4 border-b border-border/60 px-4 py-2.5 lg:flex">
              <div className="inline-flex items-center gap-2 text-[13px] font-semibold text-[#a35d26] dark:text-[var(--accent)]">
                <Image
                  src="/iq/iq-favicon.png"
                  alt="Collision IQ"
                  width={14}
                  height={14}
                  className="h-3.5 w-3.5 shrink-0 object-contain"
                />
                Collision IQ
              </div>

              <div className="ci-eyebrow hidden sm:block">
                Analysis workspace
              </div>
            </div>

            {center}
          </div>

          {hasRight && (
            <aside
              className={[
                "ci-panel hidden h-full min-h-0 w-full flex-col overflow-hidden lg:flex",
                rightRailHeightClass,
              ].join(" ")}
            >
              <div className="ci-eyebrow min-h-[45px] shrink-0 border-b border-border/60 px-4 py-3">
                Evidence / Exports / Audit
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-3">{effectiveRight}</div>
            </aside>
          )}
        </div>
        {bottom ? <div className="mt-2 shrink-0 sm:mt-3">{bottom}</div> : null}
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
          {effectiveRight}
        </Drawer>
      )}
    </div>
  );
}
