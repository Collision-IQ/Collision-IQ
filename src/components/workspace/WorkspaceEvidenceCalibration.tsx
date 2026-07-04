"use client";

import { ExternalLink, Gauge, ShieldCheck } from "lucide-react";

export type WorkspaceEvidenceLink = {
  title: string;
  url?: string | null;
  sourceType?: string | null;
};

export type WorkspaceCalibrationItem = {
  label: string;
  detail?: string | null;
  status?: string | null;
};

const SOURCE_STYLE: Record<string, string> = {
  oem: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  law: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300",
  policy: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300",
  industry: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
};

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/** Evidence tab — OE-procedure and jurisdiction/law links & docs from the review. */
export function WorkspaceEvidencePanel({ links }: { links: WorkspaceEvidenceLink[] }) {
  return (
    <div className="ci-panel flex min-h-0 min-w-0 flex-col overflow-y-auto p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck size={18} className="text-[var(--accent)]" />
        <h2 className="text-lg font-semibold text-foreground">Evidence</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        OE procedures and jurisdiction/law references that support the OE procedures and review reports.
      </p>

      <div className="mt-4 min-h-0 flex-1">
        {links.length === 0 ? (
          <Empty>No OE-procedure or jurisdiction links attached to this review yet.</Empty>
        ) : (
          <ul className="space-y-2">
            {links.map((link, index) => {
              const badge = (link.sourceType ?? "").toLowerCase();
              return (
                <li
                  key={`${link.title}-${index}`}
                  className="ci-card flex items-start gap-3 rounded-lg border border-border bg-card p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{link.title}</span>
                      {badge ? (
                        <span
                          className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ${SOURCE_STYLE[badge] ?? "border-border bg-muted text-muted-foreground"}`}
                        >
                          {badge}
                        </span>
                      ) : null}
                    </div>
                    {link.url ? (
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-0.5 inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
                      >
                        Open source <ExternalLink size={11} />
                      </a>
                    ) : (
                      <span className="mt-0.5 block text-xs text-muted-foreground">Referenced — link not produced</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        These are the OE / jurisdiction sources cited in the current review. Fresh OEM-procedure retrieval and
        AI-generated support visuals can be added on demand — say the word to enable it.
      </p>
    </div>
  );
}

/** Calibration tab — ADAS / calibration requirements identified from the review. */
export function WorkspaceCalibrationPanel({ items }: { items: WorkspaceCalibrationItem[] }) {
  return (
    <div className="ci-panel flex min-h-0 min-w-0 flex-col overflow-y-auto p-5">
      <div className="flex items-center gap-2">
        <Gauge size={18} className="text-[var(--accent)]" />
        <h2 className="text-lg font-semibold text-foreground">Calibration</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        ADAS, scan, and calibration requirements identified from this review.
      </p>

      <div className="mt-4 min-h-0 flex-1">
        {items.length === 0 ? (
          <Empty>No ADAS / calibration items were identified in this review.</Empty>
        ) : (
          <ul className="space-y-2">
            {items.map((item, index) => (
              <li
                key={`${item.label}-${index}`}
                className="ci-card rounded-lg border border-border bg-card p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{item.label}</span>
                  {item.status ? (
                    <span className="shrink-0 rounded-full border border-border bg-muted px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                      {String(item.status).replace(/_/g, " ")}
                    </span>
                  ) : null}
                </div>
                {item.detail ? <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        Calibration items are surfaced from the generated review. Confirm each against the OEM aiming /
        initialization procedure and the completed scan/calibration records before relying on it.
      </p>
    </div>
  );
}
