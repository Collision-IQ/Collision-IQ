/**
 * RO 20792 CONTRACT — 2022 Tesla Model Y, shop final (CCC ONE, $7,445.25)
 * against Progressive Supplement 2 (Mitchell Cloud Estimating, $6,229.51).
 *
 * The QA review found the totals correct and the line-level narrative wrong
 * in about twenty places: operations reported "not present" on the
 * comparison that were there at the same part number and price, and labelled
 * "OCR-uncertain" against a native text export. The rows below are the
 * review's own tables, reconstructed as each platform prints them (the
 * original PDFs are not in the repository).
 *
 * Defect classes the review adjudicated:
 *  D1 — Mitchell rows reached the matcher with no description tokens and no
 *       operation code, so no description could pair against a Mitchell
 *       comparison; only an exact part-number string could.
 *  D2 — part numbers compared as printed: "1493770-00-C" ≠ "149377000C".
 *  D3 — no split-vs-combined reconciliation ("Research DTC's" ×2 against
 *       "Research DTC's Pre and Post"; Service Mode enable/disable).
 *  D4 — Mitchell's Repair + Refinish twin lines against CCC's one row.
 *  D5 — CCC's truncated words ("Storage compart") never matched the full
 *       word ("Storage Compartment").
 *  D6 — the "OCR-uncertain" caveat applied to a document never scanned.
 *  D7 — no sanity check of line-level absence claims against the category
 *       gaps the totals blocks state.
 */
import { describe, expect, it } from "vitest";
import { parseEstimateRowsForPlatform } from "../estimatePlatform";
import {
  matchEstimateLineItems,
  mergeRepairRefinishTwins,
  normalizePartKey,
  parseCccEstimateRow,
  reconcileMissingClaimsAgainstTotals,
  type EstimateDeltaRow,
  type EstimateLineItemDelta,
} from "../estimateDeltaMatcher";
import { parseMitchellEstimateTotals } from "@/lib/rekey/mitchellEstimateReader";

const MITCHELL_TEXT = [
  "Progressive Supplement 2",
  "Mitchell Cloud Estimating 26.2",
  "Line Item Description Operation Labor Type Units Part Type Part Number Qty Total Price Tax",
  "4201426Bumper Cover UnpaintedRemove / ReplaceBody2.0New1493736-S0-A 1$761.74Yes",
  "6201427LT Upper BracketRemove / ReplaceBody0.2New1493770-00-C 1$7.00Yes",
  "7201428LT Inner BracketRemove / ReplaceBody0.2New1493772-00-B 1$1.00Yes",
  "8201429Lower Grille Type 1Remove / ReplaceBody0.3New1493759-00-A 1$165.29Yes",
  "18201431LT FenderRefinishRefinish2.0Existing",
  "19201430LT FenderRepairBody2.0Existing",
  "20201441LT Fender LinerRemove / ReplaceBody0.4New1744361-00-A 1$130.00Yes",
  "21201440LT Fender Liner RivetRemove / ReplaceBody0.0New1006521-00-A 4$2.00Yes",
  "22201442LT RivetRemove / ReplaceBody0.0New1006535-00-A 1$0.38Yes",
  "26201432Storage CompartmentRemove / InstallBody0.5Existing",
  "27201433Valance PanelRemove / ReplaceBody0.3New1613579-00-D 1$302.41Yes",
  "28201434Valance Panel RivetRemove / ReplaceBody0.0New1128034-00-B 1$5.90Yes",
  "36900500Enable and Disable Service modeAdditional LaborBody0.2Existing",
  "37900500Research DTC's Pre and PostAdditional LaborBody1.0Existing",
  "38900500Download and Redeploy FirmwareAdditional LaborBody0.5Existing",
  "39900500Final road test and safety inspectAdditional LaborBody0.5Existing",
  "40900500Maintain HV ChargeAdditional LaborBody0.5Existing 1$5.00Yes",
  "46900500TintAdditional LaborRefinish0.5Existing",
  "47900500Set up & initiate camera calibration procedureAdditional LaborBody1.0Existing",
  "48900500Capture image and adjust camerasAdditional LaborBody0.5Existing",
  "49900500Capture image to confirm adjustmentsAdditional LaborBody0.5Existing",
  "50900500Drive time to confirm camera calibrationsAdditional LaborBody1.0Existing",
].join("\n");

