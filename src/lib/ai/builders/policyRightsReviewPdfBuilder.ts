import type { CarrierReportDocument } from "./carrierPdfBuilder";
import {
  buildExportModel,
  redactExportModelForDownload,
  resolveCanonicalInsurer,
  resolveCanonicalVehicleLabel,
  resolveCanonicalVin,
} from "./buildExportModel";
import type { ExportBuilderInput } from "./exportTemplates";
import { buildClaimHandlingDisputeContext } from "./claimHandlingDisputeContext";
import { sanitizeUserFacingEvidenceText } from "@/lib/ui/presentationText";
import { buildReviewCompletenessMessage } from "@/lib/reviewCompleteness";
import {
  formatResolvedJurisdictionForReport,
  resolveJurisdiction,
  type ResolvedJurisdiction,
} from "@/lib/ai/jurisdictionResolver";
import {
  buildJurisdictionUnavailableMessage,
  classifySourceAuthorityTier,
  getClaimStateCodeFromJurisdiction,
  isOfficialLegalSource,
  isVerifiedLegalCitation,
  isVerifiedPolicyCitation,
  isWeakLegalSource,
} from "./policySourceValidation";
import type {
  ImmutablePolicyCitation,
  PolicyRightsAssertion,
  PolicyRightsConfidenceBand,
  PolicyRightsCitationSource,
  PolicyRightsReviewModel,
  PolicyRightsSupportCategory,
} from "@/lib/ai/types/policyRightsReview";

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  IA: "Iowa",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  MA: "Massachusetts",
  MD: "Maryland",
  ME: "Maine",
  MI: "Michigan",
  MN: "Minnesota",
  MO: "Missouri",
  MS: "Mississippi",
  MT: "Montana",
  NC: "North Carolina",
  ND: "North Dakota",
  NE: "Nebraska",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NV: "Nevada",
  NY: "New York",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VA: "Virginia",
  VT: "Vermont",
  WA: "Washington",
  WI: "Wisconsin",
  WV: "West Virginia",
  WY: "Wyoming",
};

