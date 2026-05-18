import {
  buildExportModel,
  COLLISION_ACADEMY_HANDOFF_URL,
  redactExportModelForDownload,
  resolveCanonicalInsurer,
  resolveCanonicalVehicleLabel,
  resolveCanonicalVin,
  type ExportModel,
} from "./buildExportModel";
import type { AnalysisResult, RepairIntelligenceReport } from "../types/analysis";
import type { ExportBuilderInput } from "./exportTemplates";
import { buildExportResearchSections } from "./exportResearchSections";
import { normalizeWorkspaceEstimateComparisons } from "@/lib/workspace/estimateComparisons";
import { dedupeEstimateComparisonRationales } from "@/components/workspace/estimateComparisonPresentation";
import {
  cleanOperationDisplayText,
  normalizeEstimateOperationLabel,
} from "@/lib/ui/presentationText";
import {
  buildIndexedExclusionAuditNote,
  buildReviewCompletenessMessage,
} from "@/lib/reviewCompleteness";
import {
  evaluateAppraisalAward,
  formatAppraisalAwardPosture,
} from "@/lib/ai/appraisalAwardEvaluator";
import { normalizeNarrativeProse } from "@/lib/ai/narrativeNormalization";

export type CarrierReportSection = {
  title: string;
  body?: string;
  bullets?: string[];
  comparisonRows?: Array<{
    label: string;
    leftLabel: string;
    leftValue: string;
    rightLabel: string;
    rightValue: string;
    delta?: string;
    note?: string;
  }>;
};

export type CarrierReportDocument = {
  filename?: string;
  brand: {
    companyName: string;
    reportLabel: string;
    logoPath: string;
  };
  header: {
    title: string;
    subtitle: string;
    generatedLabel: string;
  };
  summary: Array<{
    label: string;
    value: string;
  }>;
  sections: CarrierReportSection[];
  footer: string[];
};

export function buildCarrierReport({
  report,
  analysis,
  panel,
  assistantAnalysis,
  renderModel,
  workspaceData,
  exportResearchSnapshot,
}: ExportBuilderInput): CarrierReportDocument {
  const exportModel = resolveCarrierExportModel({
    report,
    analysis,
    panel,
    assistantAnalysis,
    renderModel,
  });

  const topItems = selectReportSupplementItems(exportModel.supplementItems);
  const isComparison = (analysis?.mode ?? report?.analysis?.mode) === "comparison";
  const documentedStrengths = exportModel.reportFields.presentStrengths;
  const fallbackComparisons =
    analysis?.estimateComparisons ?? report?.analysis?.estimateComparisons;
  const structuredComparisons = normalizeWorkspaceEstimateComparisons(
    workspaceData ? (workspaceData.estimateComparisons ?? null) : fallbackComparisons
  );
  const dedupedComparisonRows = dedupeEstimateComparisonRationales(structuredComparisons.rows);
  const strongestDisputes =
    topItems.length > 0
      ? joinHumanList(
          topItems.slice(0, 4).map((item) => displayOperationLabel(item.title).toLowerCase())
        )
      : "no major unresolved support items identified from the current file";
  const credibilityConclusion = buildCredibilityConclusion(exportModel);
  const whyItWins = buildWhyItWins(exportModel, report, analysis);

  const canonicalVehicle = resolveCanonicalVehicleLabel(exportModel) ?? "Unspecified";
  const canonicalVin = resolveCanonicalVin(exportModel) ?? "Unspecified";
  const canonicalInsurer = resolveCanonicalInsurer(exportModel);

  const document: CarrierReportDocument = {
    filename: "repair-intelligence-report.pdf",
    brand: {
      companyName: "Collision Academy",
      reportLabel: "Repair Intelligence Report",
      logoPath: "/brand/logos/logo-horizontal.png",
    },
    header: {
      title: "Repair Intelligence Report",
      subtitle:
        "Technical, procedural, evidentiary, and negotiation-aware repair position built from the current estimate, structured analysis, and supporting documentation.",
      generatedLabel: `Generated ${new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })}`,
    },
    summary: [
      {
        label: "Vehicle",
        value: canonicalVehicle,
      },
      {
        label: "VIN",
        value: canonicalVin,
      },
      ...(canonicalInsurer
        ? [{ label: "Insurer", value: canonicalInsurer }]
        : []),
      ...(typeof exportModel.reportFields.mileage === "number"
        ? [{ label: "Mileage", value: exportModel.reportFields.mileage.toLocaleString("en-US") }]
        : []),
      ...(typeof exportModel.reportFields.estimateTotal === "number"
        ? [{ label: "Estimate Total", value: formatMoneyPrecise(exportModel.reportFields.estimateTotal) }]
        : []),
      {
        label: "Repair Conclusion",
        value: credibilityConclusion,
      },
      {
        label: isComparison ? "Primary Dispute Areas" : "Primary Review Focus",
        value: strongestDisputes,
      },
      {
        label: "Adjusted Confidence",
        value: exportModel.confidenceIntegrity.adjustedConfidence,
      },
    ],
    sections: [
      ...(exportModel.oemContradictions.length > 0
        ? buildExportResearchSections(exportResearchSnapshot)
        : []),
      ...(exportModel.outputMode === "UMPIRING"
        ? [{
            title: "Appraisal Recommendation",
            bullets: buildAppraisalRecommendationBullets(exportModel, isComparison),
          }]
        : []),
      {
        title: "Executive Repair Position",
        body: buildExecutiveSummary({
          isComparison,
          credibilityConclusion,
          whyItWins,
          strongestDisputes,
        }),
      },
      {
        title: "File Completeness & Confidence",
        bullets: buildConfidenceIntegrityBullets(exportModel.confidenceIntegrity),
      },
      {
        title: "Repair Strategy Comparison",
        bullets: buildRepairStrategyComparisonBullets({
          exportModel,
          credibilityConclusion,
          whyItWins,
          topItems,
          isComparison,
        }),
      },
      ...(dedupedComparisonRows.length > 0
        ? [{
            title: "Structured Estimate Differences",
            comparisonRows: dedupedComparisonRows.slice(0, 8).map((row) => ({
              label: formatComparisonLabel(row.category, row.operation, row.partName),
              leftLabel: row.lhsSource ?? "Shop",
              leftValue: formatComparisonSide(row.lhsValue),
              rightLabel: row.rhsSource ?? "Carrier",
              rightValue: formatComparisonSide(row.rhsValue),
              delta:
                row.delta !== null && row.delta !== undefined && `${row.delta}`.trim() !== ""
                  ? `${row.delta}`
                  : undefined,
              note: row.notes?.[0],
            })),
          }]
        : []),
      {
        title: "Top Dispute Drivers",
        bullets: buildTopDisputeDriverBullets(exportModel, topItems),
      },
      ...(exportModel.findingReasoning.length > 0
        ? [{
            title: "Explainability Summary",
            bullets: buildExplainabilityBullets(exportModel),
          }]
        : []),
      ...(exportModel.oemContradictions.length > 0
        ? [{
            title: "OEM Contradiction Detection",
            bullets: buildOemContradictionBullets(exportModel),
          }]
        : []),
      {
        title: "OEM / Procedure Support",
        bullets: buildOemProcedureSupportBullets(exportModel, documentedStrengths),
      },
      {
        title: "Open Verification Evidence",
        bullets: buildMissingVerificationBullets(exportModel),
      },
      {
        title: "Recommended Next Actions",
        bullets: buildRecommendedNextActionBullets(report, exportModel),
      },
      {
        title: "Negotiation Leverage Areas",
        bullets: buildNegotiationLeverageBullets(exportModel),
      },
      {
        title: "Source & Citation Summary",
        bullets: buildSourceCitationSummary(report, analysis, exportModel),
      },
    ],
    footer: [
      "This report is a repair-position and documentation-support summary based on the current material.",
    ],
  };

  return cleanCarrierReportNarrative(document);
}

