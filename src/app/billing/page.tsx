import Link from "next/link";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";
import { PLAN_CAPS, PRO_TRIAL_DAYS } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";

type BillingPageProps = {
  searchParams?: Promise<{ offer?: string; pilot?: string }>;
};

export default async function BillingPage({ searchParams }: BillingPageProps) {
  const access = await getCurrentEntitlements();
  const params = (await searchParams) ?? {};
  const showFoundingPilot = params.offer === "founding-pilot";

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-16 text-white">
      <div className="rounded-3xl border border-white/10 bg-black/70 p-8 shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
        <div className="text-xs uppercase tracking-[0.24em] text-white/45">Billing</div>
        <h1 className="mt-3 text-3xl font-semibold">Upgrade and manage your plan</h1>

        <p className="mt-3 text-sm text-white/65">
          Every new account starts with {PRO_TRIAL_DAYS} days of Pro, free, one time. Subscribe to
          Starter or Pro at any point and access is immediate. Subscriptions renew monthly and can
          be modified or canceled at any time through the billing portal.
        </p>

        {showFoundingPilot && (
          <FoundingPilotCard
            isAuthenticated={access.isAuthenticated}
            isFull={params.pilot === "full"}
          />
        )}

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <PlanCard
            name="Starter"
            price="$50/month"
            description={`Research answers (OEM procedures, position statements) • ${PLAN_CAPS.starter} uploads per month • Scan iQ • Snapshot customer report • My Vehicle.`}
          />
          <PlanCard
            name="Pro"
            price="$200/month"
            description="Full system access — advanced analysis, supplement lines, negotiation tools, rebuttal email, and all premium exports."
            featured
          />
        </div>

        <div className="mt-6 text-sm text-white/60">
          Current access:{" "}
          {access.plan === "pro"
            ? "Pro"
            : access.plan === "starter"
              ? "Starter"
              : access.plan === "trial"
                ? "Pro (legacy trial)"
                : access.plan === "team"
                  ? "Team"
                  : "No active subscription"}
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <form action="/api/billing/checkout" method="post">
            <input type="hidden" name="plan" value="starter" />
            <button
              type="submit"
              className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-white/85 transition hover:bg-white/10"
            >
              Subscribe to Starter ($50/month)
            </button>
          </form>

          <form action="/api/billing/checkout" method="post">
            <input type="hidden" name="plan" value="pro" />
            <button
              type="submit"
              className="rounded-2xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-black transition hover:bg-[var(--accent)]/90"
            >
              Subscribe to Pro ($200/month)
            </button>
          </form>

          <form action="/api/billing/portal" method="post">
            <button
              type="submit"
              className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-white/85 transition hover:bg-white/10"
            >
              Open billing portal
            </button>
          </form>

          <Link
            href="/account"
            className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-white/85 transition hover:bg-white/10"
          >
            Back to account
          </Link>
        </div>
      </div>
    </main>
  );
}

function PlanCard({
  name,
  price,
  description,
  featured = false,
}: {
  name: string;
  price: string;
  description: string;
  featured?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border ${
        featured ? "border-[var(--accent)]/40" : "border-white/10"
      } bg-white/5 p-5`}
    >
      <div className="text-xs uppercase tracking-[0.2em] text-white/45">{name}</div>
      <div className="mt-3 text-xl font-semibold text-white">{price}</div>
      <p className="mt-3 text-sm leading-6 text-white/65">{description}</p>
    </div>
  );
}

function FoundingPilotCard({
  isAuthenticated,
  isFull,
}: {
  isAuthenticated: boolean;
  isFull: boolean;
}) {
  return (
    <section className="mt-8 rounded-2xl border border-[var(--accent)]/50 bg-[var(--accent)]/10 p-6">
      <div className="text-xs uppercase tracking-[0.2em] text-white/55">Founding Shop Pilot</div>
      <div className="mt-3 text-2xl font-semibold text-white">
        Pro at $99/month for your first 3 months
      </div>
      <p className="mt-3 text-sm leading-6 text-white/75">
        Full Pro access, a guided onboarding session, and your first estimate reviewed together,
        live. After 3 months it continues as standard Pro at $200/month. Cancel anytime. Limited
        to the first 10 shops.
      </p>
      {isFull ? (
        <p className="mt-5 text-sm font-semibold text-white">
          All 10 pilot spots have been taken. Standard Pro is available below.
        </p>
      ) : isAuthenticated ? (
        <form action="/api/billing/checkout" method="post" className="mt-5">
          <input type="hidden" name="plan" value="founding-pilot" />
          <button
            type="submit"
            className="rounded-2xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-black transition hover:bg-[var(--accent)]/90"
          >
            Claim a pilot spot ($99/month)
          </button>
        </form>
      ) : (
        <div className="mt-5">
          <Link
            href="/sign-up"
            className="inline-block rounded-2xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-black transition hover:bg-[var(--accent)]/90"
          >
            Create your account to claim a spot
          </Link>
          <p className="mt-3 text-xs text-white/60">
            Already have an account? <Link href="/sign-in" className="underline">Sign in</Link>, then
            return to this link to claim your spot.
          </p>
        </div>
      )}
    </section>
  );
}
