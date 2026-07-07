"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Download, FileText, Loader2, Lock, RefreshCw, Upload } from "lucide-react";

// Scan IQ + CCC Secure Share Import (Pro-only). The backend enforces
// entitlements and feature flags; this panel surfaces upgrade/disabled states.

type ScanRowView = {
  code: string;
  module: string | null;
  preStatus: string | null;
  postStatus: string | null;
  changeType: string;
  originalDescription: string | null;
  normalizedDescription: string | null;
  motorLookupStatus: string;
};

type ScanResult = {
  reportId: string;
  customerSummary: string;
  motorStatusLine: string;
  rows: ScanRowView[];
  pre: { sourceFile: string; dtcCount: number; warnings: string[] };
  post: { sourceFile: string; dtcCount: number; warnings: string[] };
};

type CccEvent = {
  id: string;
  receivedAt: string;
  vehicle: { year: number | null; make: string | null; model: string | null; vinTail: string | null };
  normalizedLineItemCount: number | null;
  jurisdiction: { stateCode: string | null };
};

const CHANGE_STYLE: Record<string, string> = {
  new: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300",
  remaining: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  cleared: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  unknown: "border-border bg-muted text-muted-foreground",
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function ScanFilePicker({
  label,
  file,
  onFile,
}: {
  label: string;
  file: File | null;
  onFile: (file: File | null) => void;
}) {
  return (
    <label className="flex min-h-[84px] flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border p-3 text-center transition hover:border-[var(--accent)]/50">
      <Upload size={16} className="text-muted-foreground" />
      <span className="text-xs font-medium text-foreground">{label}</span>
      <span className="max-w-full truncate text-[11px] text-muted-foreground">
        {file ? file.name : "PDF, TXT, CSV, or image"}
      </span>
      <input
        type="file"
        accept=".pdf,.txt,.csv,.log,image/*,application/pdf,text/plain,text/csv"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}

export default function ScanIqPanel() {
  const [preFile, setPreFile] = useState<File | null>(null);
  const [postFile, setPostFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);

  const [cccEvents, setCccEvents] = useState<CccEvent[] | null>(null);
  const [cccStatus, setCccStatus] = useState<"idle" | "loading" | "unavailable" | "locked" | "ready">("idle");
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importedReportId, setImportedReportId] = useState<string | null>(null);

  const loadCccEvents = useCallback(async () => {
    setCccStatus("loading");
    try {
      const res = await fetch("/api/integrations/ccc-secure-share/intake", { cache: "no-store" });
      if (res.status === 403) {
        setCccStatus("locked");
        return;
      }
      if (!res.ok) {
        setCccStatus("unavailable");
        return;
      }
      const data = (await res.json()) as { events?: CccEvent[] };
      setCccEvents(data.events ?? []);
      setCccStatus("ready");
    } catch {
      setCccStatus("unavailable");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCccEvents();
  }, [loadCccEvents]);

  const runComparison = async () => {
    if (!preFile || !postFile || running) return;
    setRunning(true);
    setError(null);
    setLocked(null);
    try {
      const [preDataUrl, postDataUrl] = await Promise.all([fileToDataUrl(preFile), fileToDataUrl(postFile)]);
      const res = await fetch("/api/scan-iq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pre: { filename: preFile.name, mimeType: preFile.type || "application/pdf", dataUrl: preDataUrl },
          post: { filename: postFile.name, mimeType: postFile.type || "application/pdf", dataUrl: postDataUrl },
        }),
      });
      const data = (await res.json().catch(() => null)) as (ScanResult & { error?: string }) | null;
      if (res.status === 403) {
        setLocked(data?.error ?? "Scan IQ is available on Pro and Team plans.");
        return;
      }
      if (!res.ok || !data) {
        setError(data?.error ?? "Scan comparison failed. Your files were kept.");
        return;
      }
      setResult(data);
    } catch {
      setError("Scan comparison failed. Your files were kept.");
    } finally {
      setRunning(false);
    }
  };

  const importCccEvent = async (eventId: string) => {
    setImportingId(eventId);
    setImportedReportId(null);
    try {
      const res = await fetch("/api/integrations/ccc-secure-share/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId }),
      });
      const data = (await res.json().catch(() => null)) as { reportId?: string; error?: string } | null;
      if (res.ok && data?.reportId) {
        setImportedReportId(data.reportId);
      }
    } finally {
      setImportingId(null);
    }
  };

  return (
    <div className="ci-panel flex min-h-0 min-w-0 flex-col overflow-y-auto p-5">
      <div className="flex items-center gap-2">
        <Activity size={18} className="text-[var(--accent)]" />
        <h2 className="text-lg font-semibold text-foreground">Scan IQ</h2>
        <span className="rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-[var(--accent)]">
          Pro
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Upload a pre-repair scan and a post-repair scan. Collision IQ extracts the diagnostic codes, compares
        them, and flags anything cleared, remaining, or new — with MOTOR DTC support where available.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <ScanFilePicker label="Pre-repair scan" file={preFile} onFile={setPreFile} />
        <ScanFilePicker label="Post-repair scan" file={postFile} onFile={setPostFile} />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void runComparison()}
          disabled={!preFile || !postFile || running}
          className="ci-btn-primary inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-semibold disabled:opacity-60"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
          {running ? "Comparing scans…" : "Compare scans"}
        </button>
        {result ? (
          <span className="text-xs text-muted-foreground">Saved to Reports (#{result.reportId.slice(0, 8)}…)</span>
        ) : null}
      </div>

      {locked ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Lock size={14} /> {locked}
        </div>
      ) : null}
      {error ? <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">{error}</p> : null}

      {result ? (
        <div className="mt-5 space-y-4">
          <div className="ci-card rounded-lg border border-border bg-card p-4">
            <div className="ci-eyebrow mb-2">Summary</div>
            <p className="whitespace-pre-line text-sm text-foreground">{result.customerSummary}</p>
            <p className="mt-2 text-[11px] text-muted-foreground">{result.motorStatusLine}</p>
          </div>

          <div>
            <div className="ci-eyebrow mb-2">Technical detail</div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="px-2.5 py-2 font-medium">DTC</th>
                    <th className="px-2.5 py-2 font-medium">Module</th>
                    <th className="px-2.5 py-2 font-medium">Pre</th>
                    <th className="px-2.5 py-2 font-medium">Post</th>
                    <th className="px-2.5 py-2 font-medium">Change</th>
                    <th className="px-2.5 py-2 font-medium">Description</th>
                    <th className="px-2.5 py-2 font-medium">MOTOR</th>
                  </tr>
                </thead>
                <tbody className="text-foreground">
                  {result.rows.map((row, index) => (
                    <tr key={`${row.code}-${index}`} className="border-t border-border">
                      <td className="px-2.5 py-1.5 font-mono">{row.code}</td>
                      <td className="px-2.5 py-1.5">{row.module ?? "—"}</td>
                      <td className="px-2.5 py-1.5">{row.preStatus ?? "—"}</td>
                      <td className="px-2.5 py-1.5">{row.postStatus ?? "—"}</td>
                      <td className="px-2.5 py-1.5">
                        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] uppercase ${CHANGE_STYLE[row.changeType] ?? CHANGE_STYLE.unknown}`}>
                          {row.changeType}
                        </span>
                      </td>
                      <td className="max-w-[240px] truncate px-2.5 py-1.5" title={row.normalizedDescription ?? row.originalDescription ?? ""}>
                        {row.normalizedDescription ?? row.originalDescription ?? "—"}
                      </td>
                      <td className="px-2.5 py-1.5 text-[10px] text-muted-foreground">{row.motorLookupStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {/* CCC Secure Share Import — inbound is webhook-driven; this lists received
          estimates ready to import into the review pipeline. */}
      <div className="mt-8 border-t border-border pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Download size={15} className="text-[var(--accent)]" />
            <h3 className="text-sm font-semibold text-foreground">Import from CCC Secure Share</h3>
            <span className="rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-[var(--accent)]">
              Pro
            </span>
          </div>
          <button
            type="button"
            onClick={() => void loadCccEvents()}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-[11px] hover:bg-background"
          >
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Estimates shared from CCC ONE arrive automatically via Secure Share. Import one to review it with
          Collision IQ and save it to your report history.
        </p>

        <div className="mt-3">
          {cccStatus === "loading" || cccStatus === "idle" ? (
            <p className="text-xs text-muted-foreground">Checking for received CCC estimates…</p>
          ) : cccStatus === "locked" ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <Lock size={13} /> CCC Secure Share import is available on Pro and Team plans.
            </div>
          ) : cccStatus === "unavailable" ? (
            <p className="text-xs text-muted-foreground">
              CCC Secure Share import isn&apos;t enabled right now.
            </p>
          ) : (cccEvents ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No CCC Secure Share estimates received yet. Share a workfile to Collision IQ from CCC ONE and it
              will appear here.
            </p>
          ) : (
            <ul className="space-y-2">
              {(cccEvents ?? []).map((event) => (
                <li key={event.id} className="ci-card flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <FileText size={13} className="shrink-0 text-muted-foreground" />
                      <span className="truncate">
                        {[event.vehicle.year, event.vehicle.make, event.vehicle.model].filter(Boolean).join(" ") || "CCC ONE estimate"}
                        {event.vehicle.vinTail ? ` (…${event.vehicle.vinTail})` : ""}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {new Date(event.receivedAt).toLocaleString()} · {event.normalizedLineItemCount ?? 0} lines
                      {event.jurisdiction.stateCode ? ` · ${event.jurisdiction.stateCode}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void importCccEvent(event.id)}
                    disabled={importingId === event.id}
                    className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1.5 text-[11px] font-medium hover:bg-background disabled:opacity-60"
                  >
                    {importingId === event.id ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                    Import
                  </button>
                </li>
              ))}
            </ul>
          )}
          {importedReportId ? (
            <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
              Imported — saved to your Reports history.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
