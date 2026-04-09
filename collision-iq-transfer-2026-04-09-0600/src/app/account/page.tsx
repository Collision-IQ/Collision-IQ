import Link from "next/link";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const access = await getCurrentEntitlements();

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-16 text-white">
      <div className="rounded-3xl border border-white/10 bg-black/70 p-8 shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
        <div className="text-xs uppercase tracking-[0.24em] text-white/45">Account</div>
        <h1 className="mt-3 text-3xl font-semibold">Plan and access</h1>
        <p className="mt-3 text-sm text-white/65">
          Authentication, billing, and usage are now scaffolded against the live app structure.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <StatCard label="Authenticated" value={access.isAuthenticated ? "Yes" : "No"} />
          <StatCard label="Plan" value={access.plan.toUpperCase()} />
          <StatCard
            label="Completed analyses this month"
            value={
              access.monthlyAnalysisLimit === null
                ? `${access.monthlyAnalysisUsed}`
                : `${access.monthlyAnalysisUsed} / ${access.monthlyAnalysisLimit}`
            }
          />
          <StatCard label="Consent" value={access.consentStatus ?? "LOCAL_ONLY"} />
          <StatCard label="Active shop" value={access.activeShopId ?? "None"} />
          <StatCard label="Subscription" value={access.activeSubscriptionId ?? "None"} />
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/billing"
            className="rounded-2xl bg-[#C65A2A] px-5 py-3 text-sm font-semibold text-black transition hover:bg-[#C65A2A]/90"
          >
            Manage billing
          </Link>
          <Link
            href="/dashboard"
            className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-white/85 transition hover:bg-white/10"
          >
            View dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="text-xs uppercase tracking-[0.2em] text-white/45">{label}</div>
      <div className="mt-3 text-xl font-semibold text-white">{value}</div>
    </div>
  );
}
