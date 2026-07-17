"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Cpu,
  FileSearch,
  FileText,
  Lightbulb,
  Scale,
  Search,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

const PIPELINE = [
  { icon: UploadCloud, title: "1. Input", body: "You upload estimates, OEM procedures, photos, or documents (PDF, images, or ZIP)." },
  { icon: Cpu, title: "2. Processing", body: "The AI extracts text — OCR'ing scanned/image-only PDFs — indexes it, and understands the case context." },
  { icon: Search, title: "3. Analysis", body: "It compares and validates against OEM procedures, position statements, industry standards, and the documented damage." },
  { icon: Lightbulb, title: "4. Insights", body: "You get clear findings, evidence, citations, and next-step recommendations." },
  { icon: FileText, title: "5. Reports", body: "Generate Repair Intelligence, Delta / OEM Citation Density, and customer/DOI reports, then export or share." },
] as const;

const RESPONSE_STEPS = [
  { icon: Sparkles, title: "Understand your request", body: "The AI interprets your question, intent, and context from the conversation and uploaded files — and the role you're working in (owner, shop, appraiser/attorney, or insurer)." },
  { icon: FileSearch, title: "Search & retrieve relevant information", body: "It searches your uploaded files plus the knowledge base (OEM procedures, bulletins, position statements, industry standards)." },
  { icon: Scale, title: "Analyze & cross-reference", body: "It compares the data to OEM requirements and identifies matches, gaps, and conflicts — holding shops and carriers to the same standard." },
  { icon: CheckCircle2, title: "Generate response with evidence", body: "You receive a clear answer with citations, file references, and links to supporting evidence — and honest labels when something isn't yet proven." },
  { icon: ArrowRight, title: "Suggest next steps", body: "It recommends actions, additional documents to review, or clarifying questions when needed." },
] as const;

const SECTIONS = [
  {
    id: "document-review",
    title: "Document Review Engine",
    body: "Collision IQ reads CCC/Audatex-style estimates line by line — including the concatenated fields and truncated makes those formats produce. Image-only (scanned) PDFs are OCR'd automatically and rebuilt into true table rows so line items, part numbers, prices, and labor are parsed correctly.",
  },
  {
    id: "sources",
    title: "Data & Knowledge Sources",
    body: "Analysis draws on OEM repair procedures and position statements, ADAS/calibration requirements, structural and refinish standards, policy/appraisal language, and jurisdiction-specific authority — layered on top of the evidence you upload.",
  },
  {
    id: "evidence",
    title: "Evidence & Citations",
    body: "Findings are separated by evidence state: documented, referenced-but-not-produced, visible-in-photos, supportable-pending-confirmation, and not-established. A referenced procedure is never treated as a produced record until it's actually provided.",
  },
  {
    id: "delta",
    title: "Delta & OEM Citation Density",
    body: "Comparing two estimates produces a delta ledger that highlights real changes — added operations, expanded scope, changed labor/part/operation — while suppressing unchanged rows. OEM Citation Density ties operations to manufacturer authority, marking anything unretrieved as such rather than treating estimate text as OEM proof.",
  },
  {
    id: "accuracy",
    title: "Accuracy & Confidence",
    body: "Every determination is re-anchored to the uploaded documents, images, and ingested evidence — prior reports are summaries, not source truth. Confidence reflects file completeness, data quality, source reliability, and technical alignment, and OCR-derived material is flagged as verify-against-source.",
  },
  {
    id: "security",
    title: "Security & Privacy",
    body: "Your reports and history are scoped to your account — you only ever see your own analyses. Uploaded files are stored as case evidence and generated visuals are clearly labeled AI visual aids, never presented as forensic measurements.",
  },
  {
    id: "limitations",
    title: "Limitations",
    body: "Collision IQ is a repair-intelligence copilot, not legal or engineering advice. It does not prove hidden damage from photos alone, and outputs should be reviewed and confirmed by a qualified professional before final decisions.",
  },
] as const;