export function buildPolicyRightsReviewPdf(params: ExportBuilderInput): CarrierReportDocument {
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
  const review = buildPolicyRightsReviewModel(params, exportModel);
  const vehicleIdentity = resolveCanonicalVehicleLabel(exportModel) ?? "Unspecified";
  const vin = resolveCanonicalVin(exportModel) ?? "Unspecified";
  const insurer = resolveCanonicalInsurer(exportModel);
  const verifiedCitations = getVerifiedReviewCitations(review);
  const needsReview = buildSourceNeedsReviewBullets(review);
  const claimHandlingContext = buildClaimHandlingDisputeContext(params, exportModel);
  const userContextBullets = buildUserProvidedContextBullets(params.assistantAnalysis, claimHandlingContext.userReports);

  return {
    filename: "policy-rights-review.pdf",
    brand: {
      companyName: "Collision Academy",
      reportLabel: "Policy & Rights Review",
      logoPath: "/brand/logos/logo-horizontal.png",
    },
    header: {
      title: "Policy & Rights Review",
      subtitle:
        "Formal review of jurisdiction, policy-rights indicators, appraisal-rights indicators, insurer-obligation support, OEM position support, and escalation options. Not legal advice.",
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
      { label: "Jurisdiction", value: review.jurisdiction.state },
      { label: "Jurisdiction Confidence", value: capitalize(review.jurisdiction.confidence) },
      ...(review.jurisdiction.source ? [{ label: "Jurisdiction Source", value: review.jurisdiction.source }] : []),
      {
        label: "Appraisal Rights",
        value: `${review.appraisalRights.detected ? "Detected" : "Not confirmed"} (${capitalize(
          review.appraisalRights.confidence
        )})`,
      },
      { label: "Verified Legal Citations", value: String(getVerifiedLegalCitationCount(review)) },
      { label: "Verified / Inferred Assertions", value: formatVerifiedInferredCount(review) },
      { label: "Incomplete Evidence Items", value: String(countAssertionsByConfidence(review, "insufficient")) },
    ],
    sections: [
      {
        title: "Policy / Appraisal Dispute Focus",
        bullets: [
          ...claimHandlingContext.summary,
          "This review prioritizes the policy appraisal clause, disagreement-resolution process, carrier written position, supplement maturity, and amount-of-loss timing before any repair operation detail.",
        ],
      },
      {
        title: "What The User Reports",
        bullets: claimHandlingContext.userReports.length
          ? claimHandlingContext.userReports
          : ["No specific appraisal-process conduct was isolated in the runtime context."],
      },
      ...claimHandlingContext.explicitSections,
      {
        title: "Appraisal / Amount-Of-Loss Timing Issues",
        bullets: claimHandlingContext.timingConcerns,
      },
      {
        title: "Appraisal Rights",
        bullets: [
          `Detection: ${review.appraisalRights.detected ? "Detected" : "Not confirmed"}.`,
          `Confidence: ${capitalize(review.appraisalRights.confidence)}.`,
          `Basis: ${humanizePolicyText(review.appraisalRights.basis)}`,
          formatCitationList(review.appraisalRights.citations),
          "The key policy question is whether the disagreement-resolution language supports finalizing the amount of loss before teardown-dependent supplements and final repair documentation are mature.",
        ],
      },
      {
        title: "Policy Rights Review",
        bullets: formatAssertions(review.policyRights, "No policy-rights provisions were identified in the current source set."),
      },
      {
        title: "Need For Written Carrier Position",
        bullets: claimHandlingContext.nextDocumentation,
      },
      {
        title: "Repair Scope Only Where Tied To Loss Maturity",
        bullets: claimHandlingContext.repairAttachments,
      },
      {
        title: "Jurisdiction Summary",
        bullets: [
          `Detected jurisdiction: ${review.jurisdiction.state}.`,
          `Detection confidence: ${capitalize(review.jurisdiction.confidence)}.`,
          review.jurisdiction.source ? `Source: ${review.jurisdiction.source}.` : null,
          `Basis: ${humanizePolicyText(review.jurisdiction.basis)}`,
        ].filter((item): item is string => Boolean(item)),
      },
      {
        title: "Verified Regulation Support",
        bullets: formatAssertions(
          review.verifiedRegulations,
          review.jurisdiction.confidence === "high"
            ? "No verified regulation citations were available in the current source set. The report does not infer statutes or regulatory duties without citation metadata."
            : buildJurisdictionUnavailableMessage()
        ),
      },
      ...(userContextBullets.length
        ? [{
            title: "User-Provided Chat Context",
            bullets: userContextBullets,
          }]
        : []),
      {
        title: "Needs Review",
        bullets: needsReview.length
          ? needsReview
          : ["No weak, unsupported, or mismatched legal sources were used as verified legal support."],
      },
      {
        title: "Insurer Obligation Indicators",
        bullets: formatAssertions(
          review.insurerObligations,
          "No verified insurer-obligation citation was available. Operational concerns should be treated as claim-handling indicators only."
        ),
      },
      ...(review.oemPositionSupport.length
        ? [{
            title: "OEM / Repair Support Attachments",
            bullets: formatAssertions(review.oemPositionSupport, "No OEM position statement citation was available in the current source set."),
          }]
        : []),
      {
        title: "Escalation Options",
        bullets: formatAssertions(
          review.escalationOptions,
          review.jurisdiction.confidence === "high"
            ? "No DOI escalation citation was available. Escalation should not be recommended as a legal conclusion without verified jurisdiction support."
            : buildJurisdictionUnavailableMessage()
        ),
      },
      {
        title: "Documentation Still Needed",
        bullets: review.missingDocumentation,
      },
      {
        title: "Source & Citation Index",
        bullets: verifiedCitations.length
          ? verifiedCitations.map(formatCitationIndexItem)
          : ["No immutable legal or policy citation metadata was available from the current source set."],
      },
    ],
    footer: [
      "This report is informational and documentation-focused. It is not legal advice.",
      "Verified law, policy extraction, OEM support, procedural inference, and internet-derived support are confidence-weighted separately. Do not cite inferred or unsupported commentary as a statute, regulation, policy term, or OEM procedure.",
    ],
  };
}

