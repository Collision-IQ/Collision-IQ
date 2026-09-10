/**
 * TEST 99 (RO 22132) CONTRACT — 2019 Volvo XC90, Conestoga preliminary (CCC
 * ONE, $7,024.78) against Progressive Supplement 3 (Mitchell Cloud
 * Estimating, $5,633.12 gross / $5,133.12 net of a $500.00 deductible).
 *
 * The run that produced the review read NEITHER totals block, never named
 * the comparison document, stated no gap, and shipped two findings that were
 * not differences. The Mitchell document had a clean text layer.
 *
 * The fixtures are SYNTHETIC: the original PDFs are not in the repository,
 * so both texts are reconstructed from the review's documented ground truth
 * (line values, part numbers, rates, totals), with the filler lines labelled
 * as such. Every assertion below is a defect class the review adjudicated:
 *
 * F1 — the Mitchell text layer routes to the Mitchell reader (rows + totals)
 * F1 — dealer sublets booked as parts are reported as sublets
 * F2 — R24: an unresolved comparison fails the release gate BEFORE any PDF
 * F3 — the CCC totals block with a financing block beneath it still parses
 * F4 — a structural review cannot fire on documents with no structural work
 * F5 — a wrapped CCC description keeps its columns out of the description
 * F6 — R26: a tier-5 how-to never reaches the authority table
 * F8 — the forensic report and the badges share one numbering
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  detectEstimatePlatform,
  parseEstimateRowsForPlatform,
  parseEstimateTotalsForPlatform,
} from "../estimatePlatform";
import { readMitchellEstimate } from "@/lib/rekey/mitchellEstimateReader";
import { parseCccEstimateRow } from "../estimateDeltaMatcher";
import { buildForensicReconciliation, describeReconciliation } from "../forensicEstimateAnalysis";
import { mayRelease, runDeltaReleaseGate } from "../deltaReleaseGate";
import { classifyAuthorities } from "../authorityTier";
import { classifyCitationDensityDocument } from "../citationDensityDocumentClassifier";
import { isPlausibleTotalsCategory } from "../deltaEngine/rowCluster";
import {
  buildProductionReleaseBundle,
  mergeTextTotalsWithWordCategories,
  withholdUnsupportedStructuralReviews,
} from "../annotatedCitationDensityEstimate";
import { buildForensicReportPdf } from "../forensicReportRenderer";
import type { CitationDensityFinding } from "@/lib/ai/types/estimateScrubber";

const FIXTURE_DIR = path.join(__dirname, "../../../../tests/fixtures/22132");
const sorText = readFileSync(path.join(FIXTURE_DIR, "sor3_mitchell_text.txt"), "utf8");
const shopText = readFileSync(path.join(FIXTURE_DIR, "shop_ccc_totals_text.txt"), "utf8");

const money = (value: number | null) => (value === null ? null : Math.round(value * 100) / 100);

describe("F1 — platform routing", () => {
  it("names the Mitchell document by what it prints, and the CCC document likewise", () => {
    expect(detectEstimatePlatform(sorText)).toBe("mitchell");
    expect(detectEstimatePlatform(shopText)).toBe("ccc");
    expect(detectEstimatePlatform("")).toBeNull();
  });

  it("the classifier admits the Mitchell supplement as an estimate", () => {
    const verdict = classifyCitationDensityDocument({ filename: "SOR3 22132.pdf", text: sorText });
    expect(verdict.isEstimateLike).toBe(true);
    expect(verdict.evidenceSignals).toContain("Mitchell Estimating");
  });
});

describe("F1 — the Mitchell text layer reads on the first try", () => {
  const read = readMitchellEstimate(sorText);
  const platformRead = parseEstimateRowsForPlatform(sorText);
  const row = (line: number) => platformRead.rows.find((candidate) => candidate.lineNumber === line);

  it("accounts for all 52 printed lines: 40 operation rows plus 12 coded notes, none unreadable", () => {
    expect(read.rows.length + read.noteLines.length).toBe(52);
    expect(read.rows).toHaveLength(40);
    expect(read.unreadable).toEqual([]);
    expect(platformRead.platform).toBe("mitchell");
  });

  it("reads the marquee lines to the cent", () => {
    expect(row(4)?.partNumber).toBe("32365372");
    expect(money(row(4)?.price ?? null)).toBe(671.23);
    expect(row(12)?.price).toBe(1531.25);
    expect(row(12)?.labor).toBe(2.2);
    expect(row(12)?.partSource.join(" ")).toMatch(/QUAL RECYCLED/);
    expect(row(13)?.labor).toBe(3);
    expect(read.notes.get(13)?.join(" ")).toMatch(/repair attempt/i);
    expect(row(19)?.price).toBe(61.88);
    expect(row(15)?.paint).toBe(2.8);
    expect(row(15)?.labor).toBeNull();
    expect(row(38)?.labor).toBe(0.5);
    expect(row(38)?.laborType).toBe("M");
    expect(row(38)?.price).toBe(150);
  });

  it("reports the dealer sublets the platform booked as parts as sublets — $917.40 of them", () => {
    const sublets = platformRead.subletsBookedAsParts;
    expect(sublets.map((entry) => entry.line).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([42, 47, 49, 51, 52]);
    const total = sublets.reduce((sum, entry) => sum + (entry.price ?? 0), 0);
    expect(money(total)).toBe(917.4);
    for (const entry of sublets) {
      expect(row(entry.line ?? -1)?.partSource).toEqual(["SUBLET"]);
    }
    // A real purchased part keeps its part type.
    expect(row(20)?.partSource.join(" ")).toMatch(/NEW/);
  });

  it("reads the totals block: every category, the tax, the gross, the deductible", () => {
    const totals = parseEstimateTotalsForPlatform(sorText);
    expect(totals).not.toBeNull();
    const category = (name: string) => totals!.categories.find((entry) => entry.category === name);
    expect(category("Body Labor")).toMatchObject({ hours: 12.3, rate: 61, cost: 921.3 });
    expect(category("Refinish Labor")).toMatchObject({ hours: 7.9, rate: 61, cost: 481.9 });
    expect(category("Mechanical Labor")).toMatchObject({ hours: 2.1, rate: 100, cost: 360 });
    expect(category("Parts")).toMatchObject({ cost: 3215.26 });
    expect(category("Paint Materials")).toMatchObject({ cost: 335.8, rate: 42 });
    expect(totals!.subtotal).toBe(5314.26);
    expect(totals!.salesTax).toBe(318.86);
    expect(totals!.grandTotal).toBe(5633.12);
    expect(totals!.deductible).toBe(500);
  });
});

describe("F3 — the CCC totals block parses with a financing block beneath it", () => {
  const totals = parseEstimateTotalsForPlatform(shopText);

  it("reads every row of the Test 98 layout minus one", () => {
    expect(totals).not.toBeNull();
    const category = (name: string) => totals!.categories.find((entry) => entry.category === name);
    expect(category("Parts")).toMatchObject({ cost: 3197.75 });
    expect(category("Body Labor")).toMatchObject({ hours: 17.5, rate: 75, cost: 1312.5 });
    expect(category("Paint Labor")).toMatchObject({ hours: 12.3, rate: 75, cost: 922.5 });
    expect(category("Paint Supplies")).toMatchObject({ hours: 12.3, rate: 60, cost: 738 });
    expect(category("Miscellaneous")).toMatchObject({ cost: 456.4 });
    expect(totals!.subtotal).toBe(6627.15);
    expect(totals!.salesTax).toBe(397.63);
    expect(totals!.grandTotal).toBe(7024.78);
  });

  it("financing furniture beneath the table is not a spending category", () => {
    expect(isPlausibleTotalsCategory("0% APR financing available 6 months", 6, 0)).toBe(false);
    expect(isPlausibleTotalsCategory("Pay over time with Sunbit", null, null)).toBe(false);
    expect(isPlausibleTotalsCategory("Scan the QR code to see your options", null, null)).toBe(false);
    expect(isPlausibleTotalsCategory("Miscellaneous", null, null)).toBe(true);
  });

  it("a word-lane parse that absorbed page furniture cannot displace a text parse that reconciles", () => {
    const junkWordCategories = [
      { category: "Parts", hours: null, rate: null, amount: 3197.75 },
      { category: "Body Labor", hours: 17.5, rate: 75, amount: 1312.5 },
      { category: "Paint Labor", hours: 12.3, rate: 75, amount: 922.5 },
      { category: "Paint Supplies", hours: 12.3, rate: 60, amount: 738 },
      { category: "Miscellaneous", hours: null, rate: null, amount: 456.4 },
      // Page furniture that slipped the vocabulary, read as a category with a
      // figure of its own ("as low as $25.00 per month").
      { category: "As low as per month", hours: null, rate: null, amount: 25 },
    ];
    const merged = mergeTextTotalsWithWordCategories(totals, junkWordCategories);
    expect(merged?.categories.map((entry) => entry.category)).toEqual([
      "Parts",
      "Body Labor",
      "Paint Labor",
      "Paint Supplies",
      "Miscellaneous",
    ]);
  });

  it("a word-lane parse that reconciles is still allowed to refine the text parse", () => {
    const cleanWordCategories = [
      { category: "Parts", hours: null, rate: null, amount: 3197.75 },
      { category: "Body Labor", hours: 17.5, rate: 75, amount: 1312.5 },
      { category: "Paint Labor", hours: 12.3, rate: 75, amount: 922.5 },
      { category: "Paint Supplies", hours: 12.3, rate: 60, amount: 738 },
      { category: "Miscellaneous", hours: null, rate: null, amount: 456.4 },
    ];
    const merged = mergeTextTotalsWithWordCategories(totals, cleanWordCategories);
    expect(merged?.categories).toHaveLength(5);
    expect(merged?.grandTotal).toBe(7024.78);
  });
});

describe("the reconciliation the run should have produced", () => {
  const higher = parseEstimateTotalsForPlatform(shopText);
  const lower = parseEstimateTotalsForPlatform(sorText);
  const reconciliation = buildForensicReconciliation({ higherTotals: higher, lowerTotals: lower });
  const rowFor = (pattern: RegExp) => reconciliation.rows.find((row) => pattern.test(row.category));

  it("closes to the cent on both documents and states the $1,391.66 gross gap", () => {
    expect(reconciliation.balances).toBe(true);
    expect(money(reconciliation.grandTotalDifference)).toBe(-1391.66);
    expect(reconciliation.lowerDeductible).toBe(500);
    expect(reconciliation.higherDeductible).toBeNull();
  });

  it("pairs Mitchell's categories with CCC's: Refinish↔Paint, Paint Materials↔Paint Supplies", () => {
    expect(money(rowFor(/^parts$/i)?.costDifference ?? null)).toBe(17.51);
    expect(money(rowFor(/body/i)?.costDifference ?? null)).toBe(-391.2);
    expect(money(rowFor(/paint labor/i)?.costDifference ?? null)).toBe(-440.6);
    expect(money(rowFor(/paint supplies/i)?.costDifference ?? null)).toBe(-402.2);
    expect(rowFor(/mechanical/i)?.presentOnlyOn).toBe("lower");
    expect(money(rowFor(/mechanical/i)?.costDifference ?? null)).toBe(360);
    expect(rowFor(/miscellaneous/i)?.presentOnlyOn).toBe("higher");
    expect(money(rowFor(/miscellaneous/i)?.costDifference ?? null)).toBe(-456.4);
  });

  it("names all three rate disputes and never claims the rates agree", () => {
    expect(reconciliation.allSharedRatesAgree).toBe(false);
    const described = describeReconciliation(reconciliation);
    expect(described.rateDisputeStatement).toBeNull();
    expect(described.rateDifferences).toHaveLength(3);
    expect(described.rateDifferences.join("\n")).toMatch(/Body Labor: \$75\.00\/hr .* \$61\.00\/hr/);
    expect(described.rateDifferences.join("\n")).toMatch(/Paint Labor: \$75\.00\/hr .* \$61\.00\/hr/);
    expect(described.rateDifferences.join("\n")).toMatch(/Paint Supplies: \$60\.00\/hr .* \$42\.00\/hr/);
    expect(described.gapStatement).toMatch(/\$1,391\.66/);
  });

  it("the forensic report states the deductible and the net-to-shop gap", async () => {
    const { bytes } = await buildForensicReportPdf({
      reconciliation,
      findings: [],
      higherDocumentName: "Shop 22132.pdf",
      lowerDocumentName: "SOR3 22132.pdf",
      higherLineCount: 64,
      lowerLineCount: 52,
      noCounterpartRows: [],
      vehicleLabel: "2019 Volvo XC90 T6 Momentum",
      limitations: [],
      authorities: [],
      retrievedSources: [],
      generatedAt: "2026-09-10T00:00:00.000Z",
      redactionScope: "natural_person",
    });
    const pdfParse = (await import("pdf-parse")).default as (b: Buffer) => Promise<{ text: string }>;
    const { text } = await pdfParse(Buffer.from(bytes));
    expect(text).toMatch(/\$1,391\.66/);
    expect(text).toMatch(/deductible of \$500\.00, not waived/);
    expect(text).toMatch(/\$1,891\.66/);
    expect(text).not.toMatch(/could not both be read/);
  });
});

describe("F2 — R24: an unresolved comparison fails the gate before any PDF renders", () => {
  const anchored = (id: string, line: number): CitationDensityFinding =>
    ({
      id,
      operationLabel: `Line ${line}`,
      category: "refinish",
      estimateGapType: "reduced_by_carrier",
      currentSupportSummary: "written vs paid",
      missingProofSummary: "",
      recommendedNextAction: "",
      shopEvidence: { lineNumber: String(line), amount: 10 },
      impact: { dollarImpact: 10, laborHoursImpact: null, safetyImpact: "low", supplementPriority: "low" },
      citationStatus: {} as CitationDensityFinding["citationStatus"],
      citationDensityScore: 50,
      verifiedAuthorityCount: 0,
      missingAuthorityTypes: [],
      confidence: "medium",
      limitations: [],
    }) as CitationDensityFinding;

  it("the bundle this build shipped fails on source grand_total unresolved", () => {
    const bundle = buildProductionReleaseBundle({
      sourcePdfName: "Shop 22132.pdf",
      sourceText: shopText,
      // What the run had: no comparison text reached the pipeline.
      comparison: null,
      findings: [],
      reconciliation: buildForensicReconciliation({
        higherTotals: parseEstimateTotalsForPlatform(shopText),
        lowerTotals: null,
      }),
      intakeModeActive: true,
      unanchoredAppendixRendered: true,
      retrievedSources: [],
    });
    const violations = runDeltaReleaseGate(bundle);
    expect(mayRelease(violations)).toBe(false);
    const r24 = violations.filter((violation) => violation.rule === "R24").map((violation) => violation.message);
    expect(r24.some((message) => /source grand_total unresolved/.test(message))).toBe(true);
    expect(r24.some((message) => /source identity unresolved/.test(message))).toBe(true);
  });

  it("after F1 the same pair resolves both documents and passes", () => {
    const reconciliation = buildForensicReconciliation({
      higherTotals: parseEstimateTotalsForPlatform(shopText),
      lowerTotals: parseEstimateTotalsForPlatform(sorText),
    });
    const bundle = buildProductionReleaseBundle({
      sourcePdfName: "Shop 22132.pdf",
      sourceText: shopText,
      comparison: { fileName: "SOR3 22132.pdf", text: sorText },
      findings: [anchored("f-1", 24), anchored("f-2", 31), anchored("f-3", 13)],
      reconciliation,
      intakeModeActive: false,
      unanchoredAppendixRendered: true,
      retrievedSources: [],
    });
    expect(bundle.source).toMatchObject({ file: "SOR3 22132.pdf", platform: "mitchell", grand_total: 5633.12 });
    expect(bundle.target).toMatchObject({ file: "Shop 22132.pdf", platform: "ccc", grand_total: 7024.78 });
    expect(bundle.run_mode).toBe("FULL");
    expect(bundle.category_deltas?.length).toBeGreaterThanOrEqual(6);
    const violations = runDeltaReleaseGate(bundle);
    expect(violations.filter((violation) => violation.severity === "FAIL")).toEqual([]);
  });

  it("a TOTALS_ONLY run made only of speculative findings is below the floor", () => {
    const bundle = buildProductionReleaseBundle({
      sourcePdfName: "Shop 22132.pdf",
      sourceText: shopText,
      comparison: { fileName: "SOR3 22132.pdf", text: sorText },
      findings: [
        {
          ...anchored("required-detector-sand_polish_p_page_support-x", 61),
          id: "required-detector-sand_polish_p_page_support-x",
        },
        {
          ...anchored("required-detector-repair_procedure_structural-y", 32),
          id: "required-detector-repair_procedure_structural-y",
          category: "structural_or_fit_verification",
          estimateGapType: "needs_proof",
        },
      ],
      reconciliation: buildForensicReconciliation({
        higherTotals: parseEstimateTotalsForPlatform(shopText),
        lowerTotals: parseEstimateTotalsForPlatform(sorText),
      }),
      intakeModeActive: true,
      unanchoredAppendixRendered: true,
      retrievedSources: [],
    });
    expect(bundle.run_mode).toBe("TOTALS_ONLY");
    const violations = runDeltaReleaseGate(bundle);
    expect(violations.some((violation) => violation.rule === "R24" && /below the release floor/.test(violation.message))).toBe(true);
  });

  it("R09 blocks the internal evidence vocabulary that reached the customer", () => {
    const violations = runDeltaReleaseGate({
      findings: [
        {
          id: "f1",
          text: "Estimate evidence: Existing estimate parser; Estimate evidence: Uploaded claim documents",
          anchors: ["ln:32"],
        },
        { id: "f2", text: "Missing or unresolved support: oem, adas, nhtsa, photo or teardown proof", anchors: ["ln:33"] },
      ],
    });
    const r09 = violations.filter((violation) => violation.rule === "R09");
    expect(r09.length).toBeGreaterThanOrEqual(2);
  });
});

describe("F4 — a speculative detector requires anchor evidence", () => {
  const structural: CitationDensityFinding = {
    id: "citation-density-7-structural-frame-and-measurement-verification",
    operationLabel: "Structural frame and measurement verification",
    category: "structural_or_fit_verification",
    estimateGapType: "needs_proof",
    currentSupportSummary: "Estimate evidence: hood test fit",
    missingProofSummary: "Missing or unresolved support: photo or teardown proof.",
    recommendedNextAction: "",
    shopEvidence: { lineNumber: "33", description: "Cavity Wax 3M 08852" },
    impact: { safetyImpact: "high", supplementPriority: "high" },
    citationStatus: {} as CitationDensityFinding["citationStatus"],
    citationDensityScore: 40,
    verifiedAuthorityCount: 0,
    missingAuthorityTypes: ["oem"],
    confidence: "low",
    limitations: [],
  };

  it("withholds the structural review on a front hit with no structural work on either document", () => {
    const outcome = withholdUnsupportedStructuralReviews([structural], [shopText, sorText]);
    expect(outcome.dropped.map((finding) => finding.id)).toEqual([structural.id]);
    expect(outcome.kept).toEqual([]);
  });

  it("keeps it when a document prints structural labor", () => {
    const withFrame = `${shopText}\nFRAME\n70 Rpr Frame rail 2.0 S\nFrame Labor 2.0 hrs @ $ 95.00 /hr 190.00`;
    const outcome = withholdUnsupportedStructuralReviews([structural], [withFrame, sorText]);
    expect(outcome.kept).toHaveLength(1);
    expect(outcome.dropped).toEqual([]);
  });

  it("never withholds a finding that carries a verified authority", () => {
    const supported = {
      ...structural,
      bestAvailableAuthority: { type: "oem_procedure", status: "verified", title: "Volvo body repair manual", confidence: "high" },
    } as CitationDensityFinding;
    const outcome = withholdUnsupportedStructuralReviews([supported], [shopText, sorText]);
    expect(outcome.kept).toHaveLength(1);
  });
});

describe("F5 — a wrapped CCC description keeps its columns out of the description", () => {
  it("Ln 61: qty 3, paint 1.5, description without the cells", () => {
    const row = parseCccEstimateRow("61 Finish sand & polish (0.5 Refinish 3 1.5 per panel)");
    expect(row?.description).toBe("Finish sand & polish (0.5 Refinish per panel)");
    expect(row?.qty).toBe(3);
    expect(row?.paint).toBe(1.5);
    expect(row?.labor).toBeNull();
  });

  it("Ln 59: qty 3, $9.00, 0.9 body hours, description keeps its per-panel note", () => {
    const row = parseCccEstimateRow("59 Mask jambs (0.3 Hours and $3.00 3 9.00 0.9 per panel)");
    expect(row?.description).toBe("Mask jambs (0.3 Hours and $3.00 per panel)");
    expect(row?.qty).toBe(3);
    expect(row?.price).toBe(9);
    expect(row?.labor).toBe(0.9);
    expect(row?.paint).toBeNull();
  });

  it("a note's own dollar figure is never pulled out as the price column", () => {
    const row = parseCccEstimateRow("59 Mask jambs (0.3 Hours and $3.00 per panel) 3 9.00 0.9");
    expect(row?.price).toBe(9);
    expect(row?.description).toBe("Mask jambs (0.3 Hours and $3.00 per panel)");
  });
});

describe("F6 — R26: the authority table lists what was relied upon", () => {
  const retrieved = [
    { title: "Tips on Finding OEM Position Statements", url: "https://www.adasdepot.com/blog/tips" },
    { title: "How Important Are OEM Position Statements?", url: "https://caradas.com/how-important" },
    { title: "Why You Need OEM Repair Procedures", url: "https://revvhq.com/why-you-need" },
    { title: "Volvo Position Statement: Scanning and Diagnostics", url: "https://rts.i-car.com/volvo-scanning" },
  ];

  it("the tier classifier refuses advice about authorities at any tier", () => {
    const { accepted, rejected } = classifyAuthorities(retrieved);
    expect(accepted.map((authority) => authority.title)).toEqual(["Volvo Position Statement: Scanning and Diagnostics"]);
    expect(accepted[0].tier).toBe(4);
    expect(rejected).toHaveLength(3);
    expect(rejected.every((entry) => /how-to or explainer/.test(entry.reason))).toBe(true);
  });

  it("a tier-5 source attached to no finding fails the gate; a tier-4 statement may stand alone", () => {
    const violations = runDeltaReleaseGate({
      authorities: [
        { title: "Some aftermarket blog on hood alignment", tier: 5, attached_to: null },
        { title: "Volvo Position Statement: Scanning and Diagnostics", tier: 4, attached_to: null },
        { title: "Tips on Finding OEM Position Statements", tier: 5, attached_to: ["f1"] },
      ],
    });
    const r26 = violations.filter((violation) => violation.rule === "R26").map((violation) => violation.message);
    expect(r26).toHaveLength(2);
    expect(r26.some((message) => /Some aftermarket blog/.test(message))).toBe(true);
    expect(r26.some((message) => /how-to\/marketing title/.test(message))).toBe(true);
  });
});

describe("F8 — one numbering across the annotated estimate and the forensic report", () => {
  it("a finding card prints the badge number it was given", async () => {
    const reconciliation = buildForensicReconciliation({
      higherTotals: parseEstimateTotalsForPlatform(shopText),
      lowerTotals: parseEstimateTotalsForPlatform(sorText),
    });
    const finding = {
      id: "f-hood",
      operationLabel: "Reduced parts price: Hood",
      category: "parts_downgrade",
      estimateGapType: "reduced_by_carrier",
      currentSupportSummary: "$2,223.54 written vs $1,531.25 paid (Qual Recycled).",
      missingProofSummary: "",
      recommendedNextAction: "",
      shopEvidence: { lineNumber: "24", amount: 2223.54 },
      impact: { dollarImpact: 692.29, laborHoursImpact: null, safetyImpact: "medium", supplementPriority: "high" },
      citationStatus: {},
      citationDensityScore: 60,
      verifiedAuthorityCount: 0,
      missingAuthorityTypes: [],
      confidence: "medium",
      limitations: [],
    } as unknown as CitationDensityFinding;
    const { bytes } = await buildForensicReportPdf({
      reconciliation,
      findings: [finding],
      higherDocumentName: "Shop 22132.pdf",
      lowerDocumentName: "SOR3 22132.pdf",
      higherLineCount: 64,
      lowerLineCount: 52,
      noCounterpartRows: [],
      vehicleLabel: "2019 Volvo XC90 T6 Momentum",
      limitations: [],
      authorities: [],
      retrievedSources: [],
      generatedAt: "2026-09-10T00:00:00.000Z",
      redactionScope: "natural_person",
      findingNumbers: new Map([["f-hood", 7]]),
    });
    const pdfParse = (await import("pdf-parse")).default as (b: Buffer) => Promise<{ text: string }>;
    const { text } = await pdfParse(Buffer.from(bytes));
    expect(text).toMatch(/Finding 7 — Reduced parts price: Hood/);
  });
});

describe("F2 — end to end: a run the gate refuses produces no artifact", () => {
  it("throws DeltaReleaseBlockedError before rendering when the comparison never resolved", async () => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const {
      buildAnnotatedCitationDensityEstimatePdf,
      buildRequiredEstimatorDeltaFindings,
      DeltaReleaseBlockedError,
    } = await import("../annotatedCitationDensityEstimate");

    // A substantive subject with NO totals block — the shape a run has when
    // its totals reader failed — against a comparison that supplies text but
    // no readable totals either. This is the RO 22132 state: two documents,
    // neither grand total resolved.
    const subjectLines: string[] = ["SHOP OF RECORD", "FRONT BUMPER"];
    for (let line = 1; line <= 44; line += 1) {
      subjectLines.push(`${line} Repl RT Component ${line} 88162530${String(50 + line).padStart(2, "0")} ${(100 + line).toFixed(2)} 1.5`);
    }
    const subjectPdf = await PDFDocument.create();
    const subjectFont = await subjectPdf.embedFont(StandardFonts.Helvetica);
    for (let pageIndex = 0; pageIndex < 2; pageIndex += 1) {
      const page = subjectPdf.addPage([612, 792]);
      subjectLines.slice(pageIndex * 23, pageIndex * 23 + 23).forEach((text, index) => {
        page.drawText(text, { x: 42, y: 752 - index * 16, size: 9, font: subjectFont });
      });
    }
    const comparisonText = [
      "Estimate of Record",
      "FRONT BUMPER",
      ...Array.from({ length: 20 }, (_, index) => {
        const line = index + 1;
        return `${line} Repl RT Component ${line} 88162530${String(50 + line).padStart(2, "0")} ${(90 + line).toFixed(2)} 1.0`;
      }),
    ].join("\n");

    await expect(
      buildAnnotatedCitationDensityEstimatePdf({
        sourcePdfBytes: await subjectPdf.save(),
        sourcePdfName: "Shop 22132.pdf",
        sourceDocumentId: "shop",
        selectedEstimateTotal: 7024.78,
        sourceText: subjectLines.join("\n"),
        comparisonEstimateTexts: [
          { fileName: "SOR3 22132.pdf", sourceDocumentId: "sor", estimateRole: "carrier", text: comparisonText },
        ],
        findings: [],
        findingGenerator: buildRequiredEstimatorDeltaFindings,
        redactSourcePages: false,
        request: { includeLegend: true, annotationMode: "both", estimateRole: "shop", enforceReleaseGate: true },
      })
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(DeltaReleaseBlockedError);
      const blocked = error as InstanceType<typeof DeltaReleaseBlockedError>;
      const messages = blocked.violations.filter((v) => v.severity === "FAIL").map((v) => `${v.rule} ${v.message}`);
      expect(messages.some((message) => /^R24 .*grand_total unresolved/.test(message))).toBe(true);
      expect(blocked.notice).toMatch(/^RELEASE BLOCKED/);
      return true;
    });
  }, 120_000);
});
