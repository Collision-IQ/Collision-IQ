/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { PDFDocument, StandardFonts } = require("pdf-lib");

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveFilenameWithAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    const absolute = path.join(process.cwd(), "src", request.slice(2));
    return originalResolveFilename.call(this, absolute, parent, isMain, options);
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};

require.extensions[".ts"] = function registerTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};

const {
  buildAnnotatedCitationDensityEstimatePdf,
  dataUrlToPdfBytes,
} = require("./annotatedCitationDensityEstimate.ts");

async function createSourcePdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Estimate 123", { x: 50, y: 730, size: 12, font });
  page.drawText("Line 12 ADAS calibration 1.5 hrs $250.00", { x: 50, y: 690, size: 11, font });
  page.drawText("Line 13 Refinish labor 2.0 hrs $180.00", { x: 50, y: 670, size: 11, font });
  return await doc.save();
}

async function createTwoPageSourcePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const first = doc.addPage([612, 792]);
  first.drawText("Original estimate page one sentinel", { x: 50, y: 730, size: 12, font });
  first.drawText("Line 12 ADAS calibration 1.5 hrs $250.00", { x: 50, y: 690, size: 11, font });
  const second = doc.addPage([612, 792]);
  second.drawText("Original estimate page two sentinel", { x: 50, y: 730, size: 12, font });
  second.drawText("Line 13 Refinish labor 2.0 hrs $180.00", { x: 50, y: 690, size: 11, font });
  return await doc.save();
}

function baseFinding(overrides = {}) {
  return {
    id: overrides.id ?? "finding-1",
    operationLabel: overrides.operationLabel ?? "ADAS calibration",
    category: "adas_calibration",
    estimateGapType: overrides.estimateGapType ?? "needs_proof",
    carrierEvidence: overrides.carrierEvidence ?? {
      lineNumber: "12",
      description: "ADAS calibration 1.5 hrs $250.00",
      amount: 250,
      laborHours: 1.5,
      sourceLabel: "Carrier estimate",
    },
    shopEvidence: undefined,
    impact: {
      dollarImpact: 250,
      laborHoursImpact: 1.5,
      safetyImpact: "high",
      supplementPriority: "high",
    },
    citationStatus: {
      oem: overrides.oemStatus ?? "needed",
      pPages: "not_found",
      scrs: "not_applicable",
      deg: "not_applicable",
      nhtsa: "not_applicable",
      stateRegulation: "not_applicable",
      policy: "not_applicable",
      invoiceOrCompletionProof: overrides.invoiceStatus ?? "needed",
      photoOrTeardownProof: "not_found",
    },
    citationDensityScore: 35,
    verifiedAuthorityCount: 0,
    missingAuthorityTypes: overrides.missingAuthorityTypes ?? ["OEM procedure", "invoice or completion proof"],
    currentSupportSummary: "Estimate line is present only.",
    missingProofSummary: "OEM procedure and invoice proof are still needed.",
    recommendedNextAction: overrides.recommendedNextAction ??
      "Attach procedure before leading. Contact owner at 555-123-4567 or test@example.com for claim 123 Main St.",
    confidence: "medium",
    limitations: [],
    ...overrides,
  };
}

async function extractPdfText(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({
    data: bytes.slice ? bytes.slice() : new Uint8Array(bytes),
    disableWorker: true,
    useSystemFonts: true,
  }).promise;
  const chunks = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    chunks.push(...content.items.map((item) => ("str" in item ? item.str : "")));
  }
  return chunks.join(" ");
}

