/**
 * The wheel-access finding claims the CARRIER's sheet may be missing wheel
 * R&I / access labor and asks for it line by line. Its premise therefore
 * needs a carrier sheet without an access line for that wheel.
 *
 * RO 22120 (shop preliminary vs carrier SOR 2, reviewed 2026-10-04): on a
 * shop run the detector fired on the shop's LT/Front and LT/Rear wheels while
 * the carrier's sheet printed "LT/Front R&I wheel" and "LT/Rear R&I wheel"
 * (glued in its text layer: "28S02R&ILT/Front R&I wheel00.00m0.10.0"). The
 * trigger read comparison access lines as support for the claim, which holds
 * on a carrier run (the comparison is the shop's) and is backwards on a shop
 * run (the comparison is the carrier's).
 *
 * Lines are de-identified, in the prints' shapes.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { CitationDensityFinding } from "@/lib/ai/types/estimateScrubber";
import {
  buildAnnotatedCitationDensityEstimatePdf,
  buildRequiredEstimatorDeltaFindings,
  wheelPositionsConflict,
} from "../annotatedCitationDensityEstimate";

const HEADER = ["SYNTHETIC COLLISION", "2026 Tesla Model Y AWD", "Total Cost of Repairs $2,000.00"];
const SHOP_WHEELS = [
  "28 WHEELS",
  '30 Repl LT/Front Wheel, alloy 19" SYN0001 1 700.00 0.0',
  '32 Repl LT/Rear Wheel, alloy 19" SYN0001 1 700.00 0.0',
  "45 Repl LT Hub assy SYN0003 1 330.00 1.6 M",
];
const CARRIER_BASE = ["5 Repl Bumper cover SYN0009 1 400.00 2.5"];

async function pdf(lines: string[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  [...HEADER, ...lines].forEach((line, index) => page.drawText(line, { x: 42, y: 752 - index * 16, size: 9, font }));
  return doc.save();
}

async function wheelAccessFindings(params: {
  subjectLines: string[];
  subjectRole: "shop" | "carrier";
  comparisonLines: string[];
}): Promise<CitationDensityFinding[]> {
  let generated: CitationDensityFinding[] = [];
  const comparisonRole = params.subjectRole === "shop" ? "carrier" : "shop";
  await buildAnnotatedCitationDensityEstimatePdf({
    sourcePdfBytes: await pdf(params.subjectLines),
    sourcePdfName: `${params.subjectRole}.pdf`,
    sourceDocumentId: params.subjectRole,
    sourceText: [...HEADER, ...params.subjectLines].join("\n"),
    comparisonEstimateTexts: [
      {
        fileName: `${comparisonRole}.pdf`,
        sourceDocumentId: comparisonRole,
        estimateRole: comparisonRole,
        text: ["Total Cost of Repairs $1,000.00", ...params.comparisonLines].join("\n"),
      },
    ],
    findings: [],
    findingGenerator: (context) => {
      const result = buildRequiredEstimatorDeltaFindings(context);
      generated = result.findings;
      return result;
    },
    jurisdiction: "PA",
    request: { includeLegend: false, annotationMode: "both", estimateRole: params.subjectRole },
  });
  return generated.filter((finding) => /wheel_labor_delta/.test(finding.id ?? ""));
}

describe("wheel-access finding: the carrier's own access lines answer it", { timeout: 60_000 }, () => {
  it("shop run, carrier sheet with no wheel access line: raised", async () => {
    expect(await wheelAccessFindings({ subjectLines: SHOP_WHEELS, subjectRole: "shop", comparisonLines: CARRIER_BASE })).toHaveLength(1);
  });

  it("shop run, carrier R&I at the same wheels (glued text layer, RO 22120's shape): not raised", async () => {
    const findings = await wheelAccessFindings({
      subjectLines: SHOP_WHEELS,
      subjectRole: "shop",
      comparisonLines: [...CARRIER_BASE, "28S02R&ILT/Front R&I wheel00.00m0.10.0", "29S02R&ILT/Rear R&I wheel00.00m0.10.0"],
    });
    expect(findings).toEqual([]);
  });

  it("shop run, carrier R&I at the same wheels (clean text): not raised", async () => {
    const findings = await wheelAccessFindings({
      subjectLines: SHOP_WHEELS,
      subjectRole: "shop",
      comparisonLines: [...CARRIER_BASE, "28 R&I LT/Front R&I wheel 0 0.00 0.1", "29 R&I LT/Rear R&I wheel 0 0.00 0.1"],
    });
    expect(findings).toEqual([]);
  });

  it("shop run, carrier R&I only at the other side's wheels: still raised", async () => {
    const findings = await wheelAccessFindings({
      subjectLines: SHOP_WHEELS,
      subjectRole: "shop",
      comparisonLines: [...CARRIER_BASE, "28 R&I RT/Front R&I wheel 0 0.00 0.1", "29 R&I RT/Rear R&I wheel 0 0.00 0.1"],
    });
    expect(findings).toHaveLength(1);
  });

  it("carrier run, the carrier's own R&I line at that wheel answers it", async () => {
    // The same wheel line on both sheets, so no line-level difference covers
    // it; only the shop writes the R&I.
    const carrierWheel = ['30 Repl LT/Front Wheel, alloy 19" SYN0001 1 700.00 0.0'];
    const shopAccess = ['30 Repl LT/Front Wheel, alloy 19" SYN0001 1 700.00 0.0', "29 R&I LT/Front R&I wheel 0 0.00 0.2 M"];
    expect(
      await wheelAccessFindings({ subjectLines: carrierWheel, subjectRole: "carrier", comparisonLines: shopAccess })
    ).toHaveLength(1);
    expect(
      await wheelAccessFindings({
        subjectLines: [...carrierWheel, "28 R&I LT/Front R&I wheel 0 0.00 0.1"],
        subjectRole: "carrier",
        comparisonLines: shopAccess,
      })
    ).toEqual([]);
  });
});

describe("wheel positions", () => {
  it("front/rear and left/right conflict only when both lines name that axis", () => {
    expect(wheelPositionsConflict("28 r i lt front r i wheel", "30 repl lt front wheel alloy 19")).toBe(false);
    expect(wheelPositionsConflict("29 r i lt rear r i wheel", "30 repl lt front wheel alloy 19")).toBe(true);
    expect(wheelPositionsConflict("28 r i rt front r i wheel", "30 repl lt front wheel alloy 19")).toBe(true);
    // Glued "R&ILT" leaves no side: only the axle can conflict.
    expect(wheelPositionsConflict("28s02r ilt front r i wheel00.00m0.10.0", "30 repl lt front wheel")).toBe(false);
    expect(wheelPositionsConflict("four wheel alignment", "30 repl lt front wheel")).toBe(false);
  });
});
