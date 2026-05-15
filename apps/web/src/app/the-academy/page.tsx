"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

type AcademyService = {
  title: string;
  price: string;
  description: string;
  whenToUse: string;
  serviceKey: string;
};

const SERVICES: AcademyService[] = [
  {
    title: "Rekey Estimating",
    price: "Case-based pricing",
    description:
      "Estimate rewriting and repair-plan restructuring when the current file needs a cleaner technical position.",
    whenToUse: "Use this when the estimate is disorganized, incomplete, or needs a cleaner repair-plan structure.",
    serviceKey: "academy_rekey_estimating",
  },
  {
    title: "Legal Assist",
    price: "Scope-based engagement",
    description:
      "Documentation support for matters that need stronger positioning, clearer claim framing, and organized escalation support.",
    whenToUse: "Use this when the claim needs stronger documentation, escalation framing, or position support beyond normal estimate discussion.",
    serviceKey: "academy_legal_assist",
  },
  {
    title: "ACV",
    price: "Valuation engagement",
    description:
      "Actual cash value support when total-loss numbers, comparable support, or insurer valuation logic need review.",
    whenToUse: "Use this when your vehicle may be undervalued as a total loss.",
    serviceKey: "academy_acv_review",
  },
  {
    title: "Appraisal",
    price: "Professional service",
    description:
      "Formal appraisal-oriented support when a normal supplement discussion is no longer enough to move the claim.",
    whenToUse: "Use this when negotiations have stalled and the file needs formal appraisal escalation.",
    serviceKey: "academy_appraisal",
  },
  {
    title: "Right to Appraisal Clause",
    price: "Positioning review",
    description:
      "Guidance around appraisal-path language, claim posture, and when invoking appraisal becomes strategically appropriate.",
    whenToUse: "Use this when you need help deciding whether appraisal language should be invoked on the claim.",
    serviceKey: "academy_appraisal_clause",
  },
  {
    title: "Value Dispute",
    price: "Case-based pricing",
    description:
      "Support for disputed numbers, weak settlement logic, and valuation gaps that need a stronger technical response.",
    whenToUse: "Use this when your estimate is too low or missing key repairs.",
    serviceKey: "academy_value_dispute",
  },
  {
    title: "Diminished Value",
    price: "Valuation engagement",
    description:
      "Diminished value support for files where repair severity, market reaction, and loss-in-value need stronger documentation.",
    whenToUse: "Use this after repairs to recover lost resale value.",
    serviceKey: "academy_diminished_value",
  },
];

function CheckoutBanner() {
  const searchParams = useSearchParams();
  const checkoutResult = searchParams.get("checkout");
  if (checkoutResult === "success") {
    return (
      <div className="mx-auto max-w-6xl px-5 pb-2">
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-700 dark:text-emerald-300">
          Payment received. Your service case has been created and our team will be in touch to begin intake.
        </div>
      </div>
    );
  }
  if (checkoutResult === "cancelled") {
    return (
      <div className="mx-auto max-w-6xl px-5 pb-2">
        <div className="rounded-2xl border border-border bg-card px-5 py-4 text-sm text-muted-foreground">
          Checkout was cancelled. No charge was made.
        </div>
      </div>
    );
  }
  return null;
}