function buildCaseUpdateBullets(report: RepairIntelligenceReport): string[] {
  const delta = report.reassessmentDelta;
  if (!delta) return [];

  if (delta.addedEvidenceIds.length === 0 && delta.statusChanges.length === 0) {
    return [
      "The latest reassessment did not materially change the current review.",
      "Current open items remain subject to further documentation where noted.",
    ];
  }

  return compact([
    `${delta.addedEvidenceIds.length} evidence item(s) were added to the active case.`,
    delta.statusChanges.length > 0
      ? `${delta.statusChanges.length} issue status change(s) were identified.`
      : "No issue status changes were identified.",
    delta.newlyDocumented.length > 0
      ? `${delta.newlyDocumented.length} item(s) became documented.`
      : undefined,
    delta.stillOpen.length > 0
      ? `${delta.stillOpen.length} item(s) remain open to further documentation.`
      : undefined,
    delta.determinationChanged
      ? "The overall determination changed after reassessment."
      : "The overall determination did not materially change.",
  ]);
}

function buildRetrievalSummaryBullets(
  summary: NonNullable<ExportModel["retrievalSummary"]>
): string[] {
  return compact([
    `Drive docs used: ${summary.driveDocsUsed}.`,
    `Web sources used: ${summary.webSourcesUsed}.`,
    `Serper status: ${capitalize(summary.serperStatus.toLowerCase())}.`,
    `OEM evidence found: ${summary.oemEvidenceFound ? "Yes" : "No"}.`,
    ...summary.sourcesInfluencingFindings.slice(0, 6).map(
      (source) =>
        `${source.title} (${source.sourceType}) influenced ${source.relatedFindingIds.length} finding(s).`
    ),
  ]);
}

function buildConfidenceIntegrityBullets(
  integrity: ExportModel["confidenceIntegrity"]
): string[] {
  return compact([
    `Base confidence: ${integrity.baseConfidence}.`,
    `Adjusted confidence: ${integrity.adjustedConfidence}.`,
    `Completeness: ${formatCompletenessStatus(integrity.completenessStatus)}.`,
    buildReviewCompletenessMessage({
      reviewed: integrity.reviewedFileCount ?? 0,
      total: integrity.reviewableFileCount ?? integrity.totalKnownFileCount ?? integrity.uploadedFileCount,
    }),
    buildIndexedExclusionAuditNote({
      indexedCount: integrity.indexedFileCount ?? integrity.uploadedFileCount,
      reviewableFileCount: integrity.reviewableFileCount ?? integrity.reviewedFileCount ?? integrity.uploadedFileCount,
      excludedFromReviewCount: integrity.excludedFromReviewCount,
    }) ?? undefined,
    typeof integrity.indexedFileCount === "number" ? `Indexed files: ${integrity.indexedFileCount}.` : undefined,
    typeof integrity.visionProcessedFileCount === "number" ? `Vision-processed files: ${integrity.visionProcessedFileCount}.` : undefined,
    integrity.uploadLimitReached ? "Upload cap reached for this review." : "Upload cap not reached.",
    integrity.userIndicatedMoreFiles ? "User indicated more files exist outside the current upload set." : undefined,
    integrity.missingCriticalEvidence.length > 0
      ? `Not yet located in reviewed files: ${integrity.missingCriticalEvidence.join("; ")}.`
      : undefined,
    ...integrity.confidencePenalties.map((penalty) =>
      `${penalty.reason}: -${penalty.impact}. ${penalty.explanation}`
    ),
    integrity.userFacingDisclosure,
  ]);
}

