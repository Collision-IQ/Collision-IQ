/**
 * Redaction is SHAPE-BASED, and it has to be, in both directions.
 *
 * The defect that forced this, from Test 6's Customer Report — the one
 * document a vehicle owner actually reads, in the sentence that states the gap:
 *
 *     "Two repair estimates exist for this claim: [REDACTED_CLAIM], 006.59
 *      and USAA's estimate at $22,886.68"
 *
 * The claim rule's value group was "everything up to a delimiter", so it ate
 * "the shop's estimate at $26" and stopped at the comma INSIDE $26,006.59. The
 * same shape appeared in Test 93 as "[REDACTED_CLAIM], 745.29", and three
 * separate builders had grown post-hoc string repairs for it. Those repairs are
 * the tell: a patch per document cannot survive to the next document.
 *
 * The fix is that a labelled value is redacted only when it has the SHAPE of
 * the datum its label claims, and only that span is replaced. But writing it
 * introduced TWO privacy regressions, which is the more important half of this
 * file: "Claim #: 0122…" stopped redacting, because the separator class
 * matched one character and "#:" is two. Under-redaction is worse than the bug
 * being fixed, so both directions are guarded below.
 */
import { describe, it, expect } from "vitest";
import { redactDownloadContent } from "../redactDownloadContent";

describe("prose survives — the label words are ordinary English", () => {
  it("does not eat the sentence stating the gap (Test 6)", () => {
    const prose =
      "Two repair estimates exist for this claim: the shop's estimate at $26,006.59 " +
      "and USAA's estimate at $22,886.68 — a gap of about $3,120.";
    const out = redactDownloadContent(prose);
    expect(out).toBe(prose);
    expect(out).not.toContain("REDACTED");
    expect(out).toContain("$26,006.59");
  });

  it("does not eat the same sentence at the Test 93 figures", () => {
    const prose =
      "Two repair estimates exist for this claim: the shop's estimate at $8,745.29 " +
      "and Erie's at $3,642.51.";
    expect(redactDownloadContent(prose)).toBe(prose);
  });

  it("leaves a common noun after a label alone", () => {
    const prose = "The owner: a Tesla driver, was not at fault and paid $1,000.00 deductible.";
    expect(redactDownloadContent(prose)).toBe(prose);
  });

  it("never leaves an orphaned fragment of a dollar amount", () => {
    for (const amount of ["$26,006.59", "$8,745.29", "$1,203.00", "$22,886.68"]) {
      const out = redactDownloadContent(`for this claim: the estimate at ${amount} total`);
      expect(out).toContain(amount);
      expect(out).not.toMatch(/REDACTED_CLAIM\], \d/);
    }
  });
});

describe("real identifiers are still redacted — under-redaction is the worse bug", () => {
  it("redacts a claim number however the separator is punctuated", () => {
    for (const label of ["Claim #:", "Claim #", "Claim:", "Claim No.", "Claim Number:"]) {
      const out = redactDownloadContent(`${label} 012283486000000800001`);
      expect(out).toContain("[REDACTED_CLAIM]");
      expect(out).not.toContain("012283486000000800001");
    }
  });

  it("redacts a claim number inline in a sentence", () => {
    const out = redactDownloadContent("The file is claim: 012283486000000800001 for this loss.");
    expect(out).toContain("[REDACTED_CLAIM]");
    expect(out).toContain("for this loss.");
  });

  it("redacts policy numbers, plates and ZIPs", () => {
    expect(redactDownloadContent("Policy #: 012283486")).toContain("[REDACTED_POLICY]");
    expect(redactDownloadContent("Zip: 17601")).toContain("[REDACTED_ZIP]");
  });

  it("redacts owner names in both printed orders", () => {
    expect(redactDownloadContent("Insured: REARDON, CHRISTOPHER")).toContain("[REDACTED_PERSON]");
    expect(redactDownloadContent("Owner: Christopher Reardon")).toContain("[REDACTED_PERSON]");
    expect(redactDownloadContent("Owner: Christopher Reardon")).not.toContain("Reardon");
  });

  it("redacts street addresses and masks VINs", () => {
    expect(redactDownloadContent("Address: 120 Anderson Farm Rd")).toContain("[REDACTED_ADDRESS]");
    const vin = redactDownloadContent("VIN: 5YJSA1E65NF488007");
    expect(vin).not.toContain("5YJSA1E65NF488007");
    expect(vin).toContain("5YJSA1E65NF");
  });

  it("preserves the tail when a real value is followed by prose", () => {
    const out = redactDownloadContent("Claim #: 012283486000000800001 was opened on the loss date.");
    expect(out).toContain("[REDACTED_CLAIM]");
    expect(out).toContain("was opened on the loss date.");
  });
});

describe("the insurer is deliberately not redacted", () => {
  it("keeps the carrier name, which is a company and not personal data", () => {
    const out = redactDownloadContent("USAA's estimate at $22,886.68");
    expect(out).toContain("USAA");
  });
});