export function buildPolicyRightsReviewModel(
  params: ExportBuilderInput,
  exportModel: ReturnType<typeof buildExportModel>
): PolicyRightsReviewModel {
  const uploadedJurisdictionText = buildUploadedJurisdictionText(params);
  const sourceText = [
    uploadedJurisdictionText,
    params.assistantAnalysis,
    params.analysis?.narrative,
    params.report?.analysis?.narrative,
    exportModel.repairPosition,
    exportModel.positionStatement,
    exportModel.request,
    ...(params.panel?.stateLeverage ?? []),
  ]
    .filter(Boolean)
    .join("\n");
  const citations = buildImmutableCitations(params, exportModel);
  const legalCitations = citations.filter((citation) =>
    ["VerifiedRegulationsDatabase", "DriveLawFolder"].includes(citation.source) &&
    citation.sourceAuthorityTier === "LEGAL_AUTHORITY"
  );
  const internetCitations = citations.filter((citation) => citation.source === "InternetResearch");
  const policyCitations = citations.filter((citation) =>
    ["DrivePolicyFolder", "UploadedPolicyDocument"].includes(citation.source)
  );
  const oemCitations = citations.filter((citation) => citation.source === "OEMPositionStatement");
  const jurisdiction = toPolicyRightsJurisdiction(resolveJurisdiction(params));
  const claimStateCode = getClaimStateCodeFromJurisdiction(jurisdiction);
  const verifiedLegalCitations = legalCitations.filter((citation) =>
    isVerifiedLegalCitation(citation, claimStateCode)
  );
  const verifiedPolicyCitations = policyCitations.filter((citation) => isVerifiedPolicyCitation(citation));
  const appraisalDetected =
    Boolean(params.panel?.appraisal?.triggered) ||
    /\b(appraisal|arbitration|if we cannot agree|cannot agree)\b/i.test(sourceText);
  const appraisalCitations = [
    ...verifiedLegalCitations.filter((citation) => /appraisal/i.test(citation.title)),
    ...verifiedPolicyCitations.filter((citation) =>
      /appraisal|arbitration|cannot agree/i.test(`${citation.title} ${citation.locator ?? ""}`)
    ),
  ];
  const doiCitations = verifiedLegalCitations.filter((citation) =>
    /\bDOI\b|department of insurance|insurance department/i.test(`${citation.title} ${citation.locator ?? ""}`)
  );

  return {
    jurisdiction,
    appraisalRights: {
      detected: appraisalDetected,
      confidence: appraisalCitations.length > 0 ? "high" : appraisalDetected ? "medium" : "low",
      basis: appraisalCitations.length > 0
        ? "Uploaded policy or verified source metadata includes appraisal, arbitration, or disagreement-resolution language."
        : params.panel?.appraisal?.reasoning || "No verified appraisal clause or regulation was isolated from the current source set.",
      citations: appraisalCitations,
    },
    verifiedRegulations: verifiedLegalCitations.map((citation) =>
      buildConfidenceWeightedAssertion({
        statement: `Verified legal or regulatory source available for review: ${citation.title}.`,
        supportCategory: "verified_regulation",
        citations: [citation],
      })
    ),
    policyRights: verifiedPolicyCitations.map((citation) =>
      buildConfidenceWeightedAssertion({
        statement: `Policy document source available for rights review: ${citation.title}.`,
        supportCategory: "policy_extraction",
        citations: [citation],
      })
    ),
    insurerObligations: buildInsurerObligationAssertions(sourceText, verifiedLegalCitations),
    oemPositionSupport: oemCitations.map((citation) =>
      buildConfidenceWeightedAssertion({
        statement: `OEM position support source available: ${citation.title}.`,
        supportCategory: "oem_support",
        citations: [citation],
      })
    ),
    proceduralInference: buildProceduralInferenceAssertions(sourceText, citations),
    internetDerivedSupport: internetCitations.map((citation) =>
      buildConfidenceWeightedAssertion({
        statement: `Internet-derived support source available for review: ${citation.title}.`,
        supportCategory: "internet_derived_support",
        citations: [citation],
      })
    ),
    escalationOptions: doiCitations.map((citation) =>
      buildConfidenceWeightedAssertion({
        statement: `DOI or insurance-department escalation source available: ${citation.title}.`,
        supportCategory: "verified_regulation",
        citations: [citation],
      })
    ),
    missingDocumentation: buildMissingDocumentation(verifiedPolicyCitations, verifiedLegalCitations),
    citations,
  };
}

function buildInsurerObligationAssertions(
  sourceText: string,
  legalCitations: ImmutablePolicyCitation[]
): PolicyRightsAssertion[] {
  const obligationCitations = legalCitations.filter((citation) =>
    /claim handling|insurer|insurance|unfair|settlement|obligation|regulation/i.test(citation.title)
  );

  if (obligationCitations.length > 0) {
    return obligationCitations.map((citation) =>
      buildConfidenceWeightedAssertion({
        statement: `Verified insurer-obligation source available: ${citation.title}.`,
        supportCategory: "verified_regulation",
        citations: [citation],
      })
    );
  }

  if (/delay|denial|refus|underpay|supplement|documentation|appraisal/i.test(sourceText)) {
    return [
      buildConfidenceWeightedAssertion({
        statement:
          "Claim-handling concerns are present in the runtime context, but no verified insurer-obligation citation was isolated.",
        supportCategory: "claim_runtime_context",
        citations: [],
        commentary:
          "Treat this as operational commentary only until a verified regulation, statute, policy provision, or DOI source is attached.",
      }),
    ];
  }

  return [];
}

function buildProceduralInferenceAssertions(
  sourceText: string,
  citations: ImmutablePolicyCitation[]
): PolicyRightsAssertion[] {
  const hasProcedureSignals = /\b(oem|procedure|scan|calibration|adas|structural|corrosion|weld|blend|refinish|one[- ]?time|verification)\b/i.test(sourceText);
  const hasVerifiedSupport = citations.some((citation) =>
    citation.source === "OEMPositionStatement" ||
    (
      ["VerifiedRegulationsDatabase", "DriveLawFolder"].includes(citation.source) &&
      citation.sourceAuthorityTier === "LEGAL_AUTHORITY"
    )
  );

  if (!hasProcedureSignals || hasVerifiedSupport) {
    return [];
  }

  return [
    buildConfidenceWeightedAssertion({
      statement:
        "Procedure-related signals are present in the runtime analysis, but verified OEM, policy, or regulation support was not isolated.",
      supportCategory: "procedural_inference",
      citations: [],
      commentary:
        "This may guide document collection, but it should not be presented as a confirmed legal, policy, or OEM requirement.",
    }),
  ];
}