function buildAppraisalRecommendationBullets(
  exportModel: ExportModel,
  isComparison: boolean
): string[] {
  const award = evaluateAppraisalAward({
    shopEstimateSummary: exportModel.reportFields.estimateFacts.documentedHighlights.join("; "),
    carrierEstimateSummary: isComparison ? exportModel.financialGapBreakdown.narrativeSummary : undefined,
    repairOperations: [
      ...exportModel.reportFields.estimateFacts.documentedProcedures,
      ...exportModel.reportFields.likelySupplementAreas,
      ...exportModel.findingReasoning.map((finding) => `${finding.issue}: ${finding.why_it_matters}`),
    ],
    fileEvidenceSupportSignals: [
      ...exportModel.reportFields.presentStrengths,
      ...exportModel.findingReasoning
        .filter((finding) => finding.evidenceLevel === "documented" || finding.evidenceLevel === "referenced")
        .map((finding) => finding.evidenceChainSummary ?? finding.what_proves_it),
    ],
    oemProcedureSupportSignals: [
      ...exportModel.reportFields.estimateFacts.documentedProcedures,
      ...exportModel.oemContradictions.map((item) => item.oemSupportCitation ?? item.conflictSummary),
    ],
    invoiceScanCalibrationAlignmentIndicators: exportModel.findingReasoning
      .filter((finding) => /invoice|scan|calibration|alignment|test[- ]?fit|road[- ]?test/i.test(`${finding.issue} ${finding.what_proves_it}`))
      .map((finding) => finding.issue),
    completionIndicators: exportModel.reportFields.documentedHighlights,
    carrierVulnerabilitySignals: [
      ...exportModel.supplementItems.map((item) => `${item.title}: ${item.rationale}`),
      ...exportModel.disputeIntelligenceReport.topDrivers.map((driver) => `${driver.title}: ${driver.whyItMatters}`),
      ...exportModel.oemContradictions.map((item) => item.conflictSummary),
    ],
    shopVulnerabilitySignals: [
      ...exportModel.findingReasoning
        .filter((finding) => finding.evidenceLevel === "missing" || finding.evidenceLevel === "unsupported")
        .map((finding) => `${finding.issue}: ${finding.next_action}`),
      ...exportModel.confidenceIntegrity.missingCriticalEvidence,
    ],
    unresolvedMaterialEvidence: exportModel.confidenceIntegrity.missingCriticalEvidence,
    reviewedFileCount: exportModel.confidenceIntegrity.reviewedFileCount,
    totalKnownFileCount: exportModel.confidenceIntegrity.reviewableFileCount ?? exportModel.confidenceIntegrity.totalKnownFileCount ?? exportModel.confidenceIntegrity.uploadedFileCount,
  });

  return compact([
    `Award posture: ${formatAppraisalAwardPosture(award.posture)}.`,
    `Confidence: ${award.confidence}.`,
    award.recommendedLanguage,
    `Why this posture is better supported: ${award.reason}`,
    award.safetyCriticalSupport.length > 0
      ? `Safety/OEM/completion support: ${award.safetyCriticalSupport.slice(0, 4).join("; ")}.`
      : "Safety/OEM/completion support: Support not yet located in reviewed files.",
    award.carrierVulnerabilities.length > 0
      ? `Carrier vulnerabilities: ${award.carrierVulnerabilities.slice(0, 4).join("; ")}.`
      : "Carrier vulnerabilities: no major repair-path vulnerability isolated.",
    award.shopVulnerabilities.length > 0
      ? `Shop vulnerabilities: ${award.shopVulnerabilities.slice(0, 4).join("; ")}.`
      : "Shop vulnerabilities: no major unsupported broader-scope item isolated.",
    exportModel.confidenceIntegrity.missingCriticalEvidence.length > 0
      ? `Not final-award confidence: ${exportModel.confidenceIntegrity.missingCriticalEvidence.join("; ")}.`
      : "Final-award confidence: no critical support item remains not yet located in reviewed files.",
    "Partial awards are not treated as the default appraisal outcome; use a reconciled supported amount or line-adjusted award recommendation when the full estimate is not cleanly awardable.",
  ]);
}

function buildDisputeStrategyBullets(
  strategy: NonNullable<ExportModel["disputeStrategy"]>
): string[] {
  return compact([
    `Leverage score: ${strategy.leverageScore}/100.`,
    strategy.priorityFindings.length > 0
      ? `Priority rank: ${strategy.priorityFindings.join("; ")}.`
      : undefined,
    strategy.easyWins.length > 0
      ? `Easy wins: ${strategy.easyWins.join("; ")}.`
      : undefined,
    strategy.hardFights.length > 0
      ? `Hard fights: ${strategy.hardFights.join("; ")}.`
      : undefined,
    ...strategy.recommendedSequence.slice(0, 5).map((item, index) =>
      `${index + 1}. ${item}`
    ),
  ]);
}

