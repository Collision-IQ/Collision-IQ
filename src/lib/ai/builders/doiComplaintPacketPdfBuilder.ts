import type { CarrierReportDocument } from "./carrierPdfBuilder";
import {
  resolveCanonicalInsurer,
  resolveCanonicalVehicleLabel,
  resolveCanonicalVin,
  type ExportModel,
} from "./buildExportModel";
import { buildPolicyRightsReviewModel } from "./policyRightsReviewPdfBuilder";
import {
  buildExportTemplateSourceModel,
  type ExportBuilderInput,
  type ExportLineComparison,
} from "./exportTemplates";
import { buildClaimHandlingDisputeContext } from "./claimHandlingDisputeContext";
import type { CaseEvidenceRegistryItem, RepairIntelligenceReport } from "@/lib/ai/types/analysis";
import type { EvidenceRecord } from "@/lib/ai/types/evidence";
import { cleanOperationDisplayText } from "@/lib/ui/presentationText";

type DoiReadinessState = "READY_FOR_DOI" | "NOT_READY_FOR_DOI" | "NEEDS_MORE_DOCUMENTATION";

type DoiReadinessReview = {
  state: DoiReadinessState;
  jurisdictionConfirmed: boolean;
  verifiedRegulationSourceCount: number;
  documentedConduct: string[];
  missingPrerequisites: string[];
  explanation: string;
};

const NOT_READY_SUMMARY =
  "The file currently supports an appraisal-process and repair-scope dispute. It does not yet establish a verified unfair claims handling violation because no confirmed regulatory citation, written denial, delay log, refusal-to-review documentation, or communication timeline has been isolated.";
const NOT_READY_CONDUCT_EXPLANATION =
  "The current file supports a repair-scope or appraisal dispute, but does not yet establish documented regulatory misconduct.";

