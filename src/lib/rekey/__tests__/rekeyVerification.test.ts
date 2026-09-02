import { describe, expect, it } from "vitest";
import { buildRekeySheet } from "../rekeyLedger";
import { keyedEstimateFromDocument, keyedEstimateFromEms, verifyRekey } from "../rekeyVerification";
import { readEmsBundle } from "../emsReader";
import { KEYED_ESTIMATE_TEXT, SOURCE_ESTIMATE_TEXT } from "./fixtures";
import { buildEmsExportFiles } from "./emsFixture";

const sheet = buildRekeySheet({ text: SOURCE_ESTIMATE_TEXT, sourceFile: "source.pdf" });

function keyedDocument(text: string) {
  const result = keyedEstimateFromDocument({ text, sourceFile: "keyed.pdf" });
  if (!result.ok) throw new Error(result.reason);
  return result.estimate;
}

describe("verification — document keyed against the source", () => {
  const verification = verifyRekey({ sheet, keyed: keyedDocument(KEYED_ESTIMATE_TEXT) });

  it("confirms the pair is the same vehicle before comparing anything", () => {
    expect(verification.blocked).toBe(false);
    expect(verification.identity.verdict).toBe("match");
  });

  it("matches every keyable row and reports nothing missing or extra", () => {
    const unresolved = verification.lineFindings.filter((finding) => finding.resolution !== "exact");
    expect(unresolved.map((finding) => `${finding.description}: ${finding.resolution}`)).toEqual([]);
    expect(verification.extraLines).toEqual([]);
  });

  it("closes every totals row at zero", () => {
    const off = verification.totals.filter((row) => !row.matches);
    expect(off.map((row) => `${row.label} ${row.source} vs ${row.keyed}`)).toEqual([]);
  });

  it("passes", () => {
    expect(verification.summary.pass).toBe(true);
  });
});

describe("verification — findings", () => {
  it("reports a value delta when an hour or a price was keyed differently", () => {
    const verification = verifyRekey({
      sheet,
      keyed: keyedDocument(KEYED_ESTIMATE_TEXT.replace("FO1230344C 1 776.00 1.6 7.0", "FO1230344C 1 700.00 1.6 7.0")),
    });
    const hood = verification.lineFindings.find((finding) => finding.partNumber === "FO1230344C");
    expect(hood?.resolution).toBe("value_delta");
    expect(hood?.deltas).toContainEqual({ field: "price", expected: "$776.00", found: "$700.00" });
    expect(verification.summary.pass).toBe(false);
  });

  it("reports a row that was never keyed", () => {
    const verification = verifyRekey({
      sheet,
      keyed: keyedDocument(KEYED_ESTIMATE_TEXT.replace("3 Rpr Bumper Reinforcement 1.2\n", "")),
    });
    const missing = verification.lineFindings.filter((finding) => finding.resolution === "missing_in_keyed");
    expect(missing.map((finding) => finding.description)).toEqual(["Bumper Reinforcement"]);
  });

  it("reports a keyed row the source never carried", () => {
    const verification = verifyRekey({
      sheet,
      keyed: keyedDocument(KEYED_ESTIMATE_TEXT.replace("VEHICLE DIAGNOSTICS", "VEHICLE DIAGNOSTICS\n9 Repl Extra Bracket FO9999999 1 88.00 0.3")),
    });
    expect(verification.extraLines.map((line) => line.partNumber)).toContain("FO9999999");
    expect(verification.summary.pass).toBe(false);
  });
});

describe("verification — identity gate fails closed", () => {
  it("produces no findings at all when the VINs disagree", () => {
    const verification = verifyRekey({
      sheet,
      keyed: keyedDocument(KEYED_ESTIMATE_TEXT.replace("1FTFW1E84PKE00000", "1FTFW1E84PKE99999")),
    });
    expect(verification.blocked).toBe(true);
    expect(verification.blockedReason).toMatch(/different VINs/i);
    expect(verification.lineFindings).toEqual([]);
    expect(verification.totals).toEqual([]);
    expect(verification.summary.pass).toBe(false);
  });
});

describe("verification — EMS export as the keyed side", () => {
  it("reads the export and reconciles it against the sheet", () => {
    const keyed = keyedEstimateFromEms(readEmsBundle(buildEmsExportFiles()), "export.zip");
    if (!keyed.ok) throw new Error(keyed.reason);
    const verification = verifyRekey({ sheet, keyed: keyed.estimate });
    expect(verification.blocked).toBe(false);
    const hood = verification.lineFindings.find((finding) => finding.partNumber === "FO1230344C");
    expect(hood?.matchedBy).toBe("part number");
    expect(hood?.resolution).toBe("exact");
    // The synthetic export carries only two of the source's lines, so the
    // rest must be reported as never keyed rather than silently passing.
    expect(verification.summary.missing).toBeGreaterThan(0);
    expect(verification.summary.pass).toBe(false);
  });

  it("reports a profile markup that would inflate every recycled part", () => {
    const keyed = keyedEstimateFromEms(readEmsBundle(buildEmsExportFiles({ partsMarkupPct: 25 })), "export.zip");
    if (!keyed.ok) throw new Error(keyed.reason);
    const verification = verifyRekey({ sheet, keyed: keyed.estimate });
    expect(verification.profileFindings).toContainEqual({
      field: "Parts markup (PAL)",
      expected: "0%",
      found: "25%",
    });
  });

  it("refuses an export with no lines rather than reporting a pass", () => {
    const keyed = keyedEstimateFromEms(readEmsBundle(buildEmsExportFiles({ emptyLines: true })), "export.zip");
    expect(keyed.ok).toBe(false);
  });
});
