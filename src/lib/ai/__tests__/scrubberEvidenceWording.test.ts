/**
 * F4 (Test 99) — internal evidence vocabulary never reaches a reader.
 *
 * RO 22132's structural finding printed "Estimate evidence: Existing
 * estimate parser; Estimate evidence: Uploaded claim" as its evidence and
 * "Missing or unresolved support: oem, adas, nhtsa, photo or teardown proof"
 * as its proof. The first is the parser-fallback placeholder for "no source
 * was named"; the second is the citation-status enum de-camel-cased.
 */
import { describe, it, expect } from "vitest";
import {
  buildAnnotationSourceRefs,
  describeMissingProofTypes,
  isPlaceholderScrubberSource,
} from "../builders/estimateScrubberPdfBuilder";
import type { EstimateScrubFinding } from "../types/estimateScrubber";

describe("placeholder sources are not evidence", () => {
  it("recognises the parser-fallback placeholders", () => {
    expect(isPlaceholderScrubberSource({ title: "Existing estimate parser", sourceType: "EstimateParser" })).toBe(true);
    expect(isPlaceholderScrubberSource({ title: "Uploaded claim documents", sourceType: "UploadedDocument" })).toBe(true);
    expect(isPlaceholderScrubberSource({ title: "Shop estimate line 24", sourceType: "EstimateParser" })).toBe(false);
    expect(isPlaceholderScrubberSource({ title: "Volvo position statement", sourceType: "PositionStatement" })).toBe(false);
  });

  it("drops them from the reader-facing source references", () => {
    const finding = {
      operation: "Structural frame and measurement verification",
      sources: [
        { title: "Existing estimate parser", sourceType: "EstimateParser", verified: true },
        { title: "Uploaded claim documents", sourceType: "UploadedDocument", verified: true },
      ],
    } as unknown as EstimateScrubFinding;
    expect(buildAnnotationSourceRefs(finding)).toEqual([]);
  });

  it("keeps a real source reference", () => {
    const finding = {
      operation: "Pre-repair scan",
      sources: [{ title: "Volvo Position Statement: Scanning and Diagnostics", sourceType: "PositionStatement", verified: true }],
    } as unknown as EstimateScrubFinding;
    const refs = buildAnnotationSourceRefs(finding);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatch(/OEM position statement: Volvo Position Statement/);
  });
});

describe("missing-proof types read as English", () => {
  it("names each authority type the reader would recognise", () => {
    expect(describeMissingProofTypes(["oem", "adas", "nhtsa", "photoOrTeardownProof"])).toEqual([
      "OEM repair procedure",
      "ADAS calibration requirement",
      "NHTSA documentation",
      "photo or teardown proof",
    ]);
  });
});
