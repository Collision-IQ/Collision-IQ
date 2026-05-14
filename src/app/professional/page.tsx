import Image from "next/image";
import Link from "next/link";

const services = [
  {
    title: "Estimate and supplement review",
    body: "Evidence-first support for disputed scope, labor changes, procedure support, and documentation gaps.",
  },
  {
    title: "Technical systems rollout",
    body: "Help choosing, onboarding, and tailoring Shop-Flow, Parts App, or Shop Hub around the way your team works.",
  },
  {
    title: "Repair outcome strategy",
    body: "Clear next steps for appraisal posture, total-loss review, repair quality, and file documentation.",
  },
];

export default function ProfessionalPage() {
  return (
    <main className="min-h-screen bg-[#f7f9fc] text-[#102033]">
      <MarketingNav />

      <section className="mx-auto grid max-w-7xl items-center gap-10 px-6 py-16 lg:grid-cols-[1fr_0.95fr] lg:py-24">
        <div>
          <div className="inline-flex rounded-full border border-[#f26a2e]/20 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#c65a2a] shadow-sm">
            Professional Services
          </div>
          <h1 className="mt-7 text-5xl font-bold leading-[1.04] tracking-tight text-[#0b1727] md:text-6xl">
            Expert repair intelligence support when the file needs a human strategy.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[#5a697a]">
            Get practical help reviewing evidence, clarifying estimate disputes, and choosing the right technical systems path for your shop.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/the-academy" className="rounded-full bg-[#c65a2a] px-6 py-3 text-sm font-semibold text-white shadow-[0_18px_38px_rgba(198,90,42,0.24)] transition hover:bg-[#ad4d23]">
              View service options
            </Link>
            <Link href="/technical-systems" className="rounded-full border border-[#dbe4ee] bg-white px-6 py-3 text-sm font-semibold text-[#102033] shadow-sm transition hover:border-[#c65a2a]/40 hover:text-[#c65a2a]">
              Explore systems
            </Link>
          </div>
        </div>
        <div className="rounded-[30px] border border-[#dfe7f0] bg-white p-5 shadow-[0_24px_80px_rgba(15,32,51,0.12)]">
          <Image src="/brand/logos/Background.png" alt="Collision Academy professional services" width={1200} height={800} priority className="h-auto w-full rounded-[22px] object-cover" />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16">
        <div className="grid gap-6 md:grid-cols-3">
          {services.map((service) => (
            <article key={service.title} className="rounded-[28px] border border-[#dfe7f0] bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold tracking-tight text-[#0b1727]">{service.title}</h2>
              <p className="mt-3 text-sm leading-7 text-[#5a697a]">{service.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-20">
        <div className="rounded-[30px] bg-[#0b1727] p-8 text-white md:p-12">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#f2a37b]">Next step</p>
          <h2 className="mt-3 max-w-3xl text-3xl font-bold tracking-tight md:text-4xl">
            Pair software with the right review posture.
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-white/72">
            Use Professional Services when a file needs review discipline, evidence sequencing, or a rollout plan beyond a standard subscription checkout.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/the-academy" className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-[#102033] transition hover:bg-[#f4f7fb]">Start a service path</Link>
            <Link href="/dashboard" className="rounded-full border border-white/18 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10">Go to Workspace</Link>
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
          <Link href="/professional" className="text-[#c65a2a]">Professional Services</Link>
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
