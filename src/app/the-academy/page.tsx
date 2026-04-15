"use client";

import Image from "next/image";
import Link from "next/link";

const SERVICES = [
  {
    title: "Rekey Estimating",
    price: "Case-based pricing",
    description:
      "Estimate rewriting and repair-plan restructuring when the current file needs a cleaner technical position.",
  },
  {
    title: "Legal Assist",
    price: "Scope-based engagement",
    description:
      "Documentation support for matters that need stronger positioning, clearer claim framing, and organized escalation support.",
  },
  {
    title: "ACV",
    price: "Valuation engagement",
    description:
      "Actual cash value support when total-loss numbers, comparable support, or insurer valuation logic need review.",
  },
  {
    title: "Appraisal",
    price: "Professional service",
    description:
      "Formal appraisal-oriented support when a normal supplement discussion is no longer enough to move the claim.",
  },
  {
    title: "Right to Appraisal Clause",
    price: "Positioning review",
    description:
      "Guidance around appraisal-path language, claim posture, and when invoking appraisal becomes strategically appropriate.",
  },
  {
    title: "Value Dispute",
    price: "Case-based pricing",
    description:
      "Support for disputed numbers, weak settlement logic, and valuation gaps that need a stronger technical response.",
  },
  {
    title: "Diminished Value",
    price: "Valuation engagement",
    description:
      "Diminished value support for files where repair severity, market reaction, and loss-in-value need stronger documentation.",
  },
];

