"use client";

import { useState } from "react";

type EnterpriseAuditDashboard = {
  generatedAt: string;
  snapshotReplay: {
    totalSnapshots: number;
    latest: Array<{
      snapshotId: string;
      caseId: string | null;
      claimId: string | null;
      claimState: string | null;
      generatedAt: string;
      replayHash: string;
      citationCount: number;
      sourceCount: number;
      validationStatus: "pass" | "warn";
    }>;
  };
  regulationLineage: {
    totalVersions: number;
    latest: Array<{
      regulationId: string;
      jurisdiction: string;
      effectiveDate: string | null;
      supersededDate: string | null;
      retrievalTimestamp: string;
      versionHash: string;
      verificationStatus: string;
      citationSource: string;
    }>;
  };
  citationGraph: {
    nodes: Array<{ id: string; label: string; kind: string }>;
    edges: Array<{ from: string; to: string; label: string }>;
  };
  sourceTraceability: {
    regulationSources: number;
    oemSources: number;
    carrierSources: number;
    placeholderCitations: number;
    snapshotsMissingSources: number;
  };
  reportGenerationHistory: {
    totalReports: number;
    recentReports: Array<{
      reportId: string;
      ownerType: string;
      createdAt: string;
      updatedAt: string;
      attachmentCount: number;
      reportKind: string;
    }>;
  };
  disputeTrendAnalytics: {
    totalEvents: number;
    carrierCount: number;
    topCarriers: Array<{
      carrierName: string;
      analysisCount: number;
      deniedOperationCount: number;
      calibrationDisputeCount: number;
      laborSuppressionCount: number;
      recurringOmissionCount: number;
    }>;
  };
  analystOverrides: {
    totalOverrides: number;
    activeOverrides: number;
    recentOverrides: Array<{
      id: string;
      target: string;
      featureKey: string;
      enabled: boolean;
      expiresAt: string | null;
      updatedAt: string;
    }>;
  };
  exportAuditLogs: {
    totalSends: number;
    recentSends: Array<{
      id: string;
      caseId: string | null;
      reportType: string;
      destinationType: string;
      status: string;
      sentAt: string;
      lifecycle: string;
    }>;
  };
};

