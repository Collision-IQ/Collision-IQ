"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Image as ImageIcon, X, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

export type PreviewAttachment = {
  attachmentId: string;
  filename: string;
  mime: string;
  text: string;
  imageDataUrl?: string;
  previewUrl?: string;
  source: "file" | "camera";
  hasVision: boolean;
  usedInAnalysis?: boolean;
};

type AttachmentPreviewModalProps = {
  attachment: PreviewAttachment | null;
  onClose: () => void;
  onRemove: (attachmentId: string) => void;
  onReplace: (attachmentId: string) => void;
};

export default function AttachmentPreviewModal({
  attachment,
  onClose,
  onRemove,
  onReplace,
}: AttachmentPreviewModalProps) {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    setZoom(1);
  }, [attachment?.attachmentId]);

  useEffect(() => {
    if (!attachment) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [attachment, onClose]);

  const previewKind = useMemo(() => {
    if (!attachment) return "text";
    if (attachment.mime === "application/pdf") return "pdf";
    if (attachment.mime.startsWith("image/")) return "image";
    return "text";
  }, [attachment]);

  const structuredTextPreview = useMemo(() => {
    if (!attachment?.text?.trim()) return [];

    return attachment.text
      .replace(/\r/g, "")
      .split(/\n\s*\n/)
      .map((block) => block.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 10);
  }, [attachment]);

  if (!attachment) return null;

  const canZoom = previewKind === "image";
  const hasTextPreview = structuredTextPreview.length > 0;

  return (
    <div className="fixed inset-0 z-[80] bg-black/85 backdrop-blur-md">
      <div className="flex h-full w-full items-center justify-center p-4 sm:p-6">
        <div className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111111] shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-white">{attachment.filename}</div>
              <div className="mt-1 text-xs uppercase tracking-[0.18em] text-white/45">
                {formatMimeLabel(attachment.mime)}
                {attachment.usedInAnalysis ? " - Used in analysis" : " - Uploaded"}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {canZoom && (
                <>
                  <button
                    type="button"
                    onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))}
                    className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
                    aria-label="Zoom out"
                  >
                    <ZoomOut size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
                    className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
                    aria-label="Zoom in"
                  >
                    <ZoomIn size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom(1)}
                    className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
                    aria-label="Reset zoom"
                  >
                    <RotateCcw size={16} />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
                aria-label="Close preview"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1.4fr)_380px]">
            <div className="min-h-0 overflow-auto bg-black/30">
              {previewKind === "pdf" ? (
                attachment.previewUrl ? (
                  <iframe
                    title={attachment.filename}
                    src={attachment.previewUrl}
                    className="h-full min-h-[480px] w-full"
                  />
                ) : (
                  <EmptyPreviewState
                    icon={<FileText size={28} />}
                    title="PDF preview unavailable"
                    body="This file can still be used in analysis, but a live PDF view is not available for this upload."
                  />
                )
              ) : previewKind === "image" ? (
                attachment.imageDataUrl ? (
                  <div className="flex min-h-full items-start justify-center overflow-auto p-6">
                    <img
                      src={attachment.imageDataUrl}
                      alt={attachment.filename}
                      className="max-w-full rounded-xl border border-white/10 shadow-xl transition-transform duration-150"
                      style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
                    />
                  </div>
                ) : (
                  <EmptyPreviewState
                    icon={<ImageIcon size={28} />}
                    title="Image preview unavailable"
                    body="This upload does not include an image preview, but it remains attached for chat and analysis."
                  />
                )
              ) : (
                <div className="h-full overflow-auto p-6">
                  <TextPreview paragraphs={structuredTextPreview} />
                </div>
              )}
            </div>

            <div className="min-h-0 overflow-auto border-t border-white/10 bg-white/5 p-5 lg:border-l lg:border-t-0">
              <div className="space-y-5">
                <section className="space-y-2">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-white/45">File</div>
                  <div className="rounded-xl border border-white/10 bg-black/25 p-4 text-sm text-white/80">
                    <div className="truncate">{attachment.filename}</div>
                    <div className="mt-2 text-xs text-white/45">{formatMimeLabel(attachment.mime)}</div>
                    <div className="mt-1 text-xs text-white/45">
                      Source: {attachment.source === "camera" ? "Camera" : "Upload"}
                    </div>
                    <div className="mt-1 text-xs text-white/45">
                      Analysis: {attachment.usedInAnalysis ? "Used in current analysis" : "Not yet used in current analysis"}
                    </div>
                  </div>
                </section>

                {hasTextPreview && (
                  <section className="space-y-2">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-white/45">Extracted Text Preview</div>
                    <TextPreview paragraphs={structuredTextPreview.slice(0, 5)} compact />
                  </section>
                )}

                <section className="space-y-2">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-white/45">Actions</div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => onReplace(attachment.attachmentId)}
                      className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/10"
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(attachment.attachmentId)}
                      className="flex-1 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300 transition hover:bg-red-500/15"
                    >
                      Remove
                    </button>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TextPreview({
  paragraphs,
  compact = false,
}: {
  paragraphs: string[];
  compact?: boolean;
}) {
  if (paragraphs.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/25 p-4 text-sm text-white/55">
        No extracted text is available for this file.
      </div>
    );
  }

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {paragraphs.map((paragraph, index) => (
        <div
          key={`${paragraph.slice(0, 40)}-${index}`}
          className="rounded-xl border border-white/10 bg-black/25 p-4 text-sm leading-6 text-white/80"
        >
          {paragraph}
        </div>
      ))}
    </div>
  );
}

function EmptyPreviewState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/65">
        {icon}
      </div>
      <div className="mt-4 text-base font-semibold text-white">{title}</div>
      <div className="mt-2 max-w-md text-sm leading-6 text-white/60">{body}</div>
    </div>
  );
}

function formatMimeLabel(mime: string): string {
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return mime.replace("image/", "").toUpperCase();
  if (mime.startsWith("text/")) return "Text";
  return mime || "Unknown";
}