export default function TheAcademyPage() {

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-card">
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
              className="rounded-2xl border border-border bg-background px-4 py-2 text-sm text-foreground transition hover:bg-muted"
            >
              Open Collision IQ
            </Link>
            <Link
              href="/technical-systems"
              className="rounded-2xl border border-[#C65A2A]/40 bg-[#C65A2A]/10 px-4 py-2 text-sm font-semibold text-[#C65A2A] transition hover:bg-[#C65A2A]/20"
            >
              Explore Technical Systems
            </Link>
          </div>
        </div>
      </header>

      <section className="border-b border-border bg-background">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-24">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#C65A2A]/30 bg-[#C65A2A]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#C65A2A]">
            Collision Academy Services
          </div>

          <h1 className="mt-6 max-w-4xl text-4xl font-bold leading-tight tracking-tight md:text-6xl">
            Professional services for complex claims, valuation disputes, and
            appraisal-driven files.
          </h1>

          <p className="mt-6 max-w-3xl text-lg leading-relaxed text-muted-foreground md:text-xl">
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
              className="rounded-2xl border border-border bg-card px-6 py-3 text-sm font-semibold text-foreground transition hover:bg-muted"
            >
              Open Collision IQ
            </Link>
            <Link
              href="/technical-systems"
              className="rounded-2xl border border-border bg-card px-6 py-3 text-sm font-semibold text-foreground transition hover:bg-muted"
            >
              Explore Technical Systems
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-12">
        <div className="grid gap-5 md:grid-cols-3">
          <div className="rounded-3xl border border-[#C65A2A]/35 bg-card p-6 shadow-[0_18px_44px_rgba(15,23,42,0.08)] dark:shadow-[0_18px_44px_rgba(0,0,0,0.22)]">
            <div className="text-lg font-semibold">Professional Services</div>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">
              Collision Academy handles the expert-service layer when files
              need claim support, valuation work, or dispute strategy.
            </p>
          </div>
          <div className="rounded-3xl border border-border bg-card p-6 shadow-[0_18px_44px_rgba(15,23,42,0.08)] dark:shadow-[0_18px_44px_rgba(0,0,0,0.22)]">
            <div className="text-lg font-semibold">Collision IQ</div>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">
              Use Collision IQ when you need the working software surface for
              upload, analysis, documentation, and exports.
            </p>
          </div>
          <div className="rounded-3xl border border-border bg-card p-6 shadow-[0_18px_44px_rgba(15,23,42,0.08)] dark:shadow-[0_18px_44px_rgba(0,0,0,0.22)]">
            <div className="text-lg font-semibold">Technical Systems</div>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">
              Move into Technical Systems when your shop needs software,
              onboarding, workflow tooling, or tailored operating systems.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-12">
        <div className="mb-6">
          <h2 className="text-2xl font-semibold">Professional service lanes</h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-muted-foreground">
            These offers stay on the services side of the brand. They are not
            framed as software subscriptions or member-only access.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {SERVICES.map((service) => (
            <div
              key={service.title}
              className="flex flex-col rounded-3xl border border-border bg-card p-6 shadow-[0_18px_44px_rgba(15,23,42,0.08)] dark:shadow-[0_18px_44px_rgba(0,0,0,0.22)]"
            >
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C65A2A]">
                {service.price}
              </div>
              <h3 className="mt-3 text-xl font-semibold">{service.title}</h3>
              <p className="mt-3 flex-1 text-sm leading-7 text-muted-foreground">
                {service.description}
              </p>
              <div className="mt-3 rounded-2xl border border-border bg-muted px-3 py-3 text-sm leading-6 text-muted-foreground">
                <span className="font-semibold text-foreground">When should I use this?</span>{" "}
                {service.whenToUse}
              </div>
              <form
                action="/api/billing/service-checkout"
                method="post"
                className="mt-5"
              >
                <input type="hidden" name="serviceKey" value={service.serviceKey} />
                <input type="hidden" name="sourcePage" value="the-academy" />
                <button
                  type="submit"
                  className="rounded-2xl border border-[#C65A2A]/40 bg-[#C65A2A] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#C65A2A]/90"
                >
                  Request this service →
                </button>
              </form>
            </div>
          ))}
        </div>
      </section>

      <Suspense fallback={null}>
        <CheckoutBanner />
      </Suspense>

      <section className="mx-auto max-w-6xl px-5 pb-12">
        <div className="rounded-3xl border border-[#C65A2A]/25 bg-card p-6 shadow-[0_18px_44px_rgba(15,23,42,0.08)] dark:shadow-[0_18px_44px_rgba(0,0,0,0.22)] md:p-8">
          <div className="text-sm font-semibold uppercase tracking-[0.16em] text-[#C65A2A]">
            How the surfaces connect
          </div>
          <h2 className="mt-3 text-2xl font-semibold">
            Choose the right layer for the work in front of you
          </h2>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-border bg-muted p-4 text-sm leading-7 text-muted-foreground">
              <span className="font-semibold text-foreground">Collision IQ:</span>{" "}
              the working software surface for analysis, chat, uploads, and
              exports.
            </div>
            <div className="rounded-2xl border border-border bg-muted p-4 text-sm leading-7 text-muted-foreground">
              <span className="font-semibold text-foreground">Technical Systems:</span>{" "}
              the apps, bundles, onboarding, and tailored operating systems for
              shops.
            </div>
            <div className="rounded-2xl border border-border bg-muted p-4 text-sm leading-7 text-muted-foreground">
              <span className="font-semibold text-foreground">Collision Academy:</span>{" "}
              the expert professional-services layer for valuation, appraisal,
              and claim support.
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16">
        <div className="rounded-3xl border border-border bg-card p-6 shadow-[0_18px_44px_rgba(15,23,42,0.08)] dark:shadow-[0_18px_44px_rgba(0,0,0,0.22)] md:p-8">
          <div className="text-xl font-semibold">Stay connected</div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <Link
              href="/"
              className="group rounded-2xl border border-border bg-muted p-5 transition hover:bg-card"
            >
              <div className="text-sm font-semibold">Collision IQ</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Open the software workspace for live repair analysis and export workflows.
              </div>
              <div className="mt-4 text-sm text-[#C65A2A]">Open -&gt;</div>
            </Link>

            <Link
              href="/technical-systems"
              className="group rounded-2xl border border-border bg-muted p-5 transition hover:bg-card"
            >
              <div className="text-sm font-semibold">Technical Systems</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Review subscriptions, apps, onboarding, and tailored system options.
              </div>
              <div className="mt-4 text-sm text-[#C65A2A]">View Systems -&gt;</div>
            </Link>

            <a
              href="https://www.collision.academy/s/shop"
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-2xl border border-border bg-muted p-5 transition hover:bg-card"
            >
              <div className="text-sm font-semibold">Professional Services</div>
              <div className="mt-2 text-sm text-muted-foreground">
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
