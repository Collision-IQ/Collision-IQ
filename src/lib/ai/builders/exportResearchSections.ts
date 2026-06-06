import type { CarrierReportSection } from "./carrierPdfBuilder";
import type { ExportResearchSnapshot, ExportResearchSupportCategory } from "@/lib/ai/types/analysis";

const SUPPORT_CATEGORIES: ExportResearchSupportCategory[] = [
  "Verified Law",
  "Research Leads - Not Jurisdiction Verified",
  "Verified Policy Language",
  "Verified OEM / Position Statement Support",
  "Internet-Sourced Industry Support",
  "Inferred Repair Intelligence",
  "Unsupported / Needs Review",
];

export function buildExportResearchSections(
  snapshot: ExportResearchSnapshot | null | undefined,
  options: { includeInternalAudit?: boolean } = {}
): CarrierReportSection[] {
  if (!snapshot) {
    return [];
  }

  return [
    ...(options.includeInternalAudit
      ? [{
          title: "Research Flow Audit Snapshot",
          bullets: [
            `Generated: ${snapshot.generatedAt}.`,
            `Immutable snapshot hash: ${snapshot.immutableSnapshotHash}.`,
            `Agents run: ${snapshot.agentsRun.join(", ")}.`,
            `Search queries used: ${snapshot.searchQueriesUsed.length}.`,
            `Sources reviewed / accepted / rejected: ${snapshot.sourcesReviewed.length} / ${snapshot.sourcesAccepted.length} / ${snapshot.sourcesRejected.length}.`,
          ],
        }]
      : []),
    ...SUPPORT_CATEGORIES.flatMap((category) => {
      const bullets = formatCategoryBullets(snapshot, category).filter(isMeaningfulReportText);
      return bullets.length > 0 ? [{ title: resolveCategoryTitle(snapshot, category), bullets }] : [];
    }),
    ...(options.includeInternalAudit
      ? [{
          title: "Citation Verification Results",
          bullets: [
            `Uncited legal claims rejected: ${snapshot.verificationSummary.uncitedLegalClaimsRejected}.`,
            `Fabricated or non-authoritative statute candidates rejected: ${snapshot.verificationSummary.fabricatedStatutesRejected}.`,
            `Stale or superseded regulation candidates rejected: ${snapshot.verificationSummary.staleOrSupersededRegulationsRejected}.`,
            `Unsupported OEM requirement candidates rejected: ${snapshot.verificationSummary.unsupportedOemRequirementsRejected}.`,
            `Inferred policy rights downgraded: ${snapshot.verificationSummary.inferredPolicyRightsDowngraded}.`,
            ...snapshot.unsupportedFindings.slice(0, 8),
          ].filter(isMeaningfulReportText),
        }]
      : []),
  ].filter((section) => section.bullets && section.bullets.length > 0);
}

function resolveCategoryTitle(
  snapshot: ExportResearchSnapshot,
  category: ExportResearchSupportCategory
): string {
  if (category !== "Verified Law") {
    return category === "Research Leads - Not Jurisdiction Verified"
      ? "Research Leads — Not Jurisdiction Verified"
      : category;
  }

  const lawSources = snapshot.sourcesAccepted.filter(
    (source) => source.supportCategory === "Verified Law"
  );
  const hasJurisdictionRelevance = lawSources.some((source) =>
    Boolean(source.jurisdiction?.trim())
  );

  return hasJurisdictionRelevance ? "Verified Law" : "Legal Support - Jurisdiction Not Established";
}

function formatCategoryBullets(
  snapshot: ExportResearchSnapshot,
  category: ExportResearchSupportCategory
): string[] {
  const sources = snapshot.sourcesAccepted.filter((source) => source.supportCategory === category);
  if (sources.length === 0) {
    return [
      `Unverified / Needs Source: No accepted ${category.toLowerCase()} source was available in the research snapshot.`,
    ];
  }

  return sources.slice(0, 8).map((source) => {
    const reference = formatMeaningfulReference(source.url ?? source.driveFileId ?? source.locator);
    return [
      `Source type: ${source.sourceType}.`,
      `Source title: ${source.sourceTitle}.`,
      reference ? `Reference: ${reference}.` : null,
      `Retrieved: ${source.retrievalTimestamp}.`,
      source.jurisdiction
        ? `Jurisdiction: ${source.jurisdiction}.`
        : category === "Verified Law"
          ? "Jurisdiction relevance: Not established."
          : null,
      source.effectiveDate ? `Effective date: ${source.effectiveDate}.` : null,
      `Confidence score: ${Math.round(source.confidenceScore * 100)}%.`,
      `Agent: ${source.agent}.`,
    ]
      .filter(Boolean)
      .join(" ");
  });
}

function formatMeaningfulReference(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text || /^source link$/i.test(text) || /^n\/?a$/i.test(text)) return null;
  return text;
}

function isMeaningfulReportText(value: string | null | undefined): value is string {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return false;
  return ![
    /^Unverified \/ Needs Source/i,
    /^No accepted .* source was available/i,
    /^Needs Source for oem_contradiction_detection/i,
    /^Citation Verification Results$/i,
  ].some((pattern) => pattern.test(text));
}
