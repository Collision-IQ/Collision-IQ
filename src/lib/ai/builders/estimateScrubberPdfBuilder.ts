import type { CarrierReportDocument } from "./carrierPdfBuilder";
import {
  buildExportModel,
  redactExportModelForDownload,
  resolveCanonicalInsurer,
  resolveCanonicalVehicleLabel,
  resolveCanonicalVin,
} from "./buildExportModel";
import type { ExportBuilderInput } from "./exportTemplates";
import { buildExportResearchSections } from "./exportResearchSections";
import type { EstimateScrubFinding, SourceCitation } from "@/lib/ai/types/estimateScrubber";
import { cleanOperationDisplayText } from "@/lib/ui/presentationText";

export function buildEstimateScrubberPdf(params: ExportBuilderInput): CarrierReportDocument {
  const exportModel = params.renderModel
    ? redactExportModelForDownload(params.renderModel)
    : redactExportModelForDownload(
        buildExportModel({
          report: params.report,
          analysis: params.analysis,
          panel: params.panel,
          assistantAnalysis: params.assistantAnalysis,
        })
      );
  const findings = buildEstimateScrubFindings(exportModel);
  const vehicleIdentity = resolveCanonicalVehicleLabel(exportModel) ?? "Unspecified";
  const vin = resolveCanonicalVin(exportModel) ?? "Unspecified";
  const insurer = resolveCanonicalInsurer(exportModel);
  const criticalCount = findings.filter((finding) => finding.severity === "critical").length;
  const highCount = findings.filter((finding) => finding.severity === "high").length;
  const missingCount = findings.filter((finding) => finding.estimatePresence === "missing").length;
  const underDocumentedCount = findings.filter(
    (finding) => finding.estimatePresence === "under-documented"
  ).length;

  return {
    filename: "estimate-scrubber-report.pdf",
    brand: {
      companyName: "Collision Academy",
      reportLabel: "Estimate Scrubber Report",
      logoPath: "/brand/logos/logo-horizontal.png",
    },
    header: {
      title: "Estimate Scrubber Report",
      subtitle:
        "Estimate QA and compliance audit focused on missing operations, procedural support, materials, refinish, ADAS, structural, and documentation gaps.",
      generatedLabel: `Generated ${new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })}`,
    },
    summary: [
      { label: "Vehicle", value: vehicleIdentity },
      { label: "VIN", value: vin },
      ...(insurer ? [{ label: "Insurer", value: insurer }] : []),
      ...(typeof exportModel.reportFields.estimateTotal === "number"
        ? [{
            label: "Estimate Total",
            value: `$${exportModel.reportFields.estimateTotal.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`,
          }]
        : []),
      { label: "Findings", value: String(findings.length) },
      { label: "Missing / Under-Documented", value: `${missingCount} / ${underDocumentedCount}` },
      { label: "High / Critical", value: `${highCount} / ${criticalCount}` },
    ],
    sections: [
      ...buildExportResearchSections(params.exportResearchSnapshot),
      {
        title: "Audit Focus",
        bullets: [
          "OEM procedure compliance.",
          "Missing operations and under-documented repair steps.",
          "Material requirements, one-time-use items, refinish operations, weld/bond requirements, and corrosion protection.",
          "ADAS operations, scan requirements, structural verification, blend requirements, hazardous-material operations, and material allowances.",
        ],
      },
      ...(findings.length > 0
        ? [{
            title: "Estimate QA Findings",
            bullets: findings.map(formatFinding),
          }]
        : [{
            title: "Estimate QA Findings",
            body:
              "No scrubber findings were available from the current structured estimate model. Upload the carrier estimate, shop estimate, and supporting procedures to generate a fuller audit.",
          }]),
      {
        title: "Data Sources",
        bullets: buildDataSourceBullets(findings),
      },
    ],
    footer: [
      "This report is an estimate QA and compliance audit, not a final repair authorization.",
      "Use it to identify missing or under-documented estimate operations and the support needed to justify corrections.",
    ],
  };
}

function buildEstimateScrubFindings(
  exportModel: ReturnType<typeof buildExportModel>
): EstimateScrubFinding[] {
  const sourceFallback = buildSourceFallback(exportModel);
  const findings = exportModel.supplementItems.map((item) => {
    const operation = normalizeEstimateOperationName(item.title);
    const estimatePresence =
      item.kind === "missing_operation" || item.kind === "missing_verification"
        ? "missing"
        : item.kind === "underwritten_operation"
          ? "under-documented"
          : "present";

    return {
      operation,
      status: formatFindingStatus(estimatePresence, `${item.title} ${item.category}`),
      supportType: inferSupportType(`${item.title} ${item.category} ${item.rationale}`),
      severity: mapSeverity(item.priority, item.leverageScore),
      whyItMatters: cleanScrubberText(item.rationale),
      estimatePresence,
      sources: buildFindingSources(item.source, item.evidence, sourceFallback),
      recommendedRevision: buildRecommendedRevision(operation, estimatePresence, item.rationale),
    } satisfies Omit<
      EstimateScrubFinding,
      "rationaleSummary" | "evidenceChainSummary" | "riskIfOmitted" | "supportConfidenceIndicator"
    >;
  });

  return dedupeFindings(findings.map(enrichEstimateScrubFinding)).slice(0, 12);
}

