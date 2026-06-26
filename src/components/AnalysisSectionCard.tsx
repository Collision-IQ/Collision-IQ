"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

type Props = {
  title: string;
  eyebrow?: string;
  summary?: string;
  preview?: string;
  defaultExpanded?: boolean;
  expanded?: boolean;
  collapsible?: boolean;
  active?: boolean;
  dimmed?: boolean;
  forceExpanded?: boolean;
  onInteract?: () => void;
  onClearFocus?: () => void;
  cardRef?: (node: HTMLElement | null) => void;
  children: ReactNode;
};

export default function AnalysisSectionCard({
  title,
  eyebrow,
  summary,
  preview,
  defaultExpanded = false,
  expanded,
  collapsible = true,
  active = false,
  dimmed = false,
  forceExpanded = false,
  onInteract,
  onClearFocus,
  cardRef,
  children,
}: Props) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const isExpanded = forceExpanded || (typeof expanded === "boolean" ? expanded : internalExpanded);
  const showPreview = !isExpanded && Boolean(preview || summary);
  const previewText = preview || summary;

  function handleToggle() {
    if (typeof expanded !== "boolean" && collapsible) {
      setInternalExpanded((value) => !value);
    }

    onInteract?.();
  }

  return (
    <section
      ref={cardRef}
      className={`rounded-md border transition-[opacity,border-color,background-color] duration-200 ease-out ${
        active
          ? "border-[var(--accent)]/45 bg-[var(--accent)]/10 p-3.5"
          : dimmed
            ? "border-border bg-card p-3 opacity-[0.86]"
            : "border-border bg-card p-3"
      }`}
    >
      <button
        type="button"
        onClick={handleToggle}
        onFocus={onInteract}
        className="flex w-full items-start justify-between gap-4 text-left"
        aria-expanded={!!isExpanded}
      >
        <div className="min-w-0 flex-1">
          {eyebrow ? (
            <div className={`text-[10px] uppercase tracking-[0.08em] ${active ? "text-[var(--accent)]" : "text-muted-foreground"}`}>
              {eyebrow}
            </div>
          ) : null}
          <div className={`mt-1 text-[15px] font-semibold ${active ? "text-foreground" : "text-card-foreground"}`}>
            {title}
          </div>
          {isExpanded && summary ? (
            <div className={`mt-1 text-[13px] leading-5 transition-colors ${active ? "text-muted-foreground" : "text-muted-foreground"}`}>{summary}</div>
          ) : null}
          {showPreview && previewText ? (
            <div className="relative mt-2 max-w-[52rem]">
              <div
                className={`pr-6 text-[13px] leading-5 transition-colors ${active ? "text-muted-foreground" : "text-muted-foreground"}`}
                style={{
                  display: "-webkit-box",
                  WebkitBoxOrient: "vertical",
                  WebkitLineClamp: 2,
                  overflow: "hidden",
                }}
              >
                {previewText}
              </div>
              <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-card/80" />
            </div>
          ) : null}
        </div>

        <div className="mt-1 flex shrink-0 items-center gap-2">
          {active && onClearFocus ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                onClearFocus();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onClearFocus();
                }
              }}
              className="rounded-md border border-border bg-muted px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-muted-foreground transition hover:bg-muted/70 hover:text-foreground"
            >
              Show all
            </span>
          ) : null}

          <span
            className={`inline-flex items-center rounded-md border p-1.5 transition-[color,background-color,border-color,transform] duration-200 ${
              active
                ? "border-[var(--accent)]/35 bg-[var(--accent)]/14 text-[var(--accent)]"
                : "border-border bg-muted text-muted-foreground"
            }`}
          >
            <ChevronDown
              size={15}
              className={`transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`}
            />
          </span>
        </div>
      </button>

      <div
        className={`grid transition-[grid-template-rows,opacity,margin-top] duration-300 ease-out ${
          isExpanded ? "mt-3 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className={`transition-transform duration-300 ease-out ${isExpanded ? "translate-y-0" : "-translate-y-1"}`}>
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