function buildImmutableCitations(
  params: ExportBuilderInput,
  exportModel: ReturnType<typeof buildExportModel>
): ImmutablePolicyCitation[] {
  const rawSources = exportModel.retrievalSummary?.sourcesInfluencingFindings ?? [];
  const citations = rawSources.map((source, index) => {
    const locator = source.relatedFindingIds.length
      ? `Related findings: ${source.relatedFindingIds.join(", ")}`
      : undefined;
    const sourceAuthorityTier = classifySourceAuthorityTier({
      title: source.title,
      sourceType: source.sourceType,
      url: source.url,
      locator,
    });
    const citationSource = classifyCitationSource(source.title, source.sourceType, sourceAuthorityTier);

    return createCitation({
      source: citationSource,
      sourceAuthorityTier,
      sourceType: source.sourceType,
      title: source.title,
      locator,
      url: source.url,
      retrievedAt: new Date().toISOString(),
      jurisdiction: inferCitationJurisdiction(`${source.title} ${locator ?? ""}`),
      confidenceScore: source.sourceType === "oem" ? 0.78 : source.sourceType === "web" ? 0.62 : 0.7,
      index,
    });
  });

  if (params.report?.ingestionMeta?.uploadedFileCount || exportModel.confidenceIntegrity.uploadedFileCount > 0) {
    citations.push(createCitation({
      source: "ClaimAnalysisRuntime",
      sourceAuthorityTier: "INDUSTRY_CONTEXT",
      sourceType: "runtime",
      title: "Claim analysis runtime context",
      locator: buildReviewCompletenessMessage({
        reviewed: exportModel.confidenceIntegrity.reviewedFileCount ?? 0,
        total: exportModel.confidenceIntegrity.reviewableFileCount ?? exportModel.confidenceIntegrity.totalKnownFileCount ?? exportModel.confidenceIntegrity.uploadedFileCount,
      }),
      retrievedAt: new Date().toISOString(),
      confidenceScore: 0.45,
      index: citations.length,
    }));
  }

  const uploadedPolicyText = buildUploadedJurisdictionText(params);
  const uploadedPolicyCitations = buildUploadedPolicyCitations(uploadedPolicyText, citations.length);
  citations.push(...uploadedPolicyCitations);

  return dedupeCitations(citations);
}

function buildUserProvidedContextBullets(value: string | null | undefined, reportedIssues: string[] = []): string[] {
  const text = (value ?? "").replace(/\r/g, "\n").trim();
  if (!text && reportedIssues.length === 0) {
    return [];
  }
  if (!/User-Provided Chat Context|appraisal|carrier|claim|denial|delay|refus|award letter|independent appraiser|IA/i.test(text) && reportedIssues.length === 0) {
    return [];
  }

  return [
    "User-provided context reports an appraisal-process dispute or claim-handling concern. This is treated as user-provided context, not verified document evidence.",
    ...(reportedIssues.length ? [`Reported issue category: ${dedupeStrings(reportedIssues).join("; ")}.`] : []),
    "The context should be used to identify what policy issue to review, including appraisal language, disagreement-resolution terms, repair-completion posture, award-letter timing, amount-of-loss maturity, and any written carrier or IA demand.",
    "Policy/appraisal language, written carrier or IA correspondence, appraisal invocation, inspection notes, and any legal-team correspondence must be reviewed before stating a policy position.",
  ];
}

function buildUploadedPolicyCitations(text: string, startIndex: number): ImmutablePolicyCitation[] {
  if (!hasUploadedPolicyEvidence(text)) return [];

  const policySignals = [
    /governed by|laws? of|policy state|declarations?|financial responsibility|identification card/i.test(text)
      ? "policy, declarations, or insurance identification-card indicators; jurisdiction metadata is redacted or ambiguous"
      : null,
    /collision|comprehensive|coverage/i.test(text) ? "collision or comprehensive coverage indicators" : null,
    /appraisal|arbitration|if we cannot agree|cannot agree/i.test(text)
      ? "appraisal, arbitration, or disagreement-resolution wording"
      : null,
    /duties after loss|cooperat|payment of loss|loss payable|claim/i.test(text)
      ? "duties after loss, cooperation, claim, or payment-of-loss wording"
      : null,
  ].filter(Boolean).join("; ");

  return [
    createCitation({
      source: "UploadedPolicyDocument",
      sourceAuthorityTier: "POLICY_CONTRACT",
      sourceType: "runtime",
      title: "Uploaded policy packet / appraisal-language support; jurisdiction metadata redacted or ambiguous",
      locator: policySignals || "Policy evidence was classified from policy-related source text.",
      retrievedAt: new Date().toISOString(),
      confidenceScore: 0.86,
      index: startIndex,
    }),
  ];
}