async function run(name, test) {
  try {
    await test();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

(async () => {
  await run("dataUrlToPdfBytes decodes uploaded PDF bytes and rejects non-PDF data", async () => {
    const bytes = await createSourcePdf();
    const dataUrl = `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`;
    assert.ok(dataUrlToPdfBytes(dataUrl).byteLength > 0);
    assert.equal(dataUrlToPdfBytes("data:text/plain;base64,SGVsbG8="), null);
  });

  await run("annotated estimate matches anchors, adds only legend pages, and labels proof buckets", async () => {
    const sourcePdfBytes = await createSourcePdf();
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      findings: [baseFinding()],
      request: { includeLegend: true, includeSummaryPage: false, annotationMode: "both" },
    });
    const loaded = await PDFDocument.load(result.bytes);
    const text = await extractPdfText(result.bytes);

    assert.equal(result.annotatedFindingCount, 1);
    assert.equal(result.unresolvedAnchorCount, 0);
    assert.equal(result.originalPageCount, 1);
    assert.equal(loaded.getPageCount(), 2);
    assert.match(text, /NEEDS INVOICE|NEEDS OEM/);
    assert.match(text, /Finding #:/);
    assert.match(text, /Label:/);
    assert.match(text, /Citation Density:/);
    assert.match(text, /Carrier issue:/);
    assert.match(text, /Current support:/);
    assert.match(text, /Missing proof:/);
    assert.match(text, /Next action:/);
    assert.match(text, /Estimate evidence supports the existence of a difference/);
    assert.match(text, /CCC Secure Share source confirms this estimate line was present in the structured estimate data/);
    assert.match(text, /The CCC estimate data supports the existence of this line-item difference\. OEM\/P-page\/DEG\/legal support has not yet been verified/);
    assert.doesNotMatch(text, /Estimate documentation the existence|CCC Secure Share documentation this estimate line|OEMdocumentation/i);
    assert.doesNotMatch(text, /verified OEM support|CCC proves|carrier-violation proof/i);
  });

  await run("unmatched findings are placed in appendix and sensitive callout values are redacted", async () => {
    const sourcePdfBytes = await createSourcePdf();
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      findings: [
        baseFinding({
          id: "unmatched",
          operationLabel: "Quarter panel sectioning",
          carrierEvidence: {
            lineNumber: "99",
            description: "Quarter panel sectioning unrelated text",
            amount: 999,
            laborHours: 9.9,
            sourceLabel: "Carrier estimate",
          },
        }),
      ],
      request: { includeLegend: false, redactSensitive: true },
    });
    const text = await extractPdfText(result.bytes);

    assert.equal(result.annotatedFindingCount, 0);
    assert.equal(result.unresolvedAnchorCount, 1);
    assert.match(result.warnings.join(" "), /No line-level anchors could be placed/);
    assert.match(result.warnings.join(" "), /all_findings_unanchored/);
    assert.match(text, /No line-level anchors could be placed/);
    assert.match(text, /Findings are listed in the appendix/);
    assert.match(text, /Unanchored Citation Density Findings/);
    assert.match(text, /Finding #:/);
    assert.doesNotMatch(text, /555-123-4567|test@example\.com|123 Main St/i);
  });

  await run("anchor fallback keeps original pages and appends warning, legend, plus appendix", async () => {
    const sourcePdfBytes = await createTwoPageSourcePdf();
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      findings: [
        baseFinding({
          id: "unanchored",
          operationLabel: "Nonexistent operation",
          carrierEvidence: {
            lineNumber: "9999",
            description: "No matching line coordinate anchor",
            amount: 1234,
            laborHours: 9.9,
            sourceLabel: "Carrier estimate",
          },
        }),
      ],
      request: { includeLegend: true, includeSummaryPage: false, annotationMode: "both" },
    });
    const loaded = await PDFDocument.load(result.bytes);
    const text = await extractPdfText(result.bytes);

    assert.equal(result.originalPageCount, 2);
    assert.equal(result.unresolvedAnchorCount, 1);
    assert.equal(loaded.getPageCount(), 5);
    assert.match(text, /Original estimate page one sentinel/);
    assert.match(text, /Original estimate page two sentinel/);
    assert.match(text, /No line-level anchors could be placed/);
    assert.match(text, /Citation Density Annotation Legend/);
    assert.match(text, /Unanchored Citation Density Findings/);
  });

  await run("section-level fallback places callouts on original pages before appendix", async () => {
    const sourcePdfBytes = await createTwoPageSourcePdf();
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      findings: [
        baseFinding({
          id: "page-level",
          operationLabel: "ADAS calibration OEM procedure",
          carrierEvidence: {
            lineNumber: "9999",
            description: "Calibration proof missing",
            amount: 999,
            laborHours: 9.9,
            sourceLabel: "Carrier estimate",
          },
        }),
      ],
      request: { includeLegend: true, includeSummaryPage: false, annotationMode: "both" },
    });
    const loaded = await PDFDocument.load(result.bytes);
    const text = await extractPdfText(result.bytes);

    assert.equal(result.originalPageCount, 2);
    assert.equal(result.annotatedFindingCount, 1);
    assert.equal(result.unresolvedAnchorCount, 0);
    assert.equal(loaded.getPageCount(), 4);
    assert.match(text, /Original estimate page one sentinel/);
    assert.match(text, /No line-level anchors could be placed/);
    assert.match(text, /Citation Density Annotation Legend/);
    assert.doesNotMatch(text, /Unanchored Citation Density Findings/);
  });

  await run("visual page behavior uses original PDF as base with optional legend only", async () => {
    const sourcePdfBytes = await createTwoPageSourcePdf();
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      findings: [baseFinding()],
      request: { includeLegend: true, includeSummaryPage: false, annotationMode: "both" },
    });
    const loaded = await PDFDocument.load(result.bytes);
    const text = await extractPdfText(result.bytes);

    assert.equal(result.originalPageCount, 2);
    assert.equal(result.unresolvedAnchorCount, 0);
    assert.equal(loaded.getPageCount(), 3);
    assert.match(text, /Original estimate page one sentinel/);
    assert.match(text, /Original estimate page two sentinel/);
    assert.doesNotMatch(text, /Citation Density Gap Report|Report Summary|Executive Summary/i);
  });

  await run("weak findings use the required label text", async () => {
    const sourcePdfBytes = await createSourcePdf();
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      findings: [
        baseFinding({
          id: "weak",
          estimateGapType: "weak_do_not_lead",
          carrierEvidence: {
            lineNumber: "12",
            description: "ADAS calibration 1.5 hrs $250.00",
            amount: 250,
            laborHours: 1.5,
            sourceLabel: "Carrier estimate",
          },
        }),
      ],
      request: { includeLegend: true, annotationMode: "both" },
    });
    const text = await extractPdfText(result.bytes);

    assert.match(text, /WEAK — DO NOT LEAD/);
    assert.doesNotMatch(text, /WEAK - DO NOT LEAD/);
  });
})();
