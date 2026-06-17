"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Download, MessageSquareText, X } from "lucide-react";

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

export const PDF_VIEWER_INITIALIZATION_ERROR =
  "PDF viewer failed to initialize. Download the PDF instead.";

export default function CitationDensityAnnotationViewer({
  pdfUrl,
  annotations,
  onClose,
  onAsk,
}: {
  pdfUrl: string;
  annotations: CitationDensityAnnotationMetadata[];
  onClose: () => void;
  onAsk?: (annotation: CitationDensityAnnotationMetadata) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(annotations[0] ? getAnnotationSelectionKey(annotations[0]) : null);
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

  const modal = (
    <div className="fixed inset-0 z-[80] bg-black/72 text-white">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-neutral-950 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">Citation Density annotated estimate</div>
            <div className="text-xs text-white/50">{annotations.length} marked finding{annotations.length === 1 ? "" : "s"}</div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={pdfUrl}
              className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-white/10 bg-white/5 p-2 text-white/75 transition hover:bg-white/10 hover:text-white"
              aria-label="Download PDF"
              title="Download PDF"
            >
              <Download size={16} />
            </a>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-white/10 bg-white/5 p-2 text-white/75 transition hover:bg-white/10 hover:text-white"
              aria-label="Close viewer"
              title="Close viewer"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-h-0 overflow-auto bg-neutral-900 p-3">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
              <div className="rounded-md border border-white/10 bg-white/5 p-4 text-sm leading-6 text-white/72">
                PDF preview is temporarily disabled. Download the annotated PDF to view marked estimate lines.
              </div>
              {annotations.map((annotation) => {
                const selectionKey = getAnnotationSelectionKey(annotation);
                return (
                  <button
                    key={selectionKey}
                    type="button"
                    onClick={() => setSelectedId(selectionKey)}
                    className={[
                      "rounded-md border p-3 text-left transition",
                      effectiveSelectedId === selectionKey
                        ? "border-amber-300/70 bg-amber-300/15"
                        : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
                    ].join(" ")}
                  >
                    <div className="text-xs uppercase text-white/45">
                      Finding {annotation.markerNumber} · Page {annotation.pageNumber}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-white">{annotation.shortTitle}</div>
                    <div className="mt-1 text-xs text-white/55">{annotation.label}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <aside className="min-h-0 overflow-auto border-t border-white/10 bg-neutral-950 p-5 lg:border-l lg:border-t-0">
            {selected ? (
              <div className="space-y-5">
                <div>
                  <div className="text-xs uppercase text-white/45">Finding {selected.markerNumber}</div>
                  <h2 className="mt-1 text-base font-semibold">{selected.shortTitle}</h2>
                  <div className="mt-2 inline-flex rounded-md bg-amber-300/15 px-2 py-1 text-xs font-semibold text-amber-100">
                    {selected.label}
                  </div>
                </div>
                <Detail label="Estimate line" value={selected.estimateLine} />
                <Detail label="Page" value={String(selected.pageNumber)} />
                <Detail label="Source estimate" value={formatSourceEstimate(selected)} />
                <Detail label="Anchor" value={selected.targetLineNumber ? `Line ${selected.targetLineNumber}` : selected.targetSection || selected.anchorType || "Estimate row"} />
                <Detail label="Best authority" value={selected.bestAuthority} />
                <Detail label="Authority status" value={selected.authorityStatus} />
                <Detail label="Missing proof" value={selected.missingProof} />
                <Detail label="Why it matters" value={selected.whyItMatters || selected.comment} />
                <Detail label="Next action" value={selected.nextAction} />
                {selected.sourceRefs.length ? (
                  <div>
                    <div className="text-xs uppercase text-white/45">Source refs</div>
                    <div className="mt-2 space-y-2 text-sm text-white/78">
                      {selected.sourceRefs.map((ref) => <div key={ref}>{ref}</div>)}
                    </div>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => onAsk?.(selected)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-white/8 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/12"
                >
                  <MessageSquareText size={16} />
                  Ask about this finding
                </button>
              </div>
            ) : (
              <div className="text-sm text-white/55">Select a highlighted estimate line to view finding detail.</div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase text-white/45">{label}</div>
      <div className="mt-1 text-sm leading-6 text-white/82">{value || "Not specified"}</div>
    </div>
  );
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
