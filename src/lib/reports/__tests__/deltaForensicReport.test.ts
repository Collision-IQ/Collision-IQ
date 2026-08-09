/**
 * The forensic report's contract is what it may and may not say. These tests
 * hold the three rules that survive a change of claim: the vocabulary stays
 * pair-agnostic, no dollar figure appears that a finding did not carry, and
 * nothing that was capped or unquantified disappears without being counted.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  buildDeltaForensicReportModel,
  type DeltaForensicReportInput,
  type ForensicBlock,
  type ForensicFindingRecord,
  type ForensicSection,
} from "../deltaForensicReport";
import { loadCollisionIqLogo, renderDeltaForensicReport } from "../deltaForensicReportRenderer";
import { findBannedPhrases } from "../deltaWording";
import type { CitationDensityFinding } from "@/lib/ai/types/estimateScrubber";

function makeFinding(overrides: Partial<CitationDensityFinding> = {}): CitationDensityFinding {
  return {
    id: "citation-density-1",
    operationLabel: "Operation under review",
    category: "other",
    estimateGapType: "missing_from_carrier",
    impact: { safetyImpact: "medium", supplementPriority: "medium" },
    citationStatus: {
      oem: "needed",
      pPages: "needed",
      scrs: "needed",
      deg: "needed",
      nhtsa: "needed",
      stateRegulation: "needed",
      policy: "needed",
      invoiceOrCompletionProof: "needed",
      photoOrTeardownProof: "needed",
    },
    citationDensityScore: 30,
    verifiedAuthorityCount: 0,
    missingAuthorityTypes: [],
    currentSupportSummary: "Summary of what the two documents show.",
    missingProofSummary: "Documentation that would settle it.",
    recommendedNextAction: "What to do next.",
    confidence: "medium",
    limitations: [],
    ...overrides,
  } as CitationDensityFinding;
}

function baseInput(overrides: Partial<DeltaForensicReportInput> = {}): DeltaForensicReportInput {
  return {
    reportTitle: "Forensic Estimate Analysis and Repair Cost Gap Report",
    reportShortTitle: "Delta Citation Density",
    subject: { fileName: "Subject.pdf", estimateRole: "shop_final", total: 20000 },
    comparisons: [{ fileName: "Comparison.pdf", estimateRole: "shop_initial", total: 15000 }],
    anchored: [],
    unanchored: [],
    generatedAt: "2026-08-06T00:00:00.000Z",
    ...overrides,
  };
}

/** Every string a reader could see, flattened. */
function readableText(sections: ForensicSection[]): string {
  const fromBlock = (block: ForensicBlock): string[] => {
    switch (block.kind) {
      case "paragraph":
      case "note":
      case "subheading":
        return [block.text];
      case "bullets":
      case "steps":
        return block.items;
      case "callout":
        return block.paragraphs;
      case "table":
        return [
          ...block.columns.map((column) => column.header),
          ...block.rows.flatMap((row) => row.cells),
        ];
    }
  };
  return sections
    .flatMap((section) => [section.title, ...section.blocks.flatMap(fromBlock)])
    .join("\n");
}

function currencyIn(text: string): string[] {
  return (text.match(/\$\s?-?\d[\d,]*(?:\.\d{2})?/g) ?? []).map((value) =>
    value.replace(/[$,\s]/g, "")
  );
}

