import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  buildAnnotatedCitationDensityEstimatePdf,
  buildRequiredEstimatorDeltaFindings,
} from "../annotatedCitationDensityEstimate";
import { buildCanonicalDeltaSet } from "../canonicalDelta";
import { buildRo21896CanonicalDeltaSet } from "../ro21896CanonicalDelta";

async function createRo21896SourcePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = [
    [
      "Shop 21896.pdf",
      "CONESTOGA COLLISION CENTER",
      "Written By: Vincent Menichetti",
      "Customer: OLIVARES, ESMON",
      "Insurance Company: USAA",
      "Net Cost of Repairs $11,892.26",
      "14 Repl LT/Rear wheel 938.27",
      "15 Four-wheel alignment 268.00",
    ],
    [
      "24 Repl LT Wheelhouse liner retainer nut 111071300D 0.32",
      "27 Repl LT Wheel opng mldg 173255300A 140.00",
    ],
    [
      "36 Repl LT Wheelhouse high strength structural rivet 6.5mm 1454538-00-A 4.00",
      "38 Repl LT Wheelhouse flow form rivet S08 1069328-00-A 2.00",
      "39 Repl LT Wheelhouse flow form rivet S18 1069329-00-A 2.00",
      "40 Repl LT Outer wheelhouse bolt 100883301A 4.00",
      "41 Repl LT Outer wheelhouse nut 100662801A 4.00",
      "63 Repl LT Hub assy 104412300B 320.00 1.5 M",
    ],
    [
      "66 Repl LT Caliper assy bolt 108896800B 6.00",
      "67 Repl LT Axle nut 111555800A 10.00",
    ],
  ];

  pages.forEach((lines) => {
    const page = pdf.addPage([612, 792]);
    lines.forEach((line, index) => {
      page.drawText(line, { x: 42, y: 752 - index * 18, size: 10, font });
    });
  });

  return pdf.save();
}

async function extractPdfText(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({
    data: bytes.slice(),
    disableWorker: true,
    useSystemFonts: true,
  } as unknown as Parameters<typeof pdfjs.getDocument>[0]).promise;
  const chunks: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    chunks.push(...content.items.map((item) => ("str" in item ? item.str : "")));
  }
  return chunks.join(" ");
}

