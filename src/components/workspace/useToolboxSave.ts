"use client";

/**
 * The Toolbox save flow, shared between every surface that offers it.
 *
 * The contract lives here so it cannot drift between buttons: the server
 * writes NOTHING until a full Toolbox's eviction is confirmed, declining
 * costs the user nothing, and the "don't ask again" preference short-circuits
 * the overlay before the first request rather than after the 409.
 *
 * "latest" saves the user's most recently updated thread. That IS the open
 * conversation — autosave writes it every 1.5s — and resolving it server-side
 * keeps callers from having to thread a chat id through the workspace shell.
 */
import { useCallback, useState } from "react";

export type ToolboxEntry = {
  id: string;
  title: string;
  caseId: string | null;
  messageCount: number;
  attachmentCount: number;
  savedAt: string;
  updatedAt: string;
};

export type PendingEviction = {
  entry: ToolboxEntry;
  /** Slot count from the 409 body, so the overlay copy works on surfaces that
   *  never fetched the listing. */
  limit: number;
};

/** Remembers a "don't ask again" choice. A nag preference, not a policy. */
export const SKIP_WARNING_KEY = "collisioniq.toolbox.skipEvictionWarning";

export function useToolboxSave(options?: { onSaved?: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingEviction, setPendingEviction] = useState<PendingEviction | null>(null);
  const [skipWarningChecked, setSkipWarningChecked] = useState(false);
  // Callers pass a memoized callback (or none); `save` is as stable as it is.
  const onSaved = options?.onSaved;

  const save = useCallback(async (confirmed: boolean) => {
    // Resolve the standing "don't ask again" BEFORE the request rather than
    // re-entering this callback on the 409.
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
        limit?: number;
        locked?: boolean;
        error?: string;
      } | null;

      if (response.status === 409 && data?.needsConfirmation && data.evicts) {
        // Nothing was written server-side, so raising the overlay costs the
        // user nothing and declining leaves the Toolbox exactly as it was.
        setPendingEviction({ entry: data.evicts, limit: data.limit ?? 0 });
        return;
      }
      if (!response.ok || !data?.ok) {
        setStatus(
          data?.locked
            ? "The Toolbox is available on Starter, Pro, and Team plans."
            : (data?.error ?? "Could not save this chat to the Toolbox.")
        );
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
      await onSaved?.();
    } catch {
      setStatus("Could not reach the Toolbox. Try again.");
    } finally {
      setBusy(false);
    }
  }, [onSaved]);

  const confirmEviction = useCallback(async () => {
    if (skipWarningChecked && typeof window !== "undefined") {
      window.localStorage.setItem(SKIP_WARNING_KEY, "true");
    }
    setPendingEviction(null);
    await save(true);
  }, [save, skipWarningChecked]);

  const dismissEviction = useCallback(() => setPendingEviction(null), []);

  return {
    busy,
    status,
    setStatus,
    pendingEviction,
    skipWarningChecked,
    setSkipWarningChecked,
    save,
    confirmEviction,
    dismissEviction,
  };
}
