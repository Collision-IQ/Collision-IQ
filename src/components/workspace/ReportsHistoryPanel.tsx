"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2, Lock, RefreshCw } from "lucide-react";

type ReportSummary = {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  vehicleLabel: string | null;
  insurer: string | null;
  riskScore: "low" | "moderate" | "high" | null;
  active: boolean;
  fileCount: number;
};

const RISK_STYLE: Record<string, string> = {
  high: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300",
  moderate: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  low: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Reports tab — the signed-in user's private report history. Data comes from
 * GET /api/reports/history, which is scoped to the authenticated user's own
 * reports only (no cross-user or cross-shop access).
 */
export default function ReportsHistoryPanel() {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error" | "unauthorized">("loading");

  // Fetch first, then set state (after the await) — the initial "loading" state
  // covers mount, so the effect never calls setState synchronously.
  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch("/api/reports/history", { cache: "no-store" });
      if (res.status === 401) {
        setState("unauthorized");
        return;
      }
      if (!res.ok) {
        setState("error");
        return;
      }
      const data = (await res.json()) as { reports?: ReportSummary[] };
      setReports(data.reports ?? []);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  const refresh = useCallback(() => {
    setState("loading");
    void fetchReports();
  }, [fetchReports]);

  useEffect(() => {
    // Fetch-on-mount: setState only runs after the awaited fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchReports();
  }, [fetchReports]);

  return (
    <div className="ci-panel flex min-h-0 flex-1 flex-col overflow-hidden p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Reports</h2>
          <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Lock size={11} /> Your private history — only your reports are shown.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-background"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {state === "loading" ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : state === "unauthorized" ? (
          <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            Sign in to view your report history.
          </div>
        ) : state === "error" ? (
          <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            Couldn&apos;t load your report history.{" "}
            <button type="button" onClick={refresh} className="underline">
              Retry
            </button>
          </div>
        ) : reports.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No reports yet. Run a repair analysis and it will appear here.
          </div>
        ) : (
          <ul className="space-y-2">
            {reports.map((report) => (
              <li
                key={report.id}
                className="ci-card flex items-start gap-3 rounded-lg border border-border bg-card p-3"
              >
                <span className="mt-0.5 shrink-0 rounded-md bg-[var(--accent)]/12 p-2 text-[var(--accent)]">
                  <FileText size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{report.title}</span>
                    {report.active ? (
                      <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-emerald-600 dark:text-emerald-300">
                        Active
                      </span>
                    ) : null}
                    {report.riskScore ? (
                      <span
                        className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ${RISK_STYLE[report.riskScore] ?? ""}`}
                      >
                        {report.riskScore} risk
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {report.insurer ? `${report.insurer} · ` : ""}
                    {report.fileCount} file{report.fileCount === 1 ? "" : "s"} · {formatWhen(report.updatedAt)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