function hasUploadedPolicyEvidence(text: string): boolean {
  return /\b(policy|declarations?|endorsement|coverage|collision|comprehensive|appraisal|arbitration|financial responsibility|identification card|governing law|laws? of|duties after loss|payment of loss)\b/i.test(text);
}

function classifyCitationSource(
  title: string,
  sourceType: "drive" | "web" | "oem" | "estimate",
  sourceAuthorityTier: ImmutablePolicyCitation["sourceAuthorityTier"]
): PolicyRightsCitationSource {
  const officialSource = sourceAuthorityTier === "LEGAL_AUTHORITY";
  if (/policy|declarations|endorsement|coverage/i.test(title)) {
    return sourceType === "drive" ? "DrivePolicyFolder" : "UploadedPolicyDocument";
  }
  if (sourceAuthorityTier === "OEM_PROCEDURE" || sourceType === "oem" || /oem|position statement|manufacturer/i.test(title)) {
    return "OEMPositionStatement";
  }
  if (/statute|regulation|insurance code|department of insurance|\bDOI\b|appraisal|consumer rights/i.test(title)) {
    if (officialSource) {
      return sourceType === "drive" ? "DriveLawFolder" : "VerifiedRegulationsDatabase";
    }
    return "InternetResearch";
  }
  if (sourceType === "web") return "InternetResearch";
  return "ClaimAnalysisRuntime";
}

function createCitation(params: {
  source: PolicyRightsCitationSource;
  sourceAuthorityTier: ImmutablePolicyCitation["sourceAuthorityTier"];
  sourceType?: ImmutablePolicyCitation["sourceType"];
  title: string;
  locator?: string;
  url?: string;
  retrievedAt?: string;
  jurisdiction?: string;
  effectiveDate?: string;
  confidenceScore?: number;
  index: number;
}): ImmutablePolicyCitation {
  const immutableKey = stableHash([
    params.source,
    params.title,
    params.locator ?? "",
    params.url ?? "",
  ].join("|"));

  return {
    id: `PRR-${String(params.index + 1).padStart(3, "0")}-${immutableKey.slice(0, 8)}`,
    source: params.source,
    sourceAuthorityTier: params.sourceAuthorityTier,
    ...(params.sourceType ? { sourceType: params.sourceType } : {}),
    title: params.title,
    ...(params.locator ? { locator: params.locator } : {}),
    ...(params.url ? { url: params.url } : {}),
    ...(params.retrievedAt ? { retrievedAt: params.retrievedAt } : {}),
    ...(params.jurisdiction ? { jurisdiction: params.jurisdiction } : {}),
    ...(params.effectiveDate ? { effectiveDate: params.effectiveDate } : {}),
    ...(typeof params.confidenceScore === "number" ? { confidenceScore: params.confidenceScore } : {}),
    immutableKey,
  };
}

function inferCitationJurisdiction(text: string): string | undefined {
  for (const [code, name] of Object.entries(STATE_NAMES)) {
    const codePattern = new RegExp(`\\b${code}\\b`);
    const namePattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i");
    if (namePattern.test(text) || codePattern.test(text)) {
      return `${name} (${code})`;
    }
  }

  return undefined;
}

function buildUploadedJurisdictionText(params: ExportBuilderInput): string {
  const registryText = (params.report?.evidenceRegistry ?? [])
    .filter((item) =>
      /policy|declaration|declarations|insurance|identification card|id card|financial responsibility|mailing|address|garaging|registration/i.test(
        `${item.label} ${item.sourceType} ${item.extractedText ?? ""} ${item.extractedSummary ?? ""}`
      )
    )
    .map((item) =>
      [
        item.extractedText,
        item.extractedSummary,
        ...Object.values(item.structuredFacts ?? {}).flatMap((value) => Array.isArray(value) ? value : value ? [String(value)] : []),
      ].filter(Boolean).join(" ")
    );
  const evidenceText = (params.report?.evidence ?? [])
    .filter((item) =>
      item.authority === "internal" &&
      /policy|declaration|declarations|insurance|identification card|id card|financial responsibility|mailing|address|garaging|registration/i.test(
        `${item.title} ${item.source} ${item.snippet ?? ""}`
      )
    )
    .map((item) => [item.title, item.source, item.snippet].filter(Boolean).join(" "));

  return [...registryText, ...evidenceText].join("\n");
}

function toPolicyRightsJurisdiction(
  resolution: ResolvedJurisdiction
): PolicyRightsReviewModel["jurisdiction"] {
  return {
    state: formatResolvedJurisdictionForReport(resolution),
    stateCode: resolution.stateCode,
    confidence: resolution.confidence === "unknown" ? "low" : resolution.confidence,
    source: resolution.source,
    evidenceLabel: resolution.evidenceLabel,
    basis: resolution.basis,
    limitations: resolution.limitations,
  };
}

