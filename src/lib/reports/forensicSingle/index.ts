/**
 * forensic-single — single-estimate Forensic Estimate Review.
 *
 * Until this package existed the build only produced a forensic analysis
 * inside a two-estimate comparison; a case with one estimate on file hit the
 * delta release gate and shipped nothing. This runs the same discipline on
 * one document: reconcile to printed totals → deterministic findings →
 * branded PDF. `runForensicSingle` is pure and synchronous; the renderer is
 * the only async step.
 */
export { runForensicSingle, type EngineOptions } from "./engine";
export { buildNormalizedEstimateFromText } from "./fromEstimateText";
export { renderForensicSingleReportPdf, type RenderForensicSingleOptions } from "./renderer";
export { planReports, type ReportMode, type ReportPlan } from "./reportPlan";
export type { ForensicReport, Finding, NormalizedEstimate } from "./types";

export const FORENSIC_SINGLE_REPORT_FILENAME = "forensic-estimate-review.pdf";
