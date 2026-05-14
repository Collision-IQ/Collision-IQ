import Image from "next/image";
import Link from "next/link";

const features = [
  "Evidence-first",
  "Audit-ready",
  "AI-powered",
  "Built for shops",
];

const productCards = [
  {
    title: "Estimate intelligence",
    body: "Compare repair documents, isolate deltas, and turn disputed scope into clear next steps.",
  },
  {
    title: "Report exports",
    body: "Generate cleaner repair intelligence, annotated scrubber, and decision-support reports.",
  },
  {
    title: "Operational systems",
    body: "Extend the review workflow into Shop-Flow, Parts App, and bundled shop systems.",
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#f7f9fc] text-[#102033]">
      <MarketingNav />

      <section className="mx-auto grid max-w-7xl items-center gap-10 px-6 pb-16 pt-12 lg:grid-cols-[1.04fr_0.96fr] lg:pb-24 lg:pt-20">
        <div>
          <div className="inline-flex rounded-full border border-[#f26a2e]/20 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#c65a2a] shadow-sm">
            Collision IQ
          </div>
          <h1 className="mt-7 max-w-4xl text-5xl font-bold leading-[1.02] tracking-tight text-[#0b1727] md:text-7xl">
            Forensic Repair Intelligence for Better Outcomes.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[#526173]">
            Collision IQ gives repair professionals the evidence, clarity, and tools to validate estimates, negotiate with confidence, and improve total-loss and repair outcomes.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/technical-systems" className="rounded-full bg-[#c65a2a] px-6 py-3 text-sm font-semibold text-white shadow-[0_18px_38px_rgba(198,90,42,0.24)] transition hover:bg-[#ad4d23]">
              Explore Technical Systems
            </Link>
            <Link href="/dashboard" className="rounded-full border border-[#d9e1ea] bg-white px-6 py-3 text-sm font-semibold text-[#102033] shadow-sm transition hover:border-[#c65a2a]/40 hover:text-[#c65a2a]">
              Go to Workspace
            </Link>
          </div>
          <div className="mt-8 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
            {features.map((feature) => (
              <div key={feature} className="rounded-2xl border border-[#e3e9f0] bg-white px-4 py-3 text-sm font-semibold text-[#24364b] shadow-sm">
                {feature}
              </div>
            ))}
          </div>
        </div>

        <div className="relative">
          <div className="absolute -left-6 top-8 h-24 w-24 rounded-full bg-[#f26a2e]/10 blur-2xl" />
          <div className="rounded-[28px] border border-[#dde6ef] bg-white p-4 shadow-[0_24px_80px_rgba(15,32,51,0.12)]">
            <Image
              src="/iq/Brand.png"
              alt="Collision IQ platform preview"
              width={1000}
              height={760}
              priority
              className="h-auto w-full rounded-[22px] object-cover"
            />
          </div>
        </div>
      </section>

      <section className="border-y border-[#e2e8f0] bg-white">
        <div className="mx-auto grid max-w-7xl gap-5 px-6 py-14 md:grid-cols-3">
          {productCards.map((card) => (
            <article key={card.title} className="rounded-3xl border border-[#e0e7ef] bg-[#fbfcfe] p-6 shadow-sm">
              <h2 className="text-xl font-semibold tracking-tight text-[#0b1727]">{card.title}</h2>
              <p className="mt-3 text-sm leading-7 text-[#5d6c7d]">{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16">
        <div className="rounded-[30px] bg-[#0b1727] p-8 text-white shadow-[0_24px_70px_rgba(11,23,39,0.22)] md:p-12">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#f2a37b]">Technical systems</p>
            <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-5xl">Built to move from review to action.</h2>
            <p className="mt-5 text-base leading-8 text-white/72">Pair repair intelligence with workflow, parts coordination, and professional services designed around real collision operations.</p>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/technical-systems" className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-[#102033] transition hover:bg-[#f4f7fb]">
              View systems
            </Link>
            <Link href="/professional" className="rounded-full border border-white/18 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
              Professional Services
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function MarketingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-[#e4ebf3]/80 bg-white/90 backdrop-blur">
      <nav className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-6 py-4">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/iq/iq_logo.png" alt="Collision IQ" width={154} height={36} className="h-9 w-auto" priority />
        </Link>
        <div className="hidden items-center gap-7 text-sm font-medium text-[#526173] lg:flex">
          <Link href="/technical-systems" className="transition hover:text-[#c65a2a]">Technical Systems</Link>
          <Link href="/professional" className="transition hover:text-[#c65a2a]">Professional Services</Link>
          <Link href="/the-academy" className="transition hover:text-[#c65a2a]">Resources</Link>
          <Link href="/pricing" className="transition hover:text-[#c65a2a]">Pricing</Link>
          <Link href="/services" className="transition hover:text-[#c65a2a]">About</Link>
        </div>
        <Link href="/dashboard" className="rounded-full bg-[#102033] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1b314b]">
          Go to Workspace
        </Link>
      </nav>
    </header>
  );
}
