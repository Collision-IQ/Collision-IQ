/**
 * S-2 — ONE resolved identity per run, from document evidence.
 *
 * RO 22182 shipped 162 annotated callouts reading "MISSED on SHOP" against a
 * GEICO Estimate of Record: the role classifier called the EOR a shop
 * estimate, which both suppressed the carrier scan and selected the role word
 * as the printed label. The report then named the shop as the party that
 * omitted the shop's own operations.
 *
 * These guards assert the required value is PRESENT and CORRECT, not merely
 * that a previously-known-bad token is absent.
 */
import { describe, it, expect } from "vitest";
import { resolveComparisonDocumentIdentity } from "../annotatedCitationDensityEstimate";

const GEICO_EOR_HEADER = [
  "GEICO",
  "Pennsylvania",
  "Request a Supplement:",
  "CCC Facility: Use CCC Estimate Share",
  "Non-CCC Facility: partners.geico.com",
  "One GEICO Boulevard",
  "Fredericksburg, VA 22412",
  "Estimate of Record",
  "Written By: TRACY JORGENSEN, License Number: 1112567",
].join("\n");

const SHOP_ESTIMATE_HEADER = [
  "conestogacollision.com",
  "961 Lancaster Avenue, Berwyn, PA 19312",
  "Preliminary Estimate",
  "RO Number: 22182",
  "Insurance Company: GEICO",
].join("\n");

describe("the comparison document is named by its own evidence", () => {
  it("resolves the carrier from the comparison document's letterhead", () => {
    expect(
      resolveComparisonDocumentIdentity({
        comparisonText: GEICO_EOR_HEADER,
        comparisonFileName: "EOR_22182.pdf",
        sourceText: SHOP_ESTIMATE_HEADER,
      })
    ).toBe("GEICO");
  });

  it("resolves the carrier even when the role classifier is wrong — the role is never consulted", () => {
    // The production defect: this exact pair, with the EOR classified `shop`.
    // The resolver takes no role argument, so the misclassification cannot
    // reach the label at all.
    expect(
      resolveComparisonDocumentIdentity({
        comparisonText: GEICO_EOR_HEADER,
        comparisonFileName: "EOR_22182.pdf",
        sourceText: SHOP_ESTIMATE_HEADER,
      })
    ).toBe("GEICO");
  });

  it("falls back to the carrier the SOURCE names when the comparison text is unreadable", () => {
    expect(
      resolveComparisonDocumentIdentity({
        comparisonText: "G E I C O\nEs t i m a t e o f R e co r d",
        comparisonFileName: "EOR_22182.pdf",
        sourceText: SHOP_ESTIMATE_HEADER,
      })
    ).toBe("GEICO");
  });

  it("a shop-vs-shop pair never inherits the carrier the source bills", () => {
    const otherShop = ["Berwyn Collision Center", "12 Main Street", "Estimate"].join("\n");
    const label = resolveComparisonDocumentIdentity({
      comparisonText: otherShop,
      comparisonFileName: "shop-b.pdf",
      sourceText: SHOP_ESTIMATE_HEADER,
    });
    expect(label).toBe("BERWYN COLLISION CENTER");
    expect(label).not.toBe("GEICO");
  });
});

describe("an unresolved identity is a failure, never a fallback", () => {
  it("returns null rather than a role word when nothing resolves", () => {
    expect(
      resolveComparisonDocumentIdentity({
        comparisonText: "Line 1 Repl bumper cover 1 425.00",
        comparisonFileName: "EOR_22182.pdf",
        sourceText: "Line 1 Repl bumper cover 1 500.00",
      })
    ).toBeNull();
  });

  it("never returns a role word for any input", () => {
    const inputs = [
      { comparisonText: "SHOP", sourceText: "" },
      { comparisonText: "EOR", sourceText: "" },
      { comparisonText: "Carrier", sourceText: "" },
      { comparisonText: "Estimate of Record", sourceText: "" },
      { comparisonText: "", sourceText: "" },
    ];
    for (const input of inputs) {
      const label = resolveComparisonDocumentIdentity({ ...input, comparisonFileName: "x.pdf" });
      expect(label === null || !/^(SHOP|EOR|CARRIER|INSURER|ESTIMATE|COMPARISON|OTHER|SOR|SUPPLEMENT)$/i.test(label)).toBe(
        true
      );
    }
  });

  it("the file-name prefix is not an identity — 'EOR_22182.pdf' resolves nothing on its own", () => {
    expect(
      resolveComparisonDocumentIdentity({
        comparisonText: "no organization named anywhere in this document",
        comparisonFileName: "EOR_22182.pdf",
        sourceText: "",
      })
    ).toBeNull();
  });
});
