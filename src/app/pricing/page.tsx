import Link from "next/link";

export default function PricingPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-16 text-white">
      <div className="rounded-[2rem] border border-white/10 bg-black/70 p-8 shadow-[0_24px_70px_rgba(0,0,0,0.45)] md:p-10">
        <div className="text-xs uppercase tracking-[0.24em] text-white/45">Membership</div>
        <h1 className="mt-3 text-4xl font-semibold md:text-5xl">30 days of Pro. Free, at sign-up.</h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-white/68 md:text-lg">
          Every new Collision iQ account starts with the full system for a month, one time. After that, stay on Free, or pick Starter or Pro. Your account activates the moment you subscribe.
        </p>

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          <PricingCard
            name="Free"
            eyebrow="$0"
            description="Quick-answer chat • Read aloud • History • Knowledge Base • 5 photo/document uploads per month • 3 image generations per month"
            features={[
              "Quick-answer chat",
              "Read aloud",
              "History",
              "Knowledge Base",
              "5 uploads per month",
              "3 image generations per month",
            ]}
            ctaText="Create account"
          />
          <PricingCard
            name="Starter"
            eyebrow="$50 / month"
            description="Everything in Free, plus: Research answers (OEM procedures, position statements, industry references) • 15 uploads per month • 10 image generations per month • Scan iQ • Snapshot customer report • My Vehicle"
            features={[
              "Research answers (OEM procedures, position statements)",
              "15 uploads per month",
              "10 image generations per month",
              "Scan iQ",
              "Snapshot customer report",
              "My Vehicle",
            ]}
            ctaText="Start with Starter"
          />
          <PricingCard
            name="Pro"
            eyebrow="$200 / month"
            description="All features, all reports. Only in Pro: full report set (Repair Intelligence, Delta Citation Density, OEM Citation Density, Customer Report, DOI packet) • CCC Secure Share import • Toolbox saved cases • 35 uploads per month • 20 image generations per month • 10% off other Collision Academy apps and services"
            features={[
              "Full report set (Repair Intelligence, Delta, OEM Citation Density, Customer Report, DOI packet)",
              "CCC Secure Share import",
              "Toolbox saved cases",
              "35 uploads per month",
              "20 image generations per month",
              "10% off other apps & services",
            ]}
            featured
            ctaText="Start 30 days free"
          />
        </div>

        <div className="mt-10 rounded-lg border border-white/10 bg-white/5 px-6 py-4">
          <p className="text-sm text-white/82">
            <strong>Value iQ</strong> (ACV and diminished value reports) is pay-per-report and available to every account.
          </p>
          <p className="mt-2 text-sm text-white/68">
            <strong>Enterprise — coming soon.</strong> Up to 1,000-analysis capacity, seats and organization controls. Not yet purchasable.
          </p>
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
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
  ctaText = "Start",
}: {
  name: string;
  eyebrow: string;
  description: string;
  features: string[];
  featured?: boolean;
  ctaText?: string;
}) {
  const isEnterprise = name === "Enterprise";

  return (
    <section
      className={`relative rounded-[1.75rem] border p-6 ${
        featured
          ? "border-orange-500/30 bg-gradient-to-br from-[var(--accent)]/16 via-black/70 to-black/50"
          : "border-white/10 bg-white/5"
      }`}
    >
      {featured && (
        <div className="absolute -top-3 right-6 rounded-full bg-[var(--accent)] px-3 py-1 text-xs font-semibold uppercase tracking-wider text-black">
          Everything unlocked
        </div>
      )}
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
      {!isEnterprise && (
        <Link
          href={name === "Free" ? "/sign-up" : "/sign-up"}
          className={`mt-6 block rounded-2xl px-5 py-3 text-center text-sm font-semibold transition ${
            featured
              ? "bg-[var(--accent)] text-black hover:bg-[var(--accent)]/90"
              : "border border-white/10 bg-white/5 text-white/85 hover:bg-white/10"
          }`}
        >
          {ctaText}
        </Link>
      )}
    </section>
  );
}
