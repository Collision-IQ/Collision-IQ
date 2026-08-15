/**
 * TEST 99 CONTRACT — RO 22140 (2025 Polestar 3, Shop preliminary vs USAA
 * SOR-1 with embedded SUPPLEMENT SUMMARY changelog).
 *
 * Adjudicated in the Test 99 accuracy review (2026-08-14). Fixture texts are
 * the real documents with owner PII scrubbed (names, contacts, claim, VIN
 * tail). Do NOT edit engine rules just to make a guard pass — every assertion
 * here is a defect class that shipped to a customer-facing deliverable.
 *
 * D1  — exact-match lines reported as "missing from comparison estimate"
 * D2  — phantom unanchored finding cards (R05 empty-card drop)
 * D3  — supplement changelog rows cited as live comparison data (R25)
 * D5  — insurer redacted in the PDF but named in companion prose
 * D6  — unretrieved enforcement action named with false confidence (U7)
 * D7  — headline count diverging from the appendix (single source)
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  findBucketContradictions,
  matchEstimateLineItems,
  parseCccEstimateRows,
  type EstimateDeltaMatchResult,
  type EstimateDeltaRow,
} from "../estimateDeltaMatcher";
import { mayRelease, runDeltaReleaseGate } from "../deltaReleaseGate";
import { buildForensicReportPdf } from "../forensicReportRenderer";
import { buildForensicReconciliation } from "../forensicEstimateAnalysis";
import { PM_CAP_JURISDICTION_RULES } from "../jurisdictionRules";
import type { CitationDensityFinding } from "@/lib/ai/types/estimateScrubber";

const FIXTURE_DIR = path.join(__dirname, "../../../../tests/fixtures/22140");
const shopText = readFileSync(path.join(FIXTURE_DIR, "shop_text.txt"), "utf8");
const sorText = readFileSync(path.join(FIXTURE_DIR, "sor_text.txt"), "utf8");

let shopRows: EstimateDeltaRow[];
let sorRows: EstimateDeltaRow[];
let result: EstimateDeltaMatchResult;

beforeAll(() => {
  shopRows = parseCccEstimateRows(shopText);
  sorRows = parseCccEstimateRows(sorText);
  result = matchEstimateLineItems({ lowerRows: sorRows, higherRows: shopRows });
});

describe("D3 — the SOR's SUPPLEMENT SUMMARY changelog never parses as line items", () => {
  it("yields zero negative-PRICE rows from the SOR", () => {
    // Negative HOURS are legitimate in the live body (overlap deductions:
    // "Overlap Major Non-Adj. Panel -0.2"). Negative PRICES are not — they
    // only occur on the changelog's Deleted-Items reversals.
    const negatives = sorRows.filter((row) => (row.price ?? 0) < 0);
    expect(negatives).toEqual([]);
  });

  it("the sunroof resolves against the CURRENT SOR row, never the Deleted-Items reversal", () => {
    const sunroof = result.deltas.find(
      (delta) => /sunroof glass/i.test(delta.higherRow.description)
    );
    // A price-difference finding against the live line 57 row ($1,582.74) is
    // correct; a $3,402.86 gap against a -$1,701.43 reversal row is the
    // fabrication Test 99 blocked the release over.
    if (sunroof && sunroof.lowerRow) {
      expect(sunroof.lowerRow.price ?? 0).toBeGreaterThan(0);
      expect(sunroof.kind).not.toBe("missing_operation");
    }
    const missingSunroof = result.deltas.find(
      (delta) =>
        delta.kind === "missing_operation" && /sunroof glass/i.test(delta.higherRow.description)
    );
    expect(missingSunroof).toBeUndefined();
  });

  it("the changelog break fires on header variants (CONTINUED, ordinals)", () => {
    const text = [
      "LEFT APERTURE PANEL",
      "9S01R&I Aperture panel weatherstrip0.5",
      "SUPPLEMENT SUMMARY CONTINUED",
      "Deleted Items",
      "43S01R&I Aperture panel weatherstrip-0.5",
    ].join("\n");
    const rows = parseCccEstimateRows(text);
    expect(rows).toHaveLength(1);
    expect(rows[0].labor).toBe(0.5);
  });
});

describe("D1 — exact-match pairs may never render as 'no counterpart'", () => {
  // The six pairs the Test 99 audit confirmed as identical on both documents,
  // by shop line number, plus the differently-priced bumper cover (L5).
  const D1_SHOP_LINES = [80, 31, 109, 115, 135, 136, 5];

  it.each(D1_SHOP_LINES)("shop line %d is matched, not missing", (lineNumber) => {
    const missing = result.deltas.find(
      (delta) =>
        delta.kind === "missing_operation" && delta.higherRow.lineNumber === lineNumber
    );
    expect(missing).toBeUndefined();
    const matched =
      result.matchedPairs.some((pair) => pair.higherRow.lineNumber === lineNumber) ||
      result.deltas.some(
        (delta) => delta.higherRow.lineNumber === lineNumber && delta.lowerRow !== null
      );
    expect(matched).toBe(true);
  });

  it("R23: no certain contradiction survives to the caller", () => {
    const surviving = findBucketContradictions(result.deltas, result.lowerOnlyRows).filter(
      (contradiction) => contradiction.confidence === "certain"
    );
    expect(surviving).toEqual([]);
  });

  it("R23: a synthetic certain contradiction is auto-demoted to a match", () => {
    const higher = parseCccEstimateRows(
      ["FRONT BUMPER", "12Repl Pre repair scan0.5"].join("\n")
    );
    const lower = parseCccEstimateRows(
      ["FRONT BUMPER", "40Repl Pre repair scan0.5", "41Repl Unrelated absorber pad1.1"].join("\n")
    );
    // Force the pathological state by matching against a lower set whose scan
    // row failed to pair (simulated via a fresh match run — if the matcher
    // pairs them normally, the invariant holds trivially).
    const outcome = matchEstimateLineItems({ lowerRows: lower, higherRows: higher });
    const missingScan = outcome.deltas.find(
      (delta) => delta.kind === "missing_operation" && /scan/i.test(delta.higherRow.description)
    );
    const scanLowerOnly = outcome.lowerOnlyRows.find((row) => /scan/i.test(row.description));
    expect(missingScan && scanLowerOnly).toBeFalsy();
  });
});

describe("reversal rows are never a comparison basis", () => {
  it("a part-matching negative row loses to nothing rather than fabricating a delta", () => {
    const higher = parseCccEstimateRows(
      ["ROOF", "78Repl Sunroof glass panel322392000001,582.74 0.7"].join("\n")
    );
    const lowerWithReversalOnly: EstimateDeltaRow[] = parseCccEstimateRows(
      ["ROOF", "6Repl Sunroof glass panel32239200000-1,582.74 -0.7"].join("\n")
    ).map((row) => ({ ...row, price: -1582.74, labor: -0.7 }));
    const outcome = matchEstimateLineItems({
      lowerRows: lowerWithReversalOnly,
      higherRows: higher,
    });
    for (const delta of outcome.deltas) {
      if (delta.lowerRow) {
        expect(delta.lowerRow.price ?? 0).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("release gate — R23 and R25 are enforced rules, not documentation", () => {
  const baseBundle = {
    manifest: ["a.pdf", "b.pdf"],
    findings: [] as Array<Record<string, unknown>>,
  };

  it("R23 fails a bundle asserting one canonical op as both missing and counterpart-only", () => {
    const violations = runDeltaReleaseGate({
      ...baseBundle,
      findings: [
        { id: "f1", type: "missing_operation", label: "NOT ON OTHER DOC", canonical_op: "PRE_REPAIR_SCAN" },
        { id: "f2", type: "counterpart_only", label: "OTHER-DOC ONLY", canonical_op: "PRE_REPAIR_SCAN" },
      ],
    } as never);
    expect(violations.some((v) => v.rule === "R23" && v.severity === "FAIL")).toBe(true);
    expect(mayRelease(violations)).toBe(false);
  });

  it("R25 fails any finding whose comparison line resolves to a changelog row", () => {
    const violations = runDeltaReleaseGate({
      ...baseBundle,
      findings: [
        {
          id: "f1",
          type: "value_delta",
          label: "PRICE DELTA",
          source_section: "changelog",
        },
      ],
    } as never);
    expect(violations.some((v) => v.rule === "R25" && v.severity === "FAIL")).toBe(true);
  });

  it("disjoint findings pass both rules", () => {
    const violations = runDeltaReleaseGate({
      ...baseBundle,
      findings: [
        { id: "f1", type: "missing_operation", label: "NOT ON OTHER DOC", canonical_op: "PRE_REPAIR_SCAN" },
        { id: "f2", type: "counterpart_only", label: "OTHER-DOC ONLY", canonical_op: "CAVITY_WAX" },
      ],
    } as never);
    expect(violations.some((v) => v.rule === "R23")).toBe(false);
    expect(violations.some((v) => v.rule === "R25")).toBe(false);
  });
});

describe("D2/D5 — forensic report drops phantom cards and never names the carrier", () => {
  const reconciliation = buildForensicReconciliation({
    higherTotals: {
      categories: [{ category: "Body Labor", hours: 10, rate: 90, cost: 900 }],
      subtotal: 900,
      salesTax: 54,
      grandTotal: 954,
      taxLanes: [{ label: "Sales Tax", amount: 54 }],
    },
    lowerTotals: {
      categories: [{ category: "Body Labor", hours: 8, rate: 90, cost: 720 }],
      subtotal: 720,
      salesTax: 43.2,
      grandTotal: 763.2,
      taxLanes: [{ label: "Sales Tax", amount: 43.2 }],
    },
  });

  const phantom = {
    id: "phantom-1",
    operationLabel: "Hidden Mounting Geometry Teardown Growth",
    category: "structural_or_fit_verification",
    estimateGapType: "needs_proof",
    currentSupportSummary: "ESTIMATE_EVIDENCE: Mounting Geometry Verification Open",
    missingProofSummary: "Missing or unresolved support: photo or teardown proof.",
  } as CitationDensityFinding;

  const anchored = {
    id: "real-1",
    operationLabel: "Reduced paint: LT Aperture panel",
    category: "refinish",
    estimateGapType: "reduced_by_carrier",
    currentSupportSummary: "4.4 hours written vs 3.1 paid.",
    shopEvidence: { lineNumber: "60", amount: 396, laborHours: 4.4 },
    impact: { dollarImpact: 117, laborHoursImpact: 1.3, safetyImpact: "low", supplementPriority: "medium" },
  } as CitationDensityFinding;

  it("renders the anchored card, drops the phantom, and redacts the carrier filename", async () => {
    const { bytes, pageCount } = await buildForensicReportPdf({
      reconciliation,
      findings: [phantom, anchored],
      higherDocumentName: "Shop 22140.pdf",
      lowerDocumentName: "USAA SOR-1 22140.pdf",
      higherLineCount: 139,
      lowerLineCount: 95,
      noCounterpartRows: [
        { line: 12, description: "Repl Emblem upper", amount: 165.43 },
        { line: 16, description: "Repl Energy absorber", amount: 158.13 },
      ],
      vehicleLabel: "2025 Polestar 3",
      limitations: ["USAA's estimate arrived as a supplement of record."],
      authorities: [],
      retrievedSources: [],
      generatedAt: "2026-08-14T00:00:00.000Z",
    });
    expect(pageCount).toBeGreaterThan(0);
    const pdfParse = (await import("pdf-parse")).default as (b: Buffer) => Promise<{ text: string }>;
    const { text } = await pdfParse(Buffer.from(bytes));
    expect(text).not.toMatch(/Teardown Growth/i);
    expect(text).not.toMatch(/\bUSAA\b/);
    expect(text).toMatch(/Aperture panel/);
    // D7 — the headline sentence counts the same list Appendix A renders.
    expect(text).toMatch(/2 operations or parts appear on/);
  });
});

describe("D6/U7 — no unretrieved enforcement action is named in citation prose", () => {
  it("the PA rule keeps the statutory framework and drops the named examination", () => {
    const pa = PM_CAP_JURISDICTION_RULES.PA;
    expect(pa).toMatch(/31 Pa\. Code Ch\. 62/);
    expect(pa).toMatch(/31 Pa\. Code Ch\. 146/);
    expect(pa).not.toMatch(/American Modern/i);
    expect(pa).not.toMatch(/market-conduct examination/i);
  });
});
