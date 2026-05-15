import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCarrierTrendAnalytics } from "@/lib/analytics/carrierTrends";

export type EnterpriseAuditDashboard = {
  generatedAt: string;
  snapshotReplay: {
    totalSnapshots: number;
    latest: AuditSnapshotSummary[];
  };
  regulationLineage: {
    totalVersions: number;
    latest: RegulationLineageSummary[];
  };
  citationGraph: {
    nodes: CitationGraphNode[];
    edges: CitationGraphEdge[];
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
    recentReports: ReportGenerationSummary[];
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
    recentOverrides: AnalystOverrideSummary[];
  };
  exportAuditLogs: {
    totalSends: number;
    recentSends: ExportAuditSummary[];
  };
};

type AuditSnapshotSummary = {
  snapshotId: string;
  caseId: string | null;
  claimId: string | null;
  claimState: string | null;
  generatedAt: string;
  replayHash: string;
  citationCount: number;
  sourceCount: number;
  validationStatus: "pass" | "warn";
};

type RegulationLineageSummary = {
  regulationId: string;
  jurisdiction: string;
  effectiveDate: string | null;
  supersededDate: string | null;
  retrievalTimestamp: string;
  versionHash: string;
  verificationStatus: string;
  citationSource: string;
};

type CitationGraphNode = {
  id: string;
  label: string;
  kind: "snapshot" | "regulation" | "citation" | "source";
};

type CitationGraphEdge = {
  from: string;
  to: string;
  label: string;
};

type ReportGenerationSummary = {
  reportId: string;
  ownerType: string;
  createdAt: string;
  updatedAt: string;
  attachmentCount: number;
  reportKind: string;
};

type AnalystOverrideSummary = {
  id: string;
  target: string;
  featureKey: string;
  enabled: boolean;
  expiresAt: string | null;
  updatedAt: string;
};

type ExportAuditSummary = {
  id: string;
  caseId: string | null;
  reportType: string;
  destinationType: string;
  status: string;
  sentAt: string;
  lifecycle: string;
};

type SnapshotRow = {
  id: string;
  caseId: string | null;
  claimId: string | null;
  claimState: string | null;
  regulationIdsUsed: unknown;
  regulationSourcesUsed: unknown;
  citationsUsed: unknown;
  oemSourcesUsed: unknown;
  carrierSourcesUsed: unknown;
  placeholderCitations: unknown;
  policyLegalConfidenceScore: number;
  generatedAt: Date;
  createdAt: Date;
};

