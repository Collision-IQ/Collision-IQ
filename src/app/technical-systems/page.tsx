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

type PurchasablePlan =
  | "starter"
  | "pro"
  | "executive_onboarding"
  | "virtual_onboarding"
  | "shop_hub"
  | "shop_flow"
  | "parts_app";

const INITIAL_FORM: LeadFormState = {
  name: "",
  business: "",
  email: "",
  phone: "",
  shopSize: "",
  currentWorkflow: "",
  goals: "",
};

const SUBSCRIPTIONS = [
  {
    title: "Starter",
    plan: "starter" as PurchasablePlan,
    priceLabel: "$50/month",
    features: ["Chat access", "1 upload", "1 export", "Best for lighter usage after trial"],
  },
  {
    title: "Pro",
    plan: "pro" as PurchasablePlan,
    priceLabel: "$200/month",
    features: [
      "Full Collision IQ features",
      "Advanced analysis",
      "Full upload/export workflow",
      "Best for full production use",
    ],
  },
];

const SYSTEMS = [
  {
    title: "Shop-Flow",
    plan: "shop_flow" as PurchasablePlan,
    priceLabel: "$200/month",
    description:
      "Tailored workflow software for estimate review, supplement handling, and cleaner repair-process execution.",
    highlights: [
      "Workflow consistency across staff",
      "Cleaner estimate review process",
      "Faster handoff from analysis to action",
    ],
  },
  {
    title: "Parts App",
    plan: "parts_app" as PurchasablePlan,
    priceLabel: "$200/month",
    description:
      "Parts-focused process support and decision guidance inside the repair workflow.",
    highlights: [
      "Parts-focused process support",
      "Faster internal coordination",
      "More repeatable operational decisions",
    ],
  },
  {
    title: "Shop Hub",
    plan: "shop_hub" as PurchasablePlan,
    priceLabel: "$300/month",
    description:
      "A bundled operating system that includes both apps with a lower monthly price and free virtual onboarding.",
    highlights: [
      "Includes both apps",
      "Lower bundled monthly price",
      "Includes free virtual onboarding",
    ],
  },
];

const ONBOARDING = [
  {
    title: "Executive On-Boarding",
    plan: "executive_onboarding" as PurchasablePlan,
    priceLabel: "$1,250 one-time",
  },
  {
    title: "Virtual On-Boarding",
    plan: "virtual_onboarding" as PurchasablePlan,
    priceLabel: "$200 one-time",
  },
];

async function startCheckout(plan: PurchasablePlan) {
  const response = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

  throw new Error("Checkout URL missing.");
}

