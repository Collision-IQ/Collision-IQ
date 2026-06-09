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
