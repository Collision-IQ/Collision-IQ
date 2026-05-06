import type { CarrierReportDocument } from "./carrierPdfBuilder";
import {
  resolveCanonicalInsurer,
  resolveCanonicalVehicleLabel,
  resolveCanonicalVin,
  type ExportModel,
} from "./buildExportModel";
import {
  buildExportTemplateSourceModel,
  type ExportBuilderInput,
  type ExportLineComparison,
} from "./exportTemplates";
import { buildExportResearchSections } from "./exportResearchSections";
import type { CaseEvidenceRegistryItem, RepairIntelligenceReport } from "@/lib/ai/types/analysis";
import type { EvidenceRecord } from "@/lib/ai/types/evidence";
import { cleanOperationDisplayText } from "@/lib/ui/presentationText";

export function buildDoiComplaintPacketPdf(params: ExportBuilderInput): CarrierReportDocument {
  const source = buildExportTemplateSourceModel(params);
  const { exportModel } = source;
  const vehicleIdentity = resolveCanonicalVehicleLabel(exportModel) ?? "Unspecified";
  const vin = resolveCanonicalVin(exportModel) ?? "Unspecified";
  const insurer = resolveCanonicalInsurer(exportModel);
  const verifiedRegulationSources = getVerifiedRegulationSources(exportModel);
  const policySources = getPolicySources(exportModel, params.report);
  const evidenceIndex = buildEvidenceIndex(params.report);

  return {
    filename: "doi-complaint-packet.pdf",
    brand: {
      companyName: "Collision Academy",
      reportLabel: "DOI Complaint Packet",
      logoPath: "/brand/logos/logo-horizontal.png",
    },
    header: {
      title: "DOI Complaint Packet",
      subtitle:
        "Formal documentation packet for claim timeline, unresolved operations, verified support, communication summary, estimate comparison, documentation gaps, and citation appendix. Not legal advice.",
      generatedLabel: `Generated ${source.generatedLabel}`,
    },
    summary: [
      { label: "Vehicle", value: vehicleIdentity },
      { label: "VIN", value: vin },
      ...(insurer ? [{ label: "Insurer", value: insurer }] : []),
      { label: "Evidence Items", value: String(evidenceIndex.length) },
      { label: "Unresolved Operations", value: String(exportModel.supplementItems.length) },
      { label: "Verified Regulation Sources", value: String(verifiedRegulationSources.length) },
      { label: "Completeness", value: exportModel.confidenceIntegrity.completenessStatus },
    ],
    sections: [
      ...buildExportResearchSections(params.exportResearchSnapshot),
      {
        title: "Claim Timeline",
        bullets: buildClaimTimeline(params.report, source.generatedLabel),
      },
      {
        title: "Unresolved Operations",
        bullets: buildUnresolvedOperationBullets(exportModel),
      },
      {
        title: "Regulation Support",
        bullets: verifiedRegulationSources.length
          ? verifiedRegulationSources.map(formatSourceCitation)
          : [
              "No verified regulation citation metadata was available in the current source set. This packet does not assert statutory or regulatory obligations without source metadata.",
            ],
      },
      {
        title: "Policy Rights",
        bullets: policySources.length
          ? policySources
          : [
              "No uploaded policy provision or verified policy-library citation was isolated in the current source set. Policy-rights assertions should remain pending until the applicable policy language is attached and reviewed.",
            ],
      },
      {
        title: "Communication Summary",
        bullets: buildCommunicationSummary(params.report, exportModel),
      },
      {
        title: "OEM Support",
        bullets: buildOemSupportBullets(exportModel, params.report),
      },
      {
        title: "Estimate Comparison",
        bullets: buildEstimateComparisonBullets(source.lineItems),
      },
      {
        title: "Documentation Gaps",
        bullets: buildDocumentationGaps(exportModel, params.report),
      },
      {
        title: "Evidence Index",
        bullets: evidenceIndex.length
          ? evidenceIndex
          : ["No evidence registry or source evidence items were available in the current report payload."],
      },
      {
        title: "Citation Appendix",
        bullets: buildCitationAppendix(exportModel, params.report),
      },
    ],
    footer: [
      "This packet is formal, institutional, and documentation-focused. It is not legal advice.",
      "Verified citations are separated from inferred operational commentary. Do not cite inferred commentary as a statute, regulation, policy term, or OEM procedure.",
    ],
  };
}

