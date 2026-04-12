"use client";

import type { InsightKey } from "@/components/chatbot/insightSync";
import type { ResolvedFinancialView } from "@/components/chatbot/financialView";
import {
  cleanOperationDisplayText,
  formatEstimateComparisonDelta,
  formatEstimateComparisonValue,
  getEstimateComparisonLabel,
} from "@/components/workspace/estimateComparisonPresentation";
import type { ExportModel } from "@/lib/ai/builders/buildExportModel";
import type { AnalysisResult, RepairIntelligenceReport } from "@/lib/ai/types/analysis";
import type { EstimateComparisonRow, WorkspaceData } from "@/types/workspaceTypes";

export type EvidenceTargetType =
  | "comparison_row"
  | "workspace_issue"
  | "supplement_item"
  | "valuation_note"
  | "report_evidence";

export type EvidenceTarget = {
  id: string;
  type: EvidenceTargetType;
  insightKey: InsightKey;
  title: string;
  detail: string;
  summary?: string;
  sourceLabel?: string;
  workspaceScrollTargetId?: string;
};

export type EvidenceLink = {
  targetId: string;
  insightKey: InsightKey;
};

export type EvidenceLinkModel = {
  targets: EvidenceTarget[];
  comparisonRows: Array<EstimateComparisonRow & { targetId: string }>;
  workspaceIssues: Array<{ text: string; targetId: string }>;
};

type BuildParams = {
  renderModel: ExportModel;
  workspaceData: WorkspaceData | null;
  normalizedResult: AnalysisResult | null;
  analysisResult: RepairIntelligenceReport | null;
  financialView: ResolvedFinancialView;
};

export function buildComparisonRowTargetId(rowId: string) {
  return `comparison_row:${rowId}`;
}

export function buildWorkspaceIssueTargetId(issue: string, index: number) {
  return `workspace_issue:${index}:${slugify(issue).slice(0, 40)}`;
}

function buildSupplementTargetId(title: string, index: number) {
  return `supplement_item:${index}:${slugify(title).slice(0, 40)}`;
}

function buildValuationTargetId(key: string) {
  return `valuation_note:${key}`;
}

function buildReportEvidenceTargetId(id: string) {
  return `report_evidence:${id}`;
}

export function buildEvidenceLinkModel({
  renderModel,
  workspaceData,
  normalizedResult,
  analysisResult,
  financialView,
}: BuildParams): EvidenceLinkModel {
  const comparisonRows = (workspaceData?.estimateComparisons.rows ?? normalizedResult?.estimateComparisons?.rows ?? []).map(
    (row) => ({
      ...row,
      targetId: buildComparisonRowTargetId(row.id),
    })
  );
  const workspaceIssues = (workspaceData?.keyIssues ?? []).map((text, index) => ({
    text,
    targetId: buildWorkspaceIssueTargetId(text, index),
  }));
  const reportEvidenceTargets = (analysisResult?.evidence ?? []).map((entry) => ({
    id: buildReportEvidenceTargetId(entry.id),
    type: "report_evidence" as const,
    insightKey: "executive_summary" as const,
    title: entry.title || entry.source,
    detail: entry.snippet,
    sourceLabel: entry.source,
  }));

  const supplementTargets = renderModel.supplementItems.map((item, index) => {
    const workspaceScrollTargetId =
      findBestComparisonRowTargetId(comparisonRows, `${item.title} ${item.rationale} ${item.evidence ?? ""}`) ??
      findBestWorkspaceIssueTargetId(workspaceIssues, `${item.title} ${item.rationale}`);

    return {
      id: buildSupplementTargetId(item.title, index),
      type: "supplement_item" as const,
      insightKey: "support_gaps" as const,
      title: cleanOperationDisplayText(item.title) || item.title,
      detail: item.rationale,
      summary: item.evidence,
      sourceLabel: item.source,
      workspaceScrollTargetId,
    };
  });

  const valuationTargets = buildValuationTargets({
    renderModel,
    comparisonRows,
  });

  const comparisonTargets = comparisonRows.map((row) => ({
    id: row.targetId,
    type: "comparison_row" as const,
    insightKey: "financial_view" as const,
    title: getEstimateComparisonLabel(row),
    detail: `${row.lhsSource ?? "Shop estimate"}: ${formatEstimateComparisonValue(row.lhsValue)} | ${row.rhsSource ?? "Carrier estimate"}: ${formatEstimateComparisonValue(row.rhsValue)} | Delta: ${formatEstimateComparisonDelta(row)}`,
    summary: row.notes?.[0],
    workspaceScrollTargetId: row.targetId,
  }));

  const workspaceIssueTargets = workspaceIssues.map((issue) => ({
    id: issue.targetId,
    type: "workspace_issue" as const,
    insightKey: "support_gaps" as const,
    title: "Workspace issue",
    detail: issue.text,
    workspaceScrollTargetId: issue.targetId,
  }));

  const targets = [
    ...comparisonTargets,
    ...workspaceIssueTargets,
    ...supplementTargets,
    ...valuationTargets,
    ...reportEvidenceTargets,
  ];

  void financialView;

  return {
    targets,
    comparisonRows,
    workspaceIssues,
  };
}

