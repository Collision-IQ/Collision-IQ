"use client";

import type { ReactNode } from "react";
import type { ReviewProgress } from "@/components/ChatWidget";

export type WorkspaceAnalysisStatus = "idle" | "processing" | "complete" | "error";

type Props = {
  reviewProgress: ReviewProgress;
  analysisStatus: WorkspaceAnalysisStatus;
  latestFileName?: string | null;
  /** The existing right-rail content (reports/exports/evidence) rendered below. */
  children?: ReactNode;
};

function statusLabel(status: WorkspaceAnalysisStatus): { label: string; live: boolean } {
  switch (status) {
    case "processing":
      return { label: "Processing", live: true };
    case "complete":
      return { label: "Complete", live: true };
    case "error":
      return { label: "Attention", live: false };
    default:
      return { label: "Awaiting files", live: false };
  }
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-border/70 bg-muted/40 px-3 py-2.5">
      <div className="ci-eyebrow text-[10px]">{label}</div>
      <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
    </div>
  );
}

/**
 * Right-rail "Command Center" for the V2 workspace. Reads the existing review
 * progress + analysis status (no new logic) and renders the existing rail
 * content (reports/exports) beneath the decision summary.
 */
export default function CommandCenterPanel({
  reviewProgress,
  analysisStatus,
  latestFileName,
  children,
}: Props) {
  const status = statusLabel(analysisStatus);
  const reviewable = reviewProgress.reviewableFileCount || 0;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="ci-panel flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <div className="ci-eyebrow inline-flex items-center gap-1.5">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                status.live ? "bg-emerald-500" : "bg-muted-foreground/50"
              }`}
            />
            Command Center
          </div>
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${
              status.live
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                : "border-border bg-muted text-muted-foreground"
            }`}
          >
            {status.live ? "Live" : "Idle"}
          </span>
        </div>

        <div>
          <div className="text-[17px] font-semibold leading-tight text-foreground">
            Decision-Ready Analysis
          </div>
          <div className="mt-1 text-xs text-muted-foreground">Fast scan first. Details below.</div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="ci-eyebrow text-[10px]">Risk</div>
            <div className="mt-0.5 text-sm font-medium text-foreground">
              {analysisStatus === "complete" ? "Reviewed" : "Pending"}
            </div>
          </div>
          <div>
            <div className="ci-eyebrow text-[10px]">Confidence</div>
            <div className="mt-0.5 text-sm font-medium text-foreground">
              {analysisStatus === "complete" ? "Reviewed" : "Pending"}
            </div>
          </div>
          <div>
            <div className="ci-eyebrow text-[10px]">Latest file</div>
            <div className="mt-0.5 truncate text-sm font-medium text-foreground" title={latestFileName ?? undefined}>
              {latestFileName || "No attachment yet"}
            </div>
          </div>
          <div>
            <div className="ci-eyebrow text-[10px]">Analysis</div>
            <div className="mt-0.5 text-sm font-medium text-foreground">{status.label}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Stat label="Uploaded" value={reviewProgress.uploaded} />
          <Stat label="Indexed" value={reviewProgress.indexed} />
          <Stat label="Vision Processed" value={reviewProgress.visionProcessed} />
          <Stat label="Reviewed" value={`${reviewProgress.reviewedForDetermination}/${reviewable}`} />
        </div>

        <div className="text-xs text-muted-foreground">
          Reviewed {reviewProgress.reviewedForDetermination} of {reviewable} reviewable files.
        </div>
      </div>

      {children ? <div className="ci-panel flex-1 min-h-0 overflow-y-auto p-3">{children}</div> : null}
    </div>
  );
}