function buildClaimTimeline(report: RepairIntelligenceReport | null | undefined, generatedLabel: string): string[] {
  const timeline = [
    `Packet generated: ${generatedLabel}.`,
    report?.ingestionMeta?.activeCaseId ? `Active case identifier: ${report.ingestionMeta.activeCaseId}.` : null,
    report?.ingestionMeta?.reassessmentMode
      ? `Review mode: ${formatLabel(report.ingestionMeta.reassessmentMode)}.`
      : null,
    report?.ingestionMeta?.linkedEvidenceFetchedAt
      ? `Linked evidence fetched: ${formatDateTime(report.ingestionMeta.linkedEvidenceFetchedAt)}.`
      : null,
    report?.ingestionMeta?.reassessedAt
      ? `Case reassessed: ${formatDateTime(report.ingestionMeta.reassessedAt)}.`
      : null,
    report?.ingestionMeta?.closedAt
      ? `Review closed: ${formatDateTime(report.ingestionMeta.closedAt)}.`
      : null,
    report?.reassessmentDelta?.summary ? `Reassessment summary: ${cleanPacketText(report.reassessmentDelta.summary)}.` : null,
  ].filter(Boolean) as string[];

  return timeline.length > 1
    ? timeline
    : [
        ...timeline,
        "No detailed communication chronology was available in the structured claim context. Add date-stamped carrier correspondence, estimate revisions, supplements, and denial notes to complete the timeline.",
      ];
}

function buildUnresolvedOperationBullets(exportModel: ExportModel): string[] {
  const items = exportModel.supplementItems.slice(0, 12).map((item) =>
    [
      `Operation: ${formatOperation(item.title)}.`,
      `Status: ${formatLabel(item.kind)}.`,
      `Severity: ${formatPriority(item.priority, item.leverageScore)}.`,
      `Why it matters: ${cleanPacketText(item.rationale)}.`,
      item.evidence ? `Support: ${cleanPacketText(item.evidence)}.` : "Support: Not verified in attached source metadata.",
      item.source ? `Source: ${cleanPacketText(item.source)}.` : "Source: Current estimate analysis; citation still needed.",
    ].join(" ")
  );

  return items.length
    ? items
    : ["No unresolved estimate operations were isolated from the current structured analysis."];
}

function getVerifiedRegulationSources(exportModel: ExportModel) {
  return (exportModel.retrievalSummary?.sourcesInfluencingFindings ?? []).filter((source) =>
    /law|regulation|statute|doi|department of insurance|insurance department|appraisal|claim handling|unfair/i.test(
      `${source.title} ${source.sourceType} ${source.url ?? ""}`
    )
  );
}

function getPolicySources(
  exportModel: ExportModel,
  report: RepairIntelligenceReport | null | undefined
): string[] {
  const sourceBullets = (exportModel.retrievalSummary?.sourcesInfluencingFindings ?? [])
    .filter((source) => /policy|declarations|appraisal|endorsement/i.test(`${source.title} ${source.url ?? ""}`))
    .map(formatSourceCitation);
  const registryBullets = (report?.evidenceRegistry ?? [])
    .filter((item) => /policy|declarations|endorsement|appraisal/i.test(`${item.label} ${item.sourceType}`))
    .map((item) => `Policy source: ${cleanPacketText(item.label)}. Status: ${formatLabel(item.ingestionState)}.`);

  return dedupeStrings([...sourceBullets, ...registryBullets]).slice(0, 8);
}