function formatCompletenessStatus(status: ExportModel["confidenceIntegrity"]["completenessStatus"]): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function buildExecutiveSummary(params: {
  isComparison: boolean;
  credibilityConclusion: string;
  whyItWins: string;
  strongestDisputes: string;
}): string {
  const sentences = [
    params.credibilityConclusion,
    params.whyItWins,
    params.isComparison
      ? `The biggest remaining differences are ${params.strongestDisputes}.`
      : `The unresolved review items are ${params.strongestDisputes}.`,
  ].filter(Boolean);

  const kept: string[] = [];
  const seenConcepts = new Set<string>();

  for (const sentence of sentences) {
    const concept = normalizeCarrierConclusionConcept(sentence);
    if (concept && seenConcepts.has(concept)) {
      continue;
    }
    if (concept) {
      seenConcepts.add(concept);
    }
    kept.push(sentence);
  }

  return kept.join(" ");
}

function resolveCarrierExportModel(params: ExportBuilderInput): ExportModel {
  if (params.renderModel) {
    return redactExportModelForDownload(params.renderModel);
  }

  return redactExportModelForDownload(
    buildExportModel({
      report: params.report,
      analysis: params.analysis,
      panel: params.panel,
      assistantAnalysis: params.assistantAnalysis,
    })
  );
}

function formatComparisonSide(value: string | number | null | undefined): string {
  if (value === null || value === undefined || `${value}`.trim() === "") {
    return "Not clearly shown";
  }

  return cleanComparisonDisplayText(`${value}`) || "Not clearly shown";
}

function cleanComparisonDisplayText(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\$?\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z$])/g, "$1 $2")
    .replace(/\s*[|]{1,}\s*/g, " - ")
    .replace(/\bshown\b/i, "Not clearly shown")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 500);
}

function buildRepairStrategyComparisonBullets(params: {
  exportModel: ExportModel;
  credibilityConclusion: string;
  whyItWins: string;
  topItems: ExportModel["supplementItems"];
  isComparison: boolean;
}): string[] {
  return dedupeBullets(compact([
    params.credibilityConclusion,
    params.whyItWins,
    params.exportModel.disputeIntelligenceReport.summary,
    params.topItems.length > 0
      ? params.isComparison
        ? `Primary differences: ${joinHumanList(params.topItems.slice(0, 4).map((item) => displayOperationLabel(item.title).toLowerCase()))}.`
        : `Primary open items: ${joinHumanList(params.topItems.slice(0, 4).map((item) => displayOperationLabel(item.title).toLowerCase()))}.`
      : undefined,
  ]));
}

function buildTopDisputeDriverBullets(
  exportModel: ExportModel,
  fallbackItems: ExportModel["supplementItems"]
): string[] {
  const driverBullets = exportModel.disputeIntelligenceReport.topDrivers.slice(0, 6).map((driver) =>
    [
      `${displayOperationLabel(driver.title)}`,
      `${driver.whyThisWins} The item is ranked ${driver.priorityRank} with ${formatSupportStatus(driver.impact)} impact and ${formatSupportStatus(driver.supportStatus)} support.`,
      `The current gap is ${driver.currentGap}`,
      `Recommended next action: ${driver.nextAction}`,
    ].join("\n\n")
  );

  if (driverBullets.length > 0) {
    return dedupeBullets(driverBullets);
  }

  if (fallbackItems.length === 0) {
    return ["No clear dispute drivers were isolated from the current file."];
  }

  return dedupeBullets(fallbackItems.slice(0, 6).map((item) =>
    `${displayOperationLabel(item.title)}\n\n${item.rationale}${item.evidence ? ` Current support: ${item.evidence}` : ""}`
  ));
}

function buildExplainabilityBullets(exportModel: ExportModel): string[] {
  return dedupeBullets(exportModel.findingReasoning.slice(0, 6).map((finding) =>
    [
      `${displayOperationLabel(finding.issue)}`,
      `- Finding: ${cleanExplainabilityDetail(finding.finding || finding.rationaleSummary || finding.why_it_matters, finding.issue)}`,
      `- Support status: ${formatExplainabilityStatus(finding.supportConfidenceIndicator ?? finding.evidenceLevel)}`,
      `- Evidence basis: ${buildEvidenceBasisLabel(finding)}`,
      `- Next step: ${cleanExplainabilityDetail(finding.next_action || finding.riskIfOmitted || "Request the support not yet located in reviewed files or revise the estimate position.", finding.issue)}`,
    ].join("\n\n")
  ));
}

function cleanExplainabilityDetail(value: string | null | undefined, title: string): string {
  const titlePattern = escapeRegExp(displayOperationLabel(title));
  const cleaned = sanitizeReportProse(value || "Review this item against the current file evidence.")
    .replace(new RegExp(`^${titlePattern}\\s*:?\\s*`, "i"), "")
    .replace(/\bSupport is verified from current file evidence\.\s*Support basis:\s*/gi, "")
    .trim();

  return limitToReadableParagraph(cleaned || "Review this item against the current file evidence.");
}

