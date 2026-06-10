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
    assert.match(text, /Estimate evidence supports the existence of a difference/);
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
    assert.match(text, /Unanchored Findings/);
    assert.match(text, /Finding #:/);
    assert.doesNotMatch(text, /555-123-4567|test@example\.com|123 Main St/i);
  });
})();
