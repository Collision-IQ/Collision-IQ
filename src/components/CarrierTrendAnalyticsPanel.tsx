"use client";

import { useMemo, useState } from "react";

type CarrierTrendOperationSummary = {
  operation: string;
  count: number;
};

type CarrierTrendCarrierSummary = {
  carrierKey: string;
  carrierName: string;
  analysisCount: number;
  deniedOperationCount: number;
  calibrationDisputeCount: number;
  laborSuppressionCount: number;
  recurringOmissionCount: number;
  supplementOpportunityCount: number;
  supplementApprovedCount: number;
  supplementApprovalRate: number | null;
  topDeniedOperations: CarrierTrendOperationSummary[];
  topCalibrationDisputes: CarrierTrendOperationSummary[];
  topLaborSuppressionPatterns: CarrierTrendOperationSummary[];
  topEstimateOmissions: CarrierTrendOperationSummary[];
};

type CarrierTrendAnalytics = {
  generatedAt: string;
  windowDays: number;
  carrierCount: number;
  totalEvents: number;
  carriers: CarrierTrendCarrierSummary[];
};

export default function CarrierTrendAnalyticsPanel() {
  const [windowDays, setWindowDays] = useState(90);
  const [analytics, setAnalytics] = useState<CarrierTrendAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const totals = useMemo(() => {
    if (!analytics) {
      return null;
    }

    return analytics.carriers.reduce(
      (sum, carrier) => ({
        denied: sum.denied + carrier.deniedOperationCount,
        calibration: sum.calibration + carrier.calibrationDisputeCount,
        labor: sum.labor + carrier.laborSuppressionCount,
        omissions: sum.omissions + carrier.recurringOmissionCount,
      }),
      { denied: 0, calibration: 0, labor: 0, omissions: 0 }
    );
  }, [analytics]);

  async function loadAnalytics() {
    setLoading(true);
    setStatus("Loading carrier trends...");

    try {
      const response = await fetch(`/api/admin/carrier-trends?windowDays=${windowDays}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as CarrierTrendAnalytics | { error?: string } | null;

      if (!response.ok || !isCarrierTrendAnalytics(payload)) {
        throw new Error(payload && "error" in payload ? payload.error : "Carrier trend analytics failed.");
      }

      setAnalytics(payload);
      setStatus(`Loaded ${payload.totalEvents} anonymized trend events.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Carrier trend analytics failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-white/45">Admin Analytics</div>
          <h2 className="mt-2 text-2xl font-semibold text-white">Carrier Trend Analytics</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
            Anonymized carrier-level aggregates for denied operations, calibration disputes, labor suppression,
            estimate omissions, and supplement approval proxies.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={windowDays}
            onChange={(event) => setWindowDays(Number(event.target.value))}
            className="rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white"
          >
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
            <option value={365}>365 days</option>
          </select>
          <button
            type="button"
            onClick={() => void loadAnalytics()}
            disabled={loading}
            className="rounded-2xl bg-[#C65A2A] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#C65A2A]/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {status ? <div className="mt-4 text-sm text-white/60">{status}</div> : null}

      {analytics && totals ? (
        <>
          <div className="mt-5 grid gap-3 md:grid-cols-5">
            <Metric label="Carriers" value={analytics.carrierCount} />
            <Metric label="Analyses" value={analytics.totalEvents} />
            <Metric label="Denied ops" value={totals.denied} />
            <Metric label="Calibration" value={totals.calibration} />
            <Metric label="Labor patterns" value={totals.labor} />
          </div>

          <div className="mt-5 space-y-4">
            {analytics.carriers.length ? (
              analytics.carriers.map((carrier) => (
                <article key={carrier.carrierKey} className="rounded-2xl border border-white/10 bg-black/35 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-white">{carrier.carrierName}</h3>
                      <div className="mt-1 text-xs uppercase tracking-[0.16em] text-white/45">
                        {carrier.analysisCount} analyses
                      </div>
                    </div>
                    <div className="text-right text-sm text-white/65">
                      Supplement approval proxy: {formatPercent(carrier.supplementApprovalRate)}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-4">
                    <TrendList title="Denied Operations" items={carrier.topDeniedOperations} />
                    <TrendList title="Calibration Disputes" items={carrier.topCalibrationDisputes} />
                    <TrendList title="Labor Suppression" items={carrier.topLaborSuppressionPatterns} />
                    <TrendList title="Estimate Omissions" items={carrier.topEstimateOmissions} />
                  </div>
                </article>
              ))
            ) : (
              <div className="rounded-2xl border border-white/10 bg-black/35 p-4 text-sm text-white/60">
                No anonymized carrier trend events are available for this window yet.
              </div>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/35 p-4">
      <div className="text-xs uppercase tracking-[0.16em] text-white/45">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value.toLocaleString("en-US")}</div>
    </div>
  );
}

function TrendList({ title, items }: { title: string; items: CarrierTrendOperationSummary[] }) {
  return (
    <div className="rounded-2xl bg-white/[0.04] p-3">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">{title}</div>
      <div className="mt-3 space-y-2">
        {items.length ? (
          items.map((item) => (
            <div key={item.operation} className="flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0 text-white/75">{item.operation}</span>
              <span className="shrink-0 text-white/45">{item.count}</span>
            </div>
          ))
        ) : (
          <div className="text-sm text-white/40">No pattern detected.</div>
        )}
      </div>
    </div>
  );
}

function formatPercent(value: number | null): string {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "Not enough data";
}

function isCarrierTrendAnalytics(value: CarrierTrendAnalytics | { error?: string } | null): value is CarrierTrendAnalytics {
  return Boolean(
    value &&
      "generatedAt" in value &&
      "totalEvents" in value &&
      Array.isArray((value as CarrierTrendAnalytics).carriers)
  );
}
