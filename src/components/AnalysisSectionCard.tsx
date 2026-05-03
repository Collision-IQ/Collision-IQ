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
      className={`rounded-[24px] border shadow-[0_18px_40px_rgba(15,23,42,0.10)] transition-[opacity,border-color,background-color,box-shadow,padding,transform] duration-300 ease-out dark:shadow-[0_18px_40px_rgba(0,0,0,0.18)] ${
        active
          ? "border-orange-400/45 bg-gradient-to-br from-[#C65A2A]/16 via-card to-muted p-5 shadow-[0_0_0_1px_rgba(210,122,81,0.14),0_24px_54px_rgba(198,90,42,0.12)]"
          : dimmed
            ? "border-border bg-card p-4 opacity-[0.86]"
            : "border-border bg-card p-4"
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
            <div className={`text-[10px] uppercase tracking-[0.22em] ${active ? "text-orange-700 dark:text-orange-200/72" : "text-muted-foreground"}`}>
              {eyebrow}
            </div>
          ) : null}
          <div className={`mt-1 text-[1.02rem] font-semibold tracking-[-0.02em] ${active ? "text-foreground" : "text-card-foreground"}`}>
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
              <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-card via-card/80 to-transparent" />
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
              className="rounded-full border border-border bg-muted px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground transition hover:bg-muted/70 hover:text-foreground"
            >
              Show all
            </span>
          ) : null}

          <span
            className={`inline-flex items-center rounded-full border p-2 transition-[color,background-color,border-color,transform] duration-300 ${
              active
                ? "border-orange-400/35 bg-[#C65A2A]/16 text-orange-700 dark:text-orange-100"
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
          isExpanded ? "mt-4 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"
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