function buildEvidenceBasisLabel(
  finding: ExportModel["findingReasoning"][number]
): string {
  const raw = [
    finding.what_proves_it,
    finding.evidenceChainSummary,
  ].join(" ");
  const normalized = sanitizeReportProse(raw).toLowerCase();
  const labels: string[] = [];

  if (/invoice|receipt|paid|vendor/.test(normalized)) labels.push("invoice");
  if (/photo|image|visible/.test(normalized)) labels.push("photo");
  if (/scan|dtc|diagnostic/.test(normalized)) labels.push("scan");
  if (/oem|procedure|position statement|repair manual/.test(normalized)) labels.push("OEM procedure");
  if (/comparison|shop estimate|carrier estimate|estimate/.test(normalized)) labels.push("estimate comparison");
  if (/policy|coverage|endorsement/.test(normalized)) labels.push("policy record");

  return labels.length > 0 ? joinHumanList([...new Set(labels)]) : "Current file evidence";
}

function formatExplainabilityStatus(value: string): string {
  if (/verified|documented/i.test(value)) return "Verified";
  if (/missing|unsupported|not established/i.test(value)) return "Missing";
  if (/inferred/i.test(value)) return "Inferred";
  if (/referenced/i.test(value)) return "Referenced";
  return formatSupportStatus(value);
}

function sanitizeReportProse(value: string): string {
  return normalizeNarrativeProse(value
    .replace(/\buploaded document\b/gi, "supporting evidence")
    .replace(/\bUploaded document\b/g, "Supporting evidence")
    .replace(/\buploaded file:?\s*(?:uploaded file|uploaded document|documentation)(?:,\s*(?:uploaded file|uploaded document|documentation))*\.?/gi, "uploaded file")
    .replace(/\bsupporting evidence:?\s*(?:supporting evidence|uploaded document|documentation)(?:,\s*(?:supporting evidence|uploaded document|documentation))*\.?/gi, "supporting evidence")
    .replace(/\b([A-Z][A-Za-z0-9 /&()-]{6,80})\s+\1\s*:/g, "$1:")
    .replace(/\s{2,}/g, " ")
    .trim(), "REPORT");
}

function limitToReadableParagraph(value: string): string {
  if (value.length <= 500) return ensureSentence(value);

  const truncated = value.slice(0, 500);
  const sentenceEnd = Math.max(
    truncated.lastIndexOf("."),
    truncated.lastIndexOf("!"),
    truncated.lastIndexOf("?")
  );
  return sentenceEnd > 120 ? truncated.slice(0, sentenceEnd + 1).trim() : `${truncated.trimEnd()}.`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildOemContradictionBullets(exportModel: ExportModel): string[] {
  return dedupeBullets(exportModel.oemContradictions.map((contradiction) =>
    [
      `${displayOperationLabel(contradiction.affectedOperation)}`,
      `${contradiction.conflictSummary}`,
      `OEM support status: ${contradiction.oemSupportCitation ?? "not yet verified from an attached OEM procedure"}. Severity is ${formatSupportStatus(contradiction.contradictionSeverity)} and support is ${formatSupportStatus(contradiction.supportStatus)}.`,
      `Recommended follow-up: ${contradiction.recommendedFollowUp}`,
    ].join("\n\n")
  ));
}

function buildOemProcedureSupportBullets(
  exportModel: ExportModel,
  documentedStrengths: string[]
): string[] {
  const retrievalSupport = exportModel.retrievalSummary?.sourcesInfluencingFindings
    .filter((source) => /oem|procedure|position/i.test(`${source.title} ${source.sourceType}`))
    .map((source) => `${source.title} (${source.sourceType}).`) ?? [];
  const procedureSupport = [
    ...exportModel.reportFields.documentedProcedures,
    ...exportModel.reportFields.documentedHighlights,
    ...documentedStrengths,
  ].map((item) => ensureSentence(item));
  const itemSupport = exportModel.supplementItems
    .filter((item) => /oem|procedure|position|scan|calibration|corrosion|weld|bond/i.test(`${item.category} ${item.rationale} ${item.evidence ?? ""}`))
    .slice(0, 6)
    .map((item) => `${displayOperationLabel(item.title)}: ${item.evidence || item.rationale}`);

  const bullets = dedupeBullets([...procedureSupport, ...itemSupport, ...retrievalSupport]);
  return bullets.length > 0
    ? bullets
    : ["No specific OEM procedure or position-statement support was isolated from the current file."];
}

function buildMissingVerificationBullets(exportModel: ExportModel): string[] {
  const missingProof = exportModel.confidenceIntegrity.missingCriticalEvidence.map((item) => ensureSentence(item));
  const supportGaps = exportModel.disputeIntelligenceReport.supportGaps.map((item) => ensureSentence(item));
  const missingItems = exportModel.supplementItems
    .filter((item) => item.kind === "missing_verification" || item.kind === "missing_operation")
    .slice(0, 8)
    .map((item) => `${displayOperationLabel(item.title)}: ${item.rationale}`);

  const bullets = dedupeBullets([...missingProof, ...supportGaps, ...missingItems]);
  return bullets.length > 0
    ? bullets
    : ["No additional missing verification evidence was isolated beyond the current confidence and source limitations."];
}

function buildRecommendedNextActionBullets(
  report: RepairIntelligenceReport | null,
  exportModel: ExportModel
): string[] {
  const bullets = dedupeBullets([
    ...exportModel.disputeIntelligenceReport.nextMoves.map((item) => ensureSentence(item)),
    ...(exportModel.disputeStrategy?.recommendedSequence.map((item) => ensureSentence(item)) ?? []),
    ...(report?.recommendedActions.map((item) => ensureSentence(item)) ?? []),
  ]);

  return bullets.length > 0
    ? bullets.slice(0, 8)
    : ["Request the missing documentation, reconcile the estimate differences, and update the repair position after support is received."];
}

function buildNegotiationLeverageBullets(exportModel: ExportModel): string[] {
  const strategy = exportModel.disputeStrategy;
  const playbook = exportModel.negotiationPlaybook;
  const bullets = compact([
    strategy ? `Leverage score: ${strategy.leverageScore}/100.` : undefined,
    ...(strategy?.priorityFindings.length ? [`Priority findings: ${strategy.priorityFindings.join("; ")}.`] : []),
    ...(strategy?.easyWins.length ? [`Likely easier approvals: ${strategy.easyWins.join("; ")}.`] : []),
    ...(strategy?.hardFights.length ? [`Higher-friction items: ${strategy.hardFights.join("; ")}.`] : []),
    ...playbook.strongestArguments.slice(0, 4).map((item) => `Strong argument: ${ensureSentence(item)}`),
    ...playbook.vulnerablePoints.slice(0, 3).map((item) => `Vulnerable point: ${ensureSentence(item)}`),
  ]);

  return dedupeBullets(bullets).slice(0, 10);
}

function buildSourceCitationSummary(
  report: RepairIntelligenceReport | null,
  analysis: AnalysisResult | null,
  exportModel: ExportModel
): string[] {
  const bullets = [
    ...buildSourceSummary(report, analysis, exportModel),
    ...(exportModel.retrievalSummary ? buildRetrievalSummaryBullets(exportModel.retrievalSummary) : []),
  ];

  return dedupeBullets(bullets).slice(0, 12);
}

function formatComparisonLabel(
  category?: string | null,
  operation?: string | null,
  partName?: string | null
): string {
  const cleanedOperation = displayOperationLabel(operation);
  const parts = [category, cleanedOperation, partName]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part && !/^(repair operation|n\/a|none|unknown)$/i.test(part)));

  return dedupeBullets(parts).join(" - ") || "Estimate Difference";
}

