/**
 * Forensic findings and Appendix A: one printed line, one location, its own
 * numbers.
 *
 * RO 22120 review: the forensic aggregate-vs-member merge keyed on the
 * description base, which ignores side AND position. The shop's "RT/Front R&I
 * wheel" and "RT/Rear R&I wheel" (0.2 M each) became one finding titled with
 * the front wheel and carrying 0.4 hr, and Appendix A ("line items, as
 * printed") listed only the front line; the LT/Front and LT/Rear tires
 * ($454.26 each) did the same. A genuine LT/RT side group at one position
 * ("RT Wheelhouse liner" / "LT Wheelhouse liner", 0.3 each) stayed one
 * finding, but Appendix A showed it as a single row at 0.3 under the merged
 * label.
 *
 * Lines are de-identified, in the prints' shapes.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  buildAnnotatedCitationDensityEstimatePdf,
  buildRequiredEstimatorDeltaFindings,
} from "../annotatedCitationDensityEstimate";
import { buildForensicReportPdf } from "../forensicReportRenderer";

type Generated = ReturnType<typeof buildRequiredEstimatorDeltaFindings>;

const HEADER = ["SYNTHETIC COLLISION", "2026 Synthetic SUV AWD", "Total Cost of Repairs $2,000.00"];
const SHOP_LINES = [
  "5 Repl Bumper cover SYN0009 1 400.00 2.5",
  "28 WHEELS",
  "29 * R&I RT/Front R&I wheel 0 0.00 0.2 M",
  "31 * R&I RT/Rear R&I wheel 0 0.00 0.2 M",
  "33 # Repl LT/Front Touring tire 255/45R19 1 454.26 0.0",
  "34 # LT/Rear Touring tire 255/45R19 1 454.26 0.0",
  "46 R&I RT Wheelhouse liner 0 0.00 0.3",
  "47 R&I LT Wheelhouse liner 0 0.00 0.3",
];
const CARRIER_LINES = ["Total Cost of Repairs $1,000.00", "5 Repl Bumper cover SYN0009 1 400.00 2.5"];

async function pdf(lines: string[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  [...HEADER, ...lines].forEach((line, index) => page.drawText(line, { x: 42, y: 752 - index * 16, size: 9, font }));
  return doc.save();
}

async function generate(shopLines: string[] = SHOP_LINES): Promise<Generated> {
  let generated: Generated | null = null;
  await buildAnnotatedCitationDensityEstimatePdf({
    sourcePdfBytes: await pdf(shopLines),
    sourcePdfName: "shop.pdf",
    sourceDocumentId: "shop",
    sourceText: [...HEADER, ...shopLines].join("\n"),
    comparisonEstimateTexts: [
      { fileName: "carrier.pdf", sourceDocumentId: "carrier", estimateRole: "carrier", text: CARRIER_LINES.join("\n") },
    ],
    findings: [],
    findingGenerator: (context) => {
      generated = buildRequiredEstimatorDeltaFindings(context);
      return generated;
    },
    jurisdiction: "PA",
    request: { includeLegend: false, annotationMode: "both", estimateRole: "shop" },
  });
  if (!generated) throw new Error("finding generator did not run");
  return generated;
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return pages.join("\n").replace(/\s+/g, " ");
}

describe("forensic merge: only an LT/RT side group at one position is one finding", { timeout: 60_000 }, () => {
  it("front and rear lines on the same side stay separate findings with their own hours", async () => {
    const forensic = (await generate()).forensic!;
    const missing = forensic.rows.deltas.filter((delta) => delta.kind === "missing_operation");
    const byLine = (line: number) => missing.find((delta) => delta.higherRow.lineNumber === line);

    // RT/Front and RT/Rear R&I wheel: two findings, 0.2 hr each, each its own label.
    expect(byLine(29)).toMatchObject({ laborDelta: 0.2, higherRow: expect.objectContaining({ description: "RT/Front R&I wheel" }) });
    expect(byLine(31)).toMatchObject({ laborDelta: 0.2, higherRow: expect.objectContaining({ description: "RT/Rear R&I wheel" }) });
    expect(byLine(29)?.mergedMembers).toBeUndefined();
    expect(byLine(31)?.mergedMembers).toBeUndefined();
    // LT/Front and LT/Rear tires: two findings, $454.26 each.
    expect(byLine(33)?.priceDelta).toBe(454.26);
    expect(byLine(34)?.priceDelta).toBe(454.26);

    // RT/LT wheelhouse liner at one location: one side-group finding, 0.6 aggregate.
    const liner = missing.find((delta) => /Wheelhouse liner/.test(delta.higherRow.description));
    expect(liner?.higherRow.description).toBe("Wheelhouse liner (both sides, L46/L47)");
    expect(liner?.laborDelta).toBe(0.6);
    expect(liner?.mergedMembers?.map((member) => member.higherLine)).toEqual([46, 47]);
    expect(missing.filter((delta) => /Wheelhouse liner/.test(delta.higherRow.description))).toHaveLength(1);
  });

  it("Appendix A lists one row per printed line, each with that line's own hours and price", async () => {
    const forensic = (await generate()).forensic!;
    const rows = [...forensic.noCounterpartRows].sort((a, b) => Number(a.line) - Number(b.line));
    expect(rows.map((row) => [row.line, row.description, row.laborHours, row.amount])).toEqual([
      [29, "R&I RT/Front R&I wheel", 0.2, 0],
      [31, "R&I RT/Rear R&I wheel", 0.2, 0],
      [33, "Repl LT/Front Touring tire 255/45R19", 0, 454.26],
      [34, "LT/Rear Touring tire 255/45R19", 0, 454.26],
      [46, "R&I RT Wheelhouse liner", 0.3, 0],
      [47, "R&I LT Wheelhouse liner", 0.3, 0],
    ]);
  });

  it("the rendered headline count equals the Appendix A rows, and the scope sentence names what the appendix holds", async () => {
    const forensic = (await generate()).forensic!;
    const result = await buildForensicReportPdf({
      reconciliation: forensic.reconciliation,
      findings: [],
      higherDocumentName: "shop.pdf",
      lowerDocumentName: "carrier.pdf",
      higherLineCount: forensic.higherLineCount,
      lowerLineCount: forensic.lowerLineCount,
      noCounterpartRows: forensic.noCounterpartRows,
      vehicleLabel: "Synthetic test vehicle",
      limitations: [],
      authorities: [],
      retrievedSources: [],
      generatedAt: "2026-10-05T00:00:00.000Z",
    });
    const text = await pdfText(result.bytes);
    expect(text).toMatch(/6 operations or parts appear on shop\.pdf with no counterpart on carrier\.pdf/);
    expect(text).toMatch(/6 line items, as printed on shop\.pdf/);
    expect(text).toMatch(/31 R&I RT\/Rear R&I wheel 0\.2 M — \$0\.00/);
    expect(text).toMatch(/34 LT\/Rear Touring tire 255\/45R19 — — \$454\.26/);
    expect(text).toMatch(/46 R&I RT Wheelhouse liner 0\.3 — \$0\.00/);
    expect(text).toMatch(/47 R&I LT Wheelhouse liner 0\.3 — \$0\.00/);
    expect(text).not.toMatch(/the appendix lists every affected line/);
    expect(text).toMatch(/Appendix A lists, one row per printed line, every line of the higher estimate with no counterpart/);
  });

  it("an LT/RT side group at every position (LT/RT × Front/Rear) stays one finding; Appendix A lists all four lines", async () => {
    const forensic = (
      await generate([
        "5 Repl Bumper cover SYN0009 1 400.00 2.5",
        "58 WHEELS",
        "60 Repl LT Front mud flap SYN0060 1 25.00 0.3",
        "61 Repl RT Front mud flap SYN0061 1 25.00 0.3",
        "62 Repl LT Rear mud flap SYN0062 1 25.00 0.3",
        "63 Repl RT Rear mud flap SYN0063 1 25.00 0.3",
      ])
    ).forensic!;
    const flaps = forensic.rows.deltas.filter((delta) => /mud flap/i.test(delta.higherRow.description));
    expect(flaps).toHaveLength(1);
    expect(flaps[0].mergedMembers?.map((member) => member.higherLine)).toEqual([60, 61, 62, 63]);
    expect(flaps[0].higherRow.description).toBe("mud flap (both sides × front/rear, L60/L61/L62/L63)");
    expect(flaps[0].laborDelta).toBe(1.2);
    expect(forensic.noCounterpartRows.map((row) => [row.line, row.laborHours])).toEqual([
      [60, 0.3],
      [61, 0.3],
      [62, 0.3],
      [63, 0.3],
    ]);
  });

  it("a position with only one side splits from the side pair at the other position", async () => {
    const forensic = (
      await generate([
        "5 Repl Bumper cover SYN0009 1 400.00 2.5",
        "58 WHEELS",
        "60 Repl LT Front mud flap SYN0060 1 25.00 0.3",
        "61 Repl RT Front mud flap SYN0061 1 25.00 0.3",
        "62 Repl LT Rear mud flap SYN0062 1 25.00 0.3",
      ])
    ).forensic!;
    const flaps = forensic.rows.deltas.filter((delta) => /mud flap/i.test(delta.higherRow.description));
    expect(flaps.map((delta) => [delta.higherRow.description, delta.laborDelta]).sort()).toEqual([
      ["Front mud flap (both sides, L60/L61)", 0.6],
      ["LT Rear mud flap", 0.3],
    ]);
    expect(forensic.noCounterpartRows.map((row) => row.line).sort()).toEqual([60, 61, 62]);
  });
});
