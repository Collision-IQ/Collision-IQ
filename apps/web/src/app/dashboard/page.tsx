import { getCurrentEntitlements } from "@/lib/billing/entitlements";

export const dynamic = "force-dynamic";

const FEATURES = [
  { key: "basic_chat", label: "Basic chat" },
  { key: "uploads", label: "Uploads" },
  { key: "basic_pdf_export", label: "Basic PDF export" },
  { key: "supplement_lines", label: "Supplement lines" },
  { key: "negotiation_draft", label: "Negotiation draft" },
  { key: "rebuttal_email", label: "Rebuttal email" },
  { key: "shop_management", label: "Shop management" },
] as const;

export default async function DashboardPage() {
  const access = await getCurrentEntitlements();

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-16 text-white">
      <div className="rounded-3xl border border-white/10 bg-black/70 p-8 shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
        <div className="text-xs uppercase tracking-[0.24em] text-white/45">Dashboard</div>
        <h1 className="mt-3 text-3xl font-semibold">Entitlements and readiness</h1>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {FEATURES.map((feature) => (
            <div
              key={feature.key}
              className="rounded-2xl border border-white/10 bg-white/5 p-5"
            >
              <div className="text-sm font-medium text-white">{feature.label}</div>
              <div className="mt-2 text-xs uppercase tracking-[0.18em] text-white/45">
                {access.featureFlags[feature.key] ? "Enabled" : "Locked"}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
