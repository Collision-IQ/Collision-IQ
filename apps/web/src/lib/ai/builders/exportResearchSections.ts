import type { CarrierReportSection } from "./carrierPdfBuilder";
import type { ExportResearchSnapshot, ExportResearchSupportCategory } from "@/lib/ai/types/analysis";

const SUPPORT_CATEGORIES: ExportResearchSupportCategory[] = [
  "Verified Law",
  "Verified Policy Language",
  "Verified OEM / Position Statement Support",
  "Internet-Sourced Industry Support",
  "Inferred Repair Intelligence",
  "Unsupported / Needs Review",
];

export function buildExportResearchSections(
  snapshot: ExportResearchSnapshot | null | undefined
): CarrierReportSection[] {
  if (!snapshot) {
    return [{
      title: "Required Research Snapshot",
      bullets: [
        "Unverified / Needs Source: Export-specific source research was not available for this generated report.",
        "Do not present legal, policy, OEM, or internet-derived support as verified unless a later audit snapshot supplies accepted citation metadata.",
      ],
    }];
  }

  return [
    {
      title: "Research Flow Audit Snapshot",
      bullets: [
        `Generated: ${snapshot.generatedAt}.`,
        `Immutable snapshot hash: ${snapshot.immutableSnapshotHash}.`,
        `Agents run: ${snapshot.agentsRun.join(", ")}.`,
        `Search queries used: ${snapshot.searchQueriesUsed.length}.`,
        `Sources reviewed / accepted / rejected: ${snapshot.sourcesReviewed.length} / ${snapshot.sourcesAccepted.length} / ${snapshot.sourcesRejected.length}.`,
      ],
    },
    ...SUPPORT_CATEGORIES.map((category) => ({
      title: category,
      bullets: formatCategoryBullets(snapshot, category),
    })),
    {
      title: "Citation Verification Results",
      bullets: [
        `Uncited legal claims rejected: ${snapshot.verificationSummary.uncitedLegalClaimsRejected}.`,
        `Fabricated or non-authoritative statute candidates rejected: ${snapshot.verificationSummary.fabricatedStatutesRejected}.`,
        `Stale or superseded regulation candidates rejected: ${snapshot.verificationSummary.staleOrSupersededRegulationsRejected}.`,
        `Unsupported OEM requirement candidates rejected: ${snapshot.verificationSummary.unsupportedOemRequirementsRejected}.`,
        `Inferred policy rights downgraded: ${snapshot.verificationSummary.inferredPolicyRightsDowngraded}.`,
        ...snapshot.unsupportedFindings.slice(0, 8),
      ],
    },
  ];
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

  return sources.slice(0, 8).map((source) =>
    [
      `Source type: ${source.sourceType}.`,
      `Source title: ${source.sourceTitle}.`,
      `Reference: ${source.url ?? source.driveFileId ?? source.locator}.`,
      `Retrieved: ${source.retrievalTimestamp}.`,
      source.jurisdiction ? `Jurisdiction: ${source.jurisdiction}.` : null,
      source.effectiveDate ? `Effective date: ${source.effectiveDate}.` : null,
      `Confidence score: ${Math.round(source.confidenceScore * 100)}%.`,
      `Agent: ${source.agent}.`,
    ]
      .filter(Boolean)
      .join(" ")
  );
}