export async function buildEnterpriseAuditDashboard(): Promise<EnterpriseAuditDashboard> {
  const [
    snapshotTotal,
    snapshots,
    regulationTotal,
    regulationVersions,
    reportTotal,
    reports,
    overrideTotal,
    overrides,
    sendTotal,
    sends,
    carrierTrends,
  ] = await Promise.all([
    prisma.policyLegalReviewSnapshot.count(),
    prisma.policyLegalReviewSnapshot.findMany({
      orderBy: { generatedAt: "desc" },
      take: 8,
    }),
    prisma.regulationVersion.count(),
    prisma.regulationVersion.findMany({
      orderBy: { retrievalTimestamp: "desc" },
      take: 8,
    }),
    prisma.analysisReport.count(),
    prisma.analysisReport.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: {
        artifacts: {
          select: { attachmentId: true },
        },
      },
    }),
    prisma.featureOverride.count(),
    prisma.featureOverride.findMany({
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
    prisma.reportSend.count(),
    prisma.reportSend.findMany({
      orderBy: { sentAt: "desc" },
      take: 12,
    }),
    getCarrierTrendAnalytics(180).catch(() => null),
  ]);

  const snapshotSummaries = snapshots.map((snapshot) => serializeSnapshotSummary(snapshot));
  const graph = buildCitationGraph(snapshots);
  const sourceTraceability = summarizeSourceTraceability(snapshots);

  return {
    generatedAt: new Date().toISOString(),
    snapshotReplay: {
      totalSnapshots: snapshotTotal,
      latest: snapshotSummaries,
    },
    regulationLineage: {
      totalVersions: regulationTotal,
      latest: regulationVersions.map((version) => ({
        regulationId: version.regulationId,
        jurisdiction: version.jurisdiction,
        effectiveDate: toIsoOrNull(version.effectiveDate),
        supersededDate: toIsoOrNull(version.supersededDate),
        retrievalTimestamp: version.retrievalTimestamp.toISOString(),
        versionHash: version.versionHash,
        verificationStatus: version.verificationStatus,
        citationSource: version.citationSource,
      })),
    },
    citationGraph: graph,
    sourceTraceability,
    reportGenerationHistory: {
      totalReports: reportTotal,
      recentReports: reports.map((report) => ({
        reportId: report.id,
        ownerType: report.ownerType,
        createdAt: report.createdAt.toISOString(),
        updatedAt: report.updatedAt.toISOString(),
        attachmentCount: report.artifacts.length,
        reportKind: inferReportKind(report.report),
      })),
    },
    disputeTrendAnalytics: {
      totalEvents: carrierTrends?.totalEvents ?? 0,
      carrierCount: carrierTrends?.carrierCount ?? 0,
      topCarriers:
        carrierTrends?.carriers.slice(0, 6).map((carrier) => ({
          carrierName: carrier.carrierName,
          analysisCount: carrier.analysisCount,
          deniedOperationCount: carrier.deniedOperationCount,
          calibrationDisputeCount: carrier.calibrationDisputeCount,
          laborSuppressionCount: carrier.laborSuppressionCount,
          recurringOmissionCount: carrier.recurringOmissionCount,
        })) ?? [],
    },
    analystOverrides: {
      totalOverrides: overrideTotal,
      activeOverrides: overrides.filter((override) => !override.expiresAt || override.expiresAt > new Date()).length,
      recentOverrides: overrides.map((override) => ({
        id: override.id,
        target: override.userId ? "User" : override.shopId ? "Shop" : "Global",
        featureKey: override.featureKey,
        enabled: override.enabled,
        expiresAt: toIsoOrNull(override.expiresAt),
        updatedAt: override.updatedAt.toISOString(),
      })),
    },
    exportAuditLogs: {
      totalSends: sendTotal,
      recentSends: sends.map((send) => ({
        id: send.id,
        caseId: send.caseId,
        reportType: send.reportType,
        destinationType: send.destinationType,
        status: send.status,
        sentAt: send.sentAt.toISOString(),
        lifecycle: formatSendLifecycle(send),
      })),
    },
  };
}

function serializeSnapshotSummary(snapshot: SnapshotRow): AuditSnapshotSummary {
  const citationCount = toStringArray(snapshot.citationsUsed).length;
  const sourceCount =
    toArray(snapshot.regulationSourcesUsed).length +
    toStringArray(snapshot.oemSourcesUsed).length +
    toStringArray(snapshot.carrierSourcesUsed).length;
  const replayHash = hashReplayPayload({
    id: snapshot.id,
    caseId: snapshot.caseId,
    claimId: snapshot.claimId,
    claimState: snapshot.claimState,
    regulationIdsUsed: snapshot.regulationIdsUsed,
    citationsUsed: snapshot.citationsUsed,
    generatedAt: snapshot.generatedAt.toISOString(),
  });

  return {
    snapshotId: snapshot.id,
    caseId: snapshot.caseId,
    claimId: snapshot.claimId,
    claimState: snapshot.claimState,
    generatedAt: snapshot.generatedAt.toISOString(),
    replayHash,
    citationCount,
    sourceCount,
    validationStatus: citationCount > 0 && sourceCount > 0 ? "pass" : "warn",
  };
}

