import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth/require-current-user";
import { FUNNEL_STAGE_LABELS } from "@/lib/admin/conversionFunnel";
import { FUNNEL_WINDOWS_DAYS, loadConversionFunnel } from "@/lib/admin/conversionFunnelData";

export const dynamic = "force-dynamic";

type FunnelPageProps = {
  searchParams?: Promise<{ days?: string }>;
};

function resolveWindowDays(value: string | undefined): number | null {
  if (value === "all") return null;
  const parsed = Number.parseInt(value ?? "", 10);
  return FUNNEL_WINDOWS_DAYS.includes(parsed as (typeof FUNNEL_WINDOWS_DAYS)[number]) ? parsed : 90;
}

function formatDate(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : "—";
}

/**
 * Subscription conversion funnel — Platform Admin only, reached by direct URL.
 * Lists account emails so stalled signups and abandoned checkouts can be
 * contacted personally; never link it from customer navigation.
 */
export default async function ConversionFunnelPage({ searchParams }: FunnelPageProps) {
  let isPlatformAdmin = false;
  try {
    ({ isPlatformAdmin } = await requireCurrentUser());
  } catch {
    redirect("/");
  }
  if (!isPlatformAdmin) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-xl font-semibold">403 — Platform admin access is required</h1>
      </main>
    );
  }

  const windowDays = resolveWindowDays((await searchParams)?.days);
  const funnel = await loadConversionFunnel({ windowDays, now: new Date() });
  const signups = funnel.stages[0]?.count ?? 0;

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
      <header>
        <h1 className="text-2xl font-semibold">Conversion funnel</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Accounts that signed up {windowDays === null ? "at any time" : `in the last ${windowDays} days`},
          platform admins excluded. Built from existing account, upload, report and Stripe
          subscription records. Only an account&apos;s first checkout is recorded, so repeat
          abandoned checkouts are not counted.
        </p>
        <nav className="mt-3 flex gap-2 text-sm">
          {FUNNEL_WINDOWS_DAYS.map((days) => {
            const key = days === null ? "all" : String(days);
            const active = days === windowDays;
            return (
              <Link
                key={key}
                href={`/admin/funnel?days=${key}`}
                className={`rounded-lg border px-3 py-1 ${active ? "border-[var(--accent)] font-semibold" : "border-border"}`}
              >
                {days === null ? "All time" : `${days} days`}
              </Link>
            );
          })}
        </nav>
      </header>

      <section>
        <h2 className="text-lg font-semibold">Stages</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">Stage</th>
                <th className="py-2 pr-4">Accounts</th>
                <th className="py-2 pr-4">% of signups</th>
              </tr>
            </thead>
            <tbody>
              {funnel.stages.map((stage) => (
                <tr key={stage.stage} className="border-t border-border">
                  <td className="py-2 pr-4">{stage.label}</td>
                  <td className="py-2 pr-4 font-semibold">{stage.count}</td>
                  <td className="py-2 pr-4">
                    {stage.pctOfSignups === null ? "—" : `${stage.pctOfSignups}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Abandoned checkouts (started, never subscribed): <strong>{funnel.abandonedCheckouts}</strong>
          {" · "}Value iQ report purchases: <strong>{funnel.valueIqPurchases}</strong>
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Accounts ({signups})</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Furthest along first: these are the people closest to paying.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">Account</th>
                <th className="py-2 pr-4">Furthest stage</th>
                <th className="py-2 pr-4">Signed up</th>
                <th className="py-2 pr-4">First upload</th>
                <th className="py-2 pr-4">First report</th>
                <th className="py-2 pr-4">Checkout</th>
                <th className="py-2 pr-4">Subscription</th>
              </tr>
            </thead>
            <tbody>
              {funnel.accounts.map((account) => (
                <tr key={account.userId} className="border-t border-border align-top">
                  <td className="py-2 pr-4">
                    <div>{account.email ?? "(no email)"}</div>
                    {account.name && <div className="text-muted-foreground">{account.name}</div>}
                  </td>
                  <td className="py-2 pr-4">
                    {FUNNEL_STAGE_LABELS[account.furthestStage]}
                    {account.abandonedCheckout && (
                      <div className="font-semibold text-[var(--accent)]">Abandoned checkout</div>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {formatDate(account.signedUpAt)}
                    <div className="text-muted-foreground">{account.daysSinceSignup}d ago</div>
                  </td>
                  <td className="py-2 pr-4">{formatDate(account.firstUploadAt)}</td>
                  <td className="py-2 pr-4">{formatDate(account.firstReportAt)}</td>
                  <td className="py-2 pr-4">{formatDate(account.checkoutStartedAt)}</td>
                  <td className="py-2 pr-4">
                    {account.subscriptionStatus ?? "—"}
                    {account.valueIqPaidAt && (
                      <div className="text-muted-foreground">Value iQ paid {formatDate(account.valueIqPaidAt)}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
