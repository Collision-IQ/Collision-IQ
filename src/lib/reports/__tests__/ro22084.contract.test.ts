/**
 * RO 22084 — a 2018 Tesla Model 3, shop Preliminary Estimate vs the carrier's
 * Supplement of Record 5 Summary, both CCC ONE prints as hybrid PDFs (a
 * full-page raster of the rule lines under a real, positioned text layer).
 *
 * The run was refused three times, ending on "2 finding(s) produced: 0
 * line-anchored, 0 category-level, 0 unanchored, 2 speculative". Root cause:
 * the CCC text layer glues a Tesla part number to the price cell
 * ("1104926-00-B" prints as "110492600B210.00Incl."), three such lines
 * satisfy the Mitchell `<line><6-digit code><letter>` row anchor, and the
 * platform detector read BOTH CCC documents as Mitchell. The Mitchell reader
 * recovered one row and categories whose cost was the rate, the typed engine
 * was skipped for a "Mitchell" comparison, the coverage gate declared the
 * comparison unread, and intake mode left only the speculative detectors.
 *
 * Fixtures are the repo's own word layer and text of the two documents, with
 * the owner's identity redacted (natural_person scope). The figures below
 * are the documents' own: Grand Total 13,844.81 on page 7 of the shop
 * estimate, Workfile Total / NET COST OF REPAIRS 11,618.63 on page 8 of the
 * SOR-5, a 2,226.18 gap.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { detectEstimatePlatform } from "../estimatePlatform";
import { buildPdfTextLines, buildEstimateRowAnchorsFromLines, type PdfWord } from "../citationDensityRowAnchors";
import {
  buildProductionReleaseBundle,
  buildRequiredEstimatorDeltaFindings,
  pdfWordsToEnginePages,
} from "../annotatedCitationDensityEstimate";
import { parseEstimateRows, parseGrandTotalFromWords } from "../deltaEngine/rowCluster";
import { runDeltaReleaseGate } from "../deltaReleaseGate";
import { looksLikeMitchellLayout } from "@/lib/rekey/mitchellEstimateReader";

const FIXTURE_DIR = path.join(__dirname, "../../../../tests/fixtures/22084");
const read = (name: string) => fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8");
const shopText = read("shop_text.txt");
const sorText = read("sor5_text.txt");
const shopWords = JSON.parse(read("shop_words.json")) as PdfWord[];
const sorWords = JSON.parse(read("sor5_words.json")) as PdfWord[];

describe("platform routing — the producer's own words outrank the row-shape heuristic", () => {
  it("both documents print CCC markers and route to the CCC reader", () => {
    expect(detectEstimatePlatform(shopText)).toBe("ccc");
    expect(detectEstimatePlatform(sorText)).toBe("ccc");
  });

  it("the glued Tesla part-number lines alone do look Mitchell-shaped — which is why the marker must decide", () => {
    const glued = "110492600B210.00Incl.\n110433500B210.00Incl.\n1916698S0A1791.01Incl.2.8\n";
    expect(looksLikeMitchellLayout(glued)).toBe(true);
    expect(detectEstimatePlatform(`Workfile ID: 4a38c162\n${glued}`)).toBe("ccc");
    // A footer-less Mitchell text layer still routes to Mitchell on its rows.
    const mitchellRows =
      "Hood\n4201402Frt Bumper Under CoverRemove /\n10201467Hood Panel (Alum)RepairBody3.0*Existing\n12201468Hood Adhesive EmblemRemove /\n";
    expect(detectEstimatePlatform(mitchellRows)).toBe("mitchell");
    // And CCC-shaped rows with no CCC marker are not Mitchell.
    expect(looksLikeMitchellLayout("FRONT BUMPER\n7O/H bumper assy1.6\n8R&I bumper coverIncl.\n9Rpr Bumper cover2.03.0\n")).toBe(false);
  });
});

describe("the word lane reads both hybrid documents", () => {
  it("measures the column grid and types the rows on both sides", () => {
    expect(parseEstimateRows(pdfWordsToEnginePages(shopWords)).length).toBeGreaterThanOrEqual(120);
    expect(parseEstimateRows(pdfWordsToEnginePages(sorWords)).length).toBeGreaterThanOrEqual(100);
  });

  it("resolves both grand totals by baseline: 13,844.81 (Grand Total, p7) and 11,618.63 (p8)", () => {
    expect(parseGrandTotalFromWords(pdfWordsToEnginePages(shopWords))).toMatchObject({ value: 13844.81, page: 7, basis: "gross" });
    expect(parseGrandTotalFromWords(pdfWordsToEnginePages(sorWords))).toMatchObject({ value: 11618.63, page: 8 });
  });
});

describe("the findings pass and the release gate on the pair", () => {
  let generated: ReturnType<typeof buildRequiredEstimatorDeltaFindings>;
  const warnings: string[] = [];

  beforeAll(() => {
    const visualLines = buildPdfTextLines(shopWords);
    const anchors = buildEstimateRowAnchorsFromLines(visualLines, { sourceDocumentRole: "shop", sourceDocumentId: "shop-22084" });
    generated = buildRequiredEstimatorDeltaFindings({
      anchors,
      visualLines,
      sourcePdfName: "Shop Final 22084.pdf",
      sourceDocumentId: "shop-22084",
      sourceDocumentRole: "shop",
      sourcePdfHash: "fixture-22084-shop",
      uploadedFileNames: ["Shop Final 22084.pdf", "SOR-5 22084.pdf"],
      sourceText: shopText,
      comparisonEstimateTexts: [{ sourceDocumentId: "sor-22084", fileName: "SOR-5 22084.pdf", text: sorText, estimateRole: "carrier" }],
      comparisonEstimateWords: [{ fileName: "SOR-5 22084.pdf", estimateRole: "carrier", words: sorWords, textLayerReliable: true }],
      extractionWarnings: warnings,
    });
  });

  it("runs FULL, not intake: both documents were read", () => {
    expect(generated.debug?.intakeModeActive).not.toBe(true);
    expect(generated.forensic?.higherLineCount).toBeGreaterThanOrEqual(120);
    expect(generated.forensic?.lowerLineCount).toBeGreaterThanOrEqual(100);
  });

  it("reconciles both totals blocks to the documents' own figures and states the 2,226.18 gap", () => {
    const reconciliation = generated.forensic!.reconciliation;
    expect(reconciliation.higherGrandTotal).toBe(13844.81);
    expect(reconciliation.lowerGrandTotal).toBe(11618.63);
    expect(reconciliation.grandTotalDifference).toBe(-2226.18);
    expect(reconciliation.balances).toBe(true);
    const keys = reconciliation.rows.map((row) => row.categoryKey);
    expect(keys).toEqual(expect.arrayContaining(["PARTS", "BODY", "PAINT", "MECHANICAL", "PAINTSUPPLIES"]));
  });

  it("produces at least eight document-anchored findings and passes the release gate", () => {
    const bundle = buildProductionReleaseBundle({
      sourcePdfName: "Shop Final 22084.pdf",
      sourceText: shopText,
      comparison: { fileName: "SOR-5 22084.pdf", text: sorText },
      findings: generated.findings,
      reconciliation: generated.forensic?.reconciliation ?? null,
      intakeModeActive: generated.debug?.intakeModeActive === true,
      unanchoredAppendixRendered: true,
      retrievedSources: [],
      lineCounts: { target: generated.forensic?.higherLineCount ?? null, source: generated.forensic?.lowerLineCount ?? null },
    });
    expect(bundle.run_mode).toBe("FULL");
    expect(bundle.target).toMatchObject({ platform: "ccc", grand_total: 13844.81 });
    expect(bundle.source).toMatchObject({ platform: "ccc", grand_total: 11618.63 });
    const anchored = (bundle.findings ?? []).filter((finding) => (finding.anchors?.length ?? 0) > 0);
    expect(anchored.length).toBeGreaterThanOrEqual(8);
    const failures = runDeltaReleaseGate(bundle).filter((violation) => violation.severity === "FAIL");
    expect(failures.map((violation) => `${violation.rule} ${violation.message}`)).toEqual([]);
  });
});
