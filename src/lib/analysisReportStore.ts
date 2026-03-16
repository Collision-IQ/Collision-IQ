import type { RepairIntelligenceReport } from "@/lib/ai/types/analysis";

export type StoredAnalysisReport = {
  id: string;
  artifactIds: string[];
  createdAt: string;
  report: RepairIntelligenceReport;
};

const reportStore = new Map<string, StoredAnalysisReport>();

export function saveAnalysisReport(params: {
  artifactIds: string[];
  report: RepairIntelligenceReport;
}): StoredAnalysisReport {
  const stored: StoredAnalysisReport = {
    id: crypto.randomUUID(),
    artifactIds: params.artifactIds,
    createdAt: new Date().toISOString(),
    report: params.report,
  };

  reportStore.set(stored.id, stored);
  return stored;
}

export function getAnalysisReport(id: string): StoredAnalysisReport | null {
  return reportStore.get(id) ?? null;
}
