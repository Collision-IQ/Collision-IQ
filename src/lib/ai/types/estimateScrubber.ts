export type SourceCitation = {
  title: string;
  sourceType:
    | "DriveOEM"
    | "PositionStatement"
    | "InternetOEM"
    | "SCRS"
    | "DEG"
    | "EstimateParser"
    | "UploadedDocument";
  url?: string;
  note?: string;
  verified: boolean;
};

export type EstimateScrubCitationGapBucket =
  | "missing_from_carrier"
  | "reduced_by_carrier"
  | "present_but_under_documented"
  | "needs_oem_procedure"
  | "needs_p_page_support"
  | "needs_invoice_or_completion_proof"
  | "weak_do_not_lead";

export type CitationSupportStatus =
  | "verified"
  | "referenced_not_produced"
  | "needed"
  | "not_found"
  | "not_applicable";

export type CitationDensityEstimateRole = "carrier" | "shop";

export type CitationDensityEstimateLineAnchor = {
  sourceDocumentId?: string;
  estimateRole: CitationDensityEstimateRole;
  lineNumber?: string | null;
  pageNumber?: number | null;
  section?: string | null;
  operation?: string | null;
  description?: string | null;
  amount?: number | null;
  laborHours?: number | null;
  paintHours?: number | null;
};

export type CitationDensityAuthority = {
  type:
    | "oem_procedure"
    | "adas_procedure"
    | "oem_position_statement"
    | "p_page"
    | "scrs"
    | "deg"
    | "legal"
    | "invoice_completion"
    | "online_fallback"
    | "estimate_evidence";
  status: CitationSupportStatus;
  title: string;
  sourceType?: SourceCitation["sourceType"];
  confidence: "low" | "medium" | "high";
  note?: string;
};

export type CitationDensityEmbeddedEstimateLink = {
  sourceDocumentId?: string;
  pageNumber?: number | null;
  lineNumber?: string | null;
  estimateRole: CitationDensityEstimateRole | "unknown";
  nearbyOperation?: string | null;
  redactedUrl: string;
  retrievalStatus:
    | "retrieved"
    | "parsed"
    | "inaccessible"
    | "skipped"
    | "expired"
    | "blocked"
    | "not_fetched";
  authorityStatus: "reviewed_authority" | "referenced_not_produced";
};

export type CitationDensityFinding = {
  id: string;
  operationLabel: string;
  category:
    | "adas_calibration"
    | "scan_diagnostic"
    | "refinish"
    | "r_and_i"
    | "parts_downgrade"
    | "hardware_fasteners"
    | "one_time_use_parts"
    | "not_included_operation"
    | "labor_difference"
    | "rental"
    | "towing_storage"
    | "policy_coverage"
    | "state_regulation"
    | "structural_or_fit_verification"
    | "other";
  estimateGapType:
    | "missing_from_carrier"
    | "reduced_by_carrier"
    | "present_but_under_documented"
    | "referenced_not_produced"
    | "needs_proof"
    | "weak_do_not_lead";
  shopEvidence?: {
    lineNumber?: string | null;
    description?: string | null;
    amount?: number | null;
    laborHours?: number | null;
    sourceLabel?: string | null;
  };
  carrierEvidence?: {
    lineNumber?: string | null;
    description?: string | null;
    amount?: number | null;
    laborHours?: number | null;
    sourceLabel?: string | null;
  };
  applicableEstimateRoles?: CitationDensityEstimateRole[];
  primaryAnnotationRole?: CitationDensityEstimateRole | "both";
  carrierAnchor?: CitationDensityEstimateLineAnchor;
  shopAnchor?: CitationDensityEstimateLineAnchor;
  crossEstimateIssue?: boolean;
  counterpartSummary?: string;
  impact: {
    dollarImpact?: number | null;
    laborHoursImpact?: number | null;
    safetyImpact: "low" | "medium" | "high";
    supplementPriority: "low" | "medium" | "high";
  };
  citationStatus: {
    oem: CitationSupportStatus;
    oemPositionStatement?: CitationSupportStatus;
    adas?: CitationSupportStatus;
    pPages: CitationSupportStatus;
    scrs: CitationSupportStatus;
    deg: CitationSupportStatus;
    nhtsa: CitationSupportStatus;
    stateRegulation: CitationSupportStatus;
    policy: CitationSupportStatus;
    invoiceOrCompletionProof: CitationSupportStatus;
    photoOrTeardownProof: CitationSupportStatus;
  };
  citationDensityScore: number;
  verifiedAuthorityCount: number;
  missingAuthorityTypes: string[];
  bestAvailableAuthority?: CitationDensityAuthority;
  embeddedEstimateLinks?: CitationDensityEmbeddedEstimateLink[];
  missingAuthority?: string[];
  citationLabel?: string;
  currentSupportSummary: string;
  missingProofSummary: string;
  recommendedNextAction: string;
  supplementReadyLanguage?: string;
  confidence: "low" | "medium" | "high";
  limitations: string[];
};

export interface EstimateScrubFinding {
  operation: string;
  status: string;
  supportType:
    | "OEM"
    | "PositionStatement"
    | "MaterialRequirement"
    | "RefinishOperation";
  severity: "informational" | "moderate" | "high" | "critical";
  whyItMatters: string;
  rationaleSummary: string;
  evidenceChainSummary: string;
  riskIfOmitted: string;
  supportConfidenceIndicator: "verified" | "referenced" | "inferred" | "missing";
  citationGapBucket: EstimateScrubCitationGapBucket;
  estimatePresence:
    | "present"
    | "missing"
    | "under-documented";
  sources: SourceCitation[];
  recommendedRevision: string;
}
