"use client";

/**
 * The Toolbox-full confirmation. One dialog, used by every save surface, so
 * the promise it makes — nothing is displaced without the user saying so, and
 * the displaced chat survives in History — is worded exactly once.
 */
import { TriangleAlert } from "lucide-react";
import type { PendingEviction } from "./useToolboxSave";

export default function ToolboxEvictionOverlay(props: {
  pending: PendingEviction;
  skipWarningChecked: boolean;
  onSkipWarningChange: (checked: boolean) => void;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="toolbox-evict-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <div className="flex items-center gap-2">
          <TriangleAlert size={17} className="text-amber-500" aria-hidden />
          <h2 id="toolbox-evict-title" className="text-sm font-semibold text-foreground">
            Your Toolbox is full
          </h2>
        </div>
        <p className="mt-3 text-[13px] leading-6 text-muted-foreground">
          All {props.pending.limit} slots are in use. Saving this chat will remove your oldest saved
          chat, <span className="font-semibold text-foreground">{props.pending.entry.title}</span>,
          from the Toolbox.
        </p>
        <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
          The conversation itself is not deleted — it stays in History. Only its Toolbox slot is
          freed.
        </p>
        <label className="mt-4 flex cursor-pointer items-start gap-2 text-[12px] leading-5 text-muted-foreground">
          <input
            type="checkbox"
            checked={props.skipWarningChecked}
            onChange={(event) => props.onSkipWarningChange(event.target.checked)}
            className="mt-0.5 cursor-pointer"
          />
          Don&apos;t ask again — always replace the oldest saved chat.
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={props.onDismiss}
            className="cursor-pointer rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-muted"
          >
            No, keep it
          </button>
          <button
            type="button"
            onClick={props.onConfirm}
            className="cursor-pointer rounded-lg border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-black transition hover:bg-[var(--accent)]/90"
          >
            Yes, replace it
          </button>
        </div>
      </div>
    </div>
  );
}