export function getEvidenceTargetById(
  model: EvidenceLinkModel,
  targetId: string | null
): EvidenceTarget | null {
  if (!targetId) return null;
  return model.targets.find((target) => target.id === targetId) ?? null;
}

export function findEvidenceLinkForSectionItem(
  model: EvidenceLinkModel,
  insightKey: InsightKey,
  text: string
): EvidenceLink | null {
  if (!text.trim()) return null;

  if (insightKey === "support_gaps") {
    const supplement = pickBestTarget(model.targets, text, ["supplement_item", "workspace_issue", "comparison_row"]);
    return supplement ? { targetId: supplement.id, insightKey } : null;
  }

  if (insightKey === "financial_view") {
    const valuation =
      pickBestTarget(model.targets, text, ["valuation_note"]) ??
      pickBestFinancialComparisonTarget(model, text);
    return valuation ? { targetId: valuation.id, insightKey } : null;
  }

  if (insightKey === "executive_summary") {
    const target = pickBestTarget(model.targets, text, [
      "report_evidence",
      "supplement_item",
      "workspace_issue",
      "comparison_row",
      "valuation_note",
    ]);
    return target ? { targetId: target.id, insightKey } : null;
  }

  if (insightKey === "next_moves") {
    const target = pickBestTarget(model.targets, text, ["supplement_item", "workspace_issue", "comparison_row"]);
    return target ? { targetId: target.id, insightKey } : null;
  }

  return null;
}

export function findEvidenceLinkForDisputeDriver(
  model: EvidenceLinkModel,
  title: string,
  detail?: string
): EvidenceLink | null {
  const target = pickBestTarget(model.targets, `${title} ${detail ?? ""}`, ["supplement_item", "comparison_row"]);
  return target ? { targetId: target.id, insightKey: "support_gaps" } : null;
}

function buildValuationTargets(params: {
  renderModel: ExportModel;
  comparisonRows: Array<EstimateComparisonRow & { targetId: string }>;
}): EvidenceTarget[] {
  const valuation = params.renderModel.valuation;
  const targets: EvidenceTarget[] = [];
  const strongestFinancialRow = params.comparisonRows.find((row) => Boolean(classifyFinancialGapRow(row)));

  const acvReasoning = cleanNarrative(valuation.acvReasoning);
  if (acvReasoning) {
    targets.push({
      id: buildValuationTargetId("acv_reasoning"),
      type: "valuation_note",
      insightKey: "financial_view",
      title: "ACV rationale",
      detail: acvReasoning,
      workspaceScrollTargetId: strongestFinancialRow?.targetId,
    });
  }

  if (valuation.acvMissingInputs.length > 0) {
    targets.push({
      id: buildValuationTargetId("acv_missing_inputs"),
      type: "valuation_note",
      insightKey: "financial_view",
      title: "ACV missing inputs",
      detail: valuation.acvMissingInputs.join(", "),
      workspaceScrollTargetId: strongestFinancialRow?.targetId,
    });
  }

  const dvReasoning = cleanNarrative(valuation.dvReasoning);
  if (dvReasoning) {
    targets.push({
      id: buildValuationTargetId("dv_reasoning"),
      type: "valuation_note",
      insightKey: "financial_view",
      title: "DV rationale",
      detail: dvReasoning,
      workspaceScrollTargetId: strongestFinancialRow?.targetId,
    });
  }

  if (valuation.dvMissingInputs.length > 0) {
    targets.push({
      id: buildValuationTargetId("dv_missing_inputs"),
      type: "valuation_note",
      insightKey: "financial_view",
      title: "DV missing inputs",
      detail: valuation.dvMissingInputs.join(", "),
      workspaceScrollTargetId: strongestFinancialRow?.targetId,
    });
  }

  return targets;
}