export function buildDoiComplaintPacketPdf(params: ExportBuilderInput): CarrierReportDocument {
  const source = buildExportTemplateSourceModel(params);
  const { exportModel } = source;
  const rightsReview = buildPolicyRightsReviewModel(params, exportModel);
  const vehicleIdentity = resolveCanonicalVehicleLabel(exportModel) ?? "Unspecified";
  const vin = resolveCanonicalVin(exportModel) ?? "Unspecified";
  const insurer = resolveCanonicalInsurer(exportModel);
  const verifiedRegulationSources = getVerifiedRegulationSources(rightsReview);
  const policySources = getPolicySources(rightsReview, params.report);
  const evidenceIndex = buildEvidenceIndex(params.report);
  const needsReview = buildNeedsReviewBullets(exportModel, rightsReview);
  const claimHandlingContext = buildClaimHandlingDisputeContext(params, exportModel);
  const userContextBullets = buildUserProvidedContextBullets(params.assistantAnalysis, claimHandlingContext.userReports);
  const readiness = buildDoiReadinessReview({
    report: params.report,
    assistantAnalysis: params.assistantAnalysis,
    exportModel,
    rightsReview,
    verifiedRegulationSourceCount: verifiedRegulationSources.length,
  });

  if (readiness.state !== "READY_FOR_DOI") {
    return buildDoiReadinessReviewDocument({
      source,
      exportModel,
      rightsReview,
      vehicleIdentity,
      vin,
      insurer,
      verifiedRegulationSources,
      evidenceIndex,
      readiness,
      assistantAnalysis: params.assistantAnalysis,
    });
  }

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
        "Formal documentation packet for documented claim-handling conduct, verified regulatory support, evidence attachments, repair-scope context, and citation appendix. Repair or estimate disputes are not presented as DOI violations by themselves. Not legal advice.",
      generatedLabel: `Generated ${source.generatedLabel}`,
    },
    summary: [
      { label: "Vehicle", value: vehicleIdentity },
      { label: "VIN", value: vin },
      ...(insurer ? [{ label: "Insurer", value: insurer }] : []),
      { label: "DOI Readiness State", value: readiness.state },
      { label: "Jurisdiction", value: rightsReview.jurisdiction.state },
      { label: "Evidence Items", value: String(evidenceIndex.length) },
      { label: "Repair/Estimate Attachments", value: String(exportModel.supplementItems.length) },
      { label: "Verified Regulation Sources", value: String(verifiedRegulationSources.length) },
      { label: "Documented Conduct Items", value: String(readiness.documentedConduct.length) },
      { label: "Completeness", value: exportModel.confidenceIntegrity.completenessStatus },
    ],
    sections: [
      {
        title: "Claim Handling / Appraisal Dispute Summary",
        bullets: claimHandlingContext.summary,
      },
      {
        title: "What The User Reports",
        bullets: claimHandlingContext.userReports.length
          ? claimHandlingContext.userReports
          : ["No specific user-reported appraisal-process conduct was isolated in the runtime context."],
      },
      ...claimHandlingContext.explicitSections,
      {
        title: "What Uploaded Documents Support",
        bullets: claimHandlingContext.documentSupport.length
          ? claimHandlingContext.documentSupport
          : ["The current source set does not yet isolate written claim-handling communications supporting the reported appraisal-process issue."],
      },
      {
        title: "What Is Not Yet Verified",
        bullets: claimHandlingContext.unverified,
      },
      {
        title: "Why The Timing Dispute Matters",
        bullets: claimHandlingContext.timingConcerns,
      },
      {
        title: "Documents Needed Before Filing",
        bullets: claimHandlingContext.documentsNeeded,
      },
      {
        title: "Supporting Repair/Scope Attachments",
        bullets: claimHandlingContext.repairAttachments,
      },
      {
        title: "Recommended Next Documentation",
        bullets: claimHandlingContext.nextDocumentation,
      },
      {
        title: "DOI Readiness Status",
        bullets: buildReadinessBullets(readiness),
      },
      {
        title: "Claim Timeline",
        bullets: buildClaimTimeline(params.report, source.generatedLabel),
      },
      {
        title: "Claim Communication Summary",
        bullets: buildCommunicationSummary(params.report, exportModel),
      },
      ...(userContextBullets.length
        ? [{
            title: "User-Provided Chat Context",
            bullets: userContextBullets,
          }]
        : []),
      {
        title: "Complaint Grounds - Documented Claim Conduct",
        bullets: buildComplaintGroundBullets(readiness, verifiedRegulationSources),
      },
      {
        title: "Additional Repair/Scope Attachment Detail",
        bullets: buildRepairDisputeAttachmentBullets(exportModel),
      },
      {
        title: "Regulation Support",
        bullets: verifiedRegulationSources.length
          ? verifiedRegulationSources.map(formatPolicyCitation)
          : [
              rightsReview.jurisdiction.confidence === "high"
                ? "No verified regulation citation metadata was available in the current source set. This packet does not assert statutory or regulatory obligations without source metadata."
                : "Jurisdiction not confirmed; legal support unavailable.",
            ],
      },
      {
        title: "Policy Rights",
        bullets: policySources.length
          ? policySources
          : [
              "No policy provision or verified policy-library citation was isolated in the current source set. Policy-rights assertions should remain pending until the applicable policy language is attached and reviewed.",
            ],
      },
      {
        title: "OEM Support",
        bullets: buildOemSupportBullets(exportModel, params.report),
      },
      {
        title: "Estimate Comparison",
        bullets: buildEstimateComparisonAttachmentBullets(source.lineItems),
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
        bullets: buildCitationAppendix(rightsReview, params.report),
      },
      ...(needsReview.length
        ? [{
            title: "Needs Review",
            bullets: needsReview,
          }]
        : []),
    ],
    footer: [
      "This packet is formal, institutional, and documentation-focused. It is not legal advice.",
      "Repair-scope disagreement, missing operations, underwritten estimate items, OEM support, scan/calibration gaps, structural verification issues, supplement disputes, and appraisal amount disagreements are evidence attachments only unless tied to documented insurer claim-handling conduct.",
      "Verified citations are separated from inferred operational commentary. Do not cite inferred commentary as a statute, regulation, policy term, or OEM procedure.",
    ],
  };
}

