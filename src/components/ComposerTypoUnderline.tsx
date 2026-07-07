"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type { TypoSpan } from "@/lib/ai/typeHelper";

// Inline typo underlining for the chat composer. Renders a pointer-events-none
// mirror of the textarea text (transparent glyphs) behind the real textarea so
// wavy underlines line up with the typed words. Clicking a typo (caret lands
// inside a span) opens a small suggestion chip; applying it only edits the
// draft — it never sends the message.

type Props = {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  spans: TypoSpan[];
  /** Must reproduce the textarea's font/padding/border metrics exactly. */
  mirrorClassName: string;
  onApply: (span: TypoSpan) => void;
};

export default function ComposerTypoUnderline({
  textareaRef,
  value,
  spans,
  mirrorClassName,
  onApply,
}: Props) {
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [selected, setActive] = useState<TypoSpan | null>(null);
  // Derived: the popover only shows while its span still exists (spans are
  // replaced on re-check/edit/apply, which silently invalidates stale picks).
  const active = selected && spans.includes(selected) ? selected : null;

  // Scroll sync + caret-based click detection on the real textarea.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const syncScroll = () => {
      if (mirrorRef.current) mirrorRef.current.scrollTop = el.scrollTop;
    };
    const onCaret = () => {
      const pos = el.selectionStart ?? -1;
      const hit = spans.find((span) => pos >= span.start && pos <= span.end) ?? null;
      setActive(hit);
    };
    el.addEventListener("scroll", syncScroll);
    el.addEventListener("click", onCaret);
    el.addEventListener("keyup", onCaret);
    syncScroll();
    return () => {
      el.removeEventListener("scroll", syncScroll);
      el.removeEventListener("click", onCaret);
      el.removeEventListener("keyup", onCaret);
    };
  }, [textareaRef, spans]);

  const segments = useMemo(() => {
    const ordered = [...spans].sort((a, b) => a.start - b.start);
    const parts: Array<{ text: string; span?: TypoSpan }> = [];
    let cursor = 0;
    for (const span of ordered) {
      if (span.start < cursor || span.end > value.length) continue;
      if (span.start > cursor) parts.push({ text: value.slice(cursor, span.start) });
      parts.push({ text: value.slice(span.start, span.end), span });
      cursor = span.end;
    }
    parts.push({ text: value.slice(cursor) });
    return parts;
  }, [spans, value]);

  if (spans.length === 0) return null;

  return (
    <>
      <div
        ref={mirrorRef}
        aria-hidden
        data-typo-mirror
        className={`pointer-events-none absolute inset-0 select-none overflow-hidden whitespace-pre-wrap break-words text-transparent ${mirrorClassName}`}
      >
        {segments.map((segment, index) =>
          segment.span ? (
            <span
              key={index}
              style={{
                textDecorationLine: "underline",
                textDecorationStyle: "wavy",
                textDecorationColor: "var(--accent)",
                textDecorationThickness: "1.5px",
                textUnderlineOffset: "3px",
              }}
            >
              {segment.text}
            </span>
          ) : (
            <span key={index}>{segment.text}</span>
          )
        )}
        {"\n"}
      </div>

      {active ? (
        <div
          className="absolute -top-11 left-1 z-30 flex items-center gap-1 rounded-lg border border-border bg-card px-1.5 py-1 shadow-lg"
          role="tooltip"
        >
          <button
            type="button"
            // mousedown + preventDefault keeps the textarea focused.
            onMouseDown={(event) => {
              event.preventDefault();
              onApply(active);
              setActive(null);
            }}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs transition hover:bg-muted"
            title={`Replace "${active.original}" with "${active.suggestion}"`}
          >
            <span className="text-muted-foreground line-through">{active.original}</span>
            <span aria-hidden>→</span>
            <span className="font-medium text-foreground">{active.suggestion}</span>
          </button>
          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              setActive(null);
            }}
            className="inline-flex cursor-pointer items-center rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Dismiss suggestion"
          >
            <X size={11} />
          </button>
        </div>
      ) : null}
    </>
  );
}
