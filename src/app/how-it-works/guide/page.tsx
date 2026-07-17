import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Camera, FileText, MessageSquareText, ScanLine, Sparkles, Zap } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata = {
  title: "How to use Collision IQ — Quick-Start Guide",
  description:
    "One page to get the most out of Collision IQ: Quick vs Researched answers, uploads, full case analysis, reports, and Scan IQ.",
};

type GuideBlock = {
  icon: typeof Zap;
  title: string;
  body: string;
  tryThis: string;
  proTip: string;
  mistake: string;
};

const GUIDE_BLOCKS: GuideBlock[] = [
  {
    icon: Zap,
    title: "Chat — Quick answers",
    body: "The default mode. Ask anything about collision repair, your claim, or your uploads and get a fast, conversational answer in seconds.",
    tryThis: '"Is a post-repair scan needed on this car?"',
    proTip: "Quick mode is built for speed — short questions get short, direct answers. Follow-ups keep the case context.",
    mistake: "Expecting verified source citations in Quick mode — that's what Researched Answer is for.",
  },
  {
    icon: Sparkles,
    title: "Researched Answer (paid)",
    body: "Flip the Researched toggle in the composer to bring in verified sources — OEM procedures, position statements, and industry references — with full-depth reasoning.",
    tryThis: 'Toggle on, then ask "What OEM support exists for replacing this quarter panel?"',
    proTip: "The toggle is sticky — set it once and it stays until you switch back.",
    mistake: "Leaving it on for casual questions. Researched answers take longer because they actually go check sources.",
  },
  {
    icon: Camera,
    title: "Uploads & suggested actions",
    body: "Drop photos, estimates, or documents into chat. Files appear as chips above the composer with one-tap suggested prompts, and the AI answers conversationally about what it sees.",
    tryThis: "Upload a damage photo and tap “Assess the damage.”",
    proTip: "Upload related files together — the AI reads them as one case, not isolated documents.",
    mistake: "Re-uploading the same file to ask another question. It's already in the conversation — just ask.",
  },
  {
    icon: FileText,
    title: "Full case analysis",
    body: "With Researched Answer on, uploading files runs the complete case pipeline: vision review, damage detectors, evidence indexing, and the report set in the right rail.",
    tryThis: "Researched on → upload the estimate plus photos → “Review this estimate.”",
    proTip: "Add scan reports, invoices, and teardown photos — every document raises the citation density of your reports.",
    mistake: "Expecting an appraisal-grade determination from a single photo. Visible damage is a starting point, not the amount of loss.",
  },
  {
    icon: MessageSquareText,
    title: "Reports",
    body: "Generate reports from the right rail: Repair Intelligence for professionals, Delta and OEM Citation Density for estimate disputes, Customer Report in plain English, plus Snapshot and DOI packets.",
    tryThis: "After a case analysis, open the Customer Report and email it directly.",
    proTip: "Regenerate reports after new evidence lands — the annotated estimates update with the fresh findings.",
    mistake: "Sending a report while the review shows 0 files reviewed. Check the Claim Command Center first.",
  },
  {
    icon: ScanLine,
    title: "Scan IQ (Pro)",
    body: "Upload a pre-repair scan and a post-repair scan; Collision IQ extracts the diagnostic codes, compares them, and flags anything cleared, remaining, or new — with MOTOR DTC support where available.",
    tryThis: "Drop both scan exports and hit Compare scans.",
    proTip: "A text or PDF export from the scan tool reads best. Image-only PDFs work too — they're OCR'd automatically.",
    mistake: "Uploading a dealer service invoice as the post-scan. It documents work, but it isn't a code-scan report.",
  },
];

export default function QuickStartGuidePage() {
  return (
    <div className="min-h-[100svh] bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-card px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Link
            href="/how-it-works"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={16} /> How Collision IQ Works
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

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-bold">How to use Collision IQ</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          One page, six features. Quick answers are instant and free; the deep, verified-source work runs when you
          ask for it.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          {GUIDE_BLOCKS.map((block) => (
            <section key={block.title} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-2.5">
                <block.icon size={18} className="shrink-0 text-[var(--accent)]" />
                <h2 className="text-base font-semibold">{block.title}</h2>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{block.body}</p>
              <div className="mt-3 space-y-2 text-sm">
                <div className="rounded-lg bg-muted px-3 py-2">
                  <span className="font-medium">Try this:</span>{" "}
                  <span className="text-muted-foreground">{block.tryThis}</span>
                </div>
                <div className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 py-2">
                  <span className="font-medium text-[var(--accent)]">Pro tip:</span>{" "}
                  <span className="text-muted-foreground">{block.proTip}</span>
                </div>
                <div className="rounded-lg border border-border px-3 py-2">
                  <span className="font-medium">Common mistake:</span>{" "}
                  <span className="text-muted-foreground">{block.mistake}</span>
                </div>
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
