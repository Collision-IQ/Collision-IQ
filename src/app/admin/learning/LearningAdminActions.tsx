"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Admin action bar for the Collision Learning Engine dashboard. Calls the
 * Platform-Admin-only API routes; the routes re-verify authorization
 * server-side on every request.
 */
export function LearningAdminActions() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const call = async (label: string, url: string, body?: object) => {
    setBusy(label);
    setMessage(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setMessage(`${label} failed: ${String(payload.error ?? response.status)}`);
      } else {
        setMessage(`${label} complete: ${JSON.stringify(payload).slice(0, 240)}`);
        router.refresh();
      }
    } catch (error) {
      setMessage(`${label} failed: ${error instanceof Error ? error.message : "network error"}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => call("Daily sprint", "/api/admin/learning/run", { kind: "daily", limit: 25 })}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy === "Daily sprint" ? "Running…" : "Run due items"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => call("Holdout benchmark", "/api/admin/learning/run", { kind: "benchmark", limit: 50 })}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy === "Holdout benchmark" ? "Running…" : "Run holdout benchmark"}
        </button>
      </div>
      {message ? <p className="mt-3 break-all text-xs text-muted-foreground">{message}</p> : null}
    </section>
  );
}
