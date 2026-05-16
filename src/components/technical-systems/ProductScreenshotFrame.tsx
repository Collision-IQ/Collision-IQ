"use client";

import Image from "next/image";
import { useEffect, useId, useState } from "react";

type ScreenshotAsset = {
  src: string;
  alt: string;
  title: string;
  caption: string;
  width: number;
  height: number;
};

type ProductScreenshotFrameProps = {
  asset: ScreenshotAsset;
  compact?: boolean;
  priority?: boolean;
};

export function ProductScreenshotFrame({
  asset,
  compact = false,
  priority = false,
}: ProductScreenshotFrameProps) {
  const [isOpen, setIsOpen] = useState(false);
  const titleId = useId();
  const captionId = useId();

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  return (
    <>
      <figure className="overflow-hidden rounded-3xl border border-border bg-card">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C65A2A] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label={`Enlarge ${asset.title}`}
        >
          <div className="flex items-center gap-1.5 border-b border-border bg-muted px-3 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#C65A2A]" />
            <span className="h-2.5 w-2.5 rounded-full bg-border" />
            <span className="h-2.5 w-2.5 rounded-full bg-border" />
            <span className="ml-auto text-xs font-medium text-muted-foreground">
              Enlarge
            </span>
          </div>
          <div className={`relative bg-background ${compact ? "aspect-[4/3]" : "aspect-[16/10]"}`}>
            <Image
              src={asset.src}
              alt={asset.alt}
              fill
              priority={priority}
              sizes={compact ? "(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw" : "(min-width: 1024px) 50vw, 100vw"}
              className="object-contain p-3 transition duration-200 hover:scale-[1.01]"
            />
          </div>
        </button>
        <figcaption className="border-t border-border p-4">
          <div className="text-sm font-semibold text-foreground">{asset.title}</div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{asset.caption}</p>
        </figcaption>
      </figure>

      {isOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm md:p-8"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={captionId}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsOpen(false);
            }
          }}
        >
          <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl border border-white/15 bg-background shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border bg-card px-4 py-3 md:px-5">
              <div>
                <h2 id={titleId} className="text-sm font-semibold text-foreground md:text-base">
                  {asset.title}
                </h2>
                <p id={captionId} className="mt-1 text-xs leading-5 text-muted-foreground md:text-sm">
                  {asset.caption}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="shrink-0 rounded-full border border-border bg-background px-3 py-1.5 text-sm font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C65A2A]"
              >
                Close
              </button>
            </div>
            <div className="relative min-h-[58vh] bg-black md:min-h-[72vh]">
              <Image
                src={asset.src}
                alt={asset.alt}
                fill
                sizes="100vw"
                className="object-contain p-2 md:p-6"
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
