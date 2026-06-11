"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, MessageSquareText, X } from "lucide-react";

export type CitationDensityAnnotationMetadata = {
  findingId: string;
  markerNumber: number;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  shortTitle: string;
  estimateLine: string;
  bestAuthority: string;
  authorityStatus: string;
  missingProof: string;
  nextAction: string;
  sourceRefs: string[];
  comment: string;
};

type RenderedPage = {
  pageNumber: number;
  width: number;
  height: number;
  pdfWidth: number;
  pdfHeight: number;
};

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
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>());
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(annotations[0]?.findingId ?? null);
  const [error, setError] = useState<string | null>(null);
  const selected = useMemo(
    () => annotations.find((annotation) => annotation.findingId === selectedId) ?? annotations[0] ?? null,
    [annotations, selectedId]
  );

  useEffect(() => {
    let cancelled = false;
    async function renderPdf() {
      setError(null);
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const pdf = await pdfjs.getDocument({
        url: pdfUrl,
        disableWorker: true,
        useSystemFonts: true,
      } as unknown as Parameters<typeof pdfjs.getDocument>[0]).promise;
      const nextPages: RenderedPage[] = [];

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        if (cancelled) return;
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.25 });
        nextPages.push({
          pageNumber,
          width: viewport.width,
          height: viewport.height,
          pdfWidth: viewport.width / 1.25,
          pdfHeight: viewport.height / 1.25,
        });
      }

      if (cancelled) return;
      setPages(nextPages);
      await new Promise((resolve) => requestAnimationFrame(resolve));

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        if (cancelled) return;
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.25 });
        const canvas = canvasRefs.current.get(pageNumber);
        if (!canvas) continue;
        const context = canvas.getContext("2d");
        if (!context) continue;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvas, canvasContext: context, viewport }).promise;
      }
    }

    renderPdf().catch((renderError) => {
      if (!cancelled) {
        setError(renderError instanceof Error ? renderError.message : "PDF preview failed.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

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
            {error ? (
              <div className="rounded-md border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">{error}</div>
            ) : null}
            <div className="mx-auto flex w-fit max-w-full flex-col gap-4">
              {Array.from({ length: Math.max(1, pages.length || 1) }, (_, index) => {
                const pageNumber = index + 1;
                const page = pages.find((item) => item.pageNumber === pageNumber);
                const pageAnnotations = annotations.filter((annotation) => annotation.pageNumber === pageNumber);
                return (
                  <div
                    key={pageNumber}
                    className="relative bg-white shadow-2xl"
                    style={{ width: page?.width ?? 765, height: page?.height ?? 990 }}
                  >
                    <canvas
                      ref={(canvas) => {
                        if (canvas) canvasRefs.current.set(pageNumber, canvas);
                      }}
                      className="block h-full w-full"
                    />
                    {page ? pageAnnotations.map((annotation) => {
                      const scaleX = page.width / page.pdfWidth;
                      const scaleY = page.height / page.pdfHeight;
                      const left = annotation.x * scaleX;
                      const top = (page.pdfHeight - annotation.y - annotation.height) * scaleY;
                      return (
                        <button
                          key={annotation.findingId}
                          type="button"
                          onClick={() => setSelectedId(annotation.findingId)}
                          className="absolute rounded-[3px] border border-amber-600/80 bg-amber-300/25 text-left outline-none ring-offset-2 ring-offset-neutral-900 transition hover:bg-amber-300/40 focus-visible:ring-2 focus-visible:ring-amber-300"
                          style={{
                            left,
                            top,
                            width: Math.max(22, annotation.width * scaleX),
                            height: Math.max(16, annotation.height * scaleY),
                          }}
                          aria-label={`Open Citation Density finding ${annotation.markerNumber}`}
                        >
                          <span className="absolute -left-2 -top-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-700 px-1 text-[10px] font-bold leading-none text-white">
                            {annotation.markerNumber}
                          </span>
                        </button>
                      );
                    }) : null}
                  </div>
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
                <Detail label="Best authority" value={selected.bestAuthority} />
                <Detail label="Authority status" value={selected.authorityStatus} />
                <Detail label="Missing proof" value={selected.missingProof} />
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
