"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Clipboard, Download, Maximize2, MessageSquareText, Minimize2, RefreshCcw, X } from "lucide-react";

export type CitationDensityAnnotationMetadata = {
  findingId: string;
  anchorId?: string;
  sourceAnchorId?: string;
  sourceDocumentId?: string;
  sourceDocumentRole?: "carrier" | "shop" | "both";
  sourcePdfPageNumber?: number;
  sourcePageNumber?: number;
  sourceLineNumber?: string;
  sourceAnchorType?: EstimateRowAnchorType;
  sourceAnchorText?: string;
  sourceAnchorNormalizedText?: string;
  sourceAnchorOperation?: string | null;
  sourceAnchorDescription?: string | null;
  sourceAnchorPartNumber?: string | null;
  sourceAnchorQty?: number | null;
  sourceAnchorPrice?: number | null;
  sourceAnchorLabor?: number | null;
  sourceAnchorPaint?: number | null;
  sourceAnchorPdfBoundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  sourceAnchorPdfQuad?: [number, number, number, number, number, number, number, number];
  sourceAnchorNormalizedUiRect?: {
    xPct: number;
    yPct: number;
    wPct: number;
    hPct: number;
  };
  markerNumber: number;
  pageNumber: number;
  pdfPageWidth?: number;
  pdfPageHeight?: number;
  rotation?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  xPct?: number;
  yPct?: number;
  wPct?: number;
  hPct?: number;
  coordinateSpace?: "pdf-points" | "normalized";
  targetLineNumber?: string;
  targetSection?: string;
  targetRawText?: string;
  targetNormalizedText?: string;
  matchConfidence?: "high" | "medium" | "low";
  anchorType?: EstimateRowAnchorType | "exact_line" | "description" | "note" | "amount" | "section" | "totals" | "supplier" | "page_fallback";
  label: string;
  shortTitle: string;
  estimateLine: string;
  bestAuthority: string;
  authorityStatus: string;
  missingProof: string;
  whyItMatters?: string;
  nextAction: string;
  sourceRefs: string[];
  comment: string;
};

type EstimateRowAnchorType =
  | "estimate_line"
  | "line_note"
  | "embedded_link_row"
  | "supplier_row"
  | "totals_row"
  | "section_row"
  | "guide_row";

type CitationDensityViewerVariant = "modal" | "inline";
type ReportTab = "overview" | "findings" | "diagnostics";

export const PDF_VIEWER_INITIALIZATION_ERROR =
  "PDF viewer failed to initialize. Download the PDF instead.";

