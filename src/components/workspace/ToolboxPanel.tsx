"use client";

/**
 * THE TOOLBOX — saved chats, and the confirmation that protects them.
 *
 * The panel's contract with the user is that nothing they deliberately kept
 * disappears without them saying so. When the slots are full, saving raises an
 * overlay naming the exact chat that would be displaced; declining cancels the
 * save and leaves every saved chat untouched, because the server writes
 * nothing until the confirmation comes back.
 *
 * "Save current chat" saves the user's most recently updated thread. That IS
 * the open conversation — autosave writes it every 1.5s — and resolving it
 * server-side avoids threading a chat id up through the workspace shell just to
 * hand it back down. The alternative would couple this panel to ChatWidget's
 * internals for no behavioural gain.
 */
import { useCallback, useEffect, useState } from "react";
import { Briefcase, ExternalLink, Loader2, Trash2 } from "lucide-react";
import ToolboxEvictionOverlay from "./ToolboxEvictionOverlay";
import { useToolboxSave, type ToolboxEntry } from "./useToolboxSave";

type Listing = {
  entries: ToolboxEntry[];
  limit: number;
  locked: boolean;
  slotsUsed: number;
  slotsRemaining: number;
};

function formatSaved(value: string): string {
  try {
    return new Date(value).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

export default function ToolboxPanel() {
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [removeBusy, setRemoveBusy] = useState(false);
  /** Distinct from `locked`. A failed load is not a plan limitation. */
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/toolbox", { cache: "no-store", credentials: "same-origin" });
      const data = (await response.json().catch(() => null)) as (Listing & { ok?: boolean }) | null;
      if (data && response.ok) {
        setLoadFailed(false);
        setListing({
          entries: data.entries ?? [],
          limit: data.limit ?? 0,
          locked: Boolean(data.locked),
          slotsUsed: data.slotsUsed ?? 0,
          slotsRemaining: data.slotsRemaining ?? 0,
        });
      } else {
        // A 403 IS a plan limitation and carries locked: true. Anything else is
        // a failure, and must not be dressed up as one.
        setLoadFailed(response.status !== 403);
      }
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred off the mount commit: refresh now has a synchronous failure path
    // (a fetch that throws before its first await), and setting state during
    // commit is the render cascade React warns about.
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  // The save flow (two-phase confirmation included) is shared with the
  // command-surface "Add to toolbox" button — one implementation, one promise.
  const {
    busy: saveBusy,
    status,
    pendingEviction,
    skipWarningChecked,
    setSkipWarningChecked,
    save,
    confirmEviction,
    dismissEviction,
  } = useToolboxSave({ onSaved: refresh });
  const busy = saveBusy || removeBusy;

  const remove = useCallback(
    async (id: string) => {
      setRemoveBusy(true);
      try {
        await fetch(`/api/toolbox/${encodeURIComponent(id)}`, {
          method: "DELETE",
          credentials: "same-origin",
        });
        await refresh();
      } finally {
        setRemoveBusy(false);
      }
    },
    [refresh]
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-6 text-[13px] text-muted-foreground">
        <Loader2 size={15} className="animate-spin" aria-hidden /> Loading your Toolbox…
      </div>
    );
  }

  // A LOAD FAILURE IS NOT A PLAN LIMITATION.
  //
  // This branch previously fired on `!listing`, which is also the state after
  // any failed request — so a server error told a paying customer their plan
  // did not include the feature. Shipped that way, with the Toolbox live in
  // production before its migration had run, every Pro user clicking Toolbox
  // was shown an upsell for the plan they were already paying for. Three
  // distinct states (free plan, server error, network failure) must not
  // collapse into one message.
  if (loadFailed) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Briefcase size={16} className="text-[var(--accent)]" aria-hidden /> Toolbox
        </div>
        <p className="mt-2 max-w-prose text-[13px] leading-6 text-muted-foreground">
          The Toolbox could not be loaded. This is a problem on our side, not with your plan —
          your saved chats are unaffected.
        </p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void refresh();
          }}
          className="mt-3 cursor-pointer rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-muted"
        >
          Try again
        </button>
      </div>
    );
  }

  // Free accounts have no Toolbox at all — an empty locked panel would only
  // advertise an absence.
  if (!listing || listing.locked) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Briefcase size={16} className="text-[var(--accent)]" aria-hidden /> Toolbox
        </div>
        <p className="mt-2 max-w-prose text-[13px] leading-6 text-muted-foreground">
          Save a chat and pick it back up later — the whole conversation plus every estimate and
          photo you uploaded to it. Available on Starter, Pro, and Team plans.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Briefcase size={16} className="text-[var(--accent)]" aria-hidden /> Toolbox
            </div>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
              Saved chats reopen in full, with the documents and photos you uploaded to them.{" "}
              <span className="font-medium text-foreground">
                {listing.slotsUsed} of {listing.limit} slots used
              </span>
              .
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save(false)}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-black transition hover:bg-[var(--accent)]/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Briefcase size={14} aria-hidden />}
            Save current chat
          </button>
        </div>
        {status ? (
          <p className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px] leading-5 text-muted-foreground">
            {status}
          </p>
        ) : null}
      </div>

      {listing.entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-6 text-[13px] leading-6 text-muted-foreground">
          Nothing saved yet. Use <span className="font-medium text-foreground">Save current chat</span> to
          keep this conversation and its files for later.
        </div>
      ) : (
        <ul className="space-y-2">
          {listing.entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-card p-3 transition hover:border-[var(--accent)]/35"
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-foreground">{entry.title}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Saved {formatSaved(entry.savedAt)} · {entry.messageCount} messages
                  {entry.attachmentCount > 0
                    ? ` · ${entry.attachmentCount} file${entry.attachmentCount === 1 ? "" : "s"}`
                    : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <a
                  href={`/?toolboxThread=${encodeURIComponent(entry.id)}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-foreground transition hover:bg-muted"
                >
                  <ExternalLink size={13} aria-hidden /> Open
                </a>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(entry.id)}
                  aria-label={`Remove ${entry.title} from the Toolbox`}
                  className="inline-flex cursor-pointer items-center rounded-lg border border-border p-1.5 text-muted-foreground transition hover:border-red-400/50 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pendingEviction ? (
        <ToolboxEvictionOverlay
          pending={pendingEviction}
          skipWarningChecked={skipWarningChecked}
          onSkipWarningChange={setSkipWarningChecked}
          onConfirm={() => void confirmEviction()}
          onDismiss={dismissEviction}
        />
      ) : null}
    </div>
  );
}
