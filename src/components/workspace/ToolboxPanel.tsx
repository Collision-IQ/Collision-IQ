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
import { Briefcase, ExternalLink, Loader2, Trash2, TriangleAlert } from "lucide-react";

type ToolboxEntry = {
  id: string;
  title: string;
  caseId: string | null;
  messageCount: number;
  attachmentCount: number;
  savedAt: string;
  updatedAt: string;
};

type Listing = {
  entries: ToolboxEntry[];
  limit: number;
  locked: boolean;
  slotsUsed: number;
  slotsRemaining: number;
};

/** Remembers a "don't ask again" choice. A nag preference, not a policy. */
const SKIP_WARNING_KEY = "collisioniq.toolbox.skipEvictionWarning";

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
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingEviction, setPendingEviction] = useState<ToolboxEntry | null>(null);
  const [skipWarningChecked, setSkipWarningChecked] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/toolbox", { cache: "no-store", credentials: "same-origin" });
      const data = (await response.json().catch(() => null)) as (Listing & { ok?: boolean }) | null;
      if (data && response.ok) {
        setListing({
          entries: data.entries ?? [],
          limit: data.limit ?? 0,
          locked: Boolean(data.locked),
          slotsUsed: data.slotsUsed ?? 0,
          slotsRemaining: data.slotsRemaining ?? 0,
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (confirmed: boolean) => {
      // Resolve the standing "don't ask again" BEFORE the request rather than
      // re-entering this callback on the 409. Recursing through the memoized
      // function would reference it before its own declaration.
      const autoConfirm =
        confirmed ||
        (typeof window !== "undefined" &&
          window.localStorage.getItem(SKIP_WARNING_KEY) === "true");
      setBusy(true);
      setStatus(null);
      try {
        const response = await fetch("/api/toolbox", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadId: "latest", confirmed: autoConfirm }),
        });
        const data = (await response.json().catch(() => null)) as {
          ok?: boolean;
          needsConfirmation?: boolean;
          evicts?: ToolboxEntry;
          evicted?: ToolboxEntry | null;
          alreadySaved?: boolean;
          error?: string;
        } | null;

        if (response.status === 409 && data?.needsConfirmation && data.evicts) {
          // Nothing was written server-side, so raising the overlay costs the
          // user nothing and declining leaves the Toolbox exactly as it was.
          setPendingEviction(data.evicts);
          return;
        }
        if (!response.ok || !data?.ok) {
          setStatus(data?.error ?? "Could not save this chat to the Toolbox.");
          return;
        }
        setPendingEviction(null);
        setStatus(
          data.alreadySaved
            ? "Already in your Toolbox — save point updated."
            : data.evicted
              ? `Saved. "${data.evicted.title}" was removed from the Toolbox.`
              : "Saved to your Toolbox."
        );
        await refresh();
      } catch {
        setStatus("Could not reach the Toolbox. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const confirmEviction = useCallback(async () => {
    if (skipWarningChecked && typeof window !== "undefined") {
      window.localStorage.setItem(SKIP_WARNING_KEY, "true");
    }
    setPendingEviction(null);
    await save(true);
  }, [save, skipWarningChecked]);

  const remove = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await fetch(`/api/toolbox/${encodeURIComponent(id)}`, {
          method: "DELETE",
          credentials: "same-origin",
        });
        await refresh();
      } finally {
        setBusy(false);
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
              All {listing.limit} slots are in use. Saving this chat will remove your oldest saved
              chat, <span className="font-semibold text-foreground">{pendingEviction.title}</span>,
              from the Toolbox.
            </p>
            <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
              The conversation itself is not deleted — it stays in History. Only its Toolbox slot is
              freed.
            </p>
            <label className="mt-4 flex cursor-pointer items-start gap-2 text-[12px] leading-5 text-muted-foreground">
              <input
                type="checkbox"
                checked={skipWarningChecked}
                onChange={(event) => setSkipWarningChecked(event.target.checked)}
                className="mt-0.5 cursor-pointer"
              />
              Don&apos;t ask again — always replace the oldest saved chat.
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingEviction(null)}
                className="cursor-pointer rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-muted"
              >
                No, keep it
              </button>
              <button
                type="button"
                onClick={() => void confirmEviction()}
                className="cursor-pointer rounded-lg border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-black transition hover:bg-[var(--accent)]/90"
              >
                Yes, replace it
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
