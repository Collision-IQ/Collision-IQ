"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  FileWarning,
  Loader2,
  Lock,
  MessageSquare,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { ReportMemoryDetail } from "@/lib/reports/reportMemory";
import { requestChatReopen } from "@/lib/ui/chatReopen";

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

const SOURCE_LABEL: Record<string, string> = {
  repair_intelligence: "Repair analysis",
  scan_iq: "Scan IQ",
  ccc_secure_share_import: "CCC Secure Share",
};

const OPEN_ERROR_MESSAGE =
  "This report could not be opened. The saved record may be incomplete or unavailable.";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Reports tab (Report Memory) — the signed-in user's private report history.
 * The list comes from GET /api/reports/history and each report opens via
 * GET /api/reports/[reportId]; both are auth + plan gated server-side and
 * scoped to the user's own reports only.
 */
export default function ReportsHistoryPanel({
  initialReportId,
}: {
  /** When set, the panel opens straight into this report's detail view. */
  initialReportId?: string | null;
} = {}) {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error" | "unauthorized" | "locked">("loading");

  const [openReportId, setOpenReportId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReportMemoryDetail | null>(null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "error">("idle");

  // Fetch first, then set state (after the await) — the initial "loading" state
  // covers mount, so the effect never calls setState synchronously.
  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch("/api/reports/history", { cache: "no-store" });
      if (res.status === 401) {
        setState("unauthorized");
        return;
      }
      if (res.status === 403) {
        setState("locked");
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

  const openReport = useCallback(async (reportId: string) => {
    setOpenReportId(reportId);
    setDetail(null);
    setDetailState("loading");
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}`, { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as { detail?: ReportMemoryDetail } | null;
      if (!res.ok || !data?.detail) {
        setDetailState("error");
        return;
      }
      setDetail(data.detail);
      setDetailState("idle");
    } catch {
      setDetailState("error");
    }
  }, []);

  const closeDetail = useCallback(() => {
    setOpenReportId(null);
    setDetail(null);
    setDetailState("idle");
  }, []);

  // Deep link from the Analysis Workspace "Recent reports" strip.
  useEffect(() => {
    if (initialReportId) void openReport(initialReportId);
  }, [initialReportId, openReport]);

  // ── Detail view (replaces the list; Back returns) ─────────────────────────
  if (openReportId) {
    return (
      <div className="ci-panel flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={closeDetail}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-background"
          >
            <ArrowLeft size={13} /> Back to reports
          </button>
          {detail ? (
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              {SOURCE_LABEL[detail.metadata.reportType] ?? detail.metadata.reportType}
            </span>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {detailState === "loading" ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="animate-spin" size={20} />
            </div>
          ) : detailState === "error" || !detail ? (
            <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
              {OPEN_ERROR_MESSAGE}{" "}
              <button type="button" onClick={() => void openReport(openReportId)} className="underline">
                Retry
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* 1. Summary first */}
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-foreground">{detail.metadata.title}</h3>
                  {detail.metadata.riskLevel ? (
                    <span className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ${RISK_STYLE[detail.metadata.riskLevel] ?? ""}`}>
                      {detail.metadata.riskLevel} risk
                    </span>
                  ) : null}
                  {detail.metadata.confidence ? (
                    <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                      {detail.metadata.confidence} confidence
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Saved {formatWhen(detail.metadata.createdAt)} · {detail.metadata.sourceSystem}
                  {detail.metadata.attachmentCount > 0 ? ` · ${detail.metadata.attachmentCount} file${detail.metadata.attachmentCount === 1 ? "" : "s"}` : ""}
                </p>
                <p className="mt-3 rounded-lg border border-border bg-card p-3 text-sm leading-6 text-foreground">
                  {detail.summary.headline}
                </p>
              </div>

              {/* 2. Supporting statements second */}
              {detail.supportingStatements.length > 0 ? (
                <div>
                  <div className="ci-eyebrow mb-2">Supporting findings</div>
                  <ul className="space-y-1.5">
                    {detail.supportingStatements.map((statement, index) => (
                      <li key={index} className="flex items-start gap-2 text-sm text-foreground">
                        <span className="mt-[7px] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                        <span>{statement}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Attachment references (saved report opens even without them). */}
              {detail.attachments.refs.length > 0 ? (
                <div>
                  <div className="ci-eyebrow mb-2">Source files</div>
                  {detail.attachments.unavailableNote ? (
                    <p className="mb-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                      <FileWarning size={13} className="mt-0.5 shrink-0" /> {detail.attachments.unavailableNote}
                    </p>
                  ) : null}
                  <ul className="space-y-1">
                    {detail.attachments.refs.map((ref) => (
                      <li key={ref.attachmentId} className="flex items-center gap-2 text-xs">
                        <FileText size={12} className="shrink-0 text-muted-foreground" />
                        <span className={ref.available ? "text-foreground" : "text-muted-foreground line-through"}>
                          {ref.filename ?? `Attachment ${ref.attachmentId.slice(0, 8)}…`}
                        </span>
                        {!ref.available ? (
                          <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">
                            unavailable
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* 3. Technical detail (Pro/Admin presentation only; server-decided). */}
              {detail.technical ? (
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <div className="ci-eyebrow mb-2">Technical detail</div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                    <div><span className="font-medium text-foreground">Source:</span> {detail.technical.sourceSystem}</div>
                    <div><span className="font-medium text-foreground">Type:</span> {SOURCE_LABEL[detail.technical.reportType] ?? detail.technical.reportType}</div>
                    <div><span className="font-medium text-foreground">Findings:</span> {detail.technical.findingCount}</div>
                  </div>
                  {detail.technical.missingProcedures.length > 0 ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Missing procedures:</span>{" "}
                      {detail.technical.missingProcedures.join("; ")}
                    </div>
                  ) : null}
                  {detail.technical.supplementOpportunities.length > 0 ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Supplement opportunities:</span>{" "}
                      {detail.technical.supplementOpportunities.join("; ")}
                    </div>
                  ) : null}
                  {detail.technical.savedReportExcerpt ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-medium text-foreground">Saved report text</summary>
                      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-card p-2 text-[11px] leading-4 text-muted-foreground">
                        {detail.technical.savedReportExcerpt}
                      </pre>
                    </details>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── List view ──────────────────────────────────────────────────────────────
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
        ) : state === "locked" ? (
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            <Lock size={14} className="mt-0.5 shrink-0" />
            <span>Report memory is available on Starter, Pro, and Team plans.</span>
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
          <ul className="space-y-2" data-tour="past-reports-list">
            {reports.map((report) => (
              <li key={report.id}>
                <button
                  type="button"
                  onClick={() => void openReport(report.id)}
                  className="ci-card flex w-full cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 text-left transition hover:border-[var(--accent)]/45 hover:bg-muted/40"
                  aria-label={`Open report: ${report.title}`}
                >
                  <span className="mt-0.5 shrink-0 rounded-md bg-[var(--accent)]/12 p-2 text-[var(--accent)]">
                    <FileText size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
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
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {report.insurer ? `${report.insurer} · ` : ""}
                      {report.fileCount} file{report.fileCount === 1 ? "" : "s"} · {formatWhen(report.updatedAt)}
                    </span>
                  </span>
                  <ChevronRight size={15} className="mt-1 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {state !== "unauthorized" ? <PastChatsSection /> : null}
      </div>
    </div>
  );
}

type ChatThreadSummary = {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: string;
};

/**
 * Past chats — saved transcripts the user can reopen in the Analysis
 * Workspace. The visible count is plan-limited server-side (Starter 5,
 * Pro 10, Team/Admin unlimited); free plans see the section locked.
 */
function PastChatsSection() {
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [limit, setLimit] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "locked" | "error">("loading");

  const fetchThreads = useCallback(async () => {
    try {
      const res = await fetch("/api/chat-threads", { cache: "no-store" });
      if (!res.ok) {
        setState("error");
        return;
      }
      const data = (await res.json()) as {
        locked?: boolean;
        limit?: number | null;
        threads?: ChatThreadSummary[];
      };
      if (data.locked) {
        setState("locked");
        return;
      }
      setThreads(data.threads ?? []);
      setLimit(typeof data.limit === "number" ? data.limit : null);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState only runs after the awaited fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchThreads();
  }, [fetchThreads]);

  const deleteThread = useCallback(
    async (threadId: string) => {
      try {
        await fetch(`/api/chat-threads/${encodeURIComponent(threadId)}`, { method: "DELETE" });
      } catch {
        // The refresh below re-syncs either way.
      }
      void fetchThreads();
    },
    [fetchThreads]
  );

  return (
    <div className="mt-5 border-t border-border pt-4" data-tour="past-chats">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <MessageSquare size={14} className="text-[var(--accent)]" /> Past chats
        </h3>
        {state === "ready" && limit !== null ? (
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            last {limit} shown
          </span>
        ) : null}
      </div>

      {state === "loading" ? (
        <div className="flex h-16 items-center justify-center text-muted-foreground">
          <Loader2 className="animate-spin" size={16} />
        </div>
      ) : state === "locked" ? (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <Lock size={13} className="mt-0.5 shrink-0" />
          <span>
            Reopening past chats is available on paid plans — Starter keeps your last 5,
            Pro your last 10.
          </span>
        </div>
      ) : state === "error" ? (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          Couldn&apos;t load your past chats.{" "}
          <button type="button" onClick={() => { setState("loading"); void fetchThreads(); }} className="underline">
            Retry
          </button>
        </div>
      ) : threads.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No saved chats yet. Conversations save automatically as you chat.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {threads.map((thread) => (
            <li key={thread.id} className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => requestChatReopen(thread.id)}
                className="ci-card flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-left transition hover:border-[var(--accent)]/45 hover:bg-muted/40"
                aria-label={`Reopen chat: ${thread.title}`}
                title="Reopen this chat in the Analysis Workspace"
              >
                <MessageSquare size={13} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground">
                    {thread.title}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {thread.messageCount} message{thread.messageCount === 1 ? "" : "s"} ·{" "}
                    {formatWhen(thread.updatedAt)}
                  </span>
                </span>
                <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
              </button>
              <button
                type="button"
                onClick={() => void deleteThread(thread.id)}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-red-500"
                aria-label={`Delete saved chat: ${thread.title}`}
                title="Delete this saved chat"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
