import Link from "next/link";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const access = await getCurrentEntitlements();

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-16 text-white">
      <div className="rounded-3xl border border-white/10 bg-black/70 p-8 shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
        <div className="text-xs uppercase tracking-[0.24em] text-white/45">Billing</div>
        <h1 className="mt-3 text-3xl font-semibold">Upgrade and manage your plan</h1>

        <p className="mt-3 text-sm text-white/65">
          Collision IQ is subscription-based. Subscribe to Starter or Pro and get immediate access
          — no trial period, no waiting. Subscriptions renew monthly and can be modified or
          canceled at any time through the billing portal.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <PlanCard
            name="Starter"
            price="$50/month"
            description="Chat + document upload + basic analysis + 1 main report export per billing period."
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
              className="rounded-2xl bg-[#C65A2A] px-5 py-3 text-sm font-semibold text-black transition hover:bg-[#C65A2A]/90"
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
        featured ? "border-[#C65A2A]/40" : "border-white/10"
      } bg-white/5 p-5`}
    >
      <div className="text-xs uppercase tracking-[0.2em] text-white/45">{name}</div>
      <div className="mt-3 text-xl font-semibold text-white">{price}</div>
      <p className="mt-3 text-sm leading-6 text-white/65">{description}</p>
    </div>
  );
}
