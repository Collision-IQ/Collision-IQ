import Link from "next/link";
import { getOrCreateAppUser } from "@/lib/auth/get-or-create-app-user";
import { UnauthorizedError } from "@/lib/auth/require-current-user";
import { getUserServiceCases } from "@/lib/academy/serviceCases";

type ServiceCasesPageProps = {
  searchParams?: Promise<{ checkout?: string; session_id?: string }>;
};

const statusLabels: Record<string, string> = {
  PENDING_INTAKE: "Pending review",
  IN_REVIEW: "In review",
  IN_PROGRESS: "In progress",
  AWAITING_INFO: "Awaiting information",
  COMPLETE: "Complete",
  CANCELLED: "Cancelled",
};

function formatStatus(status: string): string {
  return statusLabels[status] ?? status.replace(/_/g, " ").toLowerCase();
}

function countAttachments(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export default async function ServiceCasesPage({
  searchParams,
}: ServiceCasesPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};

  let dbUser: Awaited<ReturnType<typeof getOrCreateAppUser>>;
  try {
    dbUser = await getOrCreateAppUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return (
        <main className="min-h-screen bg-slate-950 px-5 py-12 text-slate-100">
          <section className="mx-auto max-w-3xl rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <h1 className="text-2xl font-semibold">Service Cases</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Sign in to view your Collision Academy service cases.
            </p>
            <Link
              href="/sign-in"
              className="mt-5 inline-flex rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-black"
            >
              Sign in
            </Link>
          </section>
        </main>
      );
    }
    throw error;
  }

  const cases = await getUserServiceCases(dbUser.id);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <section className="mx-auto w-full max-w-6xl px-4 py-10 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Service Cases</h1>
            <p className="mt-2 text-sm text-slate-300">
              Your Collision Academy service requests and payment-backed intake records.
            </p>
          </div>
          <Link
            href="/"
            className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            Back to workspace
          </Link>
        </div>

        {resolvedSearchParams.checkout === "success" && (
          <div className="mt-6 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            Payment received. Your service case has been submitted for review.
          </div>
        )}

        <div className="mt-8 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
              <thead className="bg-slate-900/90 text-xs uppercase tracking-[0.14em] text-slate-400">
                <tr>
                  <th className="px-4 py-3">Service type</th>
                  <th className="px-4 py-3">Claim ID</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Files</th>
                  <th className="px-4 py-3">Stripe session</th>
                  <th className="px-4 py-3">Last update</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-200">
                {cases.map((serviceCase) => (
                  <tr key={serviceCase.id}>
                    <td className="px-4 py-3">{serviceCase.serviceType}</td>
                    <td className="px-4 py-3 text-slate-300">
                      {serviceCase.claimId ?? "-"}
                    </td>
                    <td className="px-4 py-3">{formatStatus(serviceCase.status)}</td>
                    <td className="px-4 py-3 text-slate-300">
                      {countAttachments(serviceCase.attachmentIds)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">
                      {serviceCase.stripeSessionId ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {serviceCase.lastUpdate ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {new Date(serviceCase.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {cases.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-slate-300" colSpan={7}>
                      No service cases yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
