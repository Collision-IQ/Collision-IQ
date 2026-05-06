import type { CarrierReportDocument } from "./carrierPdfBuilder";
import {
  buildExportModel,
  redactExportModelForDownload,
  resolveCanonicalInsurer,
  resolveCanonicalVehicleLabel,
  resolveCanonicalVin,
} from "./buildExportModel";
import type { ExportBuilderInput } from "./exportTemplates";
import type {
  ImmutablePolicyCitation,
  PolicyRightsAssertion,
  PolicyRightsConfidenceBand,
  PolicyRightsCitationSource,
  PolicyRightsReviewModel,
  PolicyRightsSupportCategory,
} from "@/lib/ai/types/policyRightsReview";
import { buildExportResearchSections } from "./exportResearchSections";

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
      {
        label: "Appraisal Rights",
        value: `${review.appraisalRights.detected ? "Detected" : "Not confirmed"} (${capitalize(
          review.appraisalRights.confidence
        )})`,
      },
      { label: "Verified Legal Citations", value: String(review.citations.length) },
      { label: "Verified / Inferred Assertions", value: formatVerifiedInferredCount(review) },
      { label: "Incomplete Evidence Items", value: String(countAssertionsByConfidence(review, "insufficient")) },
    ],
    sections: [
      ...buildExportResearchSections(params.exportResearchSnapshot),
      {
        title: "Jurisdiction Summary",
        bullets: [
          `Detected jurisdiction: ${review.jurisdiction.state}.`,
          `Detection confidence: ${capitalize(review.jurisdiction.confidence)}.`,
          `Basis: ${review.jurisdiction.basis}`,
        ],
      },
      {
        title: "Verified Regulation Support",
        bullets: formatAssertions(
          review.verifiedRegulations,
          "No verified regulation citations were available in the current source set. The report does not infer statutes or regulatory duties without citation metadata."
        ),
      },
      {
        title: "Policy Rights Review",
        bullets: formatAssertions(review.policyRights, "No uploaded policy-rights provisions were identified in the current source set."),
      },
      {
        title: "Internet-Derived Support",
        bullets: formatAssertions(
          review.internetDerivedSupport,
          "No internet-derived legal, policy, or OEM support was isolated. Web-derived support remains unavailable rather than inferred."
        ),
      },
      {
        title: "Appraisal Rights",
        bullets: [
          `Detection: ${review.appraisalRights.detected ? "Detected" : "Not confirmed"}.`,
          `Confidence: ${capitalize(review.appraisalRights.confidence)}.`,
          `Basis: ${review.appraisalRights.basis}`,
          formatCitationList(review.appraisalRights.citations),
        ],
      },
      {
        title: "Insurer Obligation Indicators",
        bullets: formatAssertions(
          review.insurerObligations,
          "No verified insurer-obligation citation was available. Operational concerns should be treated as claim-handling indicators only."
        ),
      },
      {
        title: "OEM Position Support",
        bullets: formatAssertions(review.oemPositionSupport, "No OEM position statement citation was available in the current source set."),
      },
      {
        title: "Procedural Inference",
        bullets: formatAssertions(
          review.proceduralInference,
          "No procedural inference was used for legal or policy support. Procedure-related conclusions require verified OEM, policy, or estimate support before escalation."
        ),
      },
      {
        title: "Escalation Options",
        bullets: formatAssertions(
          review.escalationOptions,
          "No DOI escalation citation was available. Escalation should not be recommended as a legal conclusion without verified jurisdiction support."
        ),
      },
      {
        title: "Documentation Still Needed",
        bullets: review.missingDocumentation,
      },
      {
        title: "Source & Citation Index",
        bullets: review.citations.length
          ? review.citations.map(formatCitationIndexItem)
          : ["No immutable legal or policy citation metadata was available from the current source set."],
      },
    ],
    footer: [
      "This report is informational and documentation-focused. It is not legal advice.",
      "Verified law, policy extraction, OEM support, procedural inference, and internet-derived support are confidence-weighted separately. Do not cite inferred or unsupported commentary as a statute, regulation, policy term, or OEM procedure.",
    ],
  };
}

