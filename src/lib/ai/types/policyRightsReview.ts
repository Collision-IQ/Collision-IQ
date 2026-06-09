export type PolicyRightsCitationSource =
  | "VerifiedRegulationsDatabase"
  | "DriveLawFolder"
  | "DrivePolicyFolder"
  | "OEMPositionStatement"
  | "InternetResearch"
  | "UploadedPolicyDocument"
  | "ClaimAnalysisRuntime";

export type PolicyRightsSupportCategory =
  | "verified_regulation"
  | "policy_extraction"
  | "oem_support"
  | "procedural_inference"
  | "internet_derived_support"
  | "claim_runtime_context";

export type PolicyRightsConfidenceBand = "high" | "medium" | "low" | "insufficient";

export type SourceAuthorityTier =
  | "LEGAL_AUTHORITY"
  | "POLICY_CONTRACT"
  | "OEM_PROCEDURE"
  | "INDUSTRY_CONTEXT"
  | "REJECTED_FOR_LEGAL_USE";

export type ImmutablePolicyCitation = {
  id: string;
  source: PolicyRightsCitationSource;
  sourceAuthorityTier: SourceAuthorityTier;
  sourceType?: "drive" | "web" | "oem" | "estimate" | "runtime";
  title: string;
  locator?: string;
  url?: string;
  retrievedAt?: string;
  jurisdiction?: string;
  effectiveDate?: string;
  confidenceScore?: number;
  immutableKey: string;
};

export type PolicyRightsAssertion = {
  statement: string;
  verification: "verified" | "inferred" | "missing";
  supportCategory: PolicyRightsSupportCategory;
  confidence: PolicyRightsConfidenceBand;
  confidenceWeight: number;
  confidenceRationale: string;
  citations: ImmutablePolicyCitation[];
  commentary?: string;
  rationaleSummary?: string;
  evidenceChainSummary?: string;
  riskIfOmitted?: string;
  supportConfidenceIndicator?: "verified" | "referenced" | "inferred" | "missing" | "unsupported";
};

export type PolicyRightsReviewModel = {
  jurisdiction: {
    state: string;
    stateCode?: string | null;
    confidence: "low" | "medium" | "high";
    basis: string;
    source?: string;
    evidenceLabel?: string;
    limitations?: string[];
  };
  appraisalRights: {
    detected: boolean;
    confidence: "low" | "medium" | "high";
    basis: string;
    citations: ImmutablePolicyCitation[];
  };
  policyRights: PolicyRightsAssertion[];
  verifiedRegulations: PolicyRightsAssertion[];
  insurerObligations: PolicyRightsAssertion[];
  oemPositionSupport: PolicyRightsAssertion[];
  proceduralInference: PolicyRightsAssertion[];
  internetDerivedSupport: PolicyRightsAssertion[];
  escalationOptions: PolicyRightsAssertion[];
  missingDocumentation: string[];
  citations: ImmutablePolicyCitation[];
};
