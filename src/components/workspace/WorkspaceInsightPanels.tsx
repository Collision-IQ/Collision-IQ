"use client";

import { Activity } from "lucide-react";

/**
 * Presentational bottom-row panels for the V2 workspace. They read existing
 * case state (session events, risk/confidence) — no new analysis logic.
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

export type RiskScore = "low" | "moderate" | "high" | "unknown";

const RISK_ROWS: { key: RiskScore; color: string; label: string }[] = [
  { key: "high", color: "bg-red-500", label: "High Risk" },
  { key: "moderate", color: "bg-amber-500", label: "Medium Risk" },
  { key: "low", color: "bg-emerald-500", label: "Low Risk" },
  { key: "unknown", color: "bg-muted-foreground/40", label: "Not Set" },
];

export function AnalysisInsightsPanel({
  riskScore = "unknown",
  confidence,
}: {
  riskScore?: RiskScore;
  /** Confidence band label (e.g. "High"), or null when not yet determined. */
  confidence?: string | null;
}) {
  return (
    <div className="ci-panel flex min-h-0 flex-col p-3">
      <div className="ci-eyebrow mb-2">Analysis Insights</div>
      <div className="grid flex-1 grid-cols-2 gap-3 text-xs">
        <div>
          <div className="mb-1 font-medium text-foreground">Risk Overview</div>
          <ul className="space-y-1 text-muted-foreground">
            {RISK_ROWS.map((row) => {
              const active = row.key === riskScore;
              return (
                <li
                  key={row.label}
                  className={`flex items-center gap-1.5 ${active ? "font-semibold text-foreground" : ""}`}
                >
                  <span className={`inline-block h-2 w-2 rounded-full ${row.color} ${active ? "ring-2 ring-offset-1 ring-offset-card ring-current" : ""}`} />
                  {row.label}
                  {active ? <span className="ml-auto text-[10px] uppercase tracking-wide">Current</span> : null}
                </li>
              );
            })}
          </ul>
        </div>
        <div>
          <div className="mb-1 font-medium text-foreground">Confidence</div>
          <div className="text-[22px] font-semibold capitalize text-foreground">
            {confidence || "—"}
          </div>
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
