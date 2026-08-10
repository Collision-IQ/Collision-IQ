/**
 * The customer-facing sanitizer must scrub internal tokens without eating
 * ordinary English. The ALL-CAPS status-token rule ran case-insensitively for
 * months and deleted the word "documented" from every sentence — each mangled
 * phrasing then grew its own one-off repair pattern downstream. These tests
 * pin the words themselves.
 */
import { describe, expect, it } from "vitest";
import { toCustomerFacingInline, toCustomerFacingText } from "../customerFacingText";

describe("toCustomerFacingText does not eat English", () => {
  it("keeps 'documented' in ordinary prose", () => {
    expect(
      toCustomerFacingText("Ask that any additional findings during teardown be documented and submitted.")
    ).toContain("be documented and submitted");
    expect(toCustomerFacingText("It needs to be measured and documented, not assumed away.")).toContain(
      "measured and documented"
    );
  });

  it("still strips the ALL-CAPS internal status tokens", () => {
    expect(toCustomerFacingText("Status DOCUMENTED for this line.")).not.toContain("DOCUMENTED");
    expect(toCustomerFacingText("REFERENCED_NOT_PRODUCED on the scan line.")).not.toContain(
      "REFERENCED_NOT_PRODUCED"
    );
  });
});

describe("toCustomerFacingInline", () => {
  it("never punctuates a grid value as a sentence", () => {
    expect(toCustomerFacingInline("$4,959.35")).toBe("$4,959.35");
    expect(toCustomerFacingInline("Vehicle")).toBe("Vehicle");
    expect(toCustomerFacingInline("Generated August 9, 2026")).toBe("Generated August 9, 2026");
  });
});

describe("numbers survive prose beautification", () => {
  it("never splits a thousands-separated money value", () => {
    // "$3,652.71. That" once shipped as "$3,652. 71. That": a comma-spacing
    // rule broke the thousands separator, and the sentence-gluing rule then
    // read the decimal point as a sentence boundary.
    expect(toCustomerFacingText("the insurance company came in at $3,652.71. That is a gap.")).toContain(
      "$3,652.71."
    );
  });

  it("does not break a paragraph at an abbreviation", async () => {
    const { normalizeNarrativeProse } = await import("../narrativeNormalization");
    const long =
      "The dollar gap comes down to four things: the hourly labor rate ($75 vs. $60), one part priced as aftermarket instead of genuine Honda, less paint and blend time on the insurer's version, and small material cost differences. Both include the before-and-after computer scans, a seat weight sensor calibration, power window setup, a system report, a test fit of the new bumper, and a final road test. That is the reassurance that matters most here.";
    expect(normalizeNarrativeProse(long, "REPORT")).not.toMatch(/vs\.\n/);
  });
});
