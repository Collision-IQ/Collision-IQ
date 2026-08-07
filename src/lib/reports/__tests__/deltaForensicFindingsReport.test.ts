/**
 * The Findings Report as the pipeline actually produces it: forensic front
 * matter first, the per-finding detail records after it, one continuous page
 * count across both. The OEM report is not a two-estimate comparison and keeps
 * its plain cover — asserted here so the two reports cannot quietly converge.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  buildAnnotatedCitationDensityEstimatePdf,
  buildRequiredEstimatorDeltaFindings,
  OEM_CITATION_DENSITY_REPORT_IDENTITY,
} from "../annotatedCitationDensityEstimate";

const SUBJECT_HEADER = [
  "MODERN AUTO CRAFTERS",
  "Customer: PASLEY, DENISE",
  "Claim #: 26-232003028-01",
  "VIN: JTHD81F29P5050559",
  "2023 Lexus IS 300 AWD",
  "Net Cost of Repairs $28,840.26",
];

async function makeSubjectPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = [
    [
      ...SUBJECT_HEADER,
      "5 Repl RT Blind spot radar 8816253050 1203.26 1.6 M",
      "17 Sublet Wheel alignment 109.95",
      "155 Repl RT Side rail 5760153070 727.53 12.5",
    ],
    [
      "200 Repl RT Tail lamp assy 8155153351 887.55 0.5",
      "208 Repl Bumper cover 5215953955 583.50 2.5",
      "233 Calibrate blind spot radar 0.0 1.0 M",
    ],
  ];
  pages.forEach((lines) => {
    const page = pdf.addPage([612, 792]);
    lines.forEach((line, index) => {
      page.drawText(line, { x: 42, y: 752 - index * 16, size: 9, font });
    });
  });
  return pdf.save();
}

const COMPARISON_TEXT = [
  "Supplement of Record S2.pdf",
  "Customer: PASLEY, DENISE",
  "Claim #: 26-232003028-01",
  "Total Cost of Repairs $15,441.55",
  "31 Repl RT Side rail 57601-53070 727.53 2.5",
  "44 Repl RT Tail lamp assy AFTERMARKET L8308 553.85 0.5",
  "45 Repl Bumper cover AFTERMARKET 6256529 413.27 2.5",
].join("\n");

async function extractPageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return pages;
}

async function buildDeltaReport(overrides: Parameters<typeof buildAnnotatedCitationDensityEstimatePdf>[0] extends infer T ? Partial<T> : never = {}) {
  return buildAnnotatedCitationDensityEstimatePdf({
    sourcePdfBytes: await makeSubjectPdf(),
    sourcePdfName: "Shop Final Estimate.pdf",
    sourceDocumentId: "shop-final",
    selectedEstimateTotal: 28840.26,
    sourceText: SUBJECT_HEADER.join("\n"),
    comparisonEstimateTexts: [
      {
        fileName: "Supplement of Record S2.pdf",
        sourceDocumentId: "carrier-s2",
        estimateRole: "carrier",
        text: COMPARISON_TEXT,
      },
    ],
    findings: [],
    findingGenerator: buildRequiredEstimatorDeltaFindings,
    jurisdiction: "PA",
    request: { includeLegend: false, annotationMode: "both", estimateRole: "shop" },
    ...overrides,
  });
}

describe("delta findings report", () => {
  it("opens with the forensic front matter and keeps the detail records after it", async () => {
    const result = await buildDeltaReport();
    expect(result.findingsReportBytes).toBeTruthy();

    const pages = await extractPageTexts(result.findingsReportBytes!);
    const front = pages[0];

    expect(front).toMatch(/Forensic Estimate Analysis/);
    expect(front).toMatch(/Purpose and scope/);
    expect(front).toMatch(/Documents examined/);
    expect(front).toMatch(/Summary in plain language/);

    const all = pages.join("\n");
    expect(all).toMatch(/Authorities relied upon/);
    expect(all).toMatch(/Limitations/);
    // Detail records survive the restructure — every callout still resolves.
    expect(all).toMatch(/Finding number:/);
    for (const findingId of new Set(result.annotationMetadata.map((item) => item.findingId))) {
      expect(all.replace(/\s+/g, "")).toContain(findingId.replace(/\s+/g, ""));
    }
  });

  it("numbers the detail pages continuously with the front matter", async () => {
    const result = await buildDeltaReport();
    const pages = await extractPageTexts(result.findingsReportBytes!);
    const firstDetailIndex = pages.findIndex((page) => /Finding number:/.test(page));
    expect(firstDetailIndex).toBeGreaterThan(0);
    // The detail footer prints the document page number, not a restarted count.
    expect(pages[firstDetailIndex]).toMatch(new RegExp(`page ${firstDetailIndex + 1}\\b`));
    expect(pages[0]).not.toMatch(/\bPage 0\b/);
  });

  it("reads the vehicle from the estimate header without running into the next line", async () => {
    const result = await buildDeltaReport();
    const front = (await extractPageTexts(result.findingsReportBytes!))[0];
    expect(front).toMatch(/2023 Lexus IS 300 AWD/);
    expect(front).not.toMatch(/2023 Lexus IS 300 AWD Net/i);
  });

  it("redacts the claim number and the last eight of the VIN in the header", async () => {
    const result = await buildDeltaReport();
    const front = (await extractPageTexts(result.findingsReportBytes!))[0];
    expect(front).toContain("JTHD81F29");
    expect(front).not.toContain("JTHD81F29P5050559");
    expect(front).not.toContain("26-232003028-01");
  });

  it("leaves the OEM report on its own cover page", async () => {
    const result = await buildDeltaReport({
      reportIdentity: OEM_CITATION_DENSITY_REPORT_IDENTITY,
    });
    if (!result.findingsReportBytes) return;
    const front = (await extractPageTexts(result.findingsReportBytes))[0];
    expect(front).toMatch(/OEM Citation Density Findings Report/);
    expect(front).not.toMatch(/Forensic Estimate Analysis/);
  });
});
