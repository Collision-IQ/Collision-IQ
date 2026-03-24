import { buildExportModel, COLLISION_ACADEMY_HANDOFF_URL } from "./buildExportModel";
import type { DecisionPanel } from "./buildDecisionPanel";
import type { AnalysisResult, RepairIntelligenceReport } from "../types/analysis";

export function buildCarrierReport({
  report,
  analysis,
  panel,
  assistantAnalysis,
}: {
  report: RepairIntelligenceReport | null;
  analysis: AnalysisResult | null;
  panel: DecisionPanel | null;
  assistantAnalysis?: string | null;
}) {
  const exportModel = buildExportModel({
    report,
    analysis,
    panel,
    assistantAnalysis,
  });

  return `
COLLISION REPAIR SUPPLEMENT & EVALUATION

----------------------------------------
VEHICLE
----------------------------------------
Vehicle: ${exportModel.vehicle.label || "Not confidently identified from the current material."}
VIN: ${exportModel.vehicle.vin || "Not available from structured analysis."}

----------------------------------------
REPAIR POSITION
----------------------------------------
${exportModel.repairPosition}

----------------------------------------
SUPPLEMENT ITEMS
----------------------------------------

${exportModel.supplementItems.length > 0
    ? exportModel.supplementItems
    .map(
      (item) => `- ${item.title}
  Category: ${item.category}
  Kind: ${item.kind}
  Priority: ${item.priority}
  Reason: ${item.rationale}${item.evidence ? `\n  Evidence: ${item.evidence}` : ""}${item.source ? `\n  Source: ${item.source}` : ""}`
    )
    .join("\n\n")
    : "- No supportable missing, underwritten, or disputed repair-path items were identified from the current structured analysis."}

----------------------------------------
VALUATION
----------------------------------------

${buildValuationSection(exportModel)}

----------------------------------------
POSITION STATEMENT
----------------------------------------

${exportModel.positionStatement}

----------------------------------------
REQUEST
----------------------------------------

${exportModel.request}
`.trim();
}

function formatDVRange(low: number, high: number): string {
  if (low === 0 && high === 0) {
    return "Not enough data to quantify a DV range yet.";
  }

  return `$${low} - $${high}`;
}

function buildValuationSection(
  exportModel: ReturnType<typeof buildExportModel>
): string {
  const sections: string[] = [];

  sections.push("ACV");
  sections.push(renderAcv(exportModel));
  sections.push("");
  sections.push("DV");
  sections.push(renderDv(exportModel));

  return sections.join("\n");
}

function renderAcv(exportModel: ReturnType<typeof buildExportModel>): string {
  const valuation = exportModel.valuation;
  const lines: string[] = [];

  if (valuation.acvStatus === "provided" && typeof valuation.acvValue === "number") {
    lines.push(`Likely ACV preview: ${formatMoney(valuation.acvValue)}`);
  } else if (valuation.acvStatus === "estimated_range" && hasSaneRange(valuation.acvRange, 250000)) {
    lines.push(
      `Likely ACV preview: ${formatMoney(valuation.acvRange.low)}-${formatMoney(
        valuation.acvRange.high
      )}`
    );
  } else {
    lines.push("Likely ACV preview: Not determinable from the current documents.");
  }

  if (valuation.acvConfidence) {
    lines.push(`Confidence: ${valuation.acvConfidence}`);
  }

  const reasoning = cleanValuationReasoning(
    valuation.acvReasoning,
    valuation.acvStatus === "not_determinable"
      ? "Not determinable from the current documents."
      : "Likely ACV preview"
  );
  if (reasoning) {
    lines.push(reasoning);
  }

  if (valuation.acvMissingInputs.length) {
    lines.push(`Missing inputs: ${valuation.acvMissingInputs.join(", ")}`);
  } else if (valuation.acvStatus === "not_determinable") {
    lines.push("Missing inputs: current documents do not contain enough market/value data.");
  }

  if (valuation.acvStatus === "provided" || valuation.acvStatus === "estimated_range") {
    lines.push("This is a preliminary preview based on the current file set, not a formal valuation.");
  }

  lines.push(`For a full valuation, continue at ${COLLISION_ACADEMY_HANDOFF_URL}`);
  return lines.join("\n");
}

function renderDv(exportModel: ReturnType<typeof buildExportModel>): string {
  const valuation = exportModel.valuation;
  const lines: string[] = [];

  if (valuation.dvStatus === "provided" && typeof valuation.dvValue === "number") {
    lines.push(`Likely diminished value preview: ${formatMoney(valuation.dvValue)}`);
  } else if (valuation.dvStatus === "estimated_range" && hasSaneRange(valuation.dvRange, 50000)) {
    lines.push(
      `Likely diminished value preview: ${formatMoney(valuation.dvRange.low)}-${formatMoney(
        valuation.dvRange.high
      )}`
    );
  } else {
    lines.push("Likely diminished value preview: Not determinable from the current documents.");
  }

  if (valuation.dvConfidence) {
    lines.push(`Confidence: ${valuation.dvConfidence}`);
  }

  const reasoning = cleanValuationReasoning(
    valuation.dvReasoning,
    valuation.dvStatus === "not_determinable"
      ? "Not determinable from the current documents."
      : "Likely diminished value preview"
  );
  if (reasoning) {
    lines.push(reasoning);
  }

  if (valuation.dvMissingInputs.length) {
    lines.push(`Missing inputs: ${valuation.dvMissingInputs.join(", ")}`);
  }

  if (valuation.dvStatus === "provided" || valuation.dvStatus === "estimated_range") {
    lines.push("This is a preliminary preview based on the current file set, not a formal valuation.");
  }

  lines.push(`For a full valuation, continue at ${COLLISION_ACADEMY_HANDOFF_URL}`);
  return lines.join("\n");
}

function formatMoney(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function hasSaneRange(
  range: { low: number; high: number } | undefined,
  max: number
): range is { low: number; high: number } {
  if (!range) return false;
  if (!Number.isFinite(range.low) || !Number.isFinite(range.high)) return false;
  if (range.low <= 0 || range.high <= 0) return false;
  if (range.high < range.low || range.high > max) return false;
  return true;
}

function cleanValuationReasoning(reasoning: string, lead: string): string | null {
  const cleaned = reasoning.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;

  const normalizedReason = cleaned.toLowerCase().replace(/[^\w\s]/g, "");
  const normalizedLead = lead.toLowerCase().replace(/[^\w\s]/g, "");

  if (normalizedReason === normalizedLead) {
    return null;
  }

  if (
    normalizedLead.includes("not determinable") &&
    normalizedReason.includes("not determinable from the current documents")
  ) {
    return null;
  }

  return cleaned;
}