/** CCC rows as the shop estimate prints them, with the review's values. */
const CCC_ROWS: Array<[string, string]> = [
  ["FRONT BUMPER & GRILLE", "1Repl  Bumper cover unpainted1493736S0A1761.742.0"],
  ["FRONT BUMPER & GRILLE", "2Repl  LT Upper bracket149377000C17.000.2"],
  ["FRONT BUMPER & GRILLE", "3Repl  LT Inner bracket149377200B11.000.2"],
  ["FRONT BUMPER & GRILLE", "4Repl  Lower grille type 1149375900A1165.290.3"],
  ["FENDER", "5Rpr  LT Fender2.02.0"],
  ["FENDER", "6Repl  LT Fender liner149261300C1130.000.4"],
  ["FENDER", "7Repl  LT Fender liner rivet100652100A42.00"],
  ["FENDER", "8Repl  LT Rivet100653500A20.76"],
  ["FENDER", "9R&I  RT Fender liner0.4"],
  ["HOOD", "10R&I  Storage compart1.2"],
  ["RADIATOR SUPPORT", "11Repl  Valance panel161357900D1302.410.3"],
  ["RADIATOR SUPPORT", "12Repl  Valance panel rivet112803400B15.90"],
  ["VEHICLE DIAGNOSTICS", "13#Rpr  Place vehicle in \"Service Mode\"0.1"],
  ["VEHICLE DIAGNOSTICS", "14#Rpr  Research DTC's0.5"],
  ["VEHICLE DIAGNOSTICS", "15#Rpr  Download & redeploy firmware0.5"],
  ["VEHICLE DIAGNOSTICS", "16#Rpr  Set up & initiate camera calibration procedure1.0"],
  ["VEHICLE DIAGNOSTICS", "17#Rpr  Drive time for camera calibration procedure1.0"],
  ["VEHICLE DIAGNOSTICS", "18#Rpr  Capture image & adjust cameras0.6"],
  ["VEHICLE DIAGNOSTICS", "19#Rpr  Capture image to confirm adjustments0.3"],
  ["VEHICLE DIAGNOSTICS", "20#Rpr  Research DTC's0.5"],
  ["VEHICLE DIAGNOSTICS", "21#Rpr  Remove vehicle from \"Service Mode\"0.1"],
  ["MISCELLANEOUS OPERATIONS", "22#Maintain HV battery state of charge15.00T0.5"],
  ["MISCELLANEOUS OPERATIONS", "23#Tint color10.5"],
  ["MISCELLANEOUS OPERATIONS", "24#Rpr  Final road test for safety & quality check0.5"],
];

function higherRows(): EstimateDeltaRow[] {
  return CCC_ROWS.map(([section, line]) => {
    const row = parseCccEstimateRow(line, { section });
    if (!row) throw new Error(`CCC row did not parse: ${line}`);
    return row;
  });
}

function lowerRows(): EstimateDeltaRow[] {
  const read = parseEstimateRowsForPlatform(MITCHELL_TEXT);
  expect(read.platform).toBe("mitchell");
  return read.rows;
}

const byLine = (deltas: EstimateLineItemDelta[], line: number) =>
  deltas.filter((delta) => delta.higherRow.lineNumber === line);

describe("D1 — a Mitchell row reaches the matcher with tokens and an operation code", () => {
  const rows = lowerRows();
  const line = (n: number) => rows.find((row) => row.lineNumber === n)!;

  it("carries description tokens without the operation words", () => {
    expect(line(46).descriptionTokens).toEqual(["tint"]);
    expect(line(38).descriptionTokens).toEqual(["download", "redeploy", "firmware"]);
    expect(line(6).descriptionTokens).toEqual(["lt", "upper", "bracket"]);
  });

  it("carries the CCC code for the operation phrase, none for a manual line", () => {
    expect(line(4).opCode).toBe("Repl");
    expect(line(26).opCode).toBe("R&I");
    expect(line(19).opCode).toBe("Rpr");
    expect(line(18).opCode).toBe("Refn");
    expect(line(37).opCode).toBeNull();
  });
});

describe("D2 — part-number identity survives the platform's punctuation", () => {
  it("strips dashes and case", () => {
    expect(normalizePartKey("1493770-00-C")).toBe("149377000C");
    expect(normalizePartKey("149377000C")).toBe("149377000C");
    expect(normalizePartKey("1493736-S0-A")).toBe(normalizePartKey("1493736S0A"));
  });
});