function pickBestFinancialComparisonTarget(
  model: EvidenceLinkModel,
  text: string
): EvidenceTarget | null {
  const categoryHint = inferFinancialCategory(text);
  const comparisonTargets = model.targets.filter((target) => target.type === "comparison_row");

  if (categoryHint) {
    const direct = comparisonTargets.find((target) => {
      const row = model.comparisonRows.find((item) => item.targetId === target.id);
      return row ? classifyFinancialGapRow(row) === categoryHint : false;
    });
    if (direct) return direct;
  }

  return pickBestTarget(model.targets, text, ["comparison_row"]);
}

function pickBestTarget(
  targets: EvidenceTarget[],
  text: string,
  allowedTypes: EvidenceTargetType[]
): EvidenceTarget | null {
  const ranked = targets
    .filter((target) => allowedTypes.includes(target.type))
    .map((target) => ({
      target,
      score: scoreEvidenceMatch(text, [target.title, target.detail, target.summary, target.sourceLabel]),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.target ?? null;
}

function scoreEvidenceMatch(text: string, candidates: Array<string | undefined>) {
  const left = tokenize(text);
  if (left.length === 0) return 0;

  let best = 0;

  for (const candidate of candidates) {
    const right = tokenize(candidate ?? "");
    if (right.length === 0) continue;

    let score = 0;
    const rightSet = new Set(right);
    for (const token of left) {
      if (rightSet.has(token)) {
        score += token.length > 6 ? 3 : 2;
      }
    }

    const normalizedText = normalizeText(text);
    const normalizedCandidate = normalizeText(candidate ?? "");
    if (normalizedText && normalizedCandidate) {
      if (normalizedCandidate.includes(normalizedText) || normalizedText.includes(normalizedCandidate)) {
        score += 6;
      }
    }

    best = Math.max(best, score);
  }

  return best;
}

function findBestComparisonRowTargetId(
  rows: Array<EstimateComparisonRow & { targetId: string }>,
  text: string
) {
  const ranked = rows
    .map((row) => ({
      row,
      score: scoreEvidenceMatch(text, [
        row.operation,
        row.partName,
        row.category,
        row.notes?.join(" "),
        getEstimateComparisonLabel(row),
      ]),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.row.targetId;
}

function findBestWorkspaceIssueTargetId(
  issues: Array<{ text: string; targetId: string }>,
  text: string
) {
  const ranked = issues
    .map((issue) => ({
      issue,
      score: scoreEvidenceMatch(text, [issue.text]),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.issue.targetId;
}

function inferFinancialCategory(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  if (/(paint|refinish|blend)/.test(normalized)) return "Paint / Refinish gap";
  if (/(labor|structural|frame|measure|alignment)/.test(normalized)) return "Labor / Structural process gap";
  if (/(adas|diagnostic|scan|calibration|radar|sensor|camera)/.test(normalized)) return "Calibration / Diagnostics gap";
  if (/(parts|oem|aftermarket|hardware|suspension|seal|clip)/.test(normalized)) return "Parts strategy gap";
  if (/(material|cavity wax|corrosion|sealer|test fit)/.test(normalized)) return "Process / Materials gap";
  return null;
}

function classifyFinancialGapRow(row: EstimateComparisonRow) {
  const text = normalizeText(
    `${row.category ?? ""} ${row.operation ?? ""} ${row.partName ?? ""} ${row.notes?.join(" ") ?? ""}`
  );

  if (/(paint|refinish|blend|tint|mask|clear|prime)/.test(text)) {
    return "Paint / Refinish gap";
  }
  if (/(labor|rate|body|frame|structural|measure|setup|pull|align|alignment)/.test(text)) {
    return "Labor / Structural process gap";
  }
  if (/(adas|calibration|scan|diagnostic|sensor|camera|radar)/.test(text)) {
    return "Calibration / Diagnostics gap";
  }
  if (/(oem|aftermarket|alternate|parts|suspension|hardware|clip|seal)/.test(text)) {
    return "Parts strategy gap";
  }
  if (/(corrosion|cavity wax|material|materials|sealer|test fit|fit check)/.test(text)) {
    return "Process / Materials gap";
  }

  return null;
}

function cleanNarrative(value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (/preview band not supportable from the current file set/i.test(cleaned)) {
    return "";
  }
  if (/not determinable from the current documents/i.test(cleaned)) {
    return "";
  }
  return cleaned;
}

function tokenize(value: string) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 2);
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^\w\s]+/g, " ").replace(/\s+/g, " ").trim();
}

function slugify(value: string) {
  return normalizeText(value).replace(/\s+/g, "-");
}
