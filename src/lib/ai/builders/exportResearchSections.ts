import type { CarrierReportSection } from "./carrierPdfBuilder";
import type { ExportResearchSnapshot, ExportResearchSupportCategory } from "@/lib/ai/types/analysis";

const SUPPORT_CATEGORIES: ExportResearchSupportCategory[] = [
  "Verified Law",
  "Research Leads - Not Jurisdiction Verified",
  "Verified Policy Language",
  "Verified OEM / Position Statement Support",
  "General Research Leads - Not Make-Specific",
  "Internet-Sourced Industry Support",
  "Inferred Repair Intelligence",
];

// Rejected/unsupported candidates are audit material, never customer/adjuster
// report content — they render only when includeInternalAudit is set.
const INTERNAL_ONLY_CATEGORIES: ExportResearchSupportCategory[] = ["Unsupported / Needs Review"];

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
    ...[...SUPPORT_CATEGORIES, ...(options.includeInternalAudit ? INTERNAL_ONLY_CATEGORIES : [])].flatMap(
      (category) => {
        const bullets = formatCategoryBullets(snapshot, category).filter(isMeaningfulReportText);
        return bullets.length > 0 ? [{ title: resolveCategoryTitle(snapshot, category), bullets }] : [];
      }
    ),
    // Wrong-make position statements are rejected upstream — when that leaves
    // no OEM sources at all, say so honestly instead of rendering nothing.
    ...(hasNoOemSources(snapshot)
      ? [{
          title: "Verified OEM / Position Statement Support",
          bullets: [
            "No verified make-specific OEM position statement was found for this vehicle. Do not substitute another manufacturer's statement; request the OEM's own repair procedures or position statements.",
          ],
        }]
      : []),
    ...(options.includeInternalAudit
      ? [{
          title: "Citation Verification Results",
          bullets: [
            `Uncited legal claims rejected: ${snapshot.verificationSummary.uncitedLegalClaimsRejected}.`,
            `Fabricated or non-authoritative statute candidates rejected: ${snapshot.verificationSummary.fabricatedStatutesRejected}.`,
            `Stale or superseded regulation candidates rejected: ${snapshot.verificationSummary.staleOrSupersededRegulationsRejected}.`,
            `Unsupported OEM requirement candidates rejected: ${snapshot.verificationSummary.unsupportedOemRequirementsRejected}.`,
            `Inferred policy rights downgraded: ${snapshot.verificationSummary.inferredPolicyRightsDowngraded}.`,
            `Off-topic legal leads rejected: ${snapshot.verificationSummary.offTopicLawLeadsRejected ?? 0}.`,
            `Wrong-make OEM leads rejected: ${snapshot.verificationSummary.wrongMakeOemLeadsRejected ?? 0}.`,
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
    if (category === "Research Leads - Not Jurisdiction Verified") {
      return "Research Leads — Not Jurisdiction Verified";
    }
    if (category === "General Research Leads - Not Make-Specific") {
      return "General Research Leads — Not Make-Specific";
    }
    return category;
  }

  const lawSources = snapshot.sourcesAccepted.filter(
    (source) => source.supportCategory === "Verified Law" && hasVerifiedLawJurisdiction(source.jurisdiction)
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
  const sources = snapshot.sourcesAccepted.filter(
    (source) =>
      source.supportCategory === category &&
      (category !== "Verified Law" || hasVerifiedLawJurisdiction(source.jurisdiction))
  );
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

function hasNoOemSources(snapshot: ExportResearchSnapshot): boolean {
  return !snapshot.sourcesAccepted.some(
    (source) =>
      source.supportCategory === "Verified OEM / Position Statement Support" ||
      (source.sourceType === "oem" && source.supportCategory === "General Research Leads - Not Make-Specific")
  );
}

function hasVerifiedLawJurisdiction(value: string | null | undefined) {
  const text = value?.trim();
  if (!text) return false;
  return !/^(not established|unknown|false|null|n\/?a)$/i.test(text);
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
