import Link from "next/link";

export default function PricingPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-16 text-white">
      <div className="rounded-[2rem] border border-white/10 bg-black/70 p-8 shadow-[0_24px_70px_rgba(0,0,0,0.45)] md:p-10">
        <div className="text-xs uppercase tracking-[0.24em] text-white/45">Pricing</div>
        <h1 className="mt-3 text-3xl font-semibold md:text-4xl">Starter and Pro subscriptions</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-white/68 md:text-base">
          Collision IQ is subscription-based with instant access. Subscribe to Starter or Pro
          and your account activates immediately — no waiting, no manual setup.
          Starter covers essential analysis and one export per period. Pro unlocks the full system.
        </p>

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          <PricingCard
            name="Starter"
            eyebrow="$50 / month"
            description="Essential access for single-file reviews. Upload, analyze, and export one main report per billing period."
            features={[
              "AI chat",
              "1 document upload per period",
              "Basic analysis",
              "1 main report export",
              "Instant access on subscribe",
            ]}
          />
          <PricingCard
            name="Pro"
            eyebrow="$200 / month"
            description="All features unlocked with full analysis capacity, all exports, and every premium workflow."
            features={[
              "Everything in Starter",
              "Supplement lines",
              "Negotiation draft",
              "Rebuttal email export",
              "Side-by-side report",
              "Line-by-line report",
              "Instant access on subscribe",
            ]}
            featured
          />
          <PricingCard
            name="Enterprise"
            eyebrow="Coming soon"
            description="Enterprise-scale capacity and controls are planned, but not yet available for checkout."
            features={[
              "Up to 1000 analysis capacity",
              "Organization-level controls",
              "Seat and membership management",
              "Dedicated rollout path",
              "Not currently purchasable",
            ]}
          />
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/sign-up"
            className="rounded-2xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-black transition hover:bg-[var(--accent)]/90"
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
            href="/"
            className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-white/85 transition hover:bg-white/10"
          >
            Back to Collision IQ
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
          ? "border-orange-500/30 bg-gradient-to-br from-[var(--accent)]/16 via-black/70 to-black/50"
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