function buildCommunicationSummary(
  report: RepairIntelligenceReport | null | undefined,
  exportModel: ExportModel
): string[] {
  const bullets = dedupeStrings([
    report?.reassessmentDelta?.summary
      ? `Current file update: ${cleanPacketText(report.reassessmentDelta.summary)}.`
      : null,
    exportModel.positionStatement
      ? `Current documented position: ${cleanPacketText(exportModel.positionStatement)}.`
      : null,
    report?.artifactRefreshPolicy?.mainReport.reason
      ? `Report refresh signal: ${cleanPacketText(report.artifactRefreshPolicy.mainReport.reason)}.`
      : null,
    ...(report?.artifactRefreshPolicy?.mainReport.signals ?? []).map(
      (signal) => `Communication or file signal: ${cleanPacketText(signal)}.`
    ),
    ...(report?.recommendedActions ?? []).slice(0, 4).map(
      (action) => `Requested follow-up: ${cleanPacketText(action)}.`
    ),
  ]).slice(0, 8);

  return bullets.length
    ? bullets
    : ["No date-stamped claim communication summary was available in the structured report payload."];
}

function buildOemSupportBullets(
  exportModel: ExportModel,
  report: RepairIntelligenceReport | null | undefined
): string[] {
  const contradictionBullets = exportModel.oemContradictions.map((contradiction) =>
    [
      `Affected operation: ${formatOperation(contradiction.affectedOperation)}.`,
      `Conflict summary: ${cleanPacketText(contradiction.conflictSummary)}.`,
      `Severity: ${formatLabel(contradiction.contradictionSeverity)}.`,
      `Support status: ${formatLabel(contradiction.supportStatus)}.`,
      contradiction.oemSupportCitation
        ? `OEM support citation: ${cleanPacketText(contradiction.oemSupportCitation)}.`
        : "OEM support citation: Inferred conflict only; verified OEM procedure still required.",
      `Recommended follow-up: ${cleanPacketText(contradiction.recommendedFollowUp)}.`,
    ].join(" ")
  );
  const procedureBullets = [
    ...(report?.requiredProcedures ?? []).map((procedure) => `Required procedure: ${cleanPacketText(procedure.procedure)}.`),
    ...(exportModel.reportFields.documentedProcedures ?? []).map(
      (procedure) => `Documented procedure support: ${cleanPacketText(procedure)}.`
    ),
  ];

  return dedupeStrings([...contradictionBullets, ...procedureBullets]).slice(0, 12).length
    ? dedupeStrings([...contradictionBullets, ...procedureBullets]).slice(0, 12)
    : ["No verified OEM procedure, position-statement, calibration, or structural-verification support was attached to the current packet."];
}

function buildEstimateComparisonBullets(lineItems: ExportLineComparison[]): string[] {
  const bullets = lineItems.slice(0, 12).map((item) =>
    [
      `Operation: ${formatOperation(item.operation)}.`,
      `Component: ${cleanPacketText(item.component || "Unspecified")}.`,
      `Carrier position: ${cleanPacketText(item.carrierPosition)}.`,
      `Support status: ${formatLabel(item.supportStatus)}.`,
      `Rationale: ${cleanPacketText(item.rationale)}.`,
      item.support ? `Support: ${cleanPacketText(item.support)}.` : null,
    ]
      .filter(Boolean)
      .join(" ")
  );

  return bullets.length
    ? bullets
    : ["No structured estimate comparison rows were available in the current workspace data."];
}

function buildDocumentationGaps(
  exportModel: ExportModel,
  report: RepairIntelligenceReport | null | undefined
): string[] {
  const gaps = [
    ...exportModel.confidenceIntegrity.missingCriticalEvidence.map((gap) => `Missing evidence: ${cleanPacketText(gap)}.`),
    ...exportModel.confidenceIntegrity.confidencePenalties.map(
      (penalty) => `Completeness impact: ${cleanPacketText(penalty.reason)} - ${cleanPacketText(penalty.explanation)}.`
    ),
    ...(report?.missingProcedures ?? []).map((procedure) => `Missing procedure documentation: ${cleanPacketText(procedure)}.`),
    ...(exportModel.disputeIntelligenceReport.supportGaps ?? []).map((gap) => `Support gap: ${cleanPacketText(gap)}.`),
  ];

  return dedupeStrings(gaps).slice(0, 12).length
    ? dedupeStrings(gaps).slice(0, 12)
    : ["No additional documentation gaps were isolated beyond the current unresolved operation list."];
}