function formatSupportStatus(status: string): string {
  return status.replace(/_/g, " ");
}

function dedupeBullets(items: string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];

  for (const item of items) {
    const cleaned = item.trim().replace(/\s+/g, " ");
    if (!cleaned) continue;
    const key = normalizeCarrierConclusionConcept(cleaned) || cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(cleaned);
  }

  return kept;
}

function ensureSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function buildCredibilityConclusion(
  exportModel: ReturnType<typeof buildExportModel>
): string {
  const lower = exportModel.repairPosition.toLowerCase();
  const isComparison = /\b(shop estimate|carrier estimate)\b/i.test(exportModel.repairPosition);

  if (isComparison && lower.includes("shop estimate") && lower.includes("more complete")) {
    return "The documents describe different levels of repair support, with one estimate carrying broader documented scope.";
  }

  if (isComparison && lower.includes("carrier estimate") && lower.includes("underwritten")) {
    return "The current material shows a difference between the documented repair path and the narrower estimate posture.";
  }

  if (exportModel.supplementItems.length > 0) {
    return isComparison
      ? "The estimates should be evaluated by which items are supported by documented procedures, verifications, and scope evidence."
      : "The current file identifies specific repair, verification, or documentation items that need line-item support.";
  }

  return isComparison
    ? "The current material shows no major unresolved support split."
    : "The current file supports a generally credible estimate review with no major unresolved support issue.";
}

function buildWhyItWins(
  exportModel: ReturnType<typeof buildExportModel>,
  report: RepairIntelligenceReport | null,
  analysis: AnalysisResult | null
): string {
  const topItems = exportModel.supplementItems.slice(0, 3);
  if (topItems.length > 0) {
    const analysisMode = analysis?.mode ?? report?.analysis?.mode;
    return analysisMode === "comparison"
      ? `The current file most clearly supports review of ${joinHumanList(
          topItems.map((item) => displayOperationLabel(item.title).toLowerCase())
        )} against the competing repair documents.`
      : `The file most clearly leaves open ${joinHumanList(
          topItems.map((item) => displayOperationLabel(item.title).toLowerCase())
        )}.`;
  }

  if (analysis?.narrative) {
    return cleanCarrierSummarySentence(analysis.narrative);
  }

  if (report?.recommendedActions?.length) {
    return cleanCarrierSummarySentence(report.recommendedActions[0]);
  }

  return "The file is best read through what it documents clearly, what remains open, and what still needs support or documentation.";
}

