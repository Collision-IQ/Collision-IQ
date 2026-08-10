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
import { maskVinForExport, redactDownloadContent } from "../redactDownloadContent";

describe("prose survives — the label words are ordinary English", () => {
  it("does not eat the sentence stating the gap (Test 6)", () => {
    // The carrier name IS now redacted on export, so the sentence is no longer
    // byte-identical. The invariant this guards is the original defect: the
    // dollar figures must survive whole, with no orphaned fragment.
    const prose =
      "Two repair estimates exist for this claim: the shop's estimate at $26,006.59 " +
      "and USAA's estimate at $22,886.68 — a gap of about $3,120.";
    const out = redactDownloadContent(prose);
    expect(out).toContain("$26,006.59");
    expect(out).toContain("$22,886.68");
    expect(out).toContain("the shop's estimate at");
    expect(out).not.toMatch(/REDACTED_CLAIM/);
    expect(out).not.toMatch(/, \d{3}\.\d{2}/);
  });

  it("does not eat the same sentence at the Test 93 figures", () => {
    const prose =
      "Two repair estimates exist for this claim: the shop's estimate at $8,745.29 " +
      "and Erie's at $3,642.51.";
    const out = redactDownloadContent(prose);
    expect(out).toContain("$8,745.29");
    expect(out).toContain("$3,642.51");
    expect(out).not.toMatch(/REDACTED_CLAIM/);
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
    // Export policy: the last 8 of the VIN never leave the system, so only the
    // first 9 characters survive.
    const vin = redactDownloadContent("VIN: 5YJSA1E65NF488007");
    expect(vin).not.toContain("5YJSA1E65NF488007");
    expect(vin).toContain("5YJSA1E65");
    expect(vin).not.toContain("NF488007");
  });

  it("preserves the tail when a real value is followed by prose", () => {
    const out = redactDownloadContent("Claim #: 012283486000000800001 was opened on the loss date.");
    expect(out).toContain("[REDACTED_CLAIM]");
    expect(out).toContain("was opened on the loss date.");
  });
});

describe("the insurer IS redacted on export", () => {
  // Reversed by explicit instruction: insurance information is protected once
  // it leaves the system, even though a company is not personal data.
  it("replaces the carrier name and keeps the money", () => {
    const out = redactDownloadContent("USAA's estimate at $22,886.68");
    expect(out).not.toContain("USAA");
    expect(out).toContain("[REDACTED_INSURER]");
    expect(out).toContain("$22,886.68");
  });
});

describe("a sentence boundary is not a label separator", () => {
  // "…for the vehicle owner. Final repair decisions should…" used to parse as
  // label "owner" + person value "Final repair decisions should", which was
  // then captured and blanket-replaced with [REDACTED_PERSON] document-wide.
  it("leaves prose after 'owner.' intact", () => {
    const out = redactDownloadContent(
      "This report is written for the vehicle owner. Final repair decisions should still be confirmed by the repair facility."
    );
    expect(out).not.toContain("[REDACTED_PERSON]");
    expect(out).toContain("Final repair decisions should still be confirmed");
  });

  it("leaves prose after 'insurance.' intact", () => {
    const out = redactDownloadContent(
      "You are being paid through the other driver's insurance. Ask for a written explanation of the reductions."
    );
    expect(out).toContain("Ask for a written explanation");
  });

  it("still redacts an abbreviated identifier label", () => {
    const out = redactDownloadContent("Claim No. 012283486000000800001");
    expect(out).toContain("[REDACTED_CLAIM]");
    expect(out).not.toContain("012283486000000800001");
  });

  it("still redacts a colon-labelled owner", () => {
    const out = redactDownloadContent("Owner: MARCOLINO, JOSHUA");
    expect(out).toContain("[REDACTED_PERSON]");
    expect(out).not.toContain("MARCOLINO");
  });
});

describe("VIN last-eight masking is shape-based in labeled contexts", () => {
  // The prose scanner validates the ISO check digit so it never mangles part
  // numbers — but a value the document itself labels "VIN" is a VIN even when
  // validation fails (an OCR misread, a synthetic record). One shipped
  // unmasked exactly that way on the customer report's VIN tile.
  it("masks a labeled VIN that fails the check digit", () => {
    const out = redactDownloadContent("VIN: 2HGFC3B36LH123456");
    expect(out).toContain("2HGFC3B36********");
    expect(out).not.toContain("LH123456");
  });

  it("masks a valid labeled VIN the same way", () => {
    const out = redactDownloadContent("VIN: JTHD81F29P5050559");
    expect(out).toContain("JTHD81F29********");
    expect(out).not.toContain("P5050559");
  });

  it("maskVinForExport leaves non-VIN-shaped identifiers alone", () => {
    expect(maskVinForExport("01228348600000080")).toBe("01228348600000080");
    expect(maskVinForExport("ABCDEFGHJKLMNPRST")).toBe("ABCDEFGHJKLMNPRST");
  });
});