function buildDoiReadinessReviewDocument(params: {
  source: ReturnType<typeof buildExportTemplateSourceModel>;
  exportModel: ExportModel;
  rightsReview: ReturnType<typeof buildPolicyRightsReviewModel>;
  vehicleIdentity: string;
  vin: string;
  insurer: string | null | undefined;
  verifiedRegulationSources: ReturnType<typeof getVerifiedRegulationSources>;
  evidenceIndex: string[];
  readiness: DoiReadinessReview;
  assistantAnalysis?: string | null;
}): CarrierReportDocument {
  const readinessInput: ExportBuilderInput = {
    report: null,
    analysis: null,
    panel: null,
    assistantAnalysis: params.assistantAnalysis ?? null,
    renderModel: params.exportModel,
  };
  const claimHandlingContext = buildClaimHandlingDisputeContext(readinessInput, params.exportModel);
  const userContextBullets = buildUserProvidedContextBullets(params.assistantAnalysis, claimHandlingContext.userReports);
  return {
    filename: "doi-readiness-review.pdf",
    brand: {
      companyName: "Collision Academy",
      reportLabel: "DOI Readiness Review",
      logoPath: "/brand/logos/logo-horizontal.png",
    },
    header: {
      title: "DOI Readiness Review",
      subtitle:
        "Prerequisite review for DOI escalation. A formal DOI complaint packet is blocked until jurisdiction, verified regulation support, and documented claim-handling conduct are established. Not legal advice.",
      generatedLabel: `Generated ${params.source.generatedLabel}`,
    },
    summary: [
      { label: "Vehicle", value: params.vehicleIdentity },
      { label: "VIN", value: params.vin },
      ...(params.insurer ? [{ label: "Insurer", value: params.insurer }] : []),
      { label: "DOI Readiness State", value: params.readiness.state },
      { label: "Jurisdiction", value: params.rightsReview.jurisdiction.state },
      { label: "Jurisdiction Confirmed", value: params.readiness.jurisdictionConfirmed ? "Yes" : "No" },
      { label: "Verified Regulation Sources", value: String(params.readiness.verifiedRegulationSourceCount) },
      { label: "Documented Conduct Items", value: String(params.readiness.documentedConduct.length) },
      { label: "Repair/Estimate Attachments", value: String(params.exportModel.supplementItems.length) },
    ],
    sections: [
      {
        title: "Claim Handling / Appraisal Dispute Summary",
        bullets: claimHandlingContext.summary,
      },
      {
        title: "What The User Reports",
        bullets: claimHandlingContext.userReports.length
          ? claimHandlingContext.userReports
          : ["No specific user-reported appraisal-process conduct was isolated in the runtime context."],
      },
      ...claimHandlingContext.explicitSections,
      {
        title: "What Uploaded Documents Support",
        bullets: claimHandlingContext.documentSupport.length
          ? claimHandlingContext.documentSupport
          : ["The current source set does not yet isolate written claim-handling communications supporting the reported appraisal-process issue."],
      },
      {
        title: "What Is Not Yet Verified",
        bullets: claimHandlingContext.unverified,
      },
      {
        title: "Why The Timing Dispute Matters",
        bullets: claimHandlingContext.timingConcerns,
      },
      {
        title: "Documents Needed Before Filing",
        bullets: claimHandlingContext.documentsNeeded,
      },
      {
        title: "Supporting Repair/Scope Attachments",
        bullets: claimHandlingContext.repairAttachments,
      },
      {
        title: "Recommended Next Documentation",
        bullets: claimHandlingContext.nextDocumentation,
      },
      {
        title: "DOI Readiness Status",
        bullets: buildComplaintReadinessStatusBullets(params.readiness, params.verifiedRegulationSources),
      },
      ...(userContextBullets.length
        ? [{
            title: "User-Provided Chat Context",
            bullets: userContextBullets,
          }]
        : []),
      {
        title: "What Is Not Yet Proven",
        bullets: buildNotYetProvenBullets(params.readiness),
      },
      {
        title: "Missing Complaint Evidence",
        bullets: buildMissingComplaintEvidenceBullets(params.readiness),
      },
      {
        title: "Documents Needed Before Filing",
        bullets: buildDocumentsNeededBeforeFilingBullets(params.readiness),
      },
      ...(params.readiness.state === "READY_FOR_DOI"
        ? [{
            title: "Optional Draft Complaint",
            bullets: buildOptionalDraftComplaintBullets(params.readiness, params.verifiedRegulationSources),
          }]
        : []),
    ],
    footer: [
      "A DOI readiness review is not a formal DOI complaint packet.",
      "Technical repair or estimate issues are not labeled as DOI violations unless the file documents insurer claim-handling conduct tied to those issues.",
      "This review does not imply a payment outcome, and it does not state a legal violation unless verified legal authority and documented conduct support that conclusion.",
      "Verified citations are separated from inferred operational commentary. Do not cite inferred commentary as a statute, regulation, policy term, or OEM procedure.",
    ],
  };
}

