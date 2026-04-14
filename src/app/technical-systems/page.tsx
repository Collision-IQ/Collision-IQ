"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

type LeadFormState = {
  name: string;
  business: string;
  email: string;
  phone: string;
  shopSize: string;
  currentWorkflow: string;
  goals: string;
};

const INITIAL_FORM: LeadFormState = {
  name: "",
  business: "",
  email: "",
  phone: "",
  shopSize: "",
  currentWorkflow: "",
  goals: "",
};

type PurchasablePlan =
  | "executive_onboarding"
  | "virtual_onboarding"
  | "shop_hub"
  | "shop_flow"
  | "parts_app"
  | "pro";

const SYSTEMS = [
  {
    title: "Shop-Flow",
    description:
      "A tailored workflow system for estimate review, supplement handling, and repair-process guidance across your shop.",
    badge: "Monthly system",
    plan: "shop_flow" as PurchasablePlan,
    priceLabel: "$200/month",
    media: {
      type: "video" as const,
      src: "/shop_flow/videos/production_video.mp4",
      poster: "/shop_flow/screenshots/production_page.png",
    },
    highlights: [
      "Workflow consistency across staff",
      "Cleaner estimate review process",
      "Faster handoff from analysis to action",
    ],
  },
  {
    title: "Parts App",
    description:
      "A focused app for parts-related workflow, decision support, and operational clarity inside the repair process.",
    badge: "Monthly system",
    plan: "parts_app" as PurchasablePlan,
    priceLabel: "$200/month",
    media: {
      type: "video" as const,
      src: "/parts_app/videos/Office request video sample.mp4",
      poster: "/parts_app/screenshots/parts_home.png",
    },
    highlights: [
      "Parts-focused process support",
      "Faster internal coordination",
      "More repeatable operational decisions",
    ],
  },
  {
    title: "The Shop Hub",
    description:
      "A broader operating hub for repair-center workflow, tying systems, decisions, and process visibility together.",
    badge: "Monthly platform",
    plan: "shop_hub" as PurchasablePlan,
    priceLabel: "$300/month",
    media: {
      type: "image" as const,
      src: "/shop_flow/screenshots/shop_flow.png",
    },
    highlights: [
      "Centralized workflow visibility",
      "Broader systems entry point",
      "Stronger process control",
    ],
  },
];

const ONBOARDING = [
  {
    title: "Executive On-Boarding",
    description:
      "A higher-touch onboarding path for teams that want leadership-level alignment and a stronger implementation start.",
    plan: "executive_onboarding" as PurchasablePlan,
    priceLabel: "$1,250 one-time",
  },
  {
    title: "Virtual On-Boarding",
    description:
      "A lighter onboarding option for teams that want guided setup and implementation support without the executive package.",
    plan: "virtual_onboarding" as PurchasablePlan,
    priceLabel: "$200 one-time",
  },
];

const OUTCOMES = [
  "Reduce missed revenue from under-carried procedures and support gaps",
  "Create more consistent estimate review across staff and locations",
  "Shorten the time from upload to usable repair or dispute guidance",
  "Build repeatable documentation workflows around your actual process",
];

async function startCheckout(plan: PurchasablePlan) {
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

  if (!response.ok) {
    throw new Error(data?.error || "Unable to start checkout.");
  }

  if (data?.url) {
    window.location.href = data.url;
    return;
  }

  throw new Error("Checkout URL missing.");
}

