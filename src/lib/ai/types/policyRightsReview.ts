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

export type ImmutablePolicyCitation = {
  id: string;
  source: PolicyRightsCitationSource;
  title: string;
  locator?: string;
  url?: string;
  retrievedAt?: string;
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
    confidence: "low" | "medium" | "high";
    basis: string;
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