function buildMissingDocumentation(
  policyCitations: ImmutablePolicyCitation[],
  legalCitations: ImmutablePolicyCitation[]
): string[] {
  return [
    ...(policyCitations.length === 0
      ? ["Policy jacket, declarations page, endorsements, and appraisal clause."]
      : []),
    ...(legalCitations.length === 0
      ? ["Verified state regulation/statute or DOI source with immutable citation metadata."]
      : []),
    "Carrier denial, supplement response, appraisal demand, or written claim-position correspondence.",
    "Supplement 1, reinspection records, teardown findings, final estimate updates, and repair-completion documentation tied to amount-of-loss maturity.",
  ];
}

function buildConfidenceWeightedAssertion(params: {
  statement: string;
  supportCategory: PolicyRightsSupportCategory;
  citations: ImmutablePolicyCitation[];
  commentary?: string;
}): PolicyRightsAssertion {
  const confidence = scoreAssertionConfidence(params.supportCategory, params.citations);
  const verification = confidence.verification;

  return {
    statement: params.statement,
    verification,
    supportCategory: params.supportCategory,
    confidence: confidence.band,
    confidenceWeight: confidence.weight,
    confidenceRationale: confidence.rationale,
    citations: params.citations,
    commentary: params.commentary,
    rationaleSummary: buildAssertionRationale(params.supportCategory, verification),
    evidenceChainSummary: buildAssertionEvidenceChain(params.citations, confidence.band),
    riskIfOmitted: buildAssertionRisk(params.supportCategory, verification),
    supportConfidenceIndicator:
      verification === "verified"
        ? "verified"
        : verification === "inferred"
          ? "inferred"
          : confidence.band === "insufficient"
            ? "unsupported"
            : "missing",
  };
}

function scoreAssertionConfidence(
  supportCategory: PolicyRightsSupportCategory,
  citations: ImmutablePolicyCitation[]
): {
  verification: PolicyRightsAssertion["verification"];
  band: PolicyRightsConfidenceBand;
  weight: number;
  rationale: string;
} {
  if (citations.length === 0) {
    const isInference =
      supportCategory === "procedural_inference" || supportCategory === "claim_runtime_context";
    return {
      verification: isInference ? "inferred" : "missing",
      band: "insufficient",
      weight: isInference ? 0.25 : 0,
      rationale: isInference
        ? "Runtime analysis suggests a possible issue, but no immutable citation metadata is attached."
        : "No source metadata is attached; no legal, policy, or OEM conclusion should be asserted.",
    };
  }

  const hasVerifiedRegulation = citations.some(
    (citation) => citation.source === "VerifiedRegulationsDatabase" && citation.sourceAuthorityTier === "LEGAL_AUTHORITY"
  );
  const hasDriveLaw = citations.some(
    (citation) => citation.source === "DriveLawFolder" && citation.sourceAuthorityTier === "LEGAL_AUTHORITY"
  );
  const hasPolicy = citations.some((citation) =>
    ["DrivePolicyFolder", "UploadedPolicyDocument"].includes(citation.source)
  );
  const hasOem = citations.some((citation) => citation.source === "OEMPositionStatement");
  const hasInternet = citations.some((citation) => citation.source === "InternetResearch");

  if (supportCategory === "verified_regulation" && (hasVerifiedRegulation || hasDriveLaw)) {
    return {
      verification: "verified",
      band: "high",
      weight: 0.95,
      rationale: "Regulation support is backed by verified database or law-folder citation metadata.",
    };
  }

  if (supportCategory === "policy_extraction" && hasPolicy) {
    return {
      verification: "verified",
      band: "high",
      weight: 0.85,
      rationale: "Policy support is backed by uploaded policy or policy-folder citation metadata.",
    };
  }

  if (supportCategory === "oem_support" && hasOem) {
    return {
      verification: "verified",
      band: "high",
      weight: 0.82,
      rationale: "OEM support is backed by OEM or position-statement citation metadata.",
    };
  }

  if (supportCategory === "internet_derived_support" && hasInternet) {
    return {
      verification: "inferred",
      band: "medium",
      weight: 0.55,
      rationale: "Internet-derived support is source-linked but not treated as verified law, policy, or OEM procedure unless independently validated.",
    };
  }

  return {
    verification: "inferred",
    band: "low",
    weight: 0.4,
    rationale: "Citation metadata exists, but the source class does not fully verify the asserted support category.",
  };
}

function buildAssertionRationale(
  supportCategory: PolicyRightsSupportCategory,
  verification: PolicyRightsAssertion["verification"]
): string {
  if (verification === "verified") {
    return `${formatSupportCategory(supportCategory)} is supported by immutable source metadata and may be described as source-backed.`;
  }

  if (verification === "inferred") {
    return `${formatSupportCategory(supportCategory)} is a directional indicator only and should be used to guide document collection or review.`;
  }

  return `${formatSupportCategory(supportCategory)} is not supported by the current source set.`;
}