function buildEvidenceIndex(report: RepairIntelligenceReport | null | undefined): string[] {
  const registry = (report?.evidenceRegistry ?? []).map(formatRegistryEvidence);
  const evidence = (report?.evidence ?? []).map(formatEvidenceRecord);
  const factualCore = report?.factualCore?.evidenceRegistrySummary ?? [];

  return dedupeStrings([...registry, ...evidence, ...factualCore.map((item) => `Evidence summary: ${cleanPacketText(item)}.`)]).slice(0, 20);
}

function buildCitationAppendix(
  exportModel: ExportModel,
  report: RepairIntelligenceReport | null | undefined
): string[] {
  const retrievalSources = (exportModel.retrievalSummary?.sourcesInfluencingFindings ?? []).map(formatSourceCitation);
  const oemSources = exportModel.oemContradictions
    .filter((contradiction) => contradiction.oemSupportCitation)
    .map((contradiction) => `OEM citation: ${cleanPacketText(contradiction.oemSupportCitation ?? "")}.`);
  const evidenceSources = (report?.evidence ?? []).map(
    (item) => `Evidence citation: ${cleanPacketText(item.title)}. Source: ${cleanPacketText(item.source)}. Authority: ${formatLabel(item.authority)}.`
  );

  return dedupeStrings([...retrievalSources, ...oemSources, ...evidenceSources]).slice(0, 24).length
    ? dedupeStrings([...retrievalSources, ...oemSources, ...evidenceSources]).slice(0, 24)
    : ["No immutable citation metadata was available in the current report payload."];
}

function formatRegistryEvidence(item: CaseEvidenceRegistryItem): string {
  return [
    `Evidence: ${cleanPacketText(item.label)}.`,
    `Source type: ${formatLabel(item.sourceType)}.`,
    `Ingestion state: ${formatLabel(item.ingestionState)}.`,
    `Evidence status: ${formatLabel(item.evidenceStatus)}.`,
    item.createdAt ? `Created: ${formatDateTime(item.createdAt)}.` : null,
    item.updatedAt ? `Updated: ${formatDateTime(item.updatedAt)}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function formatEvidenceRecord(item: EvidenceRecord): string {
  return [
    `Evidence: ${cleanPacketText(item.title)}.`,
    `Source: ${cleanPacketText(item.source)}.`,
    `Authority: ${formatLabel(item.authority)}.`,
    item.snippet ? `Summary: ${cleanPacketText(item.snippet)}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function formatSourceCitation(source: NonNullable<ExportModel["retrievalSummary"]>["sourcesInfluencingFindings"][number]): string {
  return [
    `Source: ${cleanPacketText(source.title)}.`,
    `Source type: ${formatLabel(source.sourceType)}.`,
    source.url ? `Locator: ${source.url}.` : "Locator: Not provided.",
    source.relatedFindingIds.length ? `Related finding IDs: ${source.relatedFindingIds.join(", ")}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function formatOperation(value: string): string {
  return cleanOperationDisplayText(value) || cleanPacketText(value) || "Unspecified operation";
}

function formatPriority(priority: ExportModel["supplementItems"][number]["priority"], leverageScore?: number): string {
  if (priority === "high" || (typeof leverageScore === "number" && leverageScore >= 80)) return "High";
  if (priority === "medium" || (typeof leverageScore === "number" && leverageScore >= 50)) return "Moderate";
  return "Informational";
}

function formatLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function cleanPacketText(value: string): string {
  return value.replace(/\s+/g, " ").replace(/[^\S\r\n]+/g, " ").trim();
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    const cleaned = value ? cleanPacketText(value) : "";
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    deduped.push(cleaned);
  }

  return deduped;
}