export default function TechnicalSystemsPage() {
  const [form, setForm] = useState(INITIAL_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [leadError, setLeadError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [activeCheckout, setActiveCheckout] = useState<PurchasablePlan | null>(null);

  function update<K extends keyof LeadFormState>(key: K, value: LeadFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function scrollToLeadForm() {
    document.getElementById("lead-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleCheckout(plan: PurchasablePlan) {
    try {
      setCheckoutError(null);
      setActiveCheckout(plan);
      await startCheckout(plan);
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : "Unable to start checkout.");
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to submit request.");
      }
      setSubmitted(true);
      setForm(INITIAL_FORM);
    } catch (error) {
      setLeadError(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <Link href="/the-academy" className="flex items-center gap-3">
            <Image
              src="/iq/iq_logo-white.png"
              alt="Collision IQ"
              width={140}
              height={28}
              className="h-[28px] w-auto"
              priority
            />
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/the-academy" className="rounded-2xl border border-white/12 bg-white/5 px-4 py-2 text-sm text-white/85 transition hover:bg-white/10">Professional Services</Link>
            <Link href="/" className="rounded-2xl bg-[#C65A2A] px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90">Open Collision IQ</Link>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-8 px-5 py-16 md:grid-cols-[1.15fr_0.85fr]">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#C65A2A]/30 bg-[#C65A2A]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#E88A5F]">Technical Systems</div>
          <div className="mb-2 mt-5 text-sm text-white/40">Collision IQ Systems</div>
          <h1 className="mt-6 max-w-4xl text-4xl font-bold leading-tight tracking-tight md:text-6xl">Collision IQ subscriptions, shop apps, and tailored systems for repair centers.</h1>
          <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/75">Technical Systems is the product-and-systems layer under Collision Academy. Start with Collision IQ, then extend into Shop-Flow, Parts App, Shop Hub, onboarding, and tailored implementations.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button type="button" onClick={scrollToLeadForm} className="rounded-2xl bg-[#C65A2A] px-6 py-3 text-sm font-semibold text-black shadow-[0_10px_30px_rgba(198,90,42,0.25)] transition hover:opacity-90">Request a tailored systems call</button>
            <button type="button" onClick={() => void handleCheckout("pro")} disabled={activeCheckout === "pro"} className="rounded-2xl border border-white/20 bg-black/25 px-6 py-3 text-sm font-semibold text-white transition hover:bg-black/35 disabled:opacity-60">{activeCheckout === "pro" ? "Redirecting..." : "Start 30-Day Free Trial"}</button>
          </div>
          <div className="mt-8 grid gap-3 text-sm text-white/70 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">Built around real collision workflows</div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">Designed around your process, not generic software</div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">Strong fit for growing shops, groups, and multi-person teams</div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">Best paired with Collision IQ Pro subscription</div>
          </div>
          {checkoutError ? <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{checkoutError}</div> : null}
        </div>

        <div className="rounded-3xl border border-[#C65A2A]/25 bg-black/40 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.65)] backdrop-blur-xl">
          <div className="text-sm font-semibold uppercase tracking-[0.16em] text-[#E88A5F]">Collision IQ access</div>
          <h2 className="mt-3 text-2xl font-semibold">Every new account begins with a 30-day free Collision IQ trial</h2>
          <p className="mt-4 text-sm leading-7 text-white/75">All new Collision IQ accounts begin with a 30-day free trial. After the trial, users can continue on Starter for lighter usage or Pro for the full production workflow.</p>
          <ul className="mt-5 space-y-2 text-sm text-white/70">
            <li>- Start with a 30-day free Collision IQ trial</li>
            <li>- Continue on Starter for lighter usage</li>
            <li>- Move to Pro for full production use</li>
            <li>- Extend into systems, onboarding, or tailored builds</li>
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-10">
        <h2 className="text-2xl font-semibold">Collision IQ subscriptions</h2>
        <p className="mt-2 max-w-3xl text-sm text-white/60">Every new account begins with a 30-day free trial before selecting Starter or Pro.</p>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          {SUBSCRIPTIONS.map((item) => (
            <div key={item.title} className={`rounded-3xl border p-6 shadow-[0_25px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl ${item.title === "Pro" ? "border-[#C65A2A]/40 bg-black/35" : "border-white/10 bg-black/30"}`}>
              <div className="text-lg font-semibold">{item.title}</div>
              <div className="mt-2 text-2xl font-bold">{item.priceLabel}</div>
              <ul className="mt-4 space-y-2 text-sm text-white/70">{item.features.map((feature) => <li key={feature} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">{feature}</li>)}</ul>
              <button type="button" onClick={() => void handleCheckout(item.plan)} disabled={activeCheckout === item.plan} className={`mt-6 w-full rounded-2xl px-4 py-3 text-sm font-semibold transition disabled:opacity-60 ${item.title === "Pro" ? "bg-[#C65A2A] text-black hover:opacity-90" : "border border-white/20 bg-black/25 text-white hover:bg-black/35"}`}>{activeCheckout === item.plan ? "Redirecting..." : item.title === "Starter" ? "Choose a Collision IQ Plan" : "Start 30-Day Free Trial"}</button>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-10">
        <h2 className="text-2xl font-semibold">Available systems</h2>
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          {SYSTEMS.map((item) => (
            <div key={item.title} className="rounded-3xl border border-white/10 bg-black/30 p-6 shadow-[0_25px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl">
              <div className="flex items-start justify-between gap-4">
                <h3 className="text-2xl font-semibold">{item.title}</h3>
                <div className="text-sm font-medium text-[#E88A5F]">{item.priceLabel}</div>
              </div>
              <p className="mt-3 text-sm leading-7 text-white/70">{item.description}</p>
              <ul className="mt-4 space-y-2 text-sm text-white/70">{item.highlights.map((highlight) => <li key={highlight} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">{highlight}</li>)}</ul>
              <div className="mt-6 flex flex-wrap gap-3">
                <button type="button" onClick={() => void handleCheckout(item.plan)} disabled={activeCheckout === item.plan} className="rounded-2xl bg-[#C65A2A] px-5 py-3 text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-60">{activeCheckout === item.plan ? "Redirecting..." : `Get ${item.title}`}</button>
                <button type="button" onClick={scrollToLeadForm} className="rounded-2xl border border-white/20 bg-black/25 px-5 py-3 text-sm font-semibold text-white transition hover:bg-black/35">Ask about tailoring this</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-10">
        <div className="grid gap-6 md:grid-cols-2">
          {ONBOARDING.map((item) => (
            <div key={item.title} className="rounded-3xl border border-white/10 bg-black/30 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.6)] backdrop-blur-xl">
              <div className="flex items-start justify-between gap-4">
                <div className="text-xl font-semibold">{item.title}</div>
                <div className="text-sm font-medium text-[#E88A5F]">{item.priceLabel}</div>
              </div>
              <button type="button" onClick={() => void handleCheckout(item.plan)} disabled={activeCheckout === item.plan} className="mt-5 rounded-2xl bg-[#C65A2A] px-5 py-3 text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-60">{activeCheckout === item.plan ? "Redirecting..." : `Buy ${item.title}`}</button>
            </div>
          ))}
        </div>
      </section>

      <section id="lead-form" className="mx-auto max-w-6xl px-5 py-10">
        <div className="grid gap-6 md:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-3xl border border-white/10 bg-black/30 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.6)] backdrop-blur-xl">
            <div className="text-xl font-semibold">Collision IQ is the on-ramp into Technical Systems</div>
            <p className="mt-3 text-sm leading-7 text-white/70">Start with the 30-day Collision IQ trial, then continue on Starter or Pro based on how your team works. From there, extend into systems, onboarding, and tailored implementation.</p>
          </div>

          <form onSubmit={handleSubmit} className="rounded-3xl border border-[#C65A2A]/20 bg-black/30 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.6)] backdrop-blur-xl">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Your name" value={form.name} onChange={(value) => update("name", value)} required />
              <Field label="Business / shop" value={form.business} onChange={(value) => update("business", value)} required />
              <Field label="Email" value={form.email} onChange={(value) => update("email", value)} type="email" required />
              <Field label="Phone" value={form.phone} onChange={(value) => update("phone", value)} />
              <Field label="Shop size" value={form.shopSize} onChange={(value) => update("shopSize", value)} />
              <Field label="Current workflow pain point" value={form.currentWorkflow} onChange={(value) => update("currentWorkflow", value)} />
            </div>
            <div className="mt-4">
              <label className="mb-2 block text-sm font-medium text-white/80">What would you want the system to improve?</label>
              <textarea value={form.goals} onChange={(e) => update("goals", e.target.value)} rows={6} required className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#C65A2A]/40" />
            </div>
            {submitted ? <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">Your request was submitted. We can now review whether a tailored system fits your workflow.</div> : null}
            {leadError ? <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{leadError}</div> : null}
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="submit" disabled={isSubmitting} className="rounded-2xl bg-[#C65A2A] px-6 py-3 text-sm font-semibold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? "Submitting..." : "Request systems call"}</button>
              <button type="button" onClick={() => void handleCheckout("pro")} disabled={activeCheckout === "pro"} className="rounded-2xl border border-white/20 bg-black/25 px-6 py-3 text-sm font-semibold text-white transition hover:bg-black/35 disabled:opacity-60">{activeCheckout === "pro" ? "Redirecting..." : "Start 30-Day Free Trial"}</button>
            </div>
          </form>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16 pt-6">
        <div className="rounded-3xl border border-white/10 bg-black/30 p-6 text-center shadow-[0_30px_90px_rgba(0,0,0,0.6)] backdrop-blur-xl md:p-8">
          <h2 className="text-3xl font-semibold tracking-tight">Build your process advantage</h2>
          <p className="mx-auto mt-4 max-w-3xl text-sm leading-7 text-white/70">Collision IQ helps teams analyze files. Technical Systems helps them turn that intelligence into a workflow system tailored to how the business actually runs.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button type="button" onClick={scrollToLeadForm} className="rounded-2xl bg-[#C65A2A] px-6 py-3 text-sm font-semibold text-black transition hover:opacity-90">Request a tailored systems call</button>
            <Link href="/the-academy" className="rounded-2xl border border-white/20 bg-black/25 px-6 py-3 text-sm font-semibold text-white transition hover:bg-black/35">View Professional Services</Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-white/80">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#C65A2A]/40" />
    </label>
  );
}
