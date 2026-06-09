import { describe, expect, it } from "vitest";
import {
  CCC_SECURE_SHARE_ALLOWED_PROOF_CAPABILITIES,
  CCC_SECURE_SHARE_DOWNSTREAM_USES,
  CCC_SECURE_SHARE_EVIDENCE_RULE,
  CCC_SECURE_SHARE_PROHIBITED_PROOF_CATEGORIES,
  assertCccSecureShareMaySupportClaim,
  canCccSecureShareProve,
  cannotCccSecureShareProve,
  classifyCccSecureShareEvidence,
  getCccSecureShareEvidenceBoundaryNote,
} from "./secureShareEvidenceRules";

describe("CCC Secure Share evidence rules", () => {
  it("allows CCC Secure Share to prove estimate-source and delta facts", () => {
    for (const capability of CCC_SECURE_SHARE_ALLOWED_PROOF_CAPABILITIES) {
      expect(canCccSecureShareProve(capability)).toBe(true);
      expect(classifyCccSecureShareEvidence(capability)).toMatchObject({
        allowed: true,
        capability,
      });
    }
  });

  it("does not allow CCC Secure Share to prove citation authority facts", () => {
    for (const category of CCC_SECURE_SHARE_PROHIBITED_PROOF_CATEGORIES) {
      expect(cannotCccSecureShareProve(category)).toBe(true);
      expect(classifyCccSecureShareEvidence(category)).toMatchObject({
        allowed: false,
        prohibitedCategory: category,
      });
      expect(() => assertCccSecureShareMaySupportClaim(category)).toThrow();
    }
  });

  it("encodes the intended downstream pipeline without treating CCC as citation proof", () => {
    expect(CCC_SECURE_SHARE_DOWNSTREAM_USES).toEqual([
      "normalized_estimate_header",
      "normalized_line_items",
      "estimate_delta_engine",
      "citation_gap_findings",
      "exports_with_estimate_source_attribution",
    ]);
    expect(CCC_SECURE_SHARE_EVIDENCE_RULE.sourceConfidence).toBe(
      "high_confidence_estimate_source"
    );
    expect(CCC_SECURE_SHARE_EVIDENCE_RULE.citationGapBoundary).toBe(
      "The CCC estimate data supports the existence of this line-item difference. OEM/P-page/DEG/legal support has not yet been verified."
    );
  });

  it("keeps the boundary note explicit about what CCC Secure Share is not", () => {
    expect(getCccSecureShareEvidenceBoundaryNote()).toBe(
      "CCC Secure Share is estimate-source evidence only. It is not OEM, P-page, DEG, legal, policy, or carrier-violation authority."
    );
  });
});