describe("delta forensic report model", () => {
  it("never names a carrier on a shop-to-shop pair", () => {
    const model = buildDeltaForensicReportModel(
      baseInput({
        subject: { fileName: "Shop Final.pdf", estimateRole: "shop_final", total: 20000 },
        comparisons: [{ fileName: "Shop Initial.pdf", estimateRole: "shop_initial", total: 15000 }],
        anchored: [
          {
            markerNumber: 1,
            finding: makeFinding({
              deltaClass: "PRESENT_ONLY_IN_SOURCE",
              impact: { dollarImpact: 250, safetyImpact: "low", supplementPriority: "low" },
              shopEvidence: { lineNumber: "17", description: "Rear crossmember", amount: 250 },
            }),
          },
        ],
      })
    );

    const text = `${model.title} ${model.subtitle} ${readableText(model.sections)}`;
    expect(text).not.toMatch(/carrier|insurer|insurance compan/i);
    expect(text).toMatch(/initial shop estimate/i);
  });

  it("emits none of the release gate's banned phrases", () => {
    const model = buildDeltaForensicReportModel(
      baseInput({
        anchored: [
          { markerNumber: 1, finding: makeFinding({ deltaClass: "PRESENT_ONLY_IN_SOURCE" }) },
          { markerNumber: 2, finding: makeFinding({ id: "citation-density-2", deltaClass: "VALUE_CHANGED" }) },
        ],
      })
    );
    expect(findBannedPhrases(readableText(model.sections))).toEqual([]);
  });

  it("prints no dollar figure that no finding or estimate total carried", () => {
    const model = buildDeltaForensicReportModel(
      baseInput({
        anchored: [
          {
            markerNumber: 1,
            finding: makeFinding({
              impact: { dollarImpact: 1203.26, safetyImpact: "high", supplementPriority: "high" },
              shopEvidence: { lineNumber: "5", description: "Radar sensor", amount: 1203.26 },
            }),
          },
        ],
      })
    );

    // 20000 and 15000 are the two totals; 5000 their difference; 1203.26 the
    // one finding. Nothing else may appear.
    const allowed = new Set(["20000.00", "15000.00", "5000.00", "1203.26"]);
    for (const value of currencyIn(readableText(model.sections))) {
      expect(allowed.has(value), `unexpected currency ${value}`).toBe(true);
    }
  });

  it("counts unquantified differences instead of dropping them out of the totals", () => {
    const model = buildDeltaForensicReportModel(
      baseInput({
        anchored: [
          {
            markerNumber: 1,
            finding: makeFinding({
              impact: { dollarImpact: 100, safetyImpact: "low", supplementPriority: "low" },
            }),
          },
          {
            markerNumber: 2,
            finding: makeFinding({ id: "citation-density-2", operationLabel: "Seam sealer" }),
          },
        ],
      })
    );
    const text = readableText(model.sections);
    expect(text).toMatch(/Appendix C/);
    expect(text).toMatch(/1 difference is documented in Appendix C/);
    expect(text).toMatch(/An absent amount is not a zero amount/);
  });

  it("names an authority only when one was retrieved", () => {
    const model = buildDeltaForensicReportModel(
      baseInput({
        anchored: [
          {
            markerNumber: 1,
            finding: makeFinding({
              bestAvailableAuthority: {
                type: "oem_position_statement",
                status: "referenced_not_produced",
                title: "A statement nobody produced",
                confidence: "low",
              },
            }),
          },
          {
            markerNumber: 2,
            finding: makeFinding({
              id: "citation-density-2",
              bestAvailableAuthority: {
                type: "oem_procedure",
                status: "verified",
                title: "Retrieved OEM procedure",
                confidence: "high",
              },
              matchedDocumentUrl: "https://example.test/procedure",
            }),
          },
        ],
      })
    );
    const text = readableText(model.sections);
    expect(text).toMatch(/Retrieved OEM procedure/);
    expect(text).not.toMatch(/A statement nobody produced/);
    expect(text).toMatch(/verification required/i);
  });

  it("redacts identity in the header to the download policy", () => {
    const model = buildDeltaForensicReportModel(
      baseInput({
        claimContext: {
          vin: "JTHD81F29P5050559",
          claimNumber: "26-232003028-01",
          vehicle: "2023 Lexus IS 300",
        },
      })
    );
    const vin = model.identity.find((entry) => entry.label === "VIN")?.value ?? "";
    const claim = model.identity.find((entry) => entry.label === "Claim number")?.value ?? "";
    expect(vin).toBe("JTHD81F29********");
    expect(claim).not.toContain("232003028");
  });

  it("does not print a zero difference for a line that carries no basis", () => {
    const model = buildDeltaForensicReportModel(
      baseInput({
        anchored: [
          {
            markerNumber: 1,
            finding: makeFinding({
              // What a detector emits for an operation with no printed figures.
              impact: { laborHoursImpact: 0, safetyImpact: "medium", supplementPriority: "medium" },
              shopEvidence: { lineNumber: "233", description: "Calibrate blind spot radar" },
            }),
          },
        ],
      })
    );
    const text = readableText(model.sections);
    expect(text).not.toMatch(/0\.0 hrs/);
    expect(text).not.toMatch(/Difference[\s\S]{0,40}not quantified[\s\S]{0,10}0\.0/);
  });

  it("keeps pipeline provenance out of the reader-facing limitations", () => {
    const model = buildDeltaForensicReportModel(
      baseInput({
        anchored: [
          {
            markerNumber: 1,
            finding: makeFinding({
              limitations: [
                "Required estimator detector generated from an extracted estimate row.",
                "sourcePdfHash:75ec1f1eaac151e8588e66b3a6786acebfc0d15892d050f5b9c3a03b",
                "artifactVersion:citation-density-part-source-relevance-v1",
              ],
            }),
          },
        ],
      })
    );
    const text = readableText(model.sections);
    expect(text).toMatch(/Required estimator detector generated from an extracted estimate row/);
    expect(text).not.toMatch(/sourcePdfHash/);
    expect(text).not.toMatch(/artifactVersion/);
  });

  it("states that no comparison was made when only one estimate was parsed", () => {
    const model = buildDeltaForensicReportModel(
      baseInput({ comparisons: [], anchored: [{ markerNumber: 1, finding: makeFinding() }] })
    );
    expect(readableText(model.sections)).toMatch(/Only one estimate was parsed/);
  });

  it("reconciles from the canonical delta set's own category subtotals when present", () => {
    const model = buildDeltaForensicReportModel(
      baseInput({
        canonicalDeltaSet: {
          id: "set-1",
          initialFileHash: "sha256:a",
          supplementFileHash: "sha256:b",
          estimatePairKind: "shop_to_shop",
          estimateFiles: {
            initial: { fileHash: "sha256:a", filename: "Initial.pdf", total: 15000, insurer: null },
            supplement: { fileHash: "sha256:b", filename: "Final.pdf", total: 20000, insurer: null },
            insuredName: null,
            ownerName: null,
          },
          deltas: [],
          reconciliation: {
            method: "category_subtotal",
            categoryDeltas: { "BODY LABOR": -3000, PARTS: -1750 },
            subtotalDelta: -4750,
            taxDelta: -250,
            grandTotalDelta: -5000,
          },
          displayThreshold: {
            valueChangeDollarFloor: 1,
            valueChangeLaborFloorHours: 0.1,
            appliesTo: ["VALUE_CHANGE"],
            neverSuppress: ["PRESENCE"],
          },
          createdAt: "2026-08-06T00:00:00.000Z",
        },
        anchored: [{ markerNumber: 1, finding: makeFinding() }],
      })
    );
    const text = readableText(model.sections);
    expect(text).toMatch(/BODY LABOR/);
    expect(text).toMatch(/Grand total change/);
    expect(text).toMatch(/estimates' own category subtotals/);
  });
});

describe("delta forensic report renderer", () => {
  it("renders every section without throwing and stays inside the page", async () => {
    const records: ForensicFindingRecord[] = Array.from({ length: 12 }, (_, index) => ({
      markerNumber: index + 1,
      finding: makeFinding({
        id: `citation-density-${index + 1}`,
        operationLabel: `Operation ${index + 1} with a deliberately long label that must wrap across the column`,
        category: index % 2 === 0 ? "adas_calibration" : "parts_downgrade",
        deltaClass: index % 3 === 0 ? "PRESENT_ONLY_IN_SOURCE" : "VALUE_CHANGED",
        impact: { dollarImpact: 100 + index, safetyImpact: "high", supplementPriority: "high" },
        shopEvidence: { lineNumber: String(index), description: "Subject line", amount: 200 + index },
        carrierEvidence: { lineNumber: String(index), description: "Comparison line", amount: 100 },
      }),
    }));

    const model = buildDeltaForensicReportModel(
      baseInput({ anchored: records, warnings: ["A warning worth repeating."] })
    );

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
    const logo = await loadCollisionIqLogo(doc);
    const pages = renderDeltaForensicReport(doc, model, { font, boldFont, logo });

    expect(pages).toBe(doc.getPageCount());
    expect(pages).toBeGreaterThan(1);
    for (const page of doc.getPages()) {
      expect(page.getWidth()).toBe(612);
      expect(page.getHeight()).toBe(792);
    }
    expect((await doc.save()).byteLength).toBeGreaterThan(1000);
  });

  it("falls back to a typeset mark rather than failing when the logo is unavailable", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
    const model = buildDeltaForensicReportModel(baseInput({ anchored: [{ markerNumber: 1, finding: makeFinding() }] }));
    expect(() => renderDeltaForensicReport(doc, model, { font, boldFont, logo: null })).not.toThrow();
    expect(doc.getPageCount()).toBeGreaterThan(0);
  });

  it("draws text that contains characters outside WinAnsi", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
    const model = buildDeltaForensicReportModel(
      baseInput({
        anchored: [
          {
            markerNumber: 1,
            finding: makeFinding({
              operationLabel: "Repl “quarter panel” — one‑time use … 交流",
              currentSupportSummary: "Curly ‘quotes’ and an em—dash and a CJK run 交流.",
            }),
          },
        ],
      })
    );
    expect(() => renderDeltaForensicReport(doc, model, { font, boldFont, logo: null })).not.toThrow();
  });
});