function buildAssertionEvidenceChain(
  citations: ImmutablePolicyCitation[],
  confidence: PolicyRightsConfidenceBand
): string {
  if (citations.length === 0) {
    return "No citation metadata is attached; evidence chain is incomplete.";
  }

  return `Evidence chain preserves ${citations.length} citation(s); confidence band is ${confidence}.`;
}

function buildAssertionRisk(
  supportCategory: PolicyRightsSupportCategory,
  verification: PolicyRightsAssertion["verification"]
): string {
  if (verification === "verified") {
    return "If omitted, the report may understate available documented support.";
  }

  if (supportCategory === "verified_regulation" || supportCategory === "policy_extraction") {
    return "If overstated, the output could imply a legal or policy conclusion that is not currently source-backed.";
  }

  return "If overstated, the output could make the repair position sound more certain than the evidence supports.";
}

function formatAssertions(assertions: PolicyRightsAssertion[], fallback: string): string[] {
  if (assertions.length === 0) {
    return [fallback];
  }

  return assertions.map((assertion) => {
    const prefix = assertion.verification === "verified"
      ? "Verified"
      : assertion.verification === "inferred"
        ? "Inferred commentary"
        : "Missing support";
    const legalGuard =
      assertion.verification === "verified"
        ? ""
        : " Legal conclusion status: not established from the current source set.";
    const citationText = assertion.citations.length
      ? formatCitationList(assertion.citations)
      : "Citations: none attached.";
    const rationale = assertion.rationaleSummary ?? assertion.statement;
    const evidenceChain = assertion.evidenceChainSummary ??
      (assertion.citations.length
        ? `Citation metadata preserved for ${assertion.citations.length} source(s).`
        : "No citation metadata is attached.");
    const riskIfOmitted = assertion.riskIfOmitted ??
      "If omitted, the review may overstate support or miss documentation needed for escalation.";
    const support = assertion.supportConfidenceIndicator ?? assertion.verification;
    const commentary = assertion.commentary ? ` Commentary: ${assertion.commentary}` : "";

    return [
      `${prefix}: ${humanizePolicyText(assertion.statement)}`,
      `${humanizePolicyText(rationale)} The confidence band is ${capitalize(assertion.confidence)} because ${humanizePolicyText(assertion.confidenceRationale)}`,
      `${humanizePolicyText(evidenceChain)} Support posture is ${formatLabel(support)}.${legalGuard}`,
      `${humanizePolicyText(riskIfOmitted)} ${citationText}${humanizePolicyText(commentary)}`,
    ].join("\n\n");
  });
}

function getAllAssertions(review: PolicyRightsReviewModel): PolicyRightsAssertion[] {
  return [
    ...review.verifiedRegulations,
    ...review.policyRights,
    ...review.insurerObligations,
    ...review.oemPositionSupport,
    ...review.proceduralInference,
    ...review.internetDerivedSupport,
    ...review.escalationOptions,
  ];
}

function formatVerifiedInferredCount(review: PolicyRightsReviewModel): string {
  const assertions = getAllAssertions(review);
  const verified = assertions.filter((assertion) => assertion.verification === "verified").length;
  const inferred = assertions.filter((assertion) => assertion.verification === "inferred").length;
  return `${verified} / ${inferred}`;
}

function countAssertionsByConfidence(
  review: PolicyRightsReviewModel,
  confidence: PolicyRightsConfidenceBand
): number {
  return getAllAssertions(review).filter((assertion) => assertion.confidence === confidence).length;
}

function getVerifiedLegalCitationCount(review: PolicyRightsReviewModel): number {
  const claimStateCode = getClaimStateCodeFromJurisdiction(review.jurisdiction);
  return dedupeCitations(
    review.citations.filter((citation) => isVerifiedLegalCitation(citation, claimStateCode))
  ).length;
}

function getVerifiedReviewCitations(review: PolicyRightsReviewModel): ImmutablePolicyCitation[] {
  const claimStateCode = getClaimStateCodeFromJurisdiction(review.jurisdiction);
  return dedupeCitations(
    review.citations.filter((citation) => {
      if (isVerifiedLegalCitation(citation, claimStateCode)) {
        return true;
      }
      if (isVerifiedPolicyCitation(citation)) {
        return true;
      }
      return citation.source === "OEMPositionStatement" && Boolean(citation.retrievedAt || citation.effectiveDate);
    })
  );
}

