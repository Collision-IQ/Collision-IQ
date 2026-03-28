import Link from "next/link";

export default function PricingPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-16 text-white">
      <div className="rounded-[2rem] border border-white/10 bg-black/70 p-8 shadow-[0_24px_70px_rgba(0,0,0,0.45)] md:p-10">
        <div className="text-xs uppercase tracking-[0.24em] text-white/45">Pricing</div>
        <h1 className="mt-3 text-3xl font-semibold md:text-4xl">Starter, Pro, and Team access</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-white/68 md:text-base">
          Collision IQ phase one uses account-backed access. Starter keeps the core workflow available after sign-in,
          Pro unlocks advanced supplement and export workflows, and Team adds shop-ready membership structure with pooled analysis usage.
        </p>

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          <PricingCard
            name="Starter"
            eyebrow="Public access"
            description="Core chat, uploads, at-a-glance, what stands out, vehicle context, and standard PDF export."
            features={[
              "Basic AI chat",
              "Estimate and document uploads",
              "At-a-glance repair position",
              "Vehicle and VIN context",
              "Basic PDF export",
            ]}
          />
          <PricingCard
            name="Pro"
            eyebrow="Advanced workflows"
            description="For users who need export-ready supplement strategy, negotiation drafting, and richer comparison outputs."
            features={[
              "Supplement lines",
              "Negotiation draft",
              "Rebuttal email export",
              "Side-by-side report",
              "Line-by-line report",
            ]}
            featured
          />
          <PricingCard
            name="Team"
            eyebrow="Shop-ready"
            description="Built for shared shop context, pooled usage, and seat-aware subscription structure."
            features={[
              "Everything in Pro",
              "Shop-aware subscription ownership",
              "Seat-ready membership structure",
              "Pooled analysis usage",
              "Org-ready upgrade path",
            ]}
          />
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/sign-up"
            className="rounded-2xl bg-[#C65A2A] px-5 py-3 text-sm font-semibold text-black transition hover:bg-[#C65A2A]/90"
          >
            Create account
          </Link>
          <Link
            href="/billing"
            className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-white/85 transition hover:bg-white/10"
          >
            Manage billing
          </Link>
          <Link
            href="/chatbot"
            className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-white/85 transition hover:bg-white/10"
          >
            Back to chatbot
          </Link>
        </div>
      </div>
    </main>
  );
}

function PricingCard({
  name,
  eyebrow,
  description,
  features,
  featured = false,
}: {
  name: string;
  eyebrow: string;
  description: string;
  features: string[];
  featured?: boolean;
}) {
  return (
    <section
      className={`rounded-[1.75rem] border p-6 ${
        featured
          ? "border-orange-500/30 bg-gradient-to-br from-[#C65A2A]/16 via-black/70 to-black/50"
          : "border-white/10 bg-white/5"
      }`}
    >
      <div className="text-xs uppercase tracking-[0.2em] text-white/45">{eyebrow}</div>
      <h2 className="mt-3 text-2xl font-semibold">{name}</h2>
      <p className="mt-4 text-sm leading-6 text-white/68">{description}</p>
      <ul className="mt-6 space-y-3 text-sm text-white/82">
        {features.map((feature) => (
          <li key={feature} className="rounded-xl border border-white/8 bg-black/20 px-3 py-3">
            {feature}
          </li>
        ))}
      </ul>
    </section>
  );
}