function buildDoiReadinessReview(params: {
  report: RepairIntelligenceReport | null | undefined;
  assistantAnalysis?: string | null;
  exportModel: ExportModel;
  rightsReview: ReturnType<typeof buildPolicyRightsReviewModel>;
  verifiedRegulationSourceCount: number;
}): DoiReadinessReview {
  const documentedConduct = detectDocumentedClaimHandlingConduct(params.report);
  const reportedConduct = detectUserReportedClaimHandlingContext(params.assistantAnalysis);
  const jurisdictionConfirmed = params.rightsReview.jurisdiction.confidence === "high";
  const hasVerifiedRegulationSource = params.verifiedRegulationSourceCount > 0;
  const hasDocumentedConduct = documentedConduct.length > 0;
  const missingPrerequisites = [
    jurisdictionConfirmed ? null : "Confirmed claim jurisdiction.",
    hasVerifiedRegulationSource ? null : "At least one verified authoritative regulation or DOI source from the confirmed jurisdiction.",
    hasDocumentedConduct ? null : "Documented claim-handling conduct beyond repair-scope or appraisal disagreement.",
  ].filter(Boolean) as string[];
  const state: DoiReadinessState =
    jurisdictionConfirmed && hasVerifiedRegulationSource && hasDocumentedConduct
      ? "READY_FOR_DOI"
      : !hasDocumentedConduct
        ? "NOT_READY_FOR_DOI"
        : "NEEDS_MORE_DOCUMENTATION";

  return {
    state,
    jurisdictionConfirmed,
    verifiedRegulationSourceCount: params.verifiedRegulationSourceCount,
    documentedConduct,
    missingPrerequisites: reportedConduct.length
      ? dedupeStrings([
          ...missingPrerequisites,
          "Written carrier or IA demand, correspondence, appraisal invocation, and applicable policy language supporting the user-reported appraisal-process concern.",
        ])
      : missingPrerequisites,
    explanation: state === "NOT_READY_FOR_DOI"
      ? hasVerifiedRegulationSource
        ? NOT_READY_CONDUCT_EXPLANATION
        : NOT_READY_SUMMARY
      : state === "NEEDS_MORE_DOCUMENTATION"
        ? "The file includes possible claim-handling conduct, but the jurisdiction or verified authoritative regulation support is not complete enough for a formal DOI complaint packet."
        : "All DOI complaint prerequisites are present.",
  };
}

function buildUserProvidedContextBullets(value: string | null | undefined, reportedIssues: string[] = []): string[] {
  const reported = detectUserReportedClaimHandlingContext(value);
  const combined = dedupeStrings([...reported, ...reportedIssues]);
  if (!combined.length) return [];

  return [
    "User-provided context reports an appraisal-process dispute, including a disputed demand about award-letter timing before repairs continue. This context is not treated as verified insurer misconduct by itself.",
    `Reported issue category: ${combined.join("; ")}.`,
    "Policy/appraisal language must be reviewed before making any policy-rights conclusion.",
    "Written carrier or IA demand, date-stamped correspondence, appraisal invocation, inspection records, and the applicable policy clause are needed before the DOI readiness gate can treat the conduct as documented.",
  ];
}

