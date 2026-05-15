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
  estimatePresence:
    | "present"
    | "missing"
    | "under-documented";
  sources: SourceCitation[];
  recommendedRevision: string;
}