function buildCitationGraph(snapshots: SnapshotRow[]): {
  nodes: CitationGraphNode[];
  edges: CitationGraphEdge[];
} {
  const nodes = new Map<string, CitationGraphNode>();
  const edges: CitationGraphEdge[] = [];

  for (const snapshot of snapshots.slice(0, 5)) {
    const snapshotNodeId = `snapshot:${snapshot.id}`;
    nodes.set(snapshotNodeId, {
      id: snapshotNodeId,
      label: `Snapshot ${snapshot.id.slice(0, 8)}`,
      kind: "snapshot",
    });

    for (const regulationId of toStringArray(snapshot.regulationIdsUsed).slice(0, 8)) {
      const regulationNodeId = `regulation:${regulationId}`;
      nodes.set(regulationNodeId, {
        id: regulationNodeId,
        label: regulationId,
        kind: "regulation",
      });
      edges.push({ from: snapshotNodeId, to: regulationNodeId, label: "used regulation" });
    }

    for (const citation of toStringArray(snapshot.citationsUsed).slice(0, 8)) {
      const citationNodeId = `citation:${hashReplayPayload(citation).slice(0, 12)}`;
      nodes.set(citationNodeId, {
        id: citationNodeId,
        label: citation.slice(0, 80),
        kind: "citation",
      });
      edges.push({ from: snapshotNodeId, to: citationNodeId, label: "rendered citation" });
    }

    for (const source of toRegulationSourceLabels(snapshot.regulationSourcesUsed).slice(0, 8)) {
      const sourceNodeId = `source:${hashReplayPayload(source).slice(0, 12)}`;
      nodes.set(sourceNodeId, {
        id: sourceNodeId,
        label: source.slice(0, 80),
        kind: "source",
      });
      edges.push({ from: snapshotNodeId, to: sourceNodeId, label: "preserved source" });
    }
  }

  return {
    nodes: [...nodes.values()].slice(0, 80),
    edges: edges.slice(0, 120),
  };
}

function summarizeSourceTraceability(snapshots: SnapshotRow[]) {
  let regulationSources = 0;
  let oemSources = 0;
  let carrierSources = 0;
  let placeholderCitations = 0;
  let snapshotsMissingSources = 0;

  for (const snapshot of snapshots) {
    const snapshotRegSources = toArray(snapshot.regulationSourcesUsed).length;
    const snapshotOemSources = toStringArray(snapshot.oemSourcesUsed).length;
    const snapshotCarrierSources = toStringArray(snapshot.carrierSourcesUsed).length;
    regulationSources += snapshotRegSources;
    oemSources += snapshotOemSources;
    carrierSources += snapshotCarrierSources;
    placeholderCitations += toArray(snapshot.placeholderCitations).length;
    if (snapshotRegSources + snapshotOemSources + snapshotCarrierSources === 0) {
      snapshotsMissingSources += 1;
    }
  }

  return {
    regulationSources,
    oemSources,
    carrierSources,
    placeholderCitations,
    snapshotsMissingSources,
  };
}

function inferReportKind(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "analysis_report";
  const report = value as Record<string, unknown>;
  if (report.confidenceIntegrity) return "repair_intelligence";
  if (report.factualCore) return "claim_analysis";
  if (report.analysis) return "analysis_report";
  return "analysis_report";
}

function formatSendLifecycle(send: {
  deliveredAt: Date | null;
  openedAt: Date | null;
  bouncedAt: Date | null;
  failedAt: Date | null;
}) {
  if (send.failedAt) return "failed";
  if (send.bouncedAt) return "bounced";
  if (send.openedAt) return "opened";
  if (send.deliveredAt) return "delivered";
  return "sent";
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toRegulationSourceLabels(value: unknown): string[] {
  return toArray(value)
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => {
      const citation = typeof item.citation === "string" ? item.citation : null;
      const sourceName = typeof item.sourceName === "string" ? item.sourceName : null;
      const id = typeof item.id === "string" ? item.id : null;
      return [id, citation, sourceName].filter(Boolean).join(" | ");
    })
    .filter(Boolean);
}

function toIsoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function hashReplayPayload(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    return `{${Object.keys(objectValue)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