describe("D4 — Repair and Refinish twins fold into one operation", () => {
  it("merges the Mitchell Repair/Refinish pair on the same panel and nothing else", () => {
    const merged = mergeRepairRefinishTwins(lowerRows());
    const fender = merged.filter((row) => row.descriptionTokens.join(" ") === "lt fender" && !row.partNumber);
    expect(fender).toHaveLength(1);
    expect(fender[0].labor).toBe(2);
    expect(fender[0].paint).toBe(2);
    expect(fender[0].opCode).toBe("Rpr");
    // The liner is a different line (part number) and stays separate.
    expect(merged.some((row) => row.partNumber === "1744361-00-A")).toBe(true);
  });
});

describe("the review's false positives are matched, the real differences are kept", () => {
  const match = matchEstimateLineItems({
    higherRows: higherRows(),
    lowerRows: lowerRows(),
    lowerIsOcr: false,
    lowerProvenance: "clean",
    lowerCategoryText: MITCHELL_TEXT,
  });
  const missing = match.deltas.filter((delta) => delta.kind === "missing_operation");
  const missingLines = missing.map((delta) => delta.higherRow.lineNumber);

  it("pairs every same-part line despite the dash formatting", () => {
    for (const line of [1, 2, 3, 4, 7, 8, 11, 12]) {
      const pair = match.matchedPairs.find((candidate) => candidate.higherRow.lineNumber === line);
      expect(pair, `line ${line}`).toBeDefined();
      expect(pair?.basis).toBe("part_number");
      expect(missingLines).not.toContain(line);
    }
  });

  it("pairs the labor-only lines whose wording differs only in connectives and tense", () => {
    for (const line of [15, 16, 17, 22, 23, 24, 18, 19]) {
      expect(missingLines, `line ${line}`).not.toContain(line);
      expect(match.matchedPairs.some((pair) => pair.higherRow.lineNumber === line), `line ${line}`).toBe(true);
    }
  });

  it("D3 — reads CCC's split lines against Mitchell's combined line, with no quantity shortfall", () => {
    const dtc = match.matchedPairs.filter((pair) => [14, 20].includes(pair.higherRow.lineNumber ?? -1));
    expect(dtc).toHaveLength(2);
    expect(dtc.every((pair) => pair.lowerRow.lineNumber === 37)).toBe(true);
    const serviceMode = match.matchedPairs.filter((pair) => [13, 21].includes(pair.higherRow.lineNumber ?? -1));
    expect(serviceMode).toHaveLength(2);
    expect(serviceMode.every((pair) => pair.lowerRow.lineNumber === 36)).toBe(true);
    expect(match.deltas.some((delta) => (delta.statusLabels ?? []).includes("QUANTITY_SHORTFALL"))).toBe(false);
    expect(match.lowerRowReconciliation.filter((entry) => entry.matchedAs === "combined").map((entry) => entry.lineNumber).sort()).toEqual([36, 37]);
  });

  it("D4 — the repaired-and-refinished fender is one paid operation, not unfunded paint", () => {
    expect(missingLines).not.toContain(5);
    expect(byLine(match.deltas, 5).some((delta) => delta.kind === "reduced_paint")).toBe(false);
  });

  it("D5 — the storage compartment is a 0.7 h shortfall, not a missing section", () => {
    expect(missingLines).not.toContain(10);
    const reduced = byLine(match.deltas, 10).find((delta) => delta.kind === "reduced_labor");
    expect(reduced?.laborDelta).toBe(0.7);
    expect(reduced?.lowerRow?.lineNumber).toBe(26);
  });

  it("still reports the one line the comparison genuinely lacks", () => {
    const rtLiner = byLine(match.deltas, 9);
    expect(rtLiner).toHaveLength(1);
    expect(["missing_operation", "expanded_scope"]).toContain(rtLiner[0].kind);
    expect(rtLiner[0].annotate).toBe(true);
  });

  it("D6 — a clean text read never wears the OCR caveat", () => {
    for (const delta of match.deltas) {
      expect(delta.statusLabels ?? []).not.toContain("OCR_UNCERTAIN");
      expect(delta.summary).not.toMatch(/image-only|OCR/);
    }
  });
});