function inferSupportType(value: string): EstimateScrubFinding["supportType"] {
  if (/refinish|blend|paint|clear coat|color/i.test(value)) {
    return "RefinishOperation";
  }
  if (/material|adhesive|seam sealer|corrosion|one-time|one time|hazard/i.test(value)) {
    return "MaterialRequirement";
  }
  if (/SCRS|position statement|procedure/i.test(value)) {
    return "PositionStatement";
  }
  return "OEM";
}

function buildFindingSources(
  source: string | undefined,
  evidence: string | undefined,
  fallback: SourceCitation[]
): SourceCitation[] {
  const sources: SourceCitation[] = [];

  if (source) {
    sources.push({
      title: cleanScrubberText(source),
      sourceType: inferSourceType(source),
      verified: true,
    });
  }

  if (evidence && evidence !== source) {
    sources.push({
      title: cleanScrubberText(evidence),
      sourceType: inferSourceType(evidence),
      verified: true,
    });
  }

  return sources.length > 0
    ? dedupeSources(sources).slice(0, 3)
    : fallback.slice(0, 3).map((item) => ({
        ...item,
        note: item.note ? `${item.note}; inferred support only` : "Inferred support only; verify procedure citation before use",
        verified: false,
      }));
}

function buildSourceFallback(exportModel: ReturnType<typeof buildExportModel>): SourceCitation[] {
  const retrievalSources =
    exportModel.retrievalSummary?.sourcesInfluencingFindings.map((source) => ({
      title: cleanScrubberText(source.title),
      sourceType: inferSourceType(`${source.title} ${source.sourceType}`),
      note: `${source.sourceType} source`,
      verified: true,
    })) ?? [];

  return [
    ...retrievalSources,
    { title: "Existing estimate parser", sourceType: "EstimateParser", verified: false },
    { title: "Uploaded claim documents", sourceType: "UploadedDocument", verified: false },
  ];
}

function inferSourceType(value: string): SourceCitation["sourceType"] {
  if (/SCRS/i.test(value)) return "SCRS";
  if (/DEG/i.test(value)) return "DEG";
  if (/position statement/i.test(value)) return "PositionStatement";
  if (/drive|folder|oem/i.test(value)) return "DriveOEM";
  if (/web|internet|http/i.test(value)) return "InternetOEM";
  if (/estimate parser/i.test(value)) return "EstimateParser";
  return "UploadedDocument";
}

function formatFinding(finding: EstimateScrubFinding): string {
  const verifiedSources = finding.sources.filter((source) => source.verified);
  const sourceText = finding.sources.length
    ? finding.sources.map((source) => `${source.title}${source.verified ? "" : " (inferred)"}`).join("; ")
    : "Current estimate review (inferred)";
  const citationText = verifiedSources.length
    ? verifiedSources.map((source) => source.title).join("; ")
    : "No verified OEM/procedure citation attached";

  return [
    `Operation: ${finding.operation}`,
    `Status: ${finding.status}`,
    `Severity: ${capitalize(finding.severity)}`,
    `Why It Matters: ${finding.whyItMatters}`,
    `Rationale: ${finding.rationaleSummary}`,
    `Evidence Chain: ${finding.evidenceChainSummary}`,
    `Risk If Omitted: ${finding.riskIfOmitted}`,
    `Support Confidence: ${capitalize(finding.supportConfidenceIndicator)}`,
    `Supporting Source: ${sourceText}`,
    `OEM/Procedure Citation: ${citationText}`,
    `Estimate Presence: ${formatPresence(finding.estimatePresence)}`,
    `Recommended Revision: ${finding.recommendedRevision}`,
  ].join(" | ");
}