export default function CitationDensityAnnotationViewer({
  pdfUrl,
  annotations,
  diagnostics,
  title,
  filename,
  variant = "modal",
  artifactUnavailableMessage,
  onClose,
  onAsk,
  onRegenerate,
}: {
  pdfUrl: string;
  annotations: CitationDensityAnnotationMetadata[];
  diagnostics?: Record<string, unknown> | null;
  title?: string;
  filename?: string;
  variant?: CitationDensityViewerVariant;
  artifactUnavailableMessage?: string | null;
  onClose: () => void;
  onAsk?: (annotation: CitationDensityAnnotationMetadata) => void;
  onRegenerate?: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(annotations[0] ? getAnnotationSelectionKey(annotations[0]) : null);
  const [activeTab, setActiveTab] = useState<ReportTab>("findings");
  const [inlineExpanded, setInlineExpanded] = useState(false);
  const [fullDrawerOpen, setFullDrawerOpen] = useState(false);
  const effectiveSelectedId = useMemo(
    () => selectedId && annotations.some((annotation) => getAnnotationSelectionKey(annotation) === selectedId)
      ? selectedId
      : annotations[0] ? getAnnotationSelectionKey(annotations[0]) : null,
    [annotations, selectedId]
  );
  const selected = useMemo(
    () => annotations.find((annotation) => getAnnotationSelectionKey(annotation) === effectiveSelectedId) ?? annotations[0] ?? null,
    [annotations, effectiveSelectedId]
  );
  const reportTitle = title || inferReportTitle(diagnostics);
  const safeFilename = filename || `${reportTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "citation-density-report"}.pdf`;

  function handleSelectAnnotation(annotation: CitationDensityAnnotationMetadata) {
    const selectionKey = getAnnotationSelectionKey(annotation);
    setSelectedId(selectionKey);
  }

  const content = (
    <CitationDensityReportWorkspace
      variant={variant}
      title={reportTitle}
      filename={safeFilename}
      pdfUrl={pdfUrl}
      annotations={annotations}
      selected={selected}
      effectiveSelectedId={effectiveSelectedId}
      diagnostics={diagnostics}
      activeTab={activeTab}
      inlineExpanded={inlineExpanded}
      artifactUnavailableMessage={artifactUnavailableMessage}
      onTabChange={setActiveTab}
      onToggleInlineExpanded={variant === "inline" ? () => setInlineExpanded((expanded) => !expanded) : undefined}
      onOpenFullDrawer={variant === "inline" ? () => setFullDrawerOpen(true) : undefined}
      onSelect={handleSelectAnnotation}
      onClose={onClose}
      onAsk={onAsk}
      onRegenerate={onRegenerate}
    />
  );

  if (variant === "inline") {
    return (
      <>
        {content}
        {fullDrawerOpen && typeof document !== "undefined"
          ? createPortal(
            <div className="fixed inset-0 z-[80] bg-black/72 text-white">
              <CitationDensityReportWorkspace
                variant="modal"
                title={reportTitle}
                filename={safeFilename}
                pdfUrl={pdfUrl}
                annotations={annotations}
                selected={selected}
                effectiveSelectedId={effectiveSelectedId}
                diagnostics={diagnostics}
                activeTab={activeTab}
                inlineExpanded={false}
                artifactUnavailableMessage={artifactUnavailableMessage}
                onTabChange={setActiveTab}
                onSelect={handleSelectAnnotation}
                onClose={() => setFullDrawerOpen(false)}
                onAsk={onAsk}
                onRegenerate={onRegenerate}
              />
            </div>,
            document.body
          )
          : null}
      </>
    );
  }

  const modal = (
    <div className="fixed inset-0 z-[80] bg-black/72 text-white">
      {content}
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}

function CitationDensityReportWorkspace({
  variant,
  title,
  filename,
  pdfUrl,
  annotations,
  selected,
  effectiveSelectedId,
  diagnostics,
  activeTab,
  inlineExpanded = false,
  artifactUnavailableMessage,
  onTabChange,
  onToggleInlineExpanded,
  onOpenFullDrawer,
  onSelect,
  onClose,
  onAsk,
  onRegenerate,
}: {
  variant: CitationDensityViewerVariant;
  title: string;
  filename: string;
  pdfUrl: string;
  annotations: CitationDensityAnnotationMetadata[];
  selected: CitationDensityAnnotationMetadata | null;
  effectiveSelectedId: string | null;
  diagnostics?: Record<string, unknown> | null;
  activeTab: ReportTab;
  inlineExpanded?: boolean;
  artifactUnavailableMessage?: string | null;
  onTabChange: (tab: ReportTab) => void;
  onToggleInlineExpanded?: () => void;
  onOpenFullDrawer?: () => void;
  onSelect: (annotation: CitationDensityAnnotationMetadata) => void;
  onClose: () => void;
  onAsk?: (annotation: CitationDensityAnnotationMetadata) => void;
  onRegenerate?: () => void;
}) {
  const inline = variant === "inline";
  const shellClass = inline
    ? `flex ${inlineExpanded ? "max-h-[min(70svh,820px)]" : "max-h-[min(38svh,460px)]"} min-h-[150px] flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-[0_20px_60px_rgba(15,23,42,0.16)] ring-1 ring-ring/10 dark:shadow-[0_20px_60px_rgba(0,0,0,0.38)]`
    : "flex h-full min-h-0 flex-col bg-neutral-950 text-white";
  const headerClass = inline
    ? "flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3 py-2.5 sm:px-4"
    : "flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-neutral-950 px-4 py-3";
  const mutedText = inline ? "text-muted-foreground" : "text-white/50";
  const titleText = inline ? "text-card-foreground" : "text-white";
  const actionClass = inline
    ? "inline-flex min-h-9 min-w-9 items-center justify-center rounded-md border border-border bg-muted p-2 text-muted-foreground transition hover:bg-background hover:text-foreground"
    : "inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-white/10 bg-white/5 p-2 text-white/75 transition hover:bg-white/10 hover:text-white";

  return (
    <section className={shellClass} aria-label={`${title} bottom report viewer`} data-citation-density-bottom-viewer={inline ? "true" : undefined}>
      <div className={headerClass}>
        <div className="min-w-0">
          <div className={`truncate text-sm font-semibold ${titleText}`}>{title}</div>
          <div className={`text-xs ${mutedText}`}>
            {annotations.length} line-item finding{annotations.length === 1 ? "" : "s"} available for in-context review
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onToggleInlineExpanded ? (
            <button
              type="button"
              onClick={onToggleInlineExpanded}
              className={actionClass}
              aria-label={inlineExpanded ? "Collapse report" : "Expand report"}
              title={inlineExpanded ? "Collapse report" : "Expand report"}
            >
              {inlineExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          ) : null}
          {onOpenFullDrawer ? (
            <button
              type="button"
              onClick={onOpenFullDrawer}
              className={actionClass}
              aria-label="Open full report drawer"
              title="Open full report drawer"
            >
              <Maximize2 size={16} />
            </button>
          ) : null}
          {onRegenerate ? (
            <button
              type="button"
              onClick={onRegenerate}
              className={actionClass}
              aria-label={`Regenerate ${title}`}
              title={`Regenerate ${title}`}
            >
              <RefreshCcw size={16} />
            </button>
          ) : null}
          <a
            href={pdfUrl}
            download={filename}
            className={actionClass}
            aria-label="Download PDF"
            title="Download PDF"
          >
            <Download size={16} />
          </a>
          <button
            type="button"
            onClick={onClose}
            className={actionClass}
            aria-label={inline ? "Close bottom report viewer" : "Close viewer"}
            title={inline ? "Close bottom report viewer" : "Close viewer"}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {artifactUnavailableMessage ? (
        <div className={inline ? "border-b border-border bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-200" : "border-b border-white/10 bg-amber-300/10 px-4 py-2 text-xs text-amber-100"}>
          {artifactUnavailableMessage} {onRegenerate ? "Regenerate this report to refresh the PDF artifact." : "Regenerate this report to refresh the PDF artifact."}
        </div>
      ) : null}

      <div className={inline ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-hidden"}>
        <div className={inline ? "grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]" : "grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]"}>
          <div className={inline ? "min-h-0 overflow-y-auto bg-background p-3" : "min-h-0 overflow-y-auto bg-neutral-900 p-3"}>
            <ReportTabs activeTab={activeTab} onTabChange={onTabChange} inline={inline} />
            {activeTab === "overview" ? (
              <OverviewTab annotations={annotations} diagnostics={diagnostics} inline={inline} />
            ) : activeTab === "diagnostics" ? (
              <DiagnosticsTab diagnostics={diagnostics} annotations={annotations} inline={inline} />
            ) : (
              <FindingsTab
                annotations={annotations}
                effectiveSelectedId={effectiveSelectedId}
                onSelect={onSelect}
                inline={inline}
              />
            )}
          </div>

          <aside className={inline ? "min-h-0 overflow-y-auto border-t border-border bg-card p-4 lg:border-l lg:border-t-0" : "min-h-0 overflow-y-auto border-t border-white/10 bg-neutral-950 p-5 lg:border-l lg:border-t-0"}>
            {selected ? (
              <SelectedFindingPanel selected={selected} diagnostics={diagnostics} annotations={annotations} inline={inline} onAsk={onAsk} />
            ) : (
              <div className={inline ? "text-sm text-muted-foreground" : "text-sm text-white/55"}>
                Select a highlighted estimate line to view finding detail.
              </div>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}

function ReportTabs({
  activeTab,
  onTabChange,
  inline,
}: {
  activeTab: ReportTab;
  onTabChange: (tab: ReportTab) => void;
  inline: boolean;
}) {
  const tabs: Array<{ id: ReportTab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "findings", label: "Line items" },
    { id: "diagnostics", label: "Diagnostics" },
  ];
  return (
    <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Citation Density report sections">
      {tabs.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onTabChange(tab.id)}
            className={[
              "rounded-md border px-3 py-1.5 text-xs font-semibold transition",
              inline
                ? active
                  ? "border-[#C65A2A]/45 bg-[#C65A2A]/12 text-foreground"
                  : "border-border bg-muted text-muted-foreground hover:bg-card hover:text-foreground"
                : active
                  ? "border-amber-300/60 bg-amber-300/15 text-amber-50"
                  : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white",
            ].join(" ")}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function OverviewTab({
  annotations,
  diagnostics,
  inline,
}: {
  annotations: CitationDensityAnnotationMetadata[];
  diagnostics?: Record<string, unknown> | null;
  inline: boolean;
}) {
  const rows = buildReportOverviewRows(diagnostics, annotations);
  return (
    <div className="space-y-3">
      <div className={inline ? "rounded-md border border-border bg-muted p-3 text-sm leading-6 text-muted-foreground" : "rounded-md border border-white/10 bg-white/5 p-4 text-sm leading-6 text-white/72"}>
        PDF preview is temporarily disabled. Use this bottom viewer to review the generated report sections, selected estimate, source line, missing support, labels, and next actions before downloading the PDF.
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className={inline ? "rounded-md border border-border bg-card p-3" : "rounded-md border border-white/10 bg-white/[0.03] p-3"}>
            <div className={inline ? "text-[10px] uppercase tracking-[0.12em] text-muted-foreground" : "text-[10px] uppercase tracking-[0.12em] text-white/45"}>{row.label}</div>
            <div className={inline ? "mt-1 break-words text-sm text-card-foreground" : "mt-1 break-words text-sm text-white/82"}>{row.value}</div>
          </div>
        ))}
      </div>
      <details className={inline ? "rounded-md border border-border bg-card p-3" : "rounded-md border border-white/10 bg-white/[0.03] p-3"}>
        <summary className={inline ? "cursor-pointer text-sm font-semibold text-card-foreground" : "cursor-pointer text-sm font-semibold text-white"}>
          Report review notes
        </summary>
        <div className={inline ? "mt-2 space-y-2 text-sm leading-6 text-muted-foreground" : "mt-2 space-y-2 text-sm leading-6 text-white/70"}>
          <p>The bottom viewer renders from the current generated report state and fresh PDF bytes when available, so review does not depend on stale artifact IDs.</p>
          <p>Use the Line items tab to inspect why a row was flagged, which authority was attached, what proof is missing, and the recommended next action.</p>
        </div>
      </details>
    </div>
  );
}

function FindingsTab({
  annotations,
  effectiveSelectedId,
  onSelect,
  inline,
}: {
  annotations: CitationDensityAnnotationMetadata[];
  effectiveSelectedId: string | null;
  onSelect: (annotation: CitationDensityAnnotationMetadata) => void;
  inline: boolean;
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      {annotations.map((annotation) => {
        const selectionKey = getAnnotationSelectionKey(annotation);
        return (
          <button
            key={selectionKey}
            type="button"
            onClick={() => onSelect(annotation)}
            className={[
              "rounded-md border p-3 text-left transition",
              inline
                ? effectiveSelectedId === selectionKey
                  ? "border-[#C65A2A]/60 bg-[#C65A2A]/12"
                  : "border-border bg-card hover:bg-muted"
                : effectiveSelectedId === selectionKey
                  ? "border-amber-300/70 bg-amber-300/15"
                  : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
            ].join(" ")}
          >
            <div className={inline ? "text-xs uppercase text-muted-foreground" : "text-xs uppercase text-white/45"}>
              Finding {annotation.markerNumber} · Page {annotation.pageNumber}
            </div>
            <div className={inline ? "mt-1 text-sm font-semibold text-card-foreground" : "mt-1 text-sm font-semibold text-white"}>{annotation.shortTitle}</div>
            <div className={inline ? "mt-1 text-xs text-muted-foreground" : "mt-1 text-xs text-white/55"}>{annotation.label}</div>
            <div className={inline ? "mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground" : "mt-2 line-clamp-2 text-xs leading-5 text-white/55"}>
              {annotation.estimateLine || annotation.targetRawText || annotation.missingProof || "No line text reported"}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function DiagnosticsTab({
  diagnostics,
  annotations,
  inline,
}: {
  diagnostics?: Record<string, unknown> | null;
  annotations: CitationDensityAnnotationMetadata[];
  inline: boolean;
}) {
  return (
    <div className="space-y-3">
      <DiagnosticsPanel diagnostics={diagnostics} annotations={annotations} inline={inline} />
      <details className={inline ? "rounded-md border border-border bg-card p-3" : "rounded-md border border-white/10 bg-white/[0.03] p-3"}>
        <summary className={inline ? "cursor-pointer text-sm font-semibold text-card-foreground" : "cursor-pointer text-sm font-semibold text-white"}>
          Raw diagnostic payload
        </summary>
        <pre className={inline ? "mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-5 text-muted-foreground" : "mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-black/30 p-3 text-xs leading-5 text-white/65"}>
          {JSON.stringify(diagnostics ?? {}, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function SelectedFindingPanel({
  selected,
  diagnostics,
  annotations,
  inline,
  onAsk,
}: {
  selected: CitationDensityAnnotationMetadata;
  diagnostics?: Record<string, unknown> | null;
  annotations: CitationDensityAnnotationMetadata[];
  inline: boolean;
  onAsk?: (annotation: CitationDensityAnnotationMetadata) => void;
}) {
  const detailTone = inline ? "text-muted-foreground" : "text-white/70";
  return (
    <div className="space-y-4">
      <div>
        <div className={inline ? "text-xs uppercase text-muted-foreground" : "text-xs uppercase text-white/45"}>Finding {selected.markerNumber}</div>
        <h2 className={inline ? "mt-1 text-base font-semibold text-card-foreground" : "mt-1 text-base font-semibold text-white"}>{selected.shortTitle}</h2>
        <div className={inline ? "mt-2 inline-flex rounded-md bg-[#C65A2A]/12 px-2 py-1 text-xs font-semibold text-[#9b4f24] dark:text-amber-100" : "mt-2 inline-flex rounded-md bg-amber-300/15 px-2 py-1 text-xs font-semibold text-amber-100"}>
          {selected.label}
        </div>
      </div>

      <ExpandableDetail title="Line-item finding" inline={inline} defaultOpen>
        <Detail label="Estimate line" value={selected.estimateLine} inline={inline} />
        <Detail label="Line-item finding" value={selected.shortTitle} inline={inline} />
        <Detail label="Label" value={selected.label} inline={inline} />
        <Detail label="Selected estimate" value={formatSourceEstimate(selected)} inline={inline} />
        <Detail label="Source page/line" value={formatSourcePageLine(selected)} inline={inline} />
        <Detail label="Anchor" value={selected.targetLineNumber ? `Line ${selected.targetLineNumber}` : selected.targetSection || selected.anchorType || "Estimate row"} inline={inline} />
      </ExpandableDetail>

      <ExpandableDetail title="Authority and source support" inline={inline} defaultOpen>
        <Detail label="Best authority" value={selected.bestAuthority} inline={inline} />
        <Detail label="Authority trace status" value={formatAuthorityTraceStatus(getAuthorityTrace(diagnostics))} inline={inline} />
        <Detail label="Authority status" value={selected.authorityStatus} inline={inline} />
        <Detail label="Drive search status" value={formatDriveSearchStatus(getAuthorityTrace(diagnostics))} inline={inline} />
        <Detail label="Matched folders/docs count" value={formatDriveMatchCounts(getAuthorityTrace(diagnostics))} inline={inline} />
        {selected.sourceRefs.length ? (
          <div>
            <div className={inline ? "text-xs uppercase text-muted-foreground" : "text-xs uppercase text-white/45"}>Source refs</div>
            <div className={`mt-2 space-y-2 text-sm ${detailTone}`}>
              {selected.sourceRefs.map((ref) => <div key={ref}>{ref}</div>)}
            </div>
          </div>
        ) : null}
      </ExpandableDetail>

      <ExpandableDetail title="Missing support and next action" inline={inline} defaultOpen>
        <Detail label="Missing support" value={selected.missingProof} inline={inline} />
        <Detail label="Missing proof" value={selected.missingProof} inline={inline} />
        <Detail label="Why it matters" value={selected.whyItMatters || selected.comment} inline={inline} />
        <Detail label="Next action" value={selected.nextAction} inline={inline} />
      </ExpandableDetail>

      <details className={inline ? "rounded-md border border-border bg-muted/40 p-3" : "rounded-md border border-white/10 bg-white/[0.03] p-3"}>
        <summary className={inline ? "cursor-pointer text-sm font-semibold text-card-foreground" : "cursor-pointer text-sm font-semibold text-white"}>
          Current report diagnostics
        </summary>
        <div className="mt-3">
          <DiagnosticsPanel diagnostics={diagnostics} annotations={annotations} inline={inline} compact />
        </div>
      </details>

      {onAsk ? (
        <button
          type="button"
          onClick={() => onAsk(selected)}
          className={inline ? "inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-muted px-4 py-3 text-sm font-medium text-card-foreground transition hover:bg-background" : "inline-flex w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-white/8 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/12"}
        >
          <MessageSquareText size={16} />
          Ask about this finding
        </button>
      ) : null}
    </div>
  );
}

function ExpandableDetail({
  title,
  inline,
  defaultOpen = false,
  children,
}: {
  title: string;
  inline: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className={inline ? "rounded-md border border-border bg-card p-3" : "rounded-md border border-white/10 bg-white/[0.03] p-3"}>
      <summary className={inline ? "cursor-pointer text-sm font-semibold text-card-foreground" : "cursor-pointer text-sm font-semibold text-white"}>
        {title}
      </summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}

function Detail({ label, value, inline = false }: { label: string; value: string; inline?: boolean }) {
  return (
    <div>
      <div className={inline ? "text-xs uppercase text-muted-foreground" : "text-xs uppercase text-white/45"}>{label}</div>
      <div className={inline ? "mt-1 text-sm leading-6 text-card-foreground" : "mt-1 text-sm leading-6 text-white/82"}>{value || "Not specified"}</div>
    </div>
  );
}

function DiagnosticsPanel({
  diagnostics,
  annotations,
  inline = false,
  compact = false,
}: {
  diagnostics?: Record<string, unknown> | null;
  annotations: CitationDensityAnnotationMetadata[];
  inline?: boolean;
  compact?: boolean;
}) {
  const authorityTrace = getAuthorityTrace(diagnostics);
  const payload = diagnostics ?? {
    artifactVersion: "not provided",
    reportType: "citation-density",
    acceptedEstimateRowFindings: annotations.length,
    rejectedAnchors: [],
  };
  const rows = [
    ["Build", formatDiagnosticValue(payload.buildCommit)],
    ["Artifact", formatDiagnosticValue(payload.artifactVersion ?? payload.citationDensityArtifactVersion)],
    ["Report", formatDiagnosticValue(payload.reportType)],
    ["Selected estimate", firstDiagnosticValue(payload.selectedEstimateForOemDensity, payload.selectedEstimateFileName, payload.actualSourcePdfName)],
    ["Selected reason", formatDiagnosticValue(payload.selectedEstimateReason ?? payload.selectionReason)],
    ["Selected total", formatMoneyDiagnostic(payload.selectedEstimateTotal)],
    ["Comparison total", formatMoneyDiagnostic(payload.comparisonEstimateTotal)],
    ["CCC Secure Share configured", formatBooleanDiagnostic(payload.cccSecureShareConfigured)],
    ["CCC Secure Share searched", formatBooleanDiagnostic(payload.cccSecureShareSearched)],
    ["CCC Secure Share matched", formatBooleanDiagnostic(payload.cccSecureShareMatched)],
    ["CCC Secure Share retrieved", formatBooleanDiagnostic(payload.cccSecureShareRetrieved)],
    ["CCC Secure Share row count", formatDiagnosticValue(payload.cccSecureShareRowCount)],
    ["CCC Secure Share estimate total", formatMoneyDiagnostic(payload.cccSecureShareEstimateTotal)],
    ["CCC Secure Share supplement/version", formatDiagnosticValue(payload.cccSecureShareSupplementVersion)],
    ["CCC Secure Share retrieval failed", formatBooleanDiagnostic(payload.cccSecureShareRetrievalFailed)],
    ["CCC Secure Share unavailable", formatDiagnosticValue(payload.cccSecureShareUnavailableReason)],
    ["Accepted rows", formatDiagnosticValue(payload.acceptedEstimateRowFindings ?? annotations.length)],
    ["Rejected boilerplate", formatDiagnosticValue(payload.rejectedBoilerplateCount)],
    ["Required detectors", formatDiagnosticValue(payload.requiredDetectorFindingCount)],
    ["Missing detectors", formatDiagnosticValue(payload.missingRequiredDetectors)],
    ["Authority trace", formatAuthorityTraceStatus(authorityTrace)],
    ["Authority search", formatDiagnosticValue(payload.googleDriveInternalAuthoritySearch)],
    ["Drive search", formatDriveSearchStatus(authorityTrace)],
    ["Matched folders/docs", formatDriveMatchCounts(authorityTrace)],
    ["Policy confidence", formatDiagnosticValue(payload.policyExtractionConfidence)],
    ["Policy mismatch", formatDiagnosticValue(payload.policyVehicleMismatch)],
  ];

  return (
    <div className={inline ? "rounded-md border border-border bg-card p-3" : "rounded-md border border-white/10 bg-white/[0.03] p-3"}>
      <div className="flex items-center justify-between gap-3">
        <div className={inline ? "text-xs uppercase text-muted-foreground" : "text-xs uppercase text-white/45"}>Diagnostics</div>
        <button
          type="button"
          onClick={() => void copyDiagnostics(payload)}
          className={inline ? "inline-flex min-h-8 min-w-8 items-center justify-center rounded-md border border-border bg-muted p-2 text-muted-foreground transition hover:bg-background hover:text-foreground" : "inline-flex min-h-8 min-w-8 items-center justify-center rounded-md border border-white/10 bg-white/5 p-2 text-white/70 transition hover:bg-white/10 hover:text-white"}
          aria-label="Copy diagnostics"
          title="Copy diagnostics"
        >
          <Clipboard size={14} />
        </button>
      </div>
      <div className={inline ? `mt-3 space-y-2 ${compact ? "text-[11px]" : "text-xs"} text-muted-foreground` : `mt-3 space-y-2 ${compact ? "text-[11px]" : "text-xs"} text-white/70`}>
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[128px_minmax(0,1fr)] gap-2">
            <span className={inline ? "text-muted-foreground" : "text-white/42"}>{label}</span>
            <span className="break-words">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

async function copyDiagnostics(payload: Record<string, unknown>) {
  await navigator.clipboard?.writeText(JSON.stringify(payload, null, 2));
}

function buildReportOverviewRows(diagnostics: Record<string, unknown> | null | undefined, annotations: CitationDensityAnnotationMetadata[]) {
  const payload = diagnostics ?? {};
  const authorityTrace = getAuthorityTrace(diagnostics);
  return [
    { label: "Selected estimate", value: firstDiagnosticValue(payload.selectedEstimateForOemDensity, payload.selectedEstimateFileName, payload.actualSourcePdfName) },
    { label: "Selected estimate reason", value: formatDiagnosticValue(payload.selectedEstimateReason ?? payload.selectionReason) },
    { label: "Selected total", value: formatMoneyDiagnostic(payload.selectedEstimateTotal) },
    { label: "Comparison estimate total", value: formatMoneyDiagnostic(payload.comparisonEstimateTotal) },
    { label: "CCC Secure Share status", value: formatCccSecureShareStatus(payload) },
    { label: "CCC Secure Share row count", value: formatDiagnosticValue(payload.cccSecureShareRowCount) },
    { label: "Authority trace status", value: formatAuthorityTraceStatus(authorityTrace) },
    { label: "Drive search status", value: formatDriveSearchStatus(authorityTrace) },
    { label: "Matched folders/docs count", value: formatDriveMatchCounts(authorityTrace) },
    { label: "Line-item findings", value: String(annotations.length) },
  ];
}

function getAuthorityTrace(diagnostics: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!diagnostics) return null;
  const direct = diagnostics.googleDriveInternalAuthoritySearch ?? diagnostics.authoritySearchTrace;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }
  return null;
}

function formatBooleanDiagnostic(value: unknown) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return formatDiagnosticValue(value);
}

function formatCccSecureShareStatus(payload: Record<string, unknown>) {
  if (payload.cccSecureShareRetrieved === true) return "retrieved";
  if (payload.cccSecureShareMatched === true) return "matched";
  if (payload.cccSecureShareSearched === true) return "searched";
  if (payload.cccSecureShareConfigured === false) return "unavailable/not configured";
  if (payload.cccSecureShareRetrievalFailed === true) return "retrieval failed";
  return "Not reported";
}

function formatAuthorityTraceStatus(trace: Record<string, unknown> | null) {
  if (!trace) return "Not reported";
  const coverage = typeof trace.authorityCoverageStatus === "string" ? trace.authorityCoverageStatus : "unknown";
  const completed = trace.authorityTraceCompleted === true ? "completed" : trace.authorityTraceStarted === true ? "started" : "not started";
  const blocked = typeof trace.authorityTraceBlockedReason === "string" && trace.authorityTraceBlockedReason.trim()
    ? ` · blocked: ${trace.authorityTraceBlockedReason}`
    : "";
  return `${completed} · coverage ${coverage}${blocked}`;
}

function formatDriveSearchStatus(trace: Record<string, unknown> | null) {
  if (!trace) return "Not reported";
  const attempted = trace.driveSearchAttempted === true || trace.googleDriveOrInternalSearchRan === true;
  const available = trace.driveSearchAvailable === true;
  const completed = trace.driveSearchCompleted === true;
  if (completed) return "Completed";
  if (attempted && available) return "Attempted";
  if (!available) return "Unavailable or not configured";
  return attempted ? "Attempted" : "Not run";
}

function formatDriveMatchCounts(trace: Record<string, unknown> | null) {
  if (!trace) return "Not reported";
  const folders = numberFromUnknown(trace.driveMatchedFoldersCount) ?? (Array.isArray(trace.driveMatchedFolders) ? trace.driveMatchedFolders.length : 0);
  const docs = numberFromUnknown(trace.driveDocumentsReviewedCount) ?? (Array.isArray(trace.driveDocumentsReviewed) ? trace.driveDocumentsReviewed.length : 0);
  return `${folders} matched folder${folders === 1 ? "" : "s"} / ${docs} doc${docs === 1 ? "" : "s"}`;
}

function formatSourcePageLine(annotation: CitationDensityAnnotationMetadata) {
  const page = annotation.sourcePdfPageNumber ?? annotation.sourcePageNumber ?? annotation.pageNumber;
  const line = annotation.sourceLineNumber ?? annotation.targetLineNumber;
  return [page ? `Page ${page}` : null, line ? `Line ${line}` : null].filter(Boolean).join(" · ") || "Not specified";
}

function inferReportTitle(diagnostics: Record<string, unknown> | null | undefined) {
  const reportType = typeof diagnostics?.reportType === "string" ? diagnostics.reportType : "";
  if (/oem/i.test(reportType)) return "OEM Citation Density Report";
  return "Delta Citation Density Report";
}

function numberFromUnknown(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstDiagnosticValue(...values: unknown[]) {
  for (const value of values) {
    const formatted = formatDiagnosticValue(value);
    if (formatted !== "Not reported" && formatted !== "None") return formatted;
  }
  return "Not reported";
}

function formatMoneyDiagnostic(value: unknown) {
  const amount = numberFromUnknown(value);
  if (amount === null) return formatDiagnosticValue(value);
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDiagnosticValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not reported";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length ? value.map((item) => String(item)).join(", ") : "None";
  return JSON.stringify(value);
}

function getAnnotationSelectionKey(annotation: CitationDensityAnnotationMetadata) {
  return `${annotation.findingId}::${annotation.anchorId || annotation.sourceAnchorId || annotation.markerNumber}`;
}

function formatSourceEstimate(annotation: CitationDensityAnnotationMetadata) {
  const role = annotation.sourceDocumentRole || "carrier";
  const id = annotation.sourceDocumentId ? ` (${annotation.sourceDocumentId})` : "";
  if (role === "both") return `Both estimates${id}`;
  return `${role[0].toUpperCase()}${role.slice(1)} estimate${id}`;
}
