import { parseEstimate } from "../extractors/estimateExtractor";
import { extractComparisonFacts } from "../extractors/comparisonExtractor";
import { extractOemRequirements } from "../extractors/oemProcedureExtractor";
import { buildAnalysisResultFromAuditReport, buildAnalysisResultFromPipeline } from "../builders/buildAnalysisResult";
import type { AnalysisResult } from "../types/analysis";
import { buildAuditFindings } from "../validators/buildAuditFindings";
import { runRepairPipeline, type RepairPipelineDocument } from "./repairPipeline";

export function runAnalysis(
  documents: RepairPipelineDocument[]
): AnalysisResult {
  const auditReport = buildDeterministicAuditReport(documents);

  if (auditReport) {
    return buildAnalysisResultFromAuditReport(auditReport);
  }

  const pipeline = runRepairPipeline(documents);
  return buildAnalysisResultFromPipeline(pipeline);
}

function buildDeterministicAuditReport(documents: RepairPipelineDocument[]) {
  const shopText =
    findDocumentText(documents, ["shop", "body shop", "repair facility"]) ?? null;
  const insurerText =
    findDocumentText(documents, ["insurer", "insurance", "carrier", "sor"]) ?? null;
  const oemText =
    findDocumentText(documents, ["oem", "adas", "procedure", "bmw"]) ?? null;

  if (!shopText || !insurerText) {
    return null;
  }

  const shopParsed = parseEstimate(shopText);
  const insurerParsed = parseEstimate(insurerText);
  const facts = extractComparisonFacts(shopParsed, insurerParsed);
  const oemReqs = oemText
    ? extractOemRequirements(oemText)
    : {
        collisionDamageRequiresScan: false,
        frontBumperRequiresAccCalibration: false,
        frontBumperRequiresKafasCalibration: false,
      };

  return buildAuditFindings(facts, oemReqs);
}

function findDocumentText(
  documents: RepairPipelineDocument[],
  keywords: string[]
): string | undefined {
  const match = documents.find((document) => {
    const haystack = `${document.filename ?? ""} ${document.mime ?? ""}`.toLowerCase();
    return keywords.some((keyword) => haystack.includes(keyword));
  });

  return match?.text;
}
