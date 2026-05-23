"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

export type PreviewAttachment = {
  attachmentId: string;
  filename: string;
  mime: string;
  text: string;
  imageDataUrl?: string;
  previewUrl?: string;
  pageCount?: number;
  source: "file" | "camera";
  hasVision: boolean;
  usedInAnalysis?: boolean;
};

type AttachmentPreviewModalProps = {
  attachment: PreviewAttachment | null;
  attachments: PreviewAttachment[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (direction: "previous" | "next") => void;
  onRemove: (attachmentId: string) => void;
  onReplace: (attachmentId: string) => void;
};

export default function AttachmentPreviewModal({
  attachment,
  attachments,
  currentIndex,
  onClose,
  onNavigate,
  onRemove,
  onReplace,
}: AttachmentPreviewModalProps) {
  const [zoomState, setZoomState] = useState<{ attachmentId: string | null; zoom: number }>({
    attachmentId: null,
    zoom: 1,
  });

  useEffect(() => {
    if (!attachment) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key === "ArrowLeft" && currentIndex > 0) {
        event.preventDefault();
        onNavigate("previous");
        return;
      }

      if (event.key === "ArrowRight" && currentIndex < attachments.length - 1) {
        event.preventDefault();
        onNavigate("next");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [attachment, attachments.length, currentIndex, onClose, onNavigate]);

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

  const zoom =
    zoomState.attachmentId === attachment.attachmentId ? zoomState.zoom : 1;
  const setZoom = (updater: number | ((value: number) => number)) => {
    setZoomState((current) => {
      const currentZoom =
        current.attachmentId === attachment.attachmentId ? current.zoom : 1;
      const nextZoom =
        typeof updater === "function"
          ? updater(currentZoom)
          : updater;

      return {
        attachmentId: attachment.attachmentId,
        zoom: nextZoom,
      };
    });
  };

  const canZoom = previewKind === "image";
  const hasTextPreview = structuredTextPreview.length > 0;
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < attachments.length - 1;
  const modal = (
    <div className="fixed inset-0 z-[120] bg-black/78 backdrop-blur-sm">
      <div className="flex h-full w-full items-center justify-center p-1 sm:p-4">
        <div className="flex h-full min-h-0 w-full max-w-[1700px] flex-col overflow-hidden border border-white/10 bg-[#0b0b0b] shadow-2xl sm:max-h-[calc(100vh-2.5rem)] sm:w-[98vw] sm:rounded-[24px]">
          <div className="shrink-0 border-b border-white/10 px-3 py-3 sm:px-5 sm:py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-white">{attachment.filename}</div>
              <div className="mt-1 text-xs uppercase tracking-[0.18em] text-white/45">
                {formatMimeLabel(attachment.mime)}
                {attachment.mime === "application/pdf" && attachment.pageCount
                  ? ` - ${attachment.pageCount} page${attachment.pageCount === 1 ? "" : "s"}`
                  : ""}
                {attachment.usedInAnalysis ? " - Used in analysis" : " - Uploaded"}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {attachments.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => onNavigate("previous")}
                    disabled={!hasPrevious}
                    className="min-h-10 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/70 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <ChevronLeft size={14} />
                      Previous
                    </span>
                  </button>
                  <div className="min-w-[68px] text-center text-xs text-white/55">
                    {currentIndex + 1} of {attachments.length}
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate("next")}
                    disabled={!hasNext}
                    className="min-h-10 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/70 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      Next
                      <ChevronRight size={14} />
                    </span>
                  </button>
                </>
              )}
              {canZoom && (
                <>
                  <button
                    type="button"
                    onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))}
                    className="min-h-10 min-w-10 rounded-lg border border-white/10 bg-white/5 p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
                    aria-label="Zoom out"
                  >
                    <ZoomOut size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
                    className="min-h-10 min-w-10 rounded-lg border border-white/10 bg-white/5 p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
                    aria-label="Zoom in"
                  >
                    <ZoomIn size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom(1)}
                    className="min-h-10 min-w-10 rounded-lg border border-white/10 bg-white/5 p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
                    aria-label="Reset zoom"
                  >
                    <RotateCcw size={16} />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={onClose}
                className="min-h-10 min-w-10 rounded-lg border border-white/10 bg-white/5 p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
                aria-label="Back to chat"
                title="Back to chat"
              >
                <X size={16} />
              </button>
            </div>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(320px,28vw)] xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-h-0 min-w-0 bg-black/30 p-2 sm:p-4">
              <div className="h-full min-h-0 overflow-hidden border border-white/8 bg-black/40 sm:rounded-[18px]">
              {previewKind === "pdf" ? (
                attachment.previewUrl ? (
                  <iframe
                    title={attachment.filename}
                    src={attachment.previewUrl}
                    className="h-full min-h-0 w-full"
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
                  <div className="flex h-full min-h-0 items-center justify-center overflow-auto p-6">
                    <Image
                      src={attachment.imageDataUrl}
                      alt={attachment.filename}
                      width={1600}
                      height={1200}
                      unoptimized
                      className="h-auto max-h-full max-w-full rounded-xl border border-white/10 object-contain shadow-xl transition-transform duration-150"
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
            </div>

            <div className="flex min-h-0 min-w-0 flex-col border-t border-white/10 bg-white/5 lg:border-l lg:border-t-0">
              <div className="min-h-0 flex-1 overflow-auto p-5">
                <div className="space-y-5">
                  <section className="space-y-2">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-white/45">File</div>
                    <div className="rounded-xl border border-white/10 bg-black/25 p-4 text-sm text-white/80">
                      <div className="truncate">{attachment.filename}</div>
                      <div className="mt-2 text-xs text-white/45">{formatMimeLabel(attachment.mime)}</div>
                      {attachment.mime === "application/pdf" && attachment.pageCount ? (
                        <div className="mt-1 text-xs text-white/45">
                          Pages: {attachment.pageCount}
                        </div>
                      ) : null}
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
                </div>
              </div>

              <div className="shrink-0 border-t border-white/8 p-5">
                <div className="space-y-2">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-white/45">Actions</div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/10"
                  >
                    Back to Chat
                  </button>
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
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
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