export default function TechnicalSystemsPage() {
  const [form, setForm] = useState<LeadFormState>(INITIAL_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [leadError, setLeadError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [activeCheckout, setActiveCheckout] =
    useState<PurchasablePlan | null>(null);

  function update<K extends keyof LeadFormState>(
    key: K,
    value: LeadFormState[K]
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleCheckout(plan: PurchasablePlan) {
    try {
      setCheckoutError(null);
      setActiveCheckout(plan);
      await startCheckout(plan);
    } catch (error) {
      setCheckoutError(
        error instanceof Error ? error.message : "Unable to start checkout."
      );
      setActiveCheckout(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setLeadError(null);

    try {
      const response = await fetch("/api/technical-systems-lead", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to submit request.");
      }

      setSubmitted(true);
      setForm(INITIAL_FORM);
    } catch (error) {
      setLeadError(
        error instanceof Error ? error.message : "Something went wrong."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/60 backdrop-blur-xl">
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

          <div className="flex items-center gap-3">
            <Link
              href="/the-academy"
              className="rounded-2xl border border-white/12 bg-white/5 px-4 py-2 text-sm text-white/85 transition hover:bg-white/10"
            >
              Back to Academy
            </Link>
            <Link
              href="/"
              className="rounded-2xl bg-[#C65A2A] px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90"
            >
              Open Collision IQ
            </Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_0%,rgba(198,90,42,0.18),transparent_35%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.06),transparent_30%)]" />

        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 md:grid-cols-[1.15fr_0.85fr] md:py-24">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#C65A2A]/30 bg-[#C65A2A]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#E88A5F]">
              Technical Systems
            </div>

            <h1 className="mt-6 max-w-4xl text-4xl font-bold leading-tight tracking-tight md:text-6xl">
              Tailored apps for repair centers that want stronger workflow,
              cleaner decisions, and real process advantage.
            </h1>

            <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/75 md:text-xl">
              Technical Systems is where Collision IQ grows into operating
              software for your business: systems for estimate review,
              supplement handling, documentation support, process control, and
              internal decision flow.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="#lead-form"
                className="rounded-2xl bg-[#C65A2A] px-6 py-3 text-sm font-semibold text-black shadow-[0_10px_30px_rgba(198,90,42,0.25)] transition hover:opacity-90"
              >
                Request a tailored systems call
              </a>

              <button
                type="button"
                onClick={() => void handleCheckout("pro")}
                disabled={activeCheckout === "pro"}
                className="rounded-2xl border border-white/20 bg-black/25 px-6 py-3 text-sm font-semibold text-white transition hover:bg-black/35 disabled:opacity-60"
              >
                {activeCheckout === "pro"
                  ? "Redirecting..."
                  : "Start Pro Free Trial"}
              </button>
            </div>

            <div className="mt-8 grid gap-3 text-sm text-white/70 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                Built around real collision workflows
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                Designed around your process, not generic software
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                Strong fit for growing shops, groups, and multi-person teams
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                Best paired with Collision IQ Pro membership
              </div>
            </div>

            {checkoutError ? (
              <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {checkoutError}
              </div>
            ) : null}
          </div>

          <div className="rounded-3xl border border-[#C65A2A]/25 bg-black/40 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.65)] backdrop-blur-xl">
            <div className="text-sm font-semibold uppercase tracking-[0.16em] text-[#E88A5F]">
              Best fit
            </div>

            <h2 className="mt-3 text-2xl font-semibold">
              This is for teams that want a system, not just another tool
            </h2>

            <div className="mt-5 space-y-3 text-sm leading-7 text-white/75">
              <p>
                Technical Systems is ideal when your team already knows where
                the friction is: inconsistent estimate review, missed support,
                slower supplement flow, weak dispute packaging, or too much
                workflow knowledge living in a few people.
              </p>
              <p>
                Instead of forcing your team into generic software, we shape the
                system around your process, documentation needs, and operating
                reality.
              </p>
            </div>

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-sm font-semibold text-white">
                Typical entry points
              </div>
              <ul className="mt-3 space-y-2 text-sm text-white/70">
                <li>- "We want estimate reviews to be more consistent."</li>
                <li>- "We need stronger support before files leave our team."</li>
                <li>- "We want fewer missed supplement opportunities."</li>
                <li>- "We want our own internal decision system."</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-10">
        <div className="mb-6">
          <h2 className="text-2xl font-semibold">Available systems</h2>
          <p className="mt-2 max-w-3xl text-sm text-white/60">
            These are real Technical Systems products you can start with now,
            while the broader tailored-systems path remains available for custom
            work.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {SYSTEMS.map((item) => (
            <div
              key={item.title}
              className="overflow-hidden rounded-3xl border border-white/10 bg-black/30 shadow-[0_25px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl"
            >
              <div className="relative aspect-[16/10] w-full bg-white/5">
                {item.media.type === "video" ? (
                  <video
                    controls
                    preload="metadata"
                    poster={item.media.poster}
                    className="h-full w-full object-cover"
                  >
                    <source src={item.media.src} type="video/mp4" />
                  </video>
                ) : (
                  <Image
                    src={item.media.src}
                    alt={item.title}
                    fill
                    className="object-cover"
                  />
                )}
              </div>

              <div className="p-6">
                <div className="inline-flex rounded-full border border-[#C65A2A]/25 bg-[#C65A2A]/10 px-3 py-1 text-xs font-semibold text-[#E88A5F]">
                  {item.badge}
                </div>

                <div className="mt-4 flex items-start justify-between gap-4">
                  <h3 className="text-2xl font-semibold">{item.title}</h3>
                  <div className="text-sm font-medium text-[#E88A5F]">
                    {item.priceLabel}
                  </div>
                </div>

                <p className="mt-3 text-sm leading-7 text-white/70">
                  {item.description}
                </p>

                <ul className="mt-4 space-y-2 text-sm text-white/70">
                  {item.highlights.map((highlight) => (
                    <li
                      key={highlight}
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                    >
                      {highlight}
                    </li>
                  ))}
                </ul>

                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void handleCheckout(item.plan)}
                    disabled={activeCheckout === item.plan}
                    className="rounded-2xl bg-[#C65A2A] px-5 py-3 text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-60"
                  >
                    {activeCheckout === item.plan
                      ? "Redirecting..."
                      : `Get ${item.title}`}
                  </button>

                  <a
                    href="#lead-form"
                    className="rounded-2xl border border-white/20 bg-black/25 px-5 py-3 text-sm font-semibold text-white transition hover:bg-black/35"
                  >
                    Ask about tailoring this
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-10">
        <div className="grid gap-6 md:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-3xl border border-white/10 bg-black/30 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.6)] backdrop-blur-xl">
            <div className="text-xl font-semibold">Why tailored systems win</div>
            <p className="mt-3 text-sm leading-7 text-white/70">
              Most software asks your team to adapt to the product. Technical
              Systems starts with your estimating, review, supplement, and
              documentation workflow, then builds around that.
            </p>
          </div>

          <div className="rounded-3xl border border-[#C65A2A]/20 bg-black/30 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.6)] backdrop-blur-xl">
            <div className="text-xl font-semibold">Target outcomes</div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {OUTCOMES.map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/75"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-10">
        <div className="rounded-3xl border border-[#C65A2A]/30 bg-black/30 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.6)] backdrop-blur-xl md:p-8">
          <div className="grid gap-6 md:grid-cols-[1.05fr_0.95fr] md:items-center">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.16em] text-[#E88A5F]">
                Onboarding
              </div>
              <h2 className="mt-3 text-2xl font-semibold">
                Choose the onboarding path that fits your team
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-white/70">
                Onboarding helps teams start cleaner and faster. Executive
                On-Boarding is the higher-touch implementation path. Virtual
                On-Boarding is the lighter guided setup path.
              </p>
            </div>

            <div className="grid gap-4">
              {ONBOARDING.map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-white/10 bg-white/5 p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-lg font-semibold">{item.title}</div>
                      <div className="mt-2 text-sm leading-6 text-white/70">
                        {item.description}
                      </div>
                    </div>
                    <div className="text-sm font-medium text-[#E88A5F]">
                      {item.priceLabel}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleCheckout(item.plan)}
                    disabled={activeCheckout === item.plan}
                    className="mt-4 rounded-2xl bg-[#C65A2A] px-5 py-3 text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-60"
                  >
                    {activeCheckout === item.plan
                      ? "Redirecting..."
                      : `Buy ${item.title}`}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-10">
        <div className="rounded-3xl border border-[#C65A2A]/30 bg-black/30 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.6)] backdrop-blur-xl md:p-8">
          <div className="grid gap-6 md:grid-cols-[1.1fr_0.9fr] md:items-center">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.16em] text-[#E88A5F]">
                Membership relationship
              </div>
              <h2 className="mt-3 text-2xl font-semibold">
                Collision IQ Pro is still the strongest on-ramp
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-white/70">
                Pro gives teams the strongest starting point into Technical
                Systems: active workflow use, stronger analysis exposure, and a
                clearer path into tailored implementation.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => void handleCheckout("pro")}
                disabled={activeCheckout === "pro"}
                className="rounded-2xl bg-[#C65A2A] px-5 py-3 text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-60"
              >
                {activeCheckout === "pro"
                  ? "Redirecting..."
                  : "Start Pro Free Trial"}
              </button>

              <a
                href="#lead-form"
                className="rounded-2xl border border-white/20 bg-black/25 px-5 py-3 text-center text-sm font-semibold text-white transition hover:bg-black/35"
              >
                Request a tailored systems call
              </a>
            </div>
          </div>
        </div>
      </section>

      <section id="lead-form" className="mx-auto max-w-6xl px-5 py-10">
        <div className="grid gap-6 md:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-3xl border border-white/10 bg-black/30 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.6)] backdrop-blur-xl">
            <div className="text-xl font-semibold">
              Request a tailored systems call
            </div>
            <p className="mt-3 text-sm leading-7 text-white/70">
              Tell us what your team is trying to improve. The goal is not to
              force generic software into your process. The goal is to see
              whether a tailored system makes sense for your workflow.
            </p>

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
              Best for:
              <ul className="mt-3 space-y-2 text-white/65">
                <li>- Multi-person review teams</li>
                <li>- Shops wanting more consistent estimate outcomes</li>
                <li>- Teams handling complex supplement or dispute workflow</li>
                <li>- Owners building process advantage</li>
              </ul>
            </div>
          </div>

          <form
            onSubmit={handleSubmit}
            className="rounded-3xl border border-[#C65A2A]/20 bg-black/30 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.6)] backdrop-blur-xl"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="Your name"
                value={form.name}
                onChange={(value) => update("name", value)}
                placeholder="Full name"
                required
              />
              <Field
                label="Business / shop"
                value={form.business}
                onChange={(value) => update("business", value)}
                placeholder="Shop or company name"
                required
              />
              <Field
                label="Email"
                value={form.email}
                onChange={(value) => update("email", value)}
                placeholder="you@example.com"
                type="email"
                required
              />
              <Field
                label="Phone"
                value={form.phone}
                onChange={(value) => update("phone", value)}
                placeholder="Optional"
              />
              <Field
                label="Shop size"
                value={form.shopSize}
                onChange={(value) => update("shopSize", value)}
                placeholder="Single location, MSO, team size, etc."
              />
              <Field
                label="Current workflow pain point"
                value={form.currentWorkflow}
                onChange={(value) => update("currentWorkflow", value)}
                placeholder="Supplements, estimate review, dispute support..."
              />
            </div>

            <div className="mt-4">
              <label className="mb-2 block text-sm font-medium text-white/80">
                What would you want the system to improve?
              </label>
              <textarea
                value={form.goals}
                onChange={(e) => update("goals", e.target.value)}
                placeholder="Describe the workflow, friction, or outcome you want to improve."
                rows={6}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#C65A2A]/40"
                required
              />
            </div>

            {submitted ? (
              <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                Your request was submitted. We can now review whether a tailored
                system fits your workflow.
              </div>
            ) : null}

            {leadError ? (
              <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {leadError}
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-2xl bg-[#C65A2A] px-6 py-3 text-sm font-semibold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "Submitting..." : "Request systems call"}
              </button>

              <button
                type="button"
                onClick={() => void handleCheckout("pro")}
                disabled={activeCheckout === "pro"}
                className="rounded-2xl border border-white/20 bg-black/25 px-6 py-3 text-sm font-semibold text-white transition hover:bg-black/35 disabled:opacity-60"
              >
                {activeCheckout === "pro"
                  ? "Redirecting..."
                  : "Start with Pro instead"}
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16 pt-6">
        <div className="rounded-3xl border border-white/10 bg-black/30 p-6 text-center shadow-[0_30px_90px_rgba(0,0,0,0.6)] backdrop-blur-xl md:p-8">
          <div className="text-sm font-semibold uppercase tracking-[0.16em] text-[#E88A5F]">
            Final step
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">
            Build your process advantage
          </h2>
          <p className="mx-auto mt-4 max-w-3xl text-sm leading-7 text-white/70">
            Collision IQ helps teams analyze files. Technical Systems helps them
            turn that intelligence into a workflow system tailored to how the
            business actually runs.
          </p>

          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <a
              href="#lead-form"
              className="rounded-2xl bg-[#C65A2A] px-6 py-3 text-sm font-semibold text-black transition hover:opacity-90"
            >
              Request a tailored systems call
            </a>
            <Link
              href="/the-academy"
              className="rounded-2xl border border-white/20 bg-black/25 px-6 py-3 text-sm font-semibold text-white transition hover:bg-black/35"
            >
              View Academy membership
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
};

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
}: FieldProps) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-white/80">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#C65A2A]/40"
      />
    </label>
  );
}