const KEY_BENEFITS = [
  "Fast, accurate analysis",
  "Evidence-based findings",
  "Transparent citations",
  "Professional reports",
  "Secure and private to you",
];

function SectionHeader({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 text-xl font-semibold text-foreground">
      {children}
    </h2>
  );
}

export default function HowItWorksPage() {
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
        {/* Left docs nav */}
        <nav className="hidden lg:block">
          <div className="sticky top-20 space-y-1 text-sm">
            <div className="ci-eyebrow mb-2">How Collision IQ Works</div>
            <Link href="/how-it-works/guide" className="block rounded-md px-2 py-1.5 font-medium text-[var(--accent)] hover:bg-muted">
              Quick-Start Guide →
            </Link>
            <a href="#overview" className="block rounded-md px-2 py-1.5 text-foreground hover:bg-muted">Overview</a>
            <a href="#responds" className="block rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">Chat &amp; Analysis</a>
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="block rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                {s.title}
              </a>
            ))}
          </div>
        </nav>

        {/* Main content */}
        <main className="min-w-0 space-y-10">
          <div>
            <h1 className="text-3xl font-bold text-foreground">How Collision IQ Works</h1>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              Collision IQ is your AI-powered repair-intelligence copilot. It analyzes estimates, procedures,
              photos, and documents to deliver accurate, evidence-based insights and strategy recommendations.
            </p>
          </div>

          <section className="space-y-4">
            <SectionHeader id="overview">Overview</SectionHeader>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Collision IQ combines advanced AI reasoning with a deep library of OEM procedures, position
              statements, and industry data to deliver fast, accurate, and defensible repair analysis.
            </p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {PIPELINE.map((step) => {
                const Icon = step.icon;
                return (
                  <div key={step.title} className="ci-card rounded-xl border border-border bg-card p-4 text-center">
                    <Icon className="mx-auto mb-2 text-[var(--accent)]" size={22} />
                    <div className="text-sm font-semibold text-foreground">{step.title}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{step.body}</p>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="space-y-4">
            <SectionHeader id="responds">Chat &amp; Analysis: How It Responds</SectionHeader>
            <p className="max-w-2xl text-sm text-muted-foreground">
              When you ask a question or request analysis, Collision IQ follows a structured process to ensure
              accurate, transparent, and defensible answers.
            </p>
            <ol className="space-y-2">
              {RESPONSE_STEPS.map((step, index) => {
                const Icon = step.icon;
                return (
                  <li key={step.title} className="ci-card flex items-start gap-3 rounded-xl border border-border bg-card p-4">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/15 text-sm font-semibold text-[var(--accent)]">
                      {index + 1}
                    </span>
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <Icon size={15} className="text-[var(--accent)]" /> {step.title}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{step.body}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          {SECTIONS.map((section) => (
            <section key={section.id} className="space-y-3">
              <SectionHeader id={section.id}>{section.title}</SectionHeader>
              <p className="max-w-2xl text-sm text-muted-foreground">{section.body}</p>
            </section>
          ))}

          <div className="rounded-xl border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
            Collision IQ is a repair-intelligence tool, not legal or engineering advice. Review outputs and apply
            professional judgment before making final decisions.
          </div>
        </main>

        {/* Right rail */}
        <aside className="hidden lg:block">
          <div className="sticky top-20 space-y-5">
            <div className="ci-panel p-4">
              <div className="ci-eyebrow mb-2">Key Benefits</div>
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                {KEY_BENEFITS.map((benefit) => (
                  <li key={benefit} className="flex items-center gap-1.5">
                    <CheckCircle2 size={14} className="text-[var(--accent)]" /> {benefit}
                  </li>
                ))}
              </ul>
            </div>
            <div className="ci-panel p-4">
              <div className="text-sm font-semibold text-foreground">Have questions?</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Explore Technical Systems or reach the team for help getting the most out of Collision IQ.
              </p>
              <Link
                href="/technical-systems"
                className="ci-btn-primary mt-3 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold"
              >
                Technical Systems <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