export default function EnterpriseAuditDashboardPanel() {
  const [dashboard, setDashboard] = useState<EnterpriseAuditDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function loadDashboard() {
    setLoading(true);
    setStatus("Loading enterprise audit dashboard...");

    try {
      const response = await fetch("/api/admin/enterprise-audit", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as EnterpriseAuditDashboard | { error?: string } | null;

      if (!response.ok || !isEnterpriseAuditDashboard(payload)) {
        throw new Error(payload && "error" in payload ? payload.error : "Enterprise audit dashboard failed.");
      }

      setDashboard(payload);
      setStatus(`Loaded audit dashboard generated ${formatDate(payload.generatedAt)}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Enterprise audit dashboard failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-white/45">Enterprise Audit</div>
          <h2 className="mt-2 text-2xl font-semibold text-white">Audit Dashboard</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
            Admin-only replay, lineage, traceability, report history, override, export-log, and dispute-trend visibility.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadDashboard()}
          disabled={loading}
          className="rounded-2xl bg-[#C65A2A] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#C65A2A]/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Loading..." : "Load Audit"}
        </button>
      </div>

      {status ? <div className="mt-4 text-sm text-white/60">{status}</div> : null}

      {dashboard ? (
        <div className="mt-5 space-y-5">
          <div className="grid gap-3 md:grid-cols-4">
            <Metric label="Snapshots" value={dashboard.snapshotReplay.totalSnapshots} />
            <Metric label="Regulation versions" value={dashboard.regulationLineage.totalVersions} />
            <Metric label="Reports" value={dashboard.reportGenerationHistory.totalReports} />
            <Metric label="Exports" value={dashboard.exportAuditLogs.totalSends} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <AuditSection title="Snapshot Replay">
              <div className="space-y-2">
                {dashboard.snapshotReplay.latest.map((snapshot) => (
                  <AuditRow
                    key={snapshot.snapshotId}
                    title={`${snapshot.claimState ?? "Unknown"} snapshot`}
                    meta={`Citations ${snapshot.citationCount} | Sources ${snapshot.sourceCount} | ${snapshot.validationStatus}`}
                    detail={`Replay hash ${snapshot.replayHash.slice(0, 16)} | ${formatDate(snapshot.generatedAt)}`}
                  />
                ))}
                {!dashboard.snapshotReplay.latest.length ? <EmptyState label="No replay snapshots available." /> : null}
              </div>
            </AuditSection>

            <AuditSection title="Regulation Lineage">
              <div className="space-y-2">
                {dashboard.regulationLineage.latest.map((version) => (
                  <AuditRow
                    key={`${version.regulationId}-${version.versionHash}`}
                    title={`${version.regulationId} | ${version.jurisdiction}`}
                    meta={`${version.verificationStatus} | ${version.citationSource}`}
                    detail={`Hash ${version.versionHash.slice(0, 16)} | Retrieved ${formatDate(version.retrievalTimestamp)}`}
                  />
                ))}
                {!dashboard.regulationLineage.latest.length ? <EmptyState label="No regulation versions available." /> : null}
              </div>
            </AuditSection>

            <AuditSection title="Source Traceability">
              <div className="grid gap-3 sm:grid-cols-2">
                <Metric label="Reg sources" value={dashboard.sourceTraceability.regulationSources} />
                <Metric label="OEM sources" value={dashboard.sourceTraceability.oemSources} />
                <Metric label="Carrier sources" value={dashboard.sourceTraceability.carrierSources} />
                <Metric label="Placeholders" value={dashboard.sourceTraceability.placeholderCitations} />
              </div>
              <div className="mt-3 text-sm text-white/55">
                Snapshots missing source metadata: {dashboard.sourceTraceability.snapshotsMissingSources}
              </div>
            </AuditSection>

            <AuditSection title="Citation Graph">
              <div className="text-sm text-white/60">
                {dashboard.citationGraph.nodes.length} nodes | {dashboard.citationGraph.edges.length} edges
              </div>
              <div className="mt-3 space-y-2">
                {dashboard.citationGraph.edges.slice(0, 8).map((edge, index) => (
                  <AuditRow
                    key={`${edge.from}-${edge.to}-${index}`}
                    title={edge.label}
                    meta={shortNode(edge.from)}
                    detail={shortNode(edge.to)}
                  />
                ))}
                {!dashboard.citationGraph.edges.length ? <EmptyState label="No citation graph edges available." /> : null}
              </div>
            </AuditSection>

            <AuditSection title="Report Generation History">
              <div className="space-y-2">
                {dashboard.reportGenerationHistory.recentReports.map((report) => (
                  <AuditRow
                    key={report.reportId}
                    title={report.reportKind}
                    meta={`${report.ownerType} | ${report.attachmentCount} files`}
                    detail={`${report.reportId.slice(0, 12)} | ${formatDate(report.createdAt)}`}
                  />
                ))}
              </div>
            </AuditSection>

            <AuditSection title="Dispute Trend Analytics">
              <div className="text-sm text-white/60">
                {dashboard.disputeTrendAnalytics.totalEvents} events across {dashboard.disputeTrendAnalytics.carrierCount} carriers
              </div>
              <div className="mt-3 space-y-2">
                {dashboard.disputeTrendAnalytics.topCarriers.map((carrier) => (
                  <AuditRow
                    key={carrier.carrierName}
                    title={carrier.carrierName}
                    meta={`${carrier.analysisCount} analyses | denied ${carrier.deniedOperationCount}`}
                    detail={`Calibration ${carrier.calibrationDisputeCount} | Labor ${carrier.laborSuppressionCount} | Omissions ${carrier.recurringOmissionCount}`}
                  />
                ))}
                {!dashboard.disputeTrendAnalytics.topCarriers.length ? <EmptyState label="No dispute trends available." /> : null}
              </div>
            </AuditSection>

            <AuditSection title="Analyst Overrides">
              <div className="text-sm text-white/60">
                {dashboard.analystOverrides.activeOverrides} active of {dashboard.analystOverrides.totalOverrides} total overrides
              </div>
              <div className="mt-3 space-y-2">
                {dashboard.analystOverrides.recentOverrides.map((override) => (
                  <AuditRow
                    key={override.id}
                    title={override.featureKey}
                    meta={`${override.target} | ${override.enabled ? "enabled" : "disabled"}`}
                    detail={`Updated ${formatDate(override.updatedAt)}${override.expiresAt ? ` | Expires ${formatDate(override.expiresAt)}` : ""}`}
                  />
                ))}
                {!dashboard.analystOverrides.recentOverrides.length ? <EmptyState label="No analyst overrides available." /> : null}
              </div>
            </AuditSection>

            <AuditSection title="Export Audit Logs">
              <div className="space-y-2">
                {dashboard.exportAuditLogs.recentSends.map((send) => (
                  <AuditRow
                    key={send.id}
                    title={send.reportType}
                    meta={`${send.destinationType} | ${send.lifecycle}`}
                    detail={`${send.status} | ${formatDate(send.sentAt)}${send.caseId ? ` | Case ${send.caseId.slice(0, 12)}` : ""}`}
                  />
                ))}
                {!dashboard.exportAuditLogs.recentSends.length ? <EmptyState label="No export audit logs available." /> : null}
              </div>
            </AuditSection>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function AuditSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-black/35 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/55">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function AuditRow({ title, meta, detail }: { title: string; meta: string; detail: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.04] p-3">
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="mt-1 text-xs uppercase tracking-[0.12em] text-white/40">{meta}</div>
      <div className="mt-2 break-words text-xs leading-5 text-white/55">{detail}</div>
    </div>
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

function EmptyState({ label }: { label: string }) {
  return <div className="rounded-2xl bg-white/[0.04] p-3 text-sm text-white/40">{label}</div>;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function shortNode(value: string): string {
  return value.length > 42 ? `${value.slice(0, 42)}...` : value;
}

function isEnterpriseAuditDashboard(
  value: EnterpriseAuditDashboard | { error?: string } | null
): value is EnterpriseAuditDashboard {
  return Boolean(
    value &&
      "generatedAt" in value &&
      "snapshotReplay" in value &&
      "regulationLineage" in value &&
      "exportAuditLogs" in value
  );
}
