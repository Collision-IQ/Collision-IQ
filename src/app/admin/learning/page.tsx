import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth/require-current-user";
import { getLearningDashboardMetrics } from "@/lib/learning/dashboardMetrics";
import { LearningAdminActions } from "./LearningAdminActions";

export const dynamic = "force-dynamic";

/**
 * Collision Learning Engine dashboard — Platform Admin only. This page is
 * deliberately NOT linked from any non-admin navigation; it is reached by
 * direct URL during the 90-day qualification period.
 */
export default async function LearningAdminPage() {
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
        <p className="mt-2 text-sm text-muted-foreground">
          The Collision Learning Engine is restricted to platform administrators during the
          qualification period.
        </p>
      </main>
    );
  }

  const metrics = await getLearningDashboardMetrics();
  const format = (value: number | null, digits = 2) =>
    value === null ? "—" : (Math.round(value * 10 ** digits) / 10 ** digits).toString();

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
      <header>
        <h1 className="text-2xl font-semibold">Collision Learning Engine</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Admin-only 90-day learning &amp; evaluation system. Separate from user report memory;
          nothing here changes production behavior without an explicit admin promotion.
        </p>
      </header>

      <LearningAdminActions />

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ["Due reviews", String(metrics.dueNow)],
          ["Critical failures (30d)", String(metrics.criticalFailures)],
          ["Citation fidelity (30d avg)", format(metrics.citationFidelityAverage)],
          ["Unsupported-claim rate (30d avg)", format(metrics.unsupportedClaimRateAverage)],
          ["Safety-item recall (30d avg)", format(metrics.safetyRecallAverage)],
          ["Source invalidations", String(metrics.sourceInvalidations)],
          ["Verified items", String(metrics.itemCounts.VERIFIED ?? 0)],
          ["Promoted items", String(metrics.itemCounts.PROMOTED ?? 0)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="mt-1 text-2xl font-semibold">{value}</div>
          </div>
        ))}
      </section>

      <section>
        <h2 className="text-lg font-semibold">Domain mastery (30 days, weakest first)</h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2">Domain</th>
                <th className="px-3 py-2">Attempts</th>
                <th className="px-3 py-2">Average grade (0–5)</th>
              </tr>
            </thead>
            <tbody>
              {metrics.domainMastery.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-muted-foreground" colSpan={3}>
                    No attempts recorded yet — run a sprint to populate mastery data.
                  </td>
                </tr>
              ) : (
                metrics.domainMastery.map((row) => (
                  <tr key={row.domain} className="border-t border-border">
                    <td className="px-3 py-2">{row.domain}</td>
                    <td className="px-3 py-2">{row.attemptCount}</td>
                    <td className="px-3 py-2">{row.averageGrade ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Recurring error patterns</h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2">Severity</th>
                <th className="px-3 py-2">Domain</th>
                <th className="px-3 py-2">Error code</th>
                <th className="px-3 py-2">Occurrences</th>
                <th className="px-3 py-2">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {metrics.recurringErrors.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-muted-foreground" colSpan={5}>
                    No open errors.
                  </td>
                </tr>
              ) : (
                metrics.recurringErrors.map((error, index) => (
                  <tr key={`${error.domain}-${error.errorCode}-${index}`} className="border-t border-border">
                    <td className="px-3 py-2">{error.severity}</td>
                    <td className="px-3 py-2">{error.domain}</td>
                    <td className="px-3 py-2">{error.errorCode}</td>
                    <td className="px-3 py-2">{error.occurrenceCount}</td>
                    <td className="px-3 py-2">{new Date(error.lastSeenAt).toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Promotion queue (VERIFIED, non-holdout)</h2>
        <ul className="mt-3 space-y-2">
          {metrics.promotionQueue.length === 0 ? (
            <li className="text-sm text-muted-foreground">Nothing awaiting promotion.</li>
          ) : (
            metrics.promotionQueue.map((item) => (
              <li key={item.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                <span className="font-medium">{item.slug}</span>
                <span className="ml-2 text-muted-foreground">{item.domain}</span>
                {item.safetyCritical ? (
                  <span className="ml-2 rounded bg-red-500/15 px-1.5 py-0.5 text-xs text-red-400">
                    safety-critical
                  </span>
                ) : null}
              </li>
            ))
          )}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Benchmark trend</h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2">Run</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Completed</th>
                <th className="px-3 py-2">Frozen</th>
                <th className="px-3 py-2">Metrics</th>
              </tr>
            </thead>
            <tbody>
              {metrics.benchmarkTrend.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-muted-foreground" colSpan={6}>
                    No benchmark runs yet.
                  </td>
                </tr>
              ) : (
                metrics.benchmarkTrend.map((run) => (
                  <tr key={run.id} className="border-t border-border">
                    <td className="px-3 py-2">{run.label}</td>
                    <td className="px-3 py-2">{run.kind}</td>
                    <td className="px-3 py-2">{new Date(run.startedAt).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      {run.completedAt ? new Date(run.completedAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2">{run.frozen ? "yes" : "no"}</td>
                    <td className="max-w-[280px] truncate px-3 py-2 text-xs text-muted-foreground">
                      {run.metrics ? JSON.stringify(run.metrics) : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