function detectUserReportedClaimHandlingContext(value: string | null | undefined): string[] {
  const text = (value ?? "").toLowerCase();
  const findings = [
    /appraisal|award letter|independent appraiser|\bia\b/.test(text) ? "user-reported appraisal-process dispute" : null,
    /denied right to appraisal|denied.*appraisal/.test(text) ? "reported denial of appraisal-rights position" : null,
    /demanding an award letter|before the shop can continue|force/.test(text) ? "reported premature or coercive appraisal demand" : null,
    /legal team|attorney|counsel/.test(text) ? "reported legal-team involvement" : null,
  ].filter(Boolean) as string[];
  return dedupeStrings(findings);
}

function buildComplaintReadinessStatusBullets(
  readiness: DoiReadinessReview,
  verifiedRegulationSources: ReturnType<typeof getVerifiedRegulationSources>
): string[] {
  const verifiedSourceBullet = verifiedRegulationSources.length
    ? `Verified authoritative source(s): ${verifiedRegulationSources.map((source) => cleanPacketText(source.title)).join("; ")}.`
    : "Verified authoritative source(s): None isolated from the confirmed jurisdiction.";

  return [
    `State: ${readiness.state}.`,
    readiness.explanation,
    `Jurisdiction confirmed: ${readiness.jurisdictionConfirmed ? "Yes" : "No"}.`,
    `Verified authoritative regulation/source count: ${readiness.verifiedRegulationSourceCount}.`,
    verifiedSourceBullet,
    `Documented claim-handling conduct count: ${readiness.documentedConduct.length}.`,
    "No legal violation is asserted unless verified legal authority and documented claim-handling conduct are both present.",
  ];
}

function buildReadinessBullets(readiness: DoiReadinessReview): string[] {
  return [
    `State: ${readiness.state}.`,
    readiness.explanation,
    `Jurisdiction confirmed: ${readiness.jurisdictionConfirmed ? "Yes" : "No"}.`,
    `Verified authoritative regulation/source count: ${readiness.verifiedRegulationSourceCount}.`,
    `Documented claim-handling conduct count: ${readiness.documentedConduct.length}.`,
    "Repair or estimate disputes alone are treated as support attachments, not DOI complaint grounds.",
  ];
}

function buildNotYetProvenBullets(readiness: DoiReadinessReview): string[] {
  const gaps = [
    readiness.verifiedRegulationSourceCount > 0 ? null : "A confirmed regulatory citation tied to the alleged conduct has not been isolated.",
    readiness.documentedConduct.some((item) => /denial/i.test(item)) ? null : "A written denial or written claim-position explanation has not been isolated.",
    readiness.documentedConduct.some((item) => /delay|respond/i.test(item)) ? null : "A delay log, ignored-communication log, or communication timeline has not been isolated.",
    readiness.documentedConduct.some((item) => /supplement|review/i.test(item)) ? null : "Refusal-to-review or refusal-to-consider supplement documentation has not been isolated.",
  ].filter(Boolean) as string[];

  return gaps.length
    ? gaps
    : ["No unresolved proof gaps were identified by the readiness gate."];
}

function buildMissingComplaintEvidenceBullets(readiness: DoiReadinessReview): string[] {
  return [
    ...(readiness.missingPrerequisites.length ? readiness.missingPrerequisites : []),
    readiness.verifiedRegulationSourceCount > 0 ? null : "Confirmed regulatory citation from the correct jurisdiction.",
    "Written denial, written claim-position letter, or written explanation of the insurer position.",
    "Date-stamped communication timeline showing unanswered, delayed, or refused communications.",
    "Supplement review request and any documented refusal to inspect, review, or consider the documented supplement.",
  ].filter(Boolean) as string[];
}

function buildDocumentsNeededBeforeFilingBullets(readiness: DoiReadinessReview): string[] {
  return dedupeStrings([
    ...readiness.missingPrerequisites,
    "Applicable policy/declarations and any governing-law or state-specific policy notices.",
    "Official regulation, statute, DOI bulletin/notice, or administrative-code citation from the confirmed jurisdiction.",
    "Carrier written denial, written claim position, supplement response, or explanation of payment decision.",
    "Date-stamped emails, letters, call logs, portal messages, or notes showing delay, nonresponse, refusal to inspect, refusal to review a supplement, misrepresentation, or coercive appraisal conduct.",
    "Repair-scope, appraisal, estimate, OEM, scan/calibration, or structural-verification materials as attachments only.",
  ]);
}

