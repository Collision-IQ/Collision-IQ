"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Loader2, RefreshCw, X } from "lucide-react";

export type DamagePreviewImage = { attachmentId: string; filename: string };

type Props = {
  /** Vision-capable image attachments (already uploaded to this case). */
  images: DamagePreviewImage[];
};

// Exclude post-teardown / in-process / technician / document-type photos so the
// preview shows the best OVERALL pre-teardown damage view.
const EXCLUDE = /teardown|tear[\s_-]?down|in[\s_-]?proc|in[\s_-]?process|during|post[\s_-]?repair|after|\btech\b|technician|scan|calibrat|invoice|estimate|work[\s_-]?auth|receipt|document|refinish|\bpaint\b/i;
const PREFER = /damage|impact|overall|dmg|\bdv\b|quarter|bumper|fender|door|panel|rocker|rear|front|left|right|side|exterior/i;

function pickPreTeardownDamagePhotos(images: DamagePreviewImage[]): DamagePreviewImage[] {
  const kept = images.filter((i) => !EXCLUDE.test(i.filename));
  const pool = kept.length > 0 ? kept : images;
  // Prefer names that read like an exterior damage view, keep upload order otherwise.
  return [...pool].sort((a, b) => (PREFER.test(b.filename) ? 1 : 0) - (PREFER.test(a.filename) ? 1 : 0));
}

type HeatResult = { dataUrl: string | null; url: string | null; summary: string; disclaimer: string };

export default function DamagePreviewPanel({ images }: Props) {
  const candidates = useMemo(() => pickPreTeardownDamagePhotos(images), [images]);
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<HeatResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const generatedForRef = useRef<string | null>(null);

  const current = candidates[index];

  const generate = useCallback(async (attachmentId: string) => {
    setLoading(true);
    setError(null);
    generatedForRef.current = attachmentId;
    try {
      const res = await fetch("/api/vision/annotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attachmentId,
          annotationStyle: "heatmap",
          prompt: "Best overall pre-teardown damage view — highlight the concentration of visible exterior damage.",
        }),
      });
      if (!res.ok) {
        setError(
          res.status === 503
            ? "Damage heat map isn't configured right now."
            : "Couldn't generate the damage heat map."
        );
        setResult(null);
        return;
      }
      const data = (await res.json()) as {
        annotatedImageDataUrl?: string | null;
        annotatedImageUrl?: string | null;
        summary?: string;
        disclaimer?: string;
      };
      setResult({
        dataUrl: data.annotatedImageDataUrl ?? null,
        url: data.annotatedImageUrl ?? null,
        summary: data.summary ?? "",
        disclaimer: data.disclaimer ?? "AI visual aid — visible damage heat map only. Not a forensic measurement.",
      });
    } catch {
      setError("Couldn't generate the damage heat map.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-generate once for the chosen photo when images first arrive.
  useEffect(() => {
    if (!current) return;
    if (generatedForRef.current === current.attachmentId) return;
    void generate(current.attachmentId);
  }, [current, generate]);

  const previewSrc = result?.url || result?.dataUrl || null;
  const downloadSrc = result?.dataUrl || result?.url || null;

  const cyclePhoto = () => {
    if (candidates.length < 2) return;
    const next = (index + 1) % candidates.length;
    setIndex(next);
    setResult(null);
    void generate(candidates[next].attachmentId);
  };

  return (
    <div className="ci-panel flex min-h-0 flex-col p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="ci-eyebrow">Damage Preview</div>
        {candidates.length > 0 ? (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span>
              {candidates.length > 1 ? `Photo ${index + 1} of ${candidates.length}` : "Best pre-teardown view"}
            </span>
            {candidates.length > 1 ? (
              <button type="button" onClick={cyclePhoto} className="rounded p-1 hover:bg-muted" title="Next photo">
                <RefreshCw size={12} />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 items-center gap-3">
        <button
          type="button"
          onClick={() => previewSrc && setFullscreen(true)}
          className="relative h-[104px] w-[168px] shrink-0 cursor-pointer overflow-hidden rounded-lg border border-border bg-muted disabled:cursor-default"
          aria-label="Open full damage preview"
          disabled={!previewSrc}
        >
          {loading ? (
            <span className="flex h-full w-full items-center justify-center text-muted-foreground">
              <Loader2 size={18} className="animate-spin" />
            </span>
          ) : previewSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewSrc} alt="Damage heat map" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center px-2 text-center text-[10px] text-muted-foreground">
              {candidates.length === 0 ? "No damage photos yet" : "Preparing…"}
            </span>
          )}
        </button>

        <div className="min-w-0 flex-1 text-xs text-muted-foreground">
          {candidates.length === 0 ? (
            <p>Upload vehicle photos to see an auto-generated damage heat map here.</p>
          ) : error ? (
            <>
              <p className="text-amber-600 dark:text-amber-400">{error}</p>
              {current ? (
                <button
                  type="button"
                  onClick={() => generate(current.attachmentId)}
                  className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-[11px] hover:bg-background"
                >
                  <RefreshCw size={11} /> Retry
                </button>
              ) : null}
            </>
          ) : (
            <>
              <p className="truncate font-medium text-foreground" title={current?.filename}>
                {current?.filename}
              </p>
              <p className="mt-0.5">Auto heat map of the strongest visible exterior damage. AI visual aid.</p>
              {previewSrc ? (
                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setFullscreen(true);
                      // Temporary diagnostic: confirms the handler fires and whether
                      // the lightbox actually mounts / where it lands in the stack.
                      console.log("[damage-preview] Full preview clicked; previewSrc?", Boolean(previewSrc));
                      setTimeout(() => {
                        const dlg = document.querySelector("[data-damage-lightbox]");
                        console.log(
                          "[damage-preview] lightbox mounted?",
                          Boolean(dlg),
                          dlg ? "z=" + getComputedStyle(dlg).zIndex : ""
                        );
                      }, 150);
                    }}
                    className="inline-flex cursor-pointer items-center rounded-md border border-border bg-muted px-2 py-1 text-[11px] hover:bg-background"
                  >
                    Full preview
                  </button>
                  {downloadSrc ? (
                    <a
                      href={downloadSrc}
                      download={`damage-heatmap-${current?.filename || "photo"}.png`}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-[11px] hover:bg-background"
                    >
                      <Download size={11} /> Download
                    </a>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {fullscreen
        ? createPortal(
            <div
              data-damage-lightbox
              className="fixed inset-0 z-[10050] flex flex-col items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
              role="dialog"
              aria-modal="true"
              onClick={() => setFullscreen(false)}
            >
              <div className="flex max-h-full max-w-4xl flex-col gap-3" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between text-card">
                  <span className="text-sm font-medium text-white">{current?.filename}</span>
                  <div className="flex items-center gap-2">
                    {downloadSrc ? (
                      <a
                        href={downloadSrc}
                        download={`damage-heatmap-${current?.filename || "photo"}.png`}
                        className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20"
                      >
                        <Download size={14} /> Download
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setFullscreen(false)}
                      className="inline-flex items-center rounded-md bg-white/10 p-1.5 text-white hover:bg-white/20"
                      aria-label="Close preview"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
                {previewSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewSrc} alt="Damage heat map — full preview" className="max-h-[80vh] rounded-lg object-contain" />
                ) : (
                  <p className="px-8 py-16 text-center text-sm text-white/80">Preparing the heat map…</p>
                )}
                <p className="text-center text-[11px] text-white/70">{result?.disclaimer}</p>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