function buildPolicyRightsReviewModel(
  params: ExportBuilderInput,
  exportModel: ReturnType<typeof buildExportModel>
): PolicyRightsReviewModel {
  const sourceText = [
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
    ["VerifiedRegulationsDatabase", "DriveLawFolder"].includes(citation.source)
  );
  const internetCitations = citations.filter((citation) => citation.source === "InternetResearch");
  const policyCitations = citations.filter((citation) =>
    ["DrivePolicyFolder", "UploadedPolicyDocument"].includes(citation.source)
  );
  const oemCitations = citations.filter((citation) => citation.source === "OEMPositionStatement");
  const jurisdiction = detectJurisdiction(sourceText, legalCitations);
  const appraisalDetected =
    Boolean(params.panel?.appraisal?.triggered) || /\bappraisal\b/i.test(sourceText);
  const appraisalCitations = legalCitations.filter((citation) => /appraisal/i.test(citation.title));
  const doiCitations = legalCitations.filter((citation) =>
    /\bDOI\b|department of insurance|insurance department/i.test(`${citation.title} ${citation.locator ?? ""}`)
  );

  return {
    jurisdiction,
    appraisalRights: {
      detected: appraisalDetected,
      confidence: appraisalCitations.length > 0 ? "high" : appraisalDetected ? "medium" : "low",
      basis: params.panel?.appraisal?.reasoning || "No verified appraisal clause or regulation was isolated from the current source set.",
      citations: appraisalCitations,
    },
    verifiedRegulations: legalCitations.map((citation) =>
      buildConfidenceWeightedAssertion({
        statement: `Verified legal or regulatory source available for review: ${citation.title}.`,
        supportCategory: "verified_regulation",
        citations: [citation],
      })
    ),
    policyRights: policyCitations.map((citation) =>
      buildConfidenceWeightedAssertion({
        statement: `Policy document source available for rights review: ${citation.title}.`,
        supportCategory: "policy_extraction",
        citations: [citation],
      })
    ),
    insurerObligations: buildInsurerObligationAssertions(sourceText, legalCitations),
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
    missingDocumentation: buildMissingDocumentation(policyCitations, legalCitations, oemCitations),
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
    ["OEMPositionStatement", "VerifiedRegulationsDatabase", "DriveLawFolder"].includes(citation.source)
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
    const citationSource = classifyCitationSource(source.title, source.sourceType);
    const locator = source.relatedFindingIds.length
      ? `Related findings: ${source.relatedFindingIds.join(", ")}`
      : undefined;

    return createCitation({
      source: citationSource,
      title: source.title,
      locator,
      url: source.url,
      index,
    });
  });

  if (params.report?.ingestionMeta?.uploadedFileCount || exportModel.confidenceIntegrity.uploadedFileCount > 0) {
    citations.push(createCitation({
      source: "ClaimAnalysisRuntime",
      title: "Claim analysis runtime context",
      locator: `Uploaded files reviewed: ${exportModel.confidenceIntegrity.uploadedFileCount}`,
      index: citations.length,
    }));
  }

  return dedupeCitations(citations);
}

function classifyCitationSource(
  title: string,
  sourceType: "drive" | "web" | "oem" | "estimate"
): PolicyRightsCitationSource {
  if (/policy|declarations|endorsement|coverage/i.test(title)) {
    return sourceType === "drive" ? "DrivePolicyFolder" : "UploadedPolicyDocument";
  }
  if (/statute|regulation|insurance code|department of insurance|\bDOI\b|appraisal|consumer rights/i.test(title)) {
    if (sourceType === "drive") return "DriveLawFolder";
    if (sourceType === "web") return "InternetResearch";
    return "VerifiedRegulationsDatabase";
  }
  if (sourceType === "oem" || /oem|position statement|manufacturer/i.test(title)) {
    return "OEMPositionStatement";
  }
  if (sourceType === "web") return "InternetResearch";
  if (sourceType === "drive") return "DriveLawFolder";
  return "ClaimAnalysisRuntime";
}

