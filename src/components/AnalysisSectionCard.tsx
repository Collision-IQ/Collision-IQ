"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

type Props = {
  title: string;
  eyebrow?: string;
  summary?: string;
  defaultExpanded?: boolean;
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
  defaultExpanded = false,
  active = false,
  dimmed = false,
  forceExpanded = false,
  onInteract,
  onClearFocus,
  cardRef,
  children,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isExpanded = forceExpanded || expanded;

  return (
    <section
      ref={cardRef}
      className={`rounded-[24px] border p-4 shadow-[0_18px_40px_rgba(0,0,0,0.18)] transition-[opacity,border-color,background-color,box-shadow,transform] duration-200 ${
        active
          ? "border-orange-400/28 bg-gradient-to-br from-[#C65A2A]/14 via-white/[0.04] to-black/22 shadow-[0_22px_48px_rgba(0,0,0,0.22)]"
          : dimmed
            ? "border-white/6 bg-gradient-to-br from-white/[0.035] via-white/[0.02] to-black/18 opacity-75"
            : "border-white/8 bg-gradient-to-br from-white/[0.055] via-white/[0.03] to-black/20"
      }`}
    >
      <button
        type="button"
        onClick={() => {
          setExpanded((value) => !value);
          onInteract?.();
        }}
        onFocus={onInteract}
        className="flex w-full items-start justify-between gap-4 text-left"
      >
        <div>
          {eyebrow ? (
            <div className={`text-[10px] uppercase tracking-[0.22em] ${active ? "text-orange-200/72" : "text-white/40"}`}>
              {eyebrow}
            </div>
          ) : null}
          <div className={`mt-1 text-[1.02rem] font-semibold tracking-[-0.02em] ${active ? "text-white" : "text-white/88"}`}>
            {title}
          </div>
          {summary ? (
            <div className={`mt-1 text-[13px] leading-5 ${active ? "text-white/60" : "text-white/50"}`}>{summary}</div>
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
              className="rounded-full border border-white/8 bg-black/22 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-white/58 transition hover:bg-black/32 hover:text-white/78"
            >
              Show all
            </span>
          ) : null}

          <span
            className={`inline-flex items-center rounded-full border p-2 transition-colors ${
              active
                ? "border-orange-400/24 bg-[#C65A2A]/14 text-orange-100/85"
                : "border-white/8 bg-black/18 text-white/55"
            }`}
          >
            <ChevronDown
              size={15}
              className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}
            />
          </span>
        </div>
      </button>

      {isExpanded ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}