describe("RO21896 rendered Delta Citation Density contract", () => {
  it("renders canonical shop-to-shop deltas instead of legacy estimate-gap findings", async () => {
    const canonicalDeltaSet = buildRo21896CanonicalDeltaSet("test-rendered-ro21896");
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes: await createRo21896SourcePdf(),
      sourcePdfName: "Shop 21896.pdf",
      sourceDocumentId: "shop-21896",
      selectedEstimateTotal: 11892.26,
      uploadedFileNames: ["Shop 21896.pdf", "Shop Final 21896.pdf"],
      sourceText: [
        "Shop 21896.pdf",
        "Customer: OLIVARES, ESMON",
        "Insurance Company: USAA",
        "Net Cost of Repairs $11,892.26",
      ].join("\n"),
      comparisonEstimateTexts: [{
        fileName: "Shop Final 21896.pdf",
        sourceDocumentId: "shop-final-21896",
        estimateRole: "shop",
        text: [
          "Shop Final 21896.pdf",
          "CONESTOGA COLLISION CENTER",
          "Written By: Vincent Menichetti",
          "Customer: OLIVARES, ESMON",
          "Insurance Company: USAA",
          "Net Cost of Repairs $17,397.20",
          "15 Repl LT/Rear wheel 938.27",
          "16 Four-wheel alignment 268.00",
          "10 Repl TPMS sensor sensor & nut black 149070101D 60.00 Incl.",
          "64 O/H rr susp lt 3.3 M",
          "65 Repl LT Hub assy 104412300B 320.00 Incl. M",
          "70 Repl LT Upr control arm 118841200A 340.00 0.4 M",
          "72 Repl LT Link arm 118842300A 180.00 0.4 M",
          "73 Repl LT Lateral arm 118843400A 190.00 0.4 M",
          "75 Repl Suspension crossmember 1070.00 9.8 M",
          "80 Purge coolant and refill coolant 105.57",
          "90 Rpr Rear compartment panel 480.00 1.2",
          "91 Repl LT side bracket 95.00 0.3",
          "100 Service mode setup",
          "101 Firmware download",
          "102 In-process scan",
          "103 Camera calibration",
          "104 DTC research",
        ].join("\n"),
      }],
      findings: [],
      canonicalDeltaSet,
      findingGenerator: buildRequiredEstimatorDeltaFindings,
      request: {
        annotationMode: "both",
        estimateRole: "shop",
        includeLegend: false,
        includeUnanchoredAppendix: true,
      },
    });

    const metadataText = result.annotationMetadata
      .map((item) => `${item.findingId} ${item.shortTitle} ${item.comment} ${item.sourceAnchorText}`)
      .join(" ");
    const pdfText = await extractPdfText(result.bytes);
    const findingsText = result.findingsReportBytes ? await extractPdfText(result.findingsReportBytes) : "";
    const renderedText = `${metadataText} ${pdfText} ${findingsText}`;
    const firstRendered = result.annotationMetadata.slice(0, 6)
      .map((item) => `${item.findingId} ${item.shortTitle} ${item.sourceAnchorText}`)
      .join(" ");

    expect(result.debugTrace?.buildCommit).toBeTruthy();
    expect(renderedText).toMatch(/Canonical delta object:\s*test-rendered-ro21896|canonicalDeltaObjectId:test-rendered-ro21896/i);
    expect(renderedText).toMatch(/Canonical delta id:\s*D17|canonicalDeltaId:D17/i);
    expect(renderedText).toMatch(/Estimate pair kind:\s*shop_to_shop|estimatePairKind:shop_to_shop/i);
    expect(renderedText).toMatch(/Initial file hash:\s*sha256:initial-shop-21896-distinct|initialFileHash:sha256:initial-shop-21896-distinct/i);
    expect(renderedText).toMatch(/Supplement file hash:\s*sha256:final-shop-21896-distinct|supplementFileHash:sha256:final-shop-21896-distinct/i);
    expect(renderedText).toMatch(/Delta class:\s*PRESENT ONLY IN SUPPLEMENT/i);
    expect(renderedText).toMatch(/Evidence status:\s*ESTIMATE_GAP_ONLY/i);
    expect(renderedText).not.toMatch(/carrier estimate/i);
    expect(renderedText).not.toMatch(/required-detector-wheel_labor_delta/i);
    expect(renderedText).not.toMatch(/canonical-delta-[^\s]*wheel/i);
    expect(renderedText).not.toMatch(/canonical-delta-[^\s]*alignment/i);
    expect(firstRendered).not.toMatch(/wheel_labor_delta|CCC\/MOTOR|boilerplate/i);
    expect(renderedText).toMatch(/D17|crossmember/i);
    expect(renderedText).toMatch(/D09|rear suspension|rr susp/i);
    expect(renderedText).toMatch(/D13|control arm|cntl arm/i);
    expect(renderedText).toMatch(/D15|link arm/i);
    expect(renderedText).toMatch(/D16|lateral arm/i);
    expect(renderedText).toMatch(/D18|coolant/i);
    expect(renderedText).toMatch(/D20|compartment/i);
    expect(renderedText).toMatch(/D21|side bracket/i);
    expect(renderedText).toMatch(/D22|service mode/i);
    expect(renderedText).toMatch(/D23|firmware/i);
    expect(renderedText).toMatch(/D24|scan/i);
    expect(renderedText).toMatch(/D25|camera calibration/i);
    expect(renderedText).toMatch(/\$5,?504\.94|5504\.94/i);
  });

  it("renders carrier estimate wording when a carrier-authored header supports it", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([612, 792]);
    [
      "GEICO insurance estimate",
      "Prepared by Claims Adjuster Jane Smith",
      "Line 12 ADAS calibration 1.0 hrs $200.00",
    ].forEach((line, index) => page.drawText(line, { x: 42, y: 752 - index * 18, size: 10, font }));

    const canonicalDeltaSet = buildCanonicalDeltaSet({
      id: "carrier-shop-render-test",
      initialFileHash: "sha256:carrier-source",
      supplementFileHash: "sha256:shop-comparison",
      estimatePairKind: "carrier_to_shop",
      estimateFiles: {
        initial: {
          fileHash: "sha256:carrier-source",
          filename: "GEICO Estimate.pdf",
          total: 1000,
          insurer: "GEICO",
          estimateRole: "carrier_estimate",
          sourceDocumentId: "carrier-source",
        },
        supplement: {
          fileHash: "sha256:shop-comparison",
          filename: "Shop Supplement.pdf",
          total: 1300,
          insurer: "GEICO",
          estimateRole: "shop_supplement",
          sourceDocumentId: "shop-comparison",
        },
        insuredName: "TEST, USER",
        ownerName: "TEST, USER",
      },
      deltas: [{
        id: "C01",
        class: "VALUE_CHANGE",
        operation: "ADAS calibration",
        partNumber: null,
        anchorInitial: { page: 1, line: 12, desc: "ADAS calibration" },
        anchorFinal: { page: 1, line: 12, desc: "ADAS calibration" },
        oldValue: { price: 200 },
        newValue: { price: 350 },
        magnitudeDollar: 150,
        magnitudeLaborHrs: 0.5,
        category: "ADAS",
        render: true,
      }],
      reconciliation: {
        method: "category_subtotal",
        categoryDeltas: { ADAS: 300 },
        subtotalDelta: 300,
        taxDelta: 18,
        grandTotalDelta: 318,
      },
    });

    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes: await pdf.save(),
      sourcePdfName: "GEICO Estimate.pdf",
      sourceDocumentId: "carrier-source",
      uploadedFileNames: ["GEICO Estimate.pdf", "Shop Supplement.pdf"],
      sourceText: "GEICO insurance estimate\nPrepared by Claims Adjuster Jane Smith",
      comparisonEstimateTexts: [{
        fileName: "Shop Supplement.pdf",
        sourceDocumentId: "shop-comparison",
        estimateRole: "shop",
        text: "Conestoga Collision Center\nRepair Facility\nWritten By: Shop Writer\nSupplement",
      }],
      findings: [],
      canonicalDeltaSet,
      findingGenerator: buildRequiredEstimatorDeltaFindings,
      request: {
        annotationMode: "both",
        estimateRole: "carrier",
        includeLegend: false,
      },
    });

    const estimateText = await extractPdfText(result.bytes);
    const findingsText = result.findingsReportBytes ? await extractPdfText(result.findingsReportBytes) : "";
    const text = `${estimateText} ${findingsText}`;
    expect(text).toMatch(/Source estimate:\s*carrier estimate/i);
    expect(text).toMatch(/Comparison estimate:\s*shop supplement/i);
    expect(text).toMatch(/Evidence status:\s*ESTIMATE_GAP_ONLY/i);
  });
});