function buildValuationBullets(
  exportModel: ReturnType<typeof buildExportModel>
): string[] {
  const bullets: string[] = [];
  const valuation = exportModel.valuation;

  bullets.push(renderValuationBullet("Market Preview", {
    status: valuation.acvStatus,
    value: valuation.acvValue,
    range: valuation.acvRange,
    confidence: valuation.acvConfidence,
    reasoning: valuation.acvReasoning,
    missingInputs: valuation.acvMissingInputs,
    sourceType: valuation.acvSourceType,
    compCount: valuation.acvCompCount,
  }));

  bullets.push(renderValuationBullet("Diminished Value", {
    status: valuation.dvStatus,
    value: valuation.dvValue,
    range: valuation.dvRange,
    confidence: valuation.dvConfidence,
    reasoning: valuation.dvReasoning,
    missingInputs: valuation.dvMissingInputs,
  }));

  bullets.push("These valuation figures are preliminary previews only, not formal appraisals or binding valuations.");
  bullets.push(`For a full valuation, continue at ${COLLISION_ACADEMY_HANDOFF_URL}.`);
  return bullets;
}

function renderValuationBullet(
  label: string,
  params: {
    status: "provided" | "estimated_range" | "not_determinable";
    value?: number;
    range?: { low: number; high: number };
    confidence?: "low" | "medium" | "high";
    reasoning: string;
    missingInputs: string[];
    sourceType?: "comps" | "jd_power" | "fallback" | "unavailable";
    compCount?: number;
  }
): string {
  const parts: string[] = [];

  if (
    label === "Market Preview" &&
    params.sourceType === "comps" &&
    typeof params.value === "number" &&
    (params.compCount ?? 0) >= 3
  ) {
    parts.push(`Market Preview median: ${formatMoney(params.value)}`);
  }

  if (params.status === "provided" && typeof params.value === "number") {
    parts.push(`${label}: preliminary preview ${formatMoney(params.value)}`);
  } else if (params.status === "estimated_range" && params.range) {
    parts.push(`${label}: preliminary preview ${formatMoney(params.range.low)}-${formatMoney(params.range.high)}`);
  } else {
    parts.push(`${label}: not determinable from the current documents`);
  }

  if (params.confidence) {
    parts.push(`confidence ${params.confidence}`);
  }

  const cleanedReasoning = cleanValuationReasoning(params.reasoning);
  if (cleanedReasoning) {
    parts.push(cleanedReasoning);
  }

  if (params.missingInputs.length > 0) {
    parts.push(`missing inputs include ${params.missingInputs.join(", ")}`);
  }

  return parts.join(". ").replace(/\.\./g, ".") + ".";
}

function buildSourceSummary(
  report: RepairIntelligenceReport | null,
  analysis: AnalysisResult | null,
  exportModel: ReturnType<typeof buildExportModel>
): string[] {
  const sources = new Set<string>();

  for (const item of exportModel.supplementItems) {
    if (item.source) {
      sources.add(item.source);
    }
  }

  for (const evidence of report?.evidence ?? []) {
    if (evidence.title) {
      sources.add(evidence.title);
    }
    if (evidence.source) {
      sources.add(evidence.source);
    }
  }

  for (const evidence of analysis?.evidence ?? []) {
    if (evidence.source) {
      sources.add(evidence.source);
    }
  }

  const resolved = [...sources].slice(0, 8);
  if (resolved.length === 0) {
    return ["References are limited to the current estimate, supporting documentation, and related file material."];
  }

  const cleaned = resolved
    .map((source) => toHumanReadableSourceLabel(source))
    .filter((source): source is string => Boolean(source))
    .slice(0, 8);

  if (cleaned.length === 0) {
    return ["References are limited to the current estimate, supporting documentation, and related file material."];
  }

  return cleaned.map((source) => `${trimTrailingPunctuation(source)}.`);
}

function displayOperationLabel(value: string | null | undefined): string {
  return normalizeEstimateOperationLabel({ label: value, operation: value })
    || cleanOperationDisplayText(value)
    || value
    || "Repair Operation";
}

function cleanCarrierReportNarrative(document: CarrierReportDocument): CarrierReportDocument {
  return {
    ...document,
    header: {
      title: cleanUserFacingRepairProse(document.header.title),
      subtitle: cleanUserFacingRepairProse(document.header.subtitle),
      generatedLabel: cleanUserFacingRepairProse(document.header.generatedLabel),
    },
    summary: document.summary.map((item) => ({
      label: cleanUserFacingRepairProse(item.label),
      value: cleanUserFacingRepairProse(item.value),
    })),
    sections: document.sections.map((section) => ({
      ...section,
      title: cleanUserFacingRepairProse(section.title),
      body: section.body ? cleanUserFacingRepairProse(section.body) : undefined,
      bullets: section.bullets?.map((bullet) => cleanUserFacingRepairProse(bullet)),
      comparisonRows: section.comparisonRows?.map((row) => ({
        ...row,
        label: cleanUserFacingRepairProse(row.label),
        leftLabel: cleanUserFacingRepairProse(row.leftLabel),
        leftValue: cleanUserFacingRepairProse(row.leftValue),
        rightLabel: cleanUserFacingRepairProse(row.rightLabel),
        rightValue: cleanUserFacingRepairProse(row.rightValue),
        delta: row.delta ? cleanUserFacingRepairProse(row.delta) : undefined,
        note: row.note ? cleanUserFacingRepairProse(row.note) : undefined,
      })),
    })),
    footer: document.footer.map((line) => cleanUserFacingRepairProse(line)),
  };
}

