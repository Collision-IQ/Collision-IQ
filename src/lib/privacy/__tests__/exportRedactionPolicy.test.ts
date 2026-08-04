/**
 * EXPORT REDACTION POLICY.
 *
 * Inside the system the full record is intact — that is what makes the analysis
 * work. Everything that LEAVES the system carries no personal identity, no last
 * 8 of the VIN, and no insurance information.
 *
 * The two rules that are easy to get wrong, and were:
 *
 *   A WORD BOUNDARY FINDS NOTHING. CCC prints "VIN:5YJ3E1EA6PF691987Interior
 *   Color:WHITE" — the VIN is welded to the next label, so /\b[A-Z0-9]{17}\b/
 *   matches nothing and the VIN exports in full. That is exactly what the
 *   shipped build did.
 *
 *   A RUN OF DIGITS IS NOT A VIN. About one in eleven random 17-character
 *   windows satisfies the ISO 3779 check digit, so sliding a window over a
 *   21-digit claim number reports phantom VINs — and masking their middle would
 *   corrupt the claim number rather than protect it.
 */
import { describe, it, expect } from "vitest";
import { redactDownloadContent } from "../redactDownloadContent";
import { describePiiExposure, findUnmaskedVins, isExportClean, scanExportForPii } from "../exportPiiScanner";

const REAL_VINS = [
  "5YJ3E1EA6PF691987",
  "5YJSA1E65NF488007",
  "7FCTGCAA3RN030329",
  "5YJ3E1EA9NF238704",
];

describe("the last 8 of the VIN never leave the system", () => {
  it("masks exactly the last 8, keeping the first 9", () => {
    const out = redactDownloadContent("VIN: 5YJSA1E65NF488007");
    expect(out).toContain("5YJSA1E65");
    expect(out).toContain("********");
    expect(out).not.toContain("5YJSA1E65NF488007");
    expect(out).not.toContain("NF488007");
  });

  it("masks a VIN welded to the next label, which is the real CCC form", () => {
    const out = redactDownloadContent("VIN:5YJ3E1EA6PF691987Interior Color:WHITE");
    expect(out).not.toContain("5YJ3E1EA6PF691987");
    expect(out).toContain("5YJ3E1EA6********");
    expect(out).toContain("Interior Color:WHITE");
  });

  it("masks every VIN in the corpus", () => {
    for (const vin of REAL_VINS) {
      const out = redactDownloadContent(`Vehicle ${vin} inspected.`);
      expect(out).not.toContain(vin);
      expect(out).toContain(vin.slice(0, 9));
    }
  });

  it("does not corrupt a long claim number that happens to check out", () => {
    const claim = "012283486000000800001";
    const out = redactDownloadContent(`Reference ${claim} on file.`);
    expect(out).toContain(claim);
  });
});

describe("insurance information is redacted on export", () => {
  it("redacts the carrier named in prose, not just after a label", () => {
    const out = redactDownloadContent("USAA's estimate at $22,886.68 covers the repair.");
    expect(out).not.toMatch(/USAA/);
    expect(out).toContain("[REDACTED_INSURER]");
    expect(out).toContain("$22,886.68");
  });

  it("redacts the whole carrier name, not a fragment of it", () => {
    const out = redactDownloadContent("American Family Insurance issued payment.");
    expect(out).not.toMatch(/American Family/i);
    expect(out).not.toMatch(/\bInsurance\b/);
  });

  it("redacts a labelled carrier", () => {
    expect(redactDownloadContent("Insurance Company: AMERICAN FAMILY")).toContain("[REDACTED_INSURER]");
  });

  it("still redacts claim and policy numbers", () => {
    const out = redactDownloadContent("Claim #: 01009983776-1 Policy #: 012283486");
    expect(out).toContain("[REDACTED_CLAIM]");
    expect(out).toContain("[REDACTED_POLICY]");
    expect(out).not.toContain("01009983776");
  });
});

describe("the redaction still does not eat the report", () => {
  it("leaves the sentence stating the gap intact", () => {
    const prose = "Two repair estimates exist for this claim: the shop's estimate at $26,006.59";
    expect(redactDownloadContent(prose)).toBe(prose);
  });

  it("leaves part numbers and money intact", () => {
    const line = "Repl RT Headlamp assy 156371400G 2,341.65";
    expect(redactDownloadContent(line)).toBe(line);
  });
});

describe("the scanner reads the finished artifact, not the intent", () => {
  it("finds an unredacted VIN however it is glued", () => {
    expect(findUnmaskedVins("VIN:5YJ3E1EA6PF691987Interior")).toEqual(["5YJ3E1EA6PF691987"]);
  });

  it("reports nothing once the text has been redacted", () => {
    const redacted = redactDownloadContent(
      "VIN:5YJ3E1EA6PF691987Interior Color:WHITE. Claim #: 01009983776-1. USAA paid."
    );
    expect(isExportClean(scanExportForPii(redacted))).toBe(true);
  });

  it("does not mistake a claim number for a VIN", () => {
    expect(findUnmaskedVins("Reference 012283486000000800001 on file")).toEqual([]);
  });

  it("its own report never repeats the identifier in full", () => {
    const message = describePiiExposure("x.pdf", scanExportForPii("VIN:5YJ3E1EA6PF691987 x"));
    expect(message).toContain("vin");
    expect(message).not.toContain("5YJ3E1EA6PF691987");
  });

  it("a clean artifact says so plainly", () => {
    expect(describePiiExposure("clean.pdf", [])).toMatch(/no unredacted identifiers found/);
  });
});