function buildOptionalDraftComplaintBullets(
  readiness: DoiReadinessReview,
  verifiedRegulationSources: ReturnType<typeof getVerifiedRegulationSources>
): string[] {
  if (readiness.state !== "READY_FOR_DOI") {
    return [];
  }

  return [
    "Draft complaint may be prepared because jurisdiction, verified regulatory support, and documented claim-handling conduct are present.",
    ...buildComplaintGroundBullets(readiness, verifiedRegulationSources),
    "Requested review should be framed as regulatory review of documented claim-handling conduct, not as a request for the DOI to force payment.",
  ];
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
  ].filter(Boolean) as string[];

  return timeline.length > 1
    ? timeline
    : [
        ...timeline,
        "No detailed communication chronology was available in the structured claim context. Add date-stamped carrier correspondence, estimate revisions, supplements, and denial notes to complete the timeline.",
      ];
}

function buildRepairDisputeAttachmentBullets(exportModel: ExportModel): string[] {
  const items = exportModel.supplementItems.slice(0, 12).map((item) =>
    [
      `Attachment context: ${formatOperation(item.title)}.`,
      `Repair/estimate issue type: ${formatLabel(item.kind)}.`,
      `Dispute priority: ${formatPriority(item.priority, item.leverageScore)}.`,
      `Why it matters: ${cleanPacketText(item.rationale)}.`,
      item.evidence ? `Support: ${cleanPacketText(item.evidence)}.` : "Support: Not verified in attached source metadata.",
      item.source ? `Source: ${cleanPacketText(item.source)}.` : "Source: Repair attachment context; independent citation still needed.",
      "DOI status: Not a complaint ground unless tied to documented insurer claim-handling conduct.",
    ].join(" ")
  );

  return items.length
    ? items
    : ["No unresolved estimate operations were isolated from the current structured analysis."];
}

function buildComplaintGroundBullets(
  readiness: DoiReadinessReview,
  verifiedRegulationSources: ReturnType<typeof getVerifiedRegulationSources>
): string[] {
  if (!readiness.documentedConduct.length) {
    return ["No DOI complaint grounds are established because no documented claim-handling conduct was isolated."];
  }

  const regulationSummary = verifiedRegulationSources.length
    ? `Verified regulatory support count: ${verifiedRegulationSources.length}.`
    : "Verified regulatory support count: 0.";

  return readiness.documentedConduct.map((conduct) =>
    `${conduct} Complaint-ground status: conduct-based. ${regulationSummary} Repair-scope disagreement is attachment context only.`
  );
}

function getVerifiedRegulationSources(review: ReturnType<typeof buildPolicyRightsReviewModel>) {
  return dedupePolicyCitations(
    review.verifiedRegulations.flatMap((assertion) => assertion.citations)
  );
}

function getPolicySources(
  review: ReturnType<typeof buildPolicyRightsReviewModel>,
  report: RepairIntelligenceReport | null | undefined
): string[] {
  const sourceBullets = dedupePolicyCitations(
    review.policyRights.flatMap((assertion) => assertion.citations)
  ).map(formatPolicyCitation);
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
        : null,
      `Recommended follow-up: ${cleanPacketText(contradiction.recommendedFollowUp)}.`,
    ].filter(Boolean).join(" ")
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