describe("D6 — an unreliable text layer is named as one, not as a scan", () => {
  it("labels an unverified absence by the actual limit", () => {
    const match = matchEstimateLineItems({
      higherRows: higherRows(),
      lowerRows: lowerRows(),
      lowerIsOcr: true,
      lowerProvenance: "unreliable_text",
      lowerCategoryText: MITCHELL_TEXT,
    });
    const flagged = match.deltas.filter((delta) => (delta.statusLabels ?? []).includes("VERIFY_AGAINST_SOURCE"));
    expect(flagged.length).toBeGreaterThan(0);
    for (const delta of flagged) {
      expect(delta.statusLabels ?? []).toContain("LOWER_ESTIMATE_TEXT_LAYER_LIMITATION");
      expect(delta.statusLabels ?? []).not.toContain("OCR_UNCERTAIN");
      expect(delta.statusLabels ?? []).not.toContain("LOWER_ESTIMATE_OCR_LIMITATION");
      expect(delta.summary).not.toMatch(/image-only PDF|OCR-extracted/);
    }
    expect(flagged.some((delta) => /text layer read unreliably/.test(delta.summary))).toBe(true);
  });
});

describe("D7 — absence claims are checked against the category gaps the totals state", () => {
  const row = (line: number, labor: number | null, laborType: string | null = null): EstimateDeltaRow => ({
    lineNumber: line,
    opCode: "Rpr",
    description: `Operation ${line}`,
    descriptionTokens: ["operation", String(line)],
    partNumber: null,
    section: "BODY",
    qty: null,
    price: null,
    labor,
    laborIncluded: false,
    paint: null,
    paintIncluded: false,
    laborType,
    rawText: `${line} Rpr Operation ${line}`,
  });
  const claim = (line: number, labor: number): EstimateLineItemDelta => ({
    kind: "missing_operation",
    lowerRow: null,
    higherRow: row(line, labor),
    matchBasis: "none",
    laborDelta: labor,
    paintDelta: null,
    priceDelta: null,
    summary: `Higher estimate documents "Operation ${line}"; this operation is not present on the lower estimate.`,
    annotate: true,
  });
  const totals = (bodyHours: number) => ({
    categories: [{ category: "Body Labor", hours: bodyHours, rate: 60, cost: bodyHours * 60 }],
    subtotal: null,
    salesTax: null,
    grandTotal: null,
    taxLanes: [],
  });

  it("flags every claim in a category whose claimed hours exceed the stated gap", () => {
    const deltas = [claim(1, 1.0), claim(2, 1.0), claim(3, 1.0)];
    const result = reconcileMissingClaimsAgainstTotals({ deltas, higher: totals(20), lower: totals(19) });
    expect(result.flagged).toBe(3);
    expect(result.notes[0]).toMatch(/Body labor: the line-level "not present" claims total 3\.0 h, but the two totals blocks put the body labor gap at 1\.0 h/);
    for (const delta of deltas) {
      expect(delta.exceedsCategoryGap).toBe(true);
      expect(delta.ocrUncertain).toBe(true);
      expect(delta.statusLabels).toContain("EXCEEDS_CATEGORY_GAP");
    }
  });

  it("leaves claims alone when they fit inside the gap", () => {
    const deltas = [claim(1, 0.5), claim(2, 0.4)];
    const result = reconcileMissingClaimsAgainstTotals({ deltas, higher: totals(20), lower: totals(19) });
    expect(result.flagged).toBe(0);
    expect(result.notes).toEqual([]);
    expect(deltas.every((delta) => !delta.exceedsCategoryGap)).toBe(true);
  });
});

describe("polish — Mitchell tax lanes name their bucket", () => {
  it("labels each Tax line with the taxable bucket printed above it", () => {
    const totals = parseMitchellEstimateTotals(
      [
        "Mitchell Cloud Estimating",
        "Estimate Totals",
        "Body Labor10.0$60.00$600.00",
        "Refinish Labor4.0$60.00$240.00",
        "Taxable Parts$1,000.00",
        "Paint Materials$100.00",
        "Taxable Labor$600.00",
        "Tax 6.0000%$36.00",
        "Taxable Parts$1,000.00",
        "Tax 6.0000%$60.00",
        "Taxable Paint Materials$100.00",
        "Tax 6.0000%$6.00",
        "Gross Total$2,042.00",
      ].join("\n")
    );
    expect(totals?.taxLanes.map((lane) => lane.label)).toEqual([
      "Tax 6.0000% (Labor)",
      "Tax 6.0000% (Parts)",
      "Tax 6.0000% (Paint Materials)",
    ]);
  });
});
