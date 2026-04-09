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
          Starter keeps core chat and basic export. Pro unlocks advanced analysis outputs and premium export formats. Team adds org-ready seats and pooled usage.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <PlanCard name="Starter" price="Included" description="Basic chat, uploads, at-a-glance, vehicle context, and standard PDF export." />
          <PlanCard name="Pro" price="Stripe plan" description="Supplement lines, negotiation draft, rebuttal email, side-by-side, and line-by-line exports." />
          <PlanCard name="Team" price="Stripe plan" description="Shared shop support, membership structure, and pooled usage." />
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <form action="/api/billing/checkout" method="post">
            <input type="hidden" name="plan" value={access.plan === "starter" ? "pro" : "team"} />
            <button
              type="submit"
              className="rounded-2xl bg-[#C65A2A] px-5 py-3 text-sm font-semibold text-black transition hover:bg-[#C65A2A]/90"
            >
              {access.plan === "starter" ? "Upgrade to Pro" : "Open Team Checkout"}
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
}: {
  name: string;
  price: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="text-xs uppercase tracking-[0.2em] text-white/45">{name}</div>
      <div className="mt-3 text-xl font-semibold text-white">{price}</div>
      <p className="mt-3 text-sm leading-6 text-white/65">{description}</p>
    </div>
  );
}