function enrichEstimateScrubFinding(
  finding: Omit<
    EstimateScrubFinding,
    "rationaleSummary" | "evidenceChainSummary" | "riskIfOmitted" | "supportConfidenceIndicator"
  >
): EstimateScrubFinding {
  const verifiedCount = finding.sources.filter((source) => source.verified).length;
  const supportConfidenceIndicator =
    verifiedCount > 0 ? "verified" : finding.sources.length > 0 ? "inferred" : "missing";
  return {
    ...finding,
    rationaleSummary: `${finding.operation}: ${finding.whyItMatters}`,
    evidenceChainSummary: finding.sources.length > 0
      ? finding.sources.map((source) =>
          `${source.title} (${source.verified ? "verified" : "inferred"})`
        ).join("; ")
      : "No direct source chain is attached; verify OEM or procedure support before use.",
    riskIfOmitted:
      finding.estimatePresence === "present"
        ? "If under-explained, the operation may still lack enough support for review."
        : "If omitted, the estimate may fail to document a potentially required operation or allowance.",
    supportConfidenceIndicator,
  };
}

function buildDataSourceBullets(findings: EstimateScrubFinding[]): string[] {
  const sources = new Map<string, SourceCitation>();
  for (const finding of findings) {
    for (const source of finding.sources) {
      sources.set(`${source.sourceType}:${source.title}`, source);
    }
  }

  const bullets = [...sources.values()].slice(0, 10).map((source) =>
    `${source.title} (${formatSourceType(source.sourceType)})${source.note ? ` - ${source.note}` : ""}.`
  );

  return bullets.length > 0
    ? bullets
    : [
        "Drive OEM folder.",
        "Position statement library.",
        "Internet OEM references.",
        "SCRS references.",
        "DEG references.",
        "Existing estimate parser.",
      ];
}

function formatPresence(value: EstimateScrubFinding["estimatePresence"]): string {
  switch (value) {
    case "present":
      return "Present";
    case "missing":
      return "Missing from carrier estimate";
    case "under-documented":
      return "Under-documented";
  }
}

function formatSourceType(value: SourceCitation["sourceType"]): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function mapSeverity(
  priority: "low" | "medium" | "high",
  leverageScore?: number
): EstimateScrubFinding["severity"] {
  if (priority === "high" && (leverageScore ?? 0) >= 85) return "critical";
  if (priority === "high") return "high";
  if (priority === "medium") return "moderate";
  return "informational";
}

function formatFindingStatus(
  presence: EstimateScrubFinding["estimatePresence"],
  text: string
): string {
  if (presence === "missing") return "Missing operation";
  if (presence === "under-documented") return "Under-documented operation";
  if (/refinish|blend/i.test(text)) return "Refinish review item";
  if (/material|allowance|hazard/i.test(text)) return "Material allowance review item";
  return "Present with review note";
}

function buildRecommendedRevision(
  operation: string,
  presence: EstimateScrubFinding["estimatePresence"],
  rationale: string
): string {
  const cleanedRationale = cleanScrubberText(rationale);
  if (presence === "missing") {
    return `Add or formally address ${operation} if verified procedure support applies. ${cleanedRationale}`;
  }
  if (presence === "under-documented") {
    return `Revise the estimate note for ${operation} to document the supporting procedure, material, labor, or verification basis. ${cleanedRationale}`;
  }
  return `Retain ${operation} only with clear estimate documentation and source support. ${cleanedRationale}`;
}

function normalizeEstimateOperationName(value: string): string {
  const cleaned = cleanOperationDisplayText(cleanScrubberText(value)) || cleanScrubberText(value);
  return cleaned
    .replace(/\bpre repair\b/gi, "Pre-repair")
    .replace(/\bpost repair\b/gi, "Post-repair")
    .replace(/\badas\b/gi, "ADAS")
    .replace(/\boem\b/gi, "OEM")
    .replace(/\br\s*&\s*i\b/gi, "R&I")
    .trim() || "Estimate Operation";
}

function cleanScrubberText(value: string): string {
  return value
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/\b(?:page|pg)\s*\d+\b/gi, "")
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, "")
    .replace(/[|]{2,}/g, "|")
    .replace(/[_]{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function dedupeFindings(findings: EstimateScrubFinding[]): EstimateScrubFinding[] {
  const byOperation = new Map<string, EstimateScrubFinding>();
  for (const finding of findings) {
    const key = normalizeDedupeKey(finding.operation);
    const existing = byOperation.get(key);
    if (!existing || severityRank(finding.severity) > severityRank(existing.severity)) {
      byOperation.set(key, finding);
    }
  }
  return [...byOperation.values()];
}

function dedupeSources(sources: SourceCitation[]): SourceCitation[] {
  const seen = new Set<string>();
  const kept: SourceCitation[] = [];
  for (const source of sources) {
    const key = normalizeDedupeKey(`${source.sourceType}:${source.title}`);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(source);
  }
  return kept;
}

function normalizeDedupeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function severityRank(severity: EstimateScrubFinding["severity"]): number {
  switch (severity) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "moderate":
      return 2;
    case "informational":
      return 1;
  }
}