export default function TheAcademyPage() {
  return (
    <main className="min-h-screen text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/50 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <Link href="/the-academy" className="flex items-center gap-3">
            <div className="relative h-9 w-40">
              <Image
                src="/brand/logos/Logo-grey.png"
                alt="Collision Academy"
                fill
                className="object-contain"
                priority
              />
            </div>
          </Link>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/"
              className="rounded-2xl border border-white/12 bg-white/5 px-4 py-2 text-sm text-white/85 transition hover:bg-white/10"
            >
              Open Collision IQ
            </Link>
            <Link
              href="/technical-systems"
              className="rounded-2xl border border-[#C65A2A]/40 bg-[#C65A2A]/10 px-4 py-2 text-sm font-semibold text-[#E88A5F] transition hover:bg-[#C65A2A]/20"
            >
              Explore Technical Systems
            </Link>
          </div>
        </div>
      </header>

      <section className="relative isolate overflow-hidden">
        <video
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
        >
          <source src="/brand/logos/Logo-video.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-black/70" />
        <div className="absolute inset-0 bg-gradient-to-tr from-black via-black/70 to-black/20" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_10%,rgba(198,90,42,0.20),transparent_45%)]" />

        <div className="relative mx-auto max-w-6xl px-5 py-16 md:py-24">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#C65A2A]/30 bg-[#C65A2A]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#E88A5F]">
            Collision Academy Services
          </div>

          <h1 className="mt-6 max-w-4xl text-4xl font-bold leading-tight tracking-tight md:text-6xl">
            Professional services for complex claims, valuation disputes, and
            appraisal-driven files.
          </h1>

          <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/78 md:text-xl">
            Collision Academy is the umbrella brand. This page is the
            professional-services surface: appraisal support, diminished value,
            ACV review, legal assist, and claim-positioning work when software
            alone is not enough.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="https://www.collision.academy/s/shop"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-2xl bg-[#C65A2A] px-6 py-3 text-sm font-semibold text-black shadow-[0_10px_30px_rgba(198,90,42,0.25)] transition hover:opacity-90"
            >
              View Professional Services
            </a>
            <Link
              href="/"
              className="rounded-2xl border border-white/20 bg-black/25 px-6 py-3 text-sm font-semibold text-white transition hover:bg-black/35"
            >
              Open Collision IQ
            </Link>
            <Link
              href="/technical-systems"
              className="rounded-2xl border border-white/20 bg-black/25 px-6 py-3 text-sm font-semibold text-white transition hover:bg-black/35"
            >
              Explore Technical Systems
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-12">
        <div className="grid gap-5 md:grid-cols-3">
          <div className="rounded-3xl border border-[#C65A2A]/35 bg-black/30 p-6 shadow-[0_25px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl">
            <div className="text-lg font-semibold">Professional Services</div>
            <p className="mt-2 text-sm leading-7 text-white/70">
              Collision Academy handles the expert-service layer when files
              need claim support, valuation work, or dispute strategy.
            </p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-black/30 p-6 shadow-[0_25px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl">
            <div className="text-lg font-semibold">Collision IQ</div>
            <p className="mt-2 text-sm leading-7 text-white/70">
              Use Collision IQ when you need the working software surface for
              upload, analysis, documentation, and exports.
            </p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-black/30 p-6 shadow-[0_25px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl">
            <div className="text-lg font-semibold">Technical Systems</div>
            <p className="mt-2 text-sm leading-7 text-white/70">
              Move into Technical Systems when your shop needs software,
              onboarding, workflow tooling, or tailored operating systems.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-12">
        <div className="mb-6">
          <h2 className="text-2xl font-semibold">Professional service lanes</h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-white/60">
            These offers stay on the services side of the brand. They are not
            framed as software subscriptions or member-only access.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {SERVICES.map((service) => (
            <div
              key={service.title}
              className="rounded-3xl border border-white/10 bg-black/30 p-6 shadow-[0_25px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl"
            >
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#E88A5F]">
                {service.price}
              </div>
              <h3 className="mt-3 text-xl font-semibold">{service.title}</h3>
              <p className="mt-3 text-sm leading-7 text-white/70">
                {service.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-12">
        <div className="rounded-3xl border border-[#C65A2A]/25 bg-black/30 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.6)] backdrop-blur-xl md:p-8">
          <div className="text-sm font-semibold uppercase tracking-[0.16em] text-[#E88A5F]">
            How the surfaces connect
          </div>
          <h2 className="mt-3 text-2xl font-semibold">
            Choose the right layer for the work in front of you
          </h2>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-7 text-white/72">
              <span className="font-semibold text-white">Collision IQ:</span>{" "}
              the working software surface for analysis, chat, uploads, and
              exports.
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-7 text-white/72">
              <span className="font-semibold text-white">Technical Systems:</span>{" "}
              the apps, bundles, onboarding, and tailored operating systems for
              shops.
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-7 text-white/72">
              <span className="font-semibold text-white">Collision Academy:</span>{" "}
              the expert professional-services layer for valuation, appraisal,
              and claim support.
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16">
        <div className="rounded-3xl border border-white/10 bg-black/30 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.6)] backdrop-blur-xl md:p-8">
          <div className="text-xl font-semibold">Stay connected</div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <Link
              href="/"
              className="group rounded-2xl border border-white/10 bg-black/35 p-5 transition hover:bg-black/45"
            >
              <div className="text-sm font-semibold">Collision IQ</div>
              <div className="mt-2 text-sm text-white/70">
                Open the software workspace for live repair analysis and export workflows.
              </div>
              <div className="mt-4 text-sm text-[#C65A2A]">Open -&gt;</div>
            </Link>

            <Link
              href="/technical-systems"
              className="group rounded-2xl border border-white/10 bg-black/35 p-5 transition hover:bg-black/45"
            >
              <div className="text-sm font-semibold">Technical Systems</div>
              <div className="mt-2 text-sm text-white/70">
                Review subscriptions, apps, onboarding, and tailored system options.
              </div>
              <div className="mt-4 text-sm text-[#C65A2A]">View Systems -&gt;</div>
            </Link>

            <a
              href="https://www.collision.academy/s/shop"
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-2xl border border-white/10 bg-black/35 p-5 transition hover:bg-black/45"
            >
              <div className="text-sm font-semibold">Professional Services</div>
              <div className="mt-2 text-sm text-white/70">
                Continue into the live services shop for scoped service engagement.
              </div>
              <div className="mt-4 text-sm text-[#C65A2A]">View Services -&gt;</div>
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
