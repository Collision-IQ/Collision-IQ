import { describe, expect, it } from "vitest";
import { DOCUMENT_REVIEW_TWO_PASS_PROTOCOL } from "./documentReviewProtocol";

describe("DOCUMENT_REVIEW_TWO_PASS_PROTOCOL", () => {
  it("requires silent two-pass review and hidden completeness score", () => {
    expect(DOCUMENT_REVIEW_TWO_PASS_PROTOCOL).toContain("PASS 1 - Evidence extraction");
    expect(DOCUMENT_REVIEW_TWO_PASS_PROTOCOL).toContain("PASS 2 - Review challenge");
    expect(DOCUMENT_REVIEW_TWO_PASS_PROTOCOL).toContain("hidden completeness score");
    expect(DOCUMENT_REVIEW_TWO_PASS_PROTOCOL).toContain("reviewed_docs_count");
    expect(DOCUMENT_REVIEW_TWO_PASS_PROTOCOL).toContain("missing_docs_or_missing_proof");
    expect(DOCUMENT_REVIEW_TWO_PASS_PROTOCOL).toContain("confidence: high | medium | low");
  });

  it("defines concise default output and dispute/customer templates", () => {
    expect(DOCUMENT_REVIEW_TWO_PASS_PROTOCOL).toContain("Bottom line:");
    expect(DOCUMENT_REVIEW_TWO_PASS_PROTOCOL).toContain("What the documents support:");
    expect(DOCUMENT_REVIEW_TWO_PASS_PROTOCOL).toContain("What is not proven yet:");
    expect(DOCUMENT_REVIEW_TWO_PASS_PROTOCOL).toContain("Best next step:");
    expect(DOCUMENT_REVIEW_TWO_PASS_PROTOCOL).toContain("Customer-facing repair report shape");
    expect(DOCUMENT_REVIEW_TWO_PASS_PROTOCOL).toContain("Carrier-facing policy/claim dispute shape");
  });
});