function createCitation(params: {
  source: PolicyRightsCitationSource;
  title: string;
  locator?: string;
  url?: string;
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
    title: params.title,
    ...(params.locator ? { locator: params.locator } : {}),
    ...(params.url ? { url: params.url } : {}),
    immutableKey,
  };
}

function detectJurisdiction(
  text: string,
  citations: ImmutablePolicyCitation[]
): PolicyRightsReviewModel["jurisdiction"] {
  const haystack = `${text}\n${citations.map((citation) => citation.title).join("\n")}`;

  for (const [code, name] of Object.entries(STATE_NAMES)) {
    const codePattern = new RegExp(`\\b${code}\\b`);
    const namePattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i");
    if (namePattern.test(haystack) || codePattern.test(haystack)) {
      const citationBacked = citations.some((citation) =>
        namePattern.test(`${citation.title} ${citation.locator ?? ""}`) ||
        codePattern.test(`${citation.title} ${citation.locator ?? ""}`)
      );

      return {
        state: `${name} (${code})`,
        confidence: citationBacked ? "high" : "medium",
        basis: citationBacked
          ? "Jurisdiction appears in source citation metadata."
          : "Jurisdiction appears in claim analysis runtime text but was not independently citation-backed.",
      };
    }
  }

  return {
    state: "Not confirmed",
    confidence: "low",
    basis: "No state-specific citation or policy jurisdiction marker was isolated from the current source set.",
  };
}

function buildMissingDocumentation(
  policyCitations: ImmutablePolicyCitation[],
  legalCitations: ImmutablePolicyCitation[],
  oemCitations: ImmutablePolicyCitation[]
): string[] {
  return [
    ...(policyCitations.length === 0
      ? ["Uploaded policy jacket, declarations page, endorsements, and appraisal clause."]
      : []),
    ...(legalCitations.length === 0
      ? ["Verified state regulation/statute or DOI source with immutable citation metadata."]
      : []),
    ...(oemCitations.length === 0
      ? ["OEM position statement or manufacturer procedure support tied to the disputed operation."]
      : []),
    "Carrier denial, supplement response, or written claim-position correspondence.",
    "Current estimate, revised estimate, and any line-item explanation from the insurer.",
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

  const hasVerifiedRegulation = citations.some((citation) => citation.source === "VerifiedRegulationsDatabase");
  const hasDriveLaw = citations.some((citation) => citation.source === "DriveLawFolder");
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

    return `${prefix}: ${assertion.statement} Support category: ${formatSupportCategory(assertion.supportCategory)}. Confidence: ${capitalize(assertion.confidence)} (${Math.round(assertion.confidenceWeight * 100)}%). Confidence basis: ${assertion.confidenceRationale} Rationale: ${rationale} Evidence chain: ${evidenceChain} Risk if omitted: ${riskIfOmitted} Support confidence: ${formatLabel(support)}.${legalGuard} ${citationText}${commentary}`;
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

function formatCitationList(citations: ImmutablePolicyCitation[]): string {
  if (citations.length === 0) {
    return "Citations: none attached.";
  }

  return `Citations: ${citations.map((citation) => citation.id).join(", ")}.`;
}

function formatCitationIndexItem(citation: ImmutablePolicyCitation): string {
  return [
    `${citation.id}: ${citation.title}`,
    `Source: ${formatCitationSource(citation.source)}`,
    citation.locator ? `Locator: ${citation.locator}` : null,
    citation.url ? `URL: ${citation.url}` : null,
    `Immutable key: ${citation.immutableKey}`,
  ]
    .filter(Boolean)
    .join(" | ");
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