function buildSourceNeedsReviewBullets(review: PolicyRightsReviewModel): string[] {
  const claimStateCode = getClaimStateCodeFromJurisdiction(review.jurisdiction);
  const legalLikeCitations = review.citations.filter((citation) =>
    /statute|regulation|insurance code|department of insurance|\bDOI\b|appraisal|consumer rights|law|legal/i.test(
      `${citation.title} ${citation.url ?? ""} ${citation.locator ?? ""}`
    )
  );
  const unverifiedLegalSources = legalLikeCitations.filter((citation) =>
    !isVerifiedLegalCitation(citation, claimStateCode)
  );
  const weakLegalSources = unverifiedLegalSources.filter((citation) =>
    isWeakLegalSource(`${citation.title} ${citation.url ?? ""} ${citation.locator ?? ""}`)
  );
  const mismatchedOfficialSources = unverifiedLegalSources.filter((citation) => {
    const haystack = `${citation.title} ${citation.url ?? ""} ${citation.locator ?? ""}`;
    return isOfficialLegalSource(haystack) && !isWeakLegalSource(haystack);
  });

  return dedupeStrings([
    review.jurisdiction.confidence === "high" ? null : buildJurisdictionUnavailableMessage(),
    weakLegalSources.length
      ? "Non-official commentary, articles, social media, or law-firm material was excluded from verified legal support."
      : null,
    mismatchedOfficialSources.length
      ? "Official legal or DOI sources from a different jurisdiction were excluded from verified legal support."
      : null,
    review.internetDerivedSupport.length
      ? "Internet-derived material remains pending review unless it is tied to a jurisdiction-matched official source with a retrieval or effective date."
      : null,
    review.proceduralInference.length
      ? "Inferred claim-handling or procedure commentary remains pending review until verified legal, policy, or OEM support is attached."
      : null,
  ]);
}

function formatCitationList(citations: ImmutablePolicyCitation[]): string {
  if (citations.length === 0) {
    return "Citations: none attached.";
  }

  return `Citations: ${citations.map((citation) => humanizePolicyText(citation.title)).join("; ")}.`;
}

function formatCitationIndexItem(citation: ImmutablePolicyCitation): string {
  const isUploadedPolicy = citation.source === "UploadedPolicyDocument";
  return [
    `Citation: ${humanizePolicyText(citation.title)}`,
    `Source: ${formatCitationSource(citation.source)}`,
    citation.sourceType ? `Source type: ${citation.sourceType}` : null,
    `Authority tier: ${formatLabel(citation.sourceAuthorityTier)}`,
    citation.locator ? `Locator: ${humanizePolicyText(citation.locator)}` : null,
    citation.url ? `URL: ${citation.url}` : null,
    citation.retrievedAt ? `Retrieved: ${citation.retrievedAt}` : null,
    isUploadedPolicy
      ? "Jurisdiction metadata: redacted or ambiguous"
      : citation.jurisdiction ? `Jurisdiction: ${citation.jurisdiction}` : null,
    citation.effectiveDate ? `Effective date: ${citation.effectiveDate}` : null,
    typeof citation.confidenceScore === "number" ? `Confidence score: ${Math.round(citation.confidenceScore * 100)}%` : null,
    isUploadedPolicy
      ? "Source metadata is redacted or ambiguous; policy language should be reviewed directly."
      : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

function humanizePolicyText(value: string): string {
  return sanitizeUserFacingEvidenceText(value
    .replace(/\bpolicy packet with\s+(?:Georgia|GA|[A-Z][a-z]+)\s*(?:\([A-Z]{2}\))?\s+policy indicators\b/gi, "uploaded policy packet / appraisal-language support; jurisdiction metadata redacted or ambiguous")
    .replace(/\bJurisdiction:\s*Georgia\s*\(GA\)\b/gi, "Jurisdiction metadata: redacted or ambiguous")
    .replace(/\buploaded document\b/gi, "source material")
    .replace(/\bSame rationale as earlier\b/gi, "The same policy support should be reviewed with the current claim context.")
    .replace(/\bCurrent estimate analysis; citation still needed\b/gi, "Repair attachment context; independent citation still needed")
    .replace(/\bclaim-\[REDACTED_CLAIM\]\b/gi, "the claim")
    .replace(/\bpolicy-\[REDACTED_POLICY\]\b/gi, "the policy")
    .replace(/\bCalibration Verification Open\b/gi, "scan and calibration verification remains open")
    .replace(/\s+/g, " ")
    .trim());
}

function dedupeCitations(citations: ImmutablePolicyCitation[]): ImmutablePolicyCitation[] {
  const seen = new Set<string>();
  const deduped: ImmutablePolicyCitation[] = [];

  for (const citation of citations) {
    if (seen.has(citation.immutableKey)) {
      continue;
    }
    seen.add(citation.immutableKey);
    deduped.push(citation);
  }

  return deduped;
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    const cleaned = value?.trim();
    if (!cleaned) {
      continue;
    }
    const key = cleaned.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(cleaned);
  }

  return deduped;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function formatCitationSource(source: PolicyRightsCitationSource): string {
  return source.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatSupportCategory(value: PolicyRightsSupportCategory): string {
  return formatLabel(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
