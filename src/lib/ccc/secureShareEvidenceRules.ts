export type CccSecureShareProofCapability =
  | "line_item_exists"
  | "line_item_missing_from_compared_estimate"
  | "line_item_changed"
  | "structured_estimate_metadata"
  | "shop_authorized_secure_share_estimate";

export type CccSecureShareProhibitedProofCategory =
  | "oem_required_procedure"
  | "p_page_inclusion_exclusion"
  | "deg_inquiry_support"
  | "legal_or_regulatory_obligation"
  | "policy_coverage_or_exclusion"
  | "carrier_violation";

export type CccSecureShareDownstreamUse =
  | "normalized_estimate_header"
  | "normalized_line_items"
  | "estimate_delta_engine"
  | "citation_gap_findings"
  | "exports_with_estimate_source_attribution";

export type CccSecureShareEvidenceClassification =
  | {
      allowed: true;
      capability: CccSecureShareProofCapability;
      reason: string;
    }
  | {
      allowed: false;
      prohibitedCategory: CccSecureShareProhibitedProofCategory;
      reason: string;
    };

export const CCC_SECURE_SHARE_ALLOWED_PROOF_CAPABILITIES = [
  "line_item_exists",
  "line_item_missing_from_compared_estimate",
  "line_item_changed",
  "structured_estimate_metadata",
  "shop_authorized_secure_share_estimate",
] as const satisfies readonly CccSecureShareProofCapability[];

export const CCC_SECURE_SHARE_PROHIBITED_PROOF_CATEGORIES = [
  "oem_required_procedure",
  "p_page_inclusion_exclusion",
  "deg_inquiry_support",
  "legal_or_regulatory_obligation",
  "policy_coverage_or_exclusion",
  "carrier_violation",
] as const satisfies readonly CccSecureShareProhibitedProofCategory[];

export const CCC_SECURE_SHARE_DOWNSTREAM_USES = [
  "normalized_estimate_header",
  "normalized_line_items",
  "estimate_delta_engine",
  "citation_gap_findings",
  "exports_with_estimate_source_attribution",
] as const satisfies readonly CccSecureShareDownstreamUse[];

export const CCC_SECURE_SHARE_EVIDENCE_RULE = {
  source: "ccc_secure_share",
  sourceConfidence: "high_confidence_estimate_source",
  authorityBoundary:
    "CCC Secure Share is estimate-source evidence only. It is not OEM, P-page, DEG, legal, policy, or carrier-violation authority.",
  citationGapBoundary:
    "CCC Secure Share may identify estimate differences that need citations, but it cannot supply the required citation authority.",
  mayProve: CCC_SECURE_SHARE_ALLOWED_PROOF_CAPABILITIES,
  mayNotProve: CCC_SECURE_SHARE_PROHIBITED_PROOF_CATEGORIES,
  downstreamUses: CCC_SECURE_SHARE_DOWNSTREAM_USES,
} as const;

const ALLOWED_PROOF_REASONS = {
  line_item_exists: "CCC Secure Share can prove that a line item exists in the CCC estimate payload.",
  line_item_missing_from_compared_estimate:
    "CCC Secure Share can prove that a line item from one estimate is missing from another estimate being compared.",
  line_item_changed:
    "CCC Secure Share can prove that a labor hour, amount, or operation changed between estimates.",
  structured_estimate_metadata:
    "CCC Secure Share can prove estimate metadata came from a structured CCC source.",
  shop_authorized_secure_share_estimate:
    "CCC Secure Share can prove the estimate was shop-authorized through CCC Secure Share.",
} as const satisfies Record<CccSecureShareProofCapability, string>;

const PROHIBITED_PROOF_REASONS = {
  oem_required_procedure:
    "CCC Secure Share cannot prove that a repair procedure is OEM-required.",
  p_page_inclusion_exclusion:
    "CCC Secure Share cannot prove whether an operation is included or not included by P-pages.",
  deg_inquiry_support: "CCC Secure Share cannot prove that a DEG inquiry supports the item.",
  legal_or_regulatory_obligation:
    "CCC Secure Share cannot prove that a legal or regulatory obligation exists.",
  policy_coverage_or_exclusion:
    "CCC Secure Share cannot prove that a policy covers or excludes the charge.",
  carrier_violation: "CCC Secure Share cannot prove that a carrier is violating anything.",
} as const satisfies Record<CccSecureShareProhibitedProofCategory, string>;

export function canCccSecureShareProve(
  capability: string
): capability is CccSecureShareProofCapability {
  return CCC_SECURE_SHARE_ALLOWED_PROOF_CAPABILITIES.includes(
    capability as CccSecureShareProofCapability
  );
}

export function cannotCccSecureShareProve(
  category: string
): category is CccSecureShareProhibitedProofCategory {
  return CCC_SECURE_SHARE_PROHIBITED_PROOF_CATEGORIES.includes(
    category as CccSecureShareProhibitedProofCategory
  );
}

export function classifyCccSecureShareEvidence(
  claim: CccSecureShareProofCapability | CccSecureShareProhibitedProofCategory
): CccSecureShareEvidenceClassification {
  if (canCccSecureShareProve(claim)) {
    return {
      allowed: true,
      capability: claim,
      reason: ALLOWED_PROOF_REASONS[claim],
    };
  }

  return {
    allowed: false,
    prohibitedCategory: claim,
    reason: PROHIBITED_PROOF_REASONS[claim],
  };
}

export function assertCccSecureShareMaySupportClaim(
  claim: CccSecureShareProofCapability | CccSecureShareProhibitedProofCategory
) {
  const classification = classifyCccSecureShareEvidence(claim);

  if (!classification.allowed) {
    throw new Error(classification.reason);
  }

  return classification;
}

export function getCccSecureShareEvidenceBoundaryNote() {
  return CCC_SECURE_SHARE_EVIDENCE_RULE.authorityBoundary;
}
