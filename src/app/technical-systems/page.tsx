"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

type PurchasablePlan = "starter" | "pro" | "shop_hub" | "shop_flow" | "parts_app";

const SYSTEMS = [
  {
    title: "Shop-Flow",
    plan: "shop_flow" as PurchasablePlan,
    href: "/technical-systems/shop-flow",
    logo: "/shop_flow/brand/collision-flow-logo.svg",
    price: "$200/month",
    description: "Production workflow software for clearer handoffs, supplement handling, and operational visibility.",
    capabilities: ["Production queue visibility", "Estimate review checkpoints", "Cleaner handoff from analysis to action"],
  },
  {
    title: "Parts App",
    plan: "parts_app" as PurchasablePlan,
    href: "/technical-systems/parts-app",
    logo: "/parts_app/brand/collision-iq-parts-logo.svg",
    price: "$200/month",
    description: "Parts-focused process support for requests, queues, locator views, and management visibility.",
    capabilities: ["Parts request intake", "Queue and locator views", "Repeatable coordination decisions"],
  },
  {
    title: "Shop Hub",
    plan: "shop_hub" as PurchasablePlan,
    href: "/technical-systems/shop-hub",
    logo: "/iq/iq_logo.png",
    price: "$300/month",
    description: "A bundled operating layer that combines Shop-Flow and Parts App with virtual onboarding value.",
    capabilities: ["Includes both apps", "Lower bundled monthly price", "Free virtual onboarding included"],
  },
];

async function startCheckout(plan: PurchasablePlan) {
  const response = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  });

  const data = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (data?.url) {
    window.location.href = data.url;
    return;
  }

  if (!response.ok && /missing stripe price/i.test(data?.error ?? "")) {
    window.location.href = "/professional";
    return;
  }

  throw new Error(data?.error || "Unable to start checkout.");
}

export default function TechnicalSystemsPage() {
  const [activeCheckout, setActiveCheckout] = useState<PurchasablePlan | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

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

  return (
    <main className="min-h-screen bg-[#f7f9fc] text-[#102033]">
      <MarketingNav />

      <section className="mx-auto grid max-w-7xl items-center gap-10 px-6 py-16 lg:grid-cols-[0.95fr_1.05fr] lg:py-24">
        <div>
          <div className="inline-flex rounded-full border border-[#f26a2e]/20 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#c65a2a] shadow-sm">
            Technical Systems
          </div>
          <h1 className="mt-7 text-5xl font-bold leading-[1.04] tracking-tight text-[#0b1727] md:text-6xl">
            Purpose-built software for modern collision repair operations.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[#5a697a]">
            Extend Collision IQ into practical workflow systems for production, parts, and shop-wide coordination.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/professional" className="rounded-full bg-[#c65a2a] px-6 py-3 text-sm font-semibold text-white shadow-[0_18px_38px_rgba(198,90,42,0.24)] transition hover:bg-[#ad4d23]">
              Contact Professional Services
            </Link>
            <button type="button" onClick={() => void handleCheckout("pro")} disabled={activeCheckout === "pro"} className="rounded-full border border-[#dbe4ee] bg-white px-6 py-3 text-sm font-semibold text-[#102033] shadow-sm transition hover:border-[#c65a2a]/40 hover:text-[#c65a2a] disabled:opacity-60">
              {activeCheckout === "pro" ? "Opening..." : "Start 30-Day Free Trial"}
            </button>
          </div>
          {checkoutError ? <p className="mt-4 text-sm text-[#b43d2a]">{checkoutError}</p> : null}
        </div>

        <div className="rounded-[30px] border border-[#dfe7f0] bg-white p-5 shadow-[0_24px_80px_rgba(15,32,51,0.12)]">
          <Image src="/shop_flow/screenshots/shop_flow.png" alt="Shop-Flow dashboard preview" width={1100} height={720} priority className="h-auto w-full rounded-[22px] object-cover" />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16">
        <div className="grid gap-6 lg:grid-cols-3">
          {SYSTEMS.map((system) => (
            <article key={system.title} className="flex min-h-full flex-col rounded-[28px] border border-[#dfe7f0] bg-white p-6 shadow-[0_18px_48px_rgba(15,32,51,0.08)]">
              <div className="flex items-start justify-between gap-4">
                <div className="flex h-14 items-center">
                  <Image src={system.logo} alt={`${system.title} logo`} width={164} height={54} className="max-h-12 w-auto object-contain" />
                </div>
                <div className="rounded-full bg-[#fff2ec] px-3 py-1 text-sm font-semibold text-[#c65a2a]">{system.price}</div>
              </div>
              <p className="mt-5 text-sm leading-7 text-[#5a697a]">{system.description}</p>
              <ul className="mt-5 space-y-3 text-sm text-[#24364b]">
                {system.capabilities.map((capability) => (
                  <li key={capability} className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[#c65a2a]" />
                    <span>{capability}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex flex-wrap gap-3 pt-7">
                <Link href={system.href} className="rounded-full bg-[#102033] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#1b314b]">
                  View {system.title}
                </Link>
                <Link href={system.href} className="rounded-full border border-[#dbe4ee] px-5 py-3 text-sm font-semibold text-[#102033] transition hover:border-[#c65a2a]/40 hover:text-[#c65a2a]">
                  Learn more
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-20">
        <div className="rounded-[30px] bg-[#0b1727] p-8 text-white shadow-[0_24px_70px_rgba(11,23,39,0.22)] md:p-12">
          <div className="grid gap-8 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#f2a37b]">Launch with clarity</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">Start with Collision IQ, then add the systems your shop actually needs.</h2>
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => void handleCheckout("pro")} className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-[#102033] transition hover:bg-[#f4f7fb]">
                Start 30-day free trial
              </button>
              <Link href="/professional" className="rounded-full border border-white/18 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
                Contact sales
              </Link>
            </div>
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
          <Link href="/technical-systems" className="text-[#c65a2a]">Technical Systems</Link>
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
