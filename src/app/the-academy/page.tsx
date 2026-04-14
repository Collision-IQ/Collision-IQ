"use client";

import Link from "next/link";
import type { BillingPlanKey } from "@/lib/billing/catalog";

async function startCheckout(plan: BillingPlanKey) {
  const response = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ plan }),
  });

  const data = (await response.json().catch(() => null)) as
    | { url?: string; error?: string }
    | null;

  if (data?.url) {
    window.location.href = data.url;
    return;
  }

  if (!response.ok) {
    throw new Error(data?.error || "Unable to start checkout.");
  }
}

export default function TheAcademyPage() {
  return (
    <main className="min-h-screen text-white">
      <section className="mx-auto max-w-6xl px-6 pb-12 pt-20">
        <div className="text-xs uppercase tracking-[0.24em] text-white/45">
          The Academy
        </div>

        <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-6xl">
          Built for collision professionals who want control.
        </h1>

        <h2 className="mt-4 text-2xl font-semibold text-white/80 md:text-3xl">
          Technical systems, training, and membership pathways.
        </h2>

        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/70">
          The Academy is the structured layer behind Collision IQ - designed for
          professionals who want deeper systems, cleaner workflows, stronger
          technical positioning, and scalable access to tools and guidance.
        </p>

        <p className="mt-4 text-sm text-white/60">
          Built to reduce missed operations, strengthen documentation, and improve
          claim outcomes.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/the-academy"
            className="inline-flex items-center gap-2 rounded-full border border-[#d96b32]/50 bg-[#d96b32]/10 px-4 py-2 text-sm font-medium text-[#d96b32] transition hover:bg-[#d96b32]/20"
          >
            Explore Academy →
          </Link>

          <Link
            href="/"
            className="text-sm text-white/60 transition hover:text-white"
          >
            Back to Chat
          </Link>

          <button
            type="button"
            onClick={() => void startCheckout("pro")}
            className="rounded-2xl bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
          >
            Start Pro Free Trial
          </button>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="grid gap-5 md:grid-cols-3">
          <div className="rounded-3xl border border-[#C65A2A]/40 bg-black/30 p-6 shadow-[0_25px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl">
            <div className="text-lg font-semibold">Membership Access</div>
            <p className="mt-2 text-sm text-white/70">
              Tiered membership unlocks deeper tools, workflows, and system
              access inside Collision IQ.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-black/30 p-6 shadow-[0_25px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl">
            <div className="text-lg font-semibold">Technical Systems</div>
            <p className="mt-2 text-sm text-white/70">
              Frameworks for estimating, documentation, negotiation, and modern
              repair decision support.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-black/30 p-6 shadow-[0_25px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl">
            <div className="text-lg font-semibold">Professional Services</div>
            <p className="mt-2 text-sm text-white/70">
              Appraisal, diminished value, dispute support, and expert-led
              engagement for complex claims and operational needs.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-12">
        <div className="mb-6">
          <h2 className="text-2xl font-semibold">Membership</h2>
          <p className="mt-3 mb-4 text-sm text-white/50">
            Access to systems and services is managed through membership.
          </p>
          <p className="text-sm text-white/60">
            Access Collision IQ tools, training, and decision systems.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-black/30 p-6 backdrop-blur-xl">
            <div className="text-lg font-semibold">Starter</div>
            <div className="mt-2 text-2xl font-bold">$50/month</div>

            <p className="mt-3 text-sm text-white/70">
              Core access to Collision IQ workflows and training.
            </p>

            <ul className="mt-4 space-y-2 text-sm text-white/70">
              <li>- Core analysis tools</li>
              <li>- Basic reports</li>
              <li>- Workflow access</li>
            </ul>

            <button
              type="button"
              onClick={() => void startCheckout("starter")}
              className="mt-6 w-full rounded-2xl bg-white/10 px-4 py-3 text-sm transition hover:bg-white/20"
            >
              Join Starter
            </button>
          </div>

          <div className="rounded-3xl border border-[#C65A2A]/40 bg-black/30 p-6 backdrop-blur-xl">
            <div className="text-lg font-semibold">Pro</div>
            <div className="mt-2 text-2xl font-bold">$200/month</div>
            <div className="text-sm text-[#C65A2A]">30-day free trial</div>

            <p className="mt-3 text-sm text-white/70">
              Full Collision IQ system with advanced analysis and exports.
            </p>

            <ul className="mt-4 space-y-2 text-sm text-white/70">
              <li>- Everything in Starter</li>
              <li>- Advanced analysis engine</li>
              <li>- Dispute-ready exports</li>
              <li>- Technical Systems access</li>
            </ul>

            <button
              type="button"
              onClick={() => void startCheckout("pro")}
              className="mt-6 w-full rounded-2xl bg-[#C65A2A] px-4 py-3 text-sm font-semibold text-black"
            >
              Start Free Trial
            </button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-12">
        <div className="rounded-3xl border border-[#C65A2A]/30 bg-black/30 p-6 backdrop-blur-xl">
          <div className="text-xl font-semibold">Technical Systems</div>

          <p className="mt-3 max-w-2xl text-white/70">
            Custom-built applications for repair centers - estimate validation,
            supplement prediction, structural risk analysis, and workflow
            automation.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/technical-systems"
              className="rounded-2xl bg-[#C65A2A] px-5 py-3 text-sm font-semibold text-black"
            >
              Explore Systems
            </Link>

            <button
              type="button"
              onClick={() => void startCheckout("pro")}
              className="rounded-2xl border border-white/20 px-5 py-3 text-sm"
            >
              Get Access with Pro
            </button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-3xl border border-white/10 bg-black/30 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.6)] backdrop-blur-xl md:p-8">
          <div className="text-xl font-semibold">Professional Services</div>

          <p className="mt-4 max-w-3xl text-white/70">
            Bring in appraisal, diminished value, dispute support, and expert-led
            guidance when the claim, customer, or repair path needs more than a
            software workflow alone.
          </p>

          <Link
            href="/services"
            className="mt-6 inline-block rounded-xl bg-[#C65A2A] px-6 py-3 text-sm font-semibold text-black shadow-[0_10px_30px_rgba(198,90,42,0.25)] transition hover:opacity-90"
          >
            Explore Services
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-16">
        <div className="rounded-3xl border border-white/10 bg-black/30 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.6)] backdrop-blur-xl md:p-8">
          <div className="text-xl font-semibold">Stay connected</div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <Link
              href="/"
              className="group rounded-2xl border border-white/10 bg-black/35 p-5 transition hover:bg-black/45"
            >
              <div className="text-sm font-semibold">Collision IQ</div>
              <div className="mt-2 text-sm text-white/70">
                Open the chatbot and repair intelligence workspace.
              </div>
              <div className="mt-4 text-sm text-[#C65A2A]">Open -&gt;</div>
            </Link>

            <Link
              href="/the-academy"
              className="group rounded-2xl border border-white/10 bg-black/35 p-5 transition hover:bg-black/45"
            >
              <div className="text-sm font-semibold">The Academy</div>
              <p className="mt-2 text-sm text-white/70">
                Join the Academy to access Collision IQ systems, workflows, and
                tailored tools.
              </p>
              <div className="mt-5 text-sm text-[#C65A2A]">
                View membership -&gt;
              </div>
            </Link>

            <a
              href="https://www.linkedin.com/in/vinny-menichetti-917097304/"
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-2xl border border-white/10 bg-black/35 p-5 transition hover:bg-black/45"
            >
              <div className="text-sm font-semibold">LinkedIn</div>
              <div className="mt-2 text-sm text-white/70">
                Industry updates and professional guidance.
              </div>
              <div className="mt-4 text-sm text-[#C65A2A]">View -&gt;</div>
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
