import { prisma } from "@/lib/prisma";

type CasesPageProps = {
  searchParams?: Promise<{ checkout?: string }>;
};

const statusLabels: Record<string, string> = {
  PENDING_INTAKE: "Pending intake",
  IN_REVIEW: "In review",
  IN_PROGRESS: "In progress",
  AWAITING_INFO: "Awaiting information",
  COMPLETE: "Complete",
  CANCELLED: "Cancelled",
};

function formatStatus(status: string): string {
  return statusLabels[status] ?? status.replace(/_/g, " ").toLowerCase();
}

export default async function CasesPage({ searchParams }: CasesPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const cases = await prisma.academyServiceCase.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <section className="mx-auto w-full max-w-6xl px-4 py-10 md:px-6">
        <h1 className="text-3xl font-semibold tracking-tight">Service Cases</h1>
        <p className="mt-2 text-sm text-slate-300">
          Your most recent Collision Academy service requests.
        </p>

        {resolvedSearchParams.checkout === "success" && (
          <div className="mt-6 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            Payment received. Your service case has been created.
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
                      {serviceCase.lastUpdate ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {new Date(serviceCase.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {cases.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-slate-300" colSpan={5}>
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
