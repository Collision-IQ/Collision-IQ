"use client";

import Image from "next/image";
import { Activity, ExternalLink } from "lucide-react";
import type { WorkspaceAnalysisStatus } from "@/components/workspace/CommandCenterPanel";

/**
 * Presentational bottom-row panels for the V2 workspace. They read existing
 * state (analysis status, latest photo) and do NOT invent new analysis logic —
 * the deeper wiring (real event feed, risk model) is intentionally deferred.
 */

export function CaseActivityPanel({ events }: { events: string[] }) {
  return (
    <div className="ci-panel flex min-h-0 flex-col p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="ci-eyebrow inline-flex items-center gap-1.5">
          <Activity size={12} /> Case Activity
        </div>
        <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.08em] text-emerald-600 dark:text-emerald-300">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live
        </span>
      </div>
      <ol className="flex-1 space-y-2 overflow-y-auto text-xs text-muted-foreground">
        {events.length === 0 ? (
          <li className="text-muted-foreground/70">Session started — awaiting documents.</li>
        ) : (
          events.map((event, index) => (
            <li key={`${event}-${index}`} className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]/70" />
              <span>{event}</span>
            </li>
          ))
        )}
      </ol>
    </div>
  );
}

export function AnalysisInsightsPanel({ status }: { status: WorkspaceAnalysisStatus }) {
  const resolved = status === "complete";
  const rows = [
    { color: "bg-red-500", label: "High Risk" },
    { color: "bg-amber-500", label: "Medium Risk" },
    { color: "bg-emerald-500", label: "Low Risk" },
    { color: "bg-muted-foreground/40", label: "Not Set" },
  ];
  return (
    <div className="ci-panel flex min-h-0 flex-col p-3">
      <div className="ci-eyebrow mb-2">Analysis Insights</div>
      <div className="grid flex-1 grid-cols-2 gap-3 text-xs">
        <div>
          <div className="mb-1 font-medium text-foreground">Risk Overview</div>
          <ul className="space-y-1 text-muted-foreground">
            {rows.map((row) => (
              <li key={row.label} className="flex items-center gap-1.5">
                <span className={`inline-block h-2 w-2 rounded-full ${row.color}`} />
                {row.label}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-1 font-medium text-foreground">Confidence Score</div>
          <div className="text-[26px] font-semibold text-foreground">{resolved ? "—" : "—"}</div>
          <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
            <li>File completeness</li>
            <li>Data quality</li>
            <li>Source reliability</li>
            <li>Technical alignment</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export function DamagePreviewPanel({
  imageSrc,
  onUploadPhotos,
}: {
  imageSrc?: string | null;
  onUploadPhotos?: () => void;
}) {
  return (
    <div className="ci-panel flex min-h-0 flex-col p-3">
      <div className="ci-eyebrow mb-2">Damage Preview</div>
      <div className="flex flex-1 items-center gap-3">
        <div className="relative h-[104px] w-[168px] shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
          {imageSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageSrc} alt="Latest damage photo" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Image src="/iq/iq-favicon.png" alt="" width={20} height={20} className="opacity-40" />
            </div>
          )}
        </div>
        <div className="min-w-0 text-xs text-muted-foreground">
          <p>Upload photos to see damage mapping and insights here.</p>
          {onUploadPhotos ? (
            <button
              type="button"
              onClick={onUploadPhotos}
              className="ci-btn-primary mt-2 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold"
            >
              <ExternalLink size={13} /> Upload Photos
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
