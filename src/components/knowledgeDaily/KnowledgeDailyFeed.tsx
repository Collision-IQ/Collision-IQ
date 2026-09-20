import type { ReactNode } from "react";
import {
  formatKnowledgeDailyDate,
  type KnowledgeDailyEntry,
  type KnowledgeDailySourceKind,
} from "@/lib/knowledgeDaily/entries";

/**
 * Knowledge Base Daily feed. Pure markup (no hooks, no router) so it renders
 * identically on the server, in the page, and under test. Every link here is
 * a document or article the reader leaves the workspace for, so ALL of them
 * open in a new tab — the test asserts it.
 */

const SOURCE_KIND_LABEL: Record<KnowledgeDailySourceKind, string> = {
  primary: "Primary document",
  coverage: "Coverage",
  reference: "Reference",
};

export function ExternalLink({
  href,
  className,
  children,
  title,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} title={title}>
      {children}
    </a>
  );
}

export function KnowledgeDailyCard({ entry }: { entry: KnowledgeDailyEntry }) {
  return (
    <article
      id={entry.slug}
      data-entry-number={entry.entryNumber}
      className="ci-panel scroll-mt-24 overflow-hidden"
    >
      <div className="grid grid-cols-1 gap-0 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-mono uppercase tracking-[0.08em] text-[var(--accent)]">Entry #{entry.entryNumber}</span>
            <time dateTime={entry.date}>{formatKnowledgeDailyDate(entry.date)}</time>
            <span className="rounded-full border border-border px-2 py-0.5">{entry.category}</span>
          </div>
          <h2 className="mt-3 text-xl font-semibold leading-snug text-foreground">{entry.headline}</h2>
          <div className="mt-4 flex items-baseline gap-3">
            <span className="text-3xl font-bold tracking-tight text-[var(--accent)]">{entry.keyFigure}</span>
            <span className="text-sm text-muted-foreground">{entry.keyFigureLabel}</span>
          </div>
          <div className="mt-4 space-y-3 text-sm leading-relaxed text-foreground/90">
            {entry.summary.map((paragraph) => (
              <p key={paragraph.slice(0, 40)}>{paragraph}</p>
            ))}
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <div className="ci-eyebrow">Why it matters</div>
              <p className="mt-1.5 text-sm leading-relaxed">{entry.whyItMatters}</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <div className="ci-eyebrow">How Collision iQ uses it</div>
              <p className="mt-1.5 text-sm leading-relaxed">{entry.howCollisionIqUsesIt}</p>
            </div>
          </div>
          <div className="mt-5">
            <div className="ci-eyebrow">Sources — open in a new tab</div>
            <ul className="mt-2 space-y-1.5">
              {entry.sources.map((source) => (
                <li key={source.url} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                    {SOURCE_KIND_LABEL[source.kind]}
                  </span>
                  <ExternalLink
                    href={source.url}
                    className="font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                    title={`${source.label} — ${source.publisher} (opens in a new tab)`}
                  >
                    {source.label}
                  </ExternalLink>
                  <span className="text-muted-foreground">{source.publisher}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {entry.tags.map((tag) => (
              <span key={tag} className="rounded-md bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                #{tag}
              </span>
            ))}
          </div>
        </div>
        <div className="border-t border-border bg-muted/30 p-4 md:border-l md:border-t-0">
          <ExternalLink href={entry.image.src} title="Open the card in a new tab">
            {/* Static SVG card; a plain img keeps the feed free of the image optimizer. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={entry.image.src}
              alt={entry.image.alt}
              width={1080}
              height={1350}
              loading="lazy"
              className="mx-auto w-full max-w-[260px] rounded-lg border border-border shadow-sm"
            />
          </ExternalLink>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">Share card · opens in a new tab</p>
        </div>
      </div>
    </article>
  );
}

export default function KnowledgeDailyFeed({ entries }: { entries: KnowledgeDailyEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="ci-panel p-6 text-sm text-muted-foreground">
        No entries have been filed yet. The first one posts the day the platform verifies it.
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {entries.map((entry) => (
        <KnowledgeDailyCard key={entry.slug} entry={entry} />
      ))}
    </div>
  );
}