function cleanUserFacingRepairProse(value: string): string {
  return value
    .replace(/\bEvidence references?:\s*(?:cmp[\w-]+(?:\s*,\s*)?)+\b/gi, "")
    .replace(/\bcmp[\w-]{4,}\b/gi, "")
    .replace(/\bGenerated\s+([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})\b/g, "Generated $1 $2, $3")
    .replace(/\bSafetydocumentation support\b/g, "Safety documentation support")
    .replace(/\bmountingdocumentation area\b/gi, "mounting documentation area")
    .replace(/\b(?:Not clearly\s+){2,}shown\b/gi, "Not clearly shown")
    .replace(/\bRetrieved:\s*\d{1,2}:\d{2}(?:\.\d+)?Z\b\.?/gi, "")
    .replace(/\bJurisdiction:\s*(?:IN|Indiana)\b/gi, "Jurisdiction relevance: not established")
    .replace(/\bsource link\b\.?/gi, "")
    .replace(/\buploaded document\b(?:\s*,\s*\buploaded document\b)+/gi, "documentation")
    .replace(/\buploaded document\b/gi, "documentation")
    .replace(/\b(Repair Intelligence Report|Estimate Delta \/ Change Requests|Annotated Estimate Scrubber)\s*:\s*\1\b/gi, "$1")
    .replace(/\b(?:[A-Z]*\d[A-Z0-9-]{5,}|\d{6,}[A-Za-z]{0,3})\b/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

function formatMoney(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function formatMoneyPrecise(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatVehicleConfidence(
  exportModel: ReturnType<typeof buildExportModel>
): string {
  const label = capitalize(exportModel.vehicle.confidence);
  if (typeof exportModel.vehicle.sourceConfidence !== "number") {
    return label;
  }

  return `${label} (${exportModel.vehicle.sourceConfidence.toFixed(2)})`;
}

function cleanValuationReasoning(reasoning?: string | null): string | null {
  if (!reasoning) return null;
  const cleaned = reasoning.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  if (
    /^(acv|dv|diminished value)\s+is\s+not determinable from the current documents\.?$/i.test(cleaned) ||
    /^not determinable from the current documents\.?$/i.test(cleaned)
  ) {
    return null;
  }
  return trimTrailingPunctuation(cleaned);
}

function selectReportSupplementItems(
  items: ReturnType<typeof buildExportModel>["supplementItems"]
): ReturnType<typeof buildExportModel>["supplementItems"] {
  if (items.length <= 8) {
    return items;
  }

  const categorySeen = new Set<string>();
  const selected: ReturnType<typeof buildExportModel>["supplementItems"] = [];

  for (const item of items) {
    if (!categorySeen.has(item.category)) {
      selected.push(item);
      categorySeen.add(item.category);
    }
    if (selected.length >= 5) {
      break;
    }
  }

  for (const item of items) {
    if (selected.some((existing) => existing.title === item.title)) {
      continue;
    }
    selected.push(item);
    if (selected.length >= 8) {
      break;
    }
  }

  return selected.slice(0, 8);
}

function toHumanReadableSourceLabel(source: string): string | undefined {
  const trimmed = trimTrailingPunctuation(source).trim();
  if (!trimmed) return undefined;
  if (
    /repair-pipeline|pipeline evidence|assistant reasoning|structured narrative|structured analysis|supplement analysis|missing procedures|scan analysis|calibration analysis|drive knowledge base|retrieved evidence|^inline-\d+$|^retrieved-\d+$/i.test(
      trimmed
    )
  ) {
    return undefined;
  }

  const lastSegment = trimmed.split(/[\\/]/).pop()?.trim() ?? trimmed;
  const withoutOpaqueId = lastSegment.replace(/\b[a-z0-9_-]{20,}\b/gi, "").replace(/\s{2,}/g, " ").trim();
  if (!withoutOpaqueId) return undefined;
  if (/^(?:uploaded document|uploaded file|documentation|supporting evidence)$/i.test(withoutOpaqueId)) {
    return undefined;
  }
  if (/^[a-z0-9_-]{12,}$/i.test(withoutOpaqueId)) return undefined;
  if (/\.(pdf|docx?|xlsx?|png|jpe?g|heic|txt)$/i.test(withoutOpaqueId)) {
    return withoutOpaqueId;
  }
  if (withoutOpaqueId.split(/\s+/).length <= 1 && !/[A-Z]/.test(withoutOpaqueId)) {
    return undefined;
  }
  return withoutOpaqueId;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function joinHumanList(values: string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[.!\s]+$/g, "").trim();
}

function cleanCarrierSummarySentence(value?: string | null): string {
  const cleaned = (value ?? "")
    .replace(
      /(?:^|[\s.])Areas that look aggressive or likely to get pushback\s*:?\s*(?:\.)?(?=\s|$)/gi,
      " "
    )
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!cleaned) {
    return "The file is best read through what it documents clearly, what remains open, and what still needs support or documentation.";
  }

  return trimTrailingPunctuation(cleaned) + ".";
}

function normalizeCarrierConclusionConcept(value: string): string | null {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (
    normalized.includes("credible") ||
    normalized.includes("preliminary repair plan") ||
    normalized.includes("generally credible estimate") ||
    normalized.includes("broader documented scope")
  ) {
    return "credibility";
  }

  if (
    normalized.includes("remaining gaps") ||
    normalized.includes("dispute areas") ||
    normalized.includes("needs clearer support around")
  ) {
    return "gaps";
  }

  return null;
}

function compact(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value && value.trim()));
}