function buildEstimateComparisonAttachmentBullets(lineItems: ExportLineComparison[]): string[] {
  const bullets = lineItems.slice(0, 12).map((item) =>
    [
      `Attachment context: ${formatOperation(item.operation)}.`,
      `Component: ${cleanPacketText(item.component || "Unspecified")}.`,
      `Carrier position: ${cleanPacketText(item.carrierPosition)}.`,
      `Support status: ${formatLabel(item.supportStatus)}.`,
      `Rationale: ${cleanPacketText(item.rationale)}.`,
      item.support ? `Support: ${cleanPacketText(item.support)}.` : null,
      "DOI status: Estimate comparison only; not a DOI violation without documented claim-handling conduct.",
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
  const evidence = (report?.evidence ?? [])
    .filter(isVerifiedEvidenceRecord)
    .map(formatEvidenceRecord);
  const factualCore = report?.factualCore?.evidenceRegistrySummary ?? [];

  return dedupeStrings([...registry, ...evidence, ...factualCore.map((item) => `Evidence summary: ${cleanPacketText(item)}.`)]).slice(0, 20);
}

function detectDocumentedClaimHandlingConduct(report: RepairIntelligenceReport | null | undefined): string[] {
  const evidenceText = [
    ...(report?.evidenceRegistry ?? []).map((item) =>
      [
        item.label,
        item.extractedText,
        item.extractedSummary,
        ...Object.values(item.structuredFacts ?? {}).flatMap((value) => Array.isArray(value) ? value : value ? [String(value)] : []),
      ].filter(Boolean).join(" ")
    ),
    ...(report?.evidence ?? []).map((item) => [item.title, item.snippet, item.source].filter(Boolean).join(" ")),
    ...(report?.factualCore?.evidenceRegistrySummary ?? []),
    ...(report?.reassessmentDelta?.newlyDocumented ?? []),
  ].join("\n");

  const conductPatterns: Array<{ label: string; pattern: RegExp }> = [
    { label: "Unreasonable delay", pattern: /\b(unreasonable|excessive|extended|unexplained|ongoing)\s+delay\b|\bdelay(?:ed|s)?\s+(?:payment|claim|response|review|inspection|supplement)\b/i },
    { label: "Denial without explanation", pattern: /\bden(?:y|ied|ial)\b(?:(?!\n).){0,80}\b(without|no)\b(?:(?!\n).){0,40}\b(explanation|basis|reason|rationale)\b|\b(without|no)\b(?:(?!\n).){0,40}\b(explanation|basis|reason|rationale)\b(?:(?!\n).){0,80}\bden(?:y|ied|ial)\b/i },
    { label: "Failure to respond", pattern: /\b(fail(?:ed|ure)?|refus(?:ed|al)|did not|no)\s+(?:to\s+)?respond\b|\bno response\b|\bunanswered\b|\bnon[- ]?responsive\b/i },
    { label: "Refusal to review supplement", pattern: /\brefus(?:ed|al|es|ing)\b(?:(?!\n).){0,80}\b(review|consider|inspect|reinspect)\b(?:(?!\n).){0,80}\bsupplement\b|\bsupplement\b(?:(?!\n).){0,80}\brefus(?:ed|al|es|ing)\b/i },
    { label: "Misrepresentation of policy rights", pattern: /\bmisrepresent(?:ed|ation|s|ing)?\b(?:(?!\n).){0,80}\b(policy|coverage|rights|appraisal)\b|\b(policy|coverage|appraisal)\s+rights\b(?:(?!\n).){0,80}\bmisstated\b/i },
    { label: "Coercive appraisal conduct", pattern: /\b(coerc(?:ed|ion|ive)|pressur(?:ed|e)|threat(?:ened|s)?)\b(?:(?!\n).){0,80}\bappraisal\b|\bappraisal\b(?:(?!\n).){0,80}\b(coerc(?:ed|ion|ive)|pressur(?:ed|e)|threat(?:ened|s)?)\b/i },
    { label: "Refusal to provide written claim position", pattern: /\brefus(?:ed|al|es|ing)\b(?:(?!\n).){0,100}\b(written|in writing)\b(?:(?!\n).){0,80}\b(claim )?position\b|\b(written|in writing)\b(?:(?!\n).){0,80}\b(claim )?position\b(?:(?!\n).){0,80}\brefus(?:ed|al|es|ing)\b/i },
  ];

  return conductPatterns
    .filter((conduct) => conduct.pattern.test(evidenceText))
    .map((conduct) => `Documented conduct: ${conduct.label}.`);
}

function buildCitationAppendix(
  review: ReturnType<typeof buildPolicyRightsReviewModel>,
  report: RepairIntelligenceReport | null | undefined
): string[] {
  const retrievalSources = dedupePolicyCitations([
    ...review.verifiedRegulations.flatMap((assertion) => assertion.citations),
    ...review.policyRights.flatMap((assertion) => assertion.citations),
    ...review.oemPositionSupport.flatMap((assertion) => assertion.citations),
    ...review.escalationOptions.flatMap((assertion) => assertion.citations),
  ]).map(formatPolicyCitation);
  const evidenceSources = (report?.evidence ?? [])
    .filter(isVerifiedEvidenceRecord)
    .map(
      (item) => `Evidence citation: ${cleanPacketText(item.title)}. Source: ${cleanPacketText(item.source)}. Authority: ${formatLabel(item.authority)}.`
    );

  return dedupeStrings([...retrievalSources, ...evidenceSources]).slice(0, 24).length
    ? dedupeStrings([...retrievalSources, ...evidenceSources]).slice(0, 24)
    : ["No immutable citation metadata was available in the current report payload."];
}

function buildNeedsReviewBullets(
  exportModel: ExportModel,
  review: ReturnType<typeof buildPolicyRightsReviewModel>
): string[] {
  const verifiedLegalKeys = new Set(
    review.verifiedRegulations.flatMap((assertion) => assertion.citations.map((citation) => citation.immutableKey))
  );
  const unverifiedLegalSourceCount = review.citations.filter((citation) =>
    !verifiedLegalKeys.has(citation.immutableKey) &&
    (
      citation.source === "InternetResearch" ||
      /statute|regulation|insurance code|department of insurance|\bDOI\b|law|legal|appraisal/i.test(
        `${citation.title} ${citation.url ?? ""} ${citation.locator ?? ""}`
      )
    )
  ).length;
  const bullets = [
    ...(review.jurisdiction.confidence === "high"
      ? []
      : ["Jurisdiction not confirmed; legal support unavailable."]),
    ...(unverifiedLegalSourceCount
      ? [
          "Needs review: Non-official, weak, or jurisdiction-mismatched legal sources were excluded from verified support.",
        ]
      : []),
    ...(review.internetDerivedSupport.length
      ? [
          "Needs review: Internet-sourced legal commentary was excluded until a jurisdiction-matched official source is verified.",
        ]
      : []),
    ...(review.proceduralInference.length
      ? [
          "Needs review: Inferred claim-handling commentary was excluded until verified legal or policy support is available.",
        ]
      : []),
    ...exportModel.oemContradictions
      .filter((contradiction) => !contradiction.oemSupportCitation)
      .map((contradiction) => `Needs review: ${cleanPacketText(contradiction.affectedOperation)} lacks verified OEM citation support.`),
  ];

  return dedupeStrings(bullets).slice(0, 12);
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

function isVerifiedEvidenceRecord(item: EvidenceRecord): boolean {
  return item.authority === "oem" || item.authority === "internal";
}

function formatPolicyCitation(citation: { title: string; source: string; sourceType?: string; url?: string; retrievedAt?: string; jurisdiction?: string; effectiveDate?: string; locator?: string }): string {
  return [
    `Source: ${cleanPacketText(citation.title)}.`,
    `Source type: ${formatLabel(citation.sourceType ?? citation.source)}.`,
    citation.url ? `Locator: ${citation.url}.` : citation.locator ? `Locator: ${citation.locator}.` : "Locator: Not provided.",
    citation.retrievedAt ? `Retrieved: ${citation.retrievedAt}.` : null,
    citation.effectiveDate ? `Effective date: ${citation.effectiveDate}.` : null,
    citation.jurisdiction ? `Jurisdiction: ${citation.jurisdiction}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function dedupePolicyCitations<T extends { id?: string; title: string; source: string }>(citations: T[]): T[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = citation.id ?? `${citation.source}:${citation.title}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
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
  return value
    .replace(/\buploaded document\b/gi, "source material")
    .replace(/\bSame rationale as earlier\b/gi, "The same support should be reviewed with the current claim context.")
    .replace(/\bCurrent estimate analysis; citation still needed\b/gi, "Repair attachment context; independent citation still needed")
    .replace(/\bclaim-\[REDACTED_CLAIM\]\b/gi, "the claim")
    .replace(/\bpolicy-\[REDACTED_POLICY\]\b/gi, "the policy")
    .replace(/\bCalibration Verification Open\b/gi, "scan and calibration verification remains open")
    .replace(/\s+/g, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .trim();
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
