import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import KnowledgeDailyFeed, { ExternalLink } from "@/components/knowledgeDaily/KnowledgeDailyFeed";
import { formatKnowledgeDailyDate, getKnowledgeDailyEntries } from "@/lib/knowledgeDaily/entries";

// Entries are filed a week ahead and date-gated; revalidate so each day's entry
// surfaces on its day without a redeploy.
export const revalidate = 3600;

export const metadata = {
  title: "The Daily iQ — what Collision IQ learned",
  description:
    "One numbered, sourced entry per day: the position statements, industry data, and rulings Collision IQ files into its knowledge base and now cites.",
};

export default function KnowledgeDailyPage() {
  const entries = getKnowledgeDailyEntries();
  const latest = entries[0] ?? null;

  return (
    <div className="min-h-[100svh] bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-card px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Link href="/collision-iq-v2" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft size={16} /> Back to workspace
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative hidden h-6 w-[112px] sm:block">
            <Image src="/iq/iq_logo.png" alt="Collision IQ" fill sizes="112px" className="object-contain dark:hidden" />
            <Image src="/iq/iq_logo-white.png" alt="Collision IQ" fill sizes="112px" className="hidden object-contain dark:block" />
          </span>
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)_240px]">
        {/* Left: entry index */}
        <nav className="hidden lg:block" aria-label="Entries">
          <div className="sticky top-20 space-y-1 text-sm">
            <div className="ci-eyebrow mb-2">The Daily iQ</div>
            {entries.map((entry) => (
              <a key={entry.slug} href={`#${entry.slug}`} className="block rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--accent)]">#{entry.entryNumber}</span>{" "}
                {formatKnowledgeDailyDate(entry.date).replace(/^\w+, /, "")}
              </a>
            ))}
          </div>
        </nav>

        {/* Main feed */}
        <main className="min-w-0 space-y-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">The Daily iQ</h1>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              What Collision IQ learned, one numbered and sourced entry per day. Every fact here was verified the day it was
              filed into the platform&apos;s knowledge base, so the platform argues from the industry&apos;s own documents and
              numbers. Sources and cards open in a new tab.
            </p>
            {latest ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Latest entry: #{latest.entryNumber} · {formatKnowledgeDailyDate(latest.date)}
              </p>
            ) : null}
          </div>
          <KnowledgeDailyFeed entries={entries} />
        </main>

        {/* Right: about + related reading */}
        <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
          <div className="ci-panel p-4">
            <div className="ci-eyebrow">About this series</div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Each entry pairs a verified fact with where it came from and how the platform uses it. Hook wording is the
              social post; figures trace back to the linked sources, and nothing is quoted that the coverage did not disclose.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              The same entries post daily on Instagram, TikTok, and LinkedIn as The Daily iQ series.
            </p>
          </div>
          <div className="ci-panel p-4">
            <div className="ci-eyebrow">Keep learning</div>
            <ul className="mt-2 space-y-1 text-sm">
              <li>
                <ExternalLink href="/how-it-works" className="text-foreground underline-offset-2 hover:underline">
                  How Collision IQ works
                </ExternalLink>
              </li>
              <li>
                <ExternalLink href="/how-it-works/guide" className="text-foreground underline-offset-2 hover:underline">
                  Quick-start guide
                </ExternalLink>
              </li>
              <li>
                <ExternalLink href="https://www.collision.academy/" className="text-foreground underline-offset-2 hover:underline">
                  Collision Academy
                </ExternalLink>
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
