/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const { PDFName, PDFString, PDFHexString } = require("pdf-lib/cjs/core");

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
const {
  detectEmbeddedEstimateLinks,
} = require("../ai/builders/estimateScrubberPdfBuilder.ts");

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

async function createKiaLikeEstimatePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText("GEICO lower estimate", { x: 42, y: 746, size: 10, font });
  page.drawText("Parts", { x: 42, y: 716, size: 10, font });
  drawFragmentedEstimateRow(page, font, 49, "A/M bumper cover", "1", "$312.40", 690);
  drawFragmentedEstimateRow(page, font, 54, "A/M LT reflector", "1", "$42.10", 672);
  drawFragmentedEstimateRow(page, font, 55, "A/M molding", "1", "$66.75", 654);
  page.drawText("Electrical / Diagnostics", { x: 42, y: 628, size: 10, font });
  drawFragmentedEstimateRow(page, font, 56, "R&I blind spot radar", "0.6", "$0.00", 604);
  drawFragmentedEstimateRow(page, font, 57, "R&I blind spot radar bracket", "0.4", "$0.00", 586);
  drawFragmentedEstimateRow(page, font, 62, "Pre-repair scan", "0.5", "$75.00", 560);
  drawFragmentedEstimateRow(page, font, 63, "In-process scan", "0.5", "$75.00", 542);
  drawFragmentedEstimateRow(page, font, 64, "Blind spot radar calibration", "1.2", "$210.00", 524);
  drawFragmentedEstimateRow(page, font, 65, "Power window initialization", "0.3", "$42.00", 506);
  drawFragmentedEstimateRow(page, font, 66, "Post-repair scan", "0.5", "$75.00", 488);
  drawFragmentedEstimateRow(page, font, 68, "REVVDAdas Report", "", "$0.00", 462);
  page.drawText("ADAS report available upon request and via this link", { x: 86, y: 448, size: 8, font });
  page.drawText("Refinish", { x: 42, y: 420, size: 10, font });
  drawFragmentedEstimateRow(page, font, 70, "Restore corrosion protection", "0.7", "$63.00", 396);
  drawFragmentedEstimateRow(page, font, 76, "Mask for refinishing", "0.5", "$45.00", 378);
  drawFragmentedEstimateRow(page, font, 77, "Mask jambs", "0.4", "$36.00", 360);
  drawFragmentedEstimateRow(page, font, 79, "Color sand polish", "0.8", "$72.00", 342);
  page.drawText("Totals / Labor Rates / Paint Supplies", { x: 42, y: 304, size: 10, font });
  page.drawText("Paint supplies total $185.00 Labor rate body $58.00 refinish $58.00", { x: 42, y: 286, size: 8, font });
  return await doc.save();
}

async function createBlankSourcePdf(pageCount = 2) {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    doc.addPage([612, 792]);
  }
  return await doc.save();
}

function ramEstimateStoredText() {
  return [
    "RAM lower estimate",
    "Parts",
    "23 LKQ grille Note: not correct style for vehicle $185.00",
    "Diagnostics and Calibration",
    "39 Pre-repair scan 0.5 $75.00",
    "40 In-process scan 0.5 $75.00",
    "41 Seat belt dynamic function test 0.4 $52.00",
    "42 Post-repair scan 0.5 $75.00",
    "43 Final road test 0.3 $40.00",
    "44 REVVAdas Report ADAS report available upon request and via this link https://egnyte.example.com/revvadas/ram-report?token=secret",
    "Totals / Labor / Paint / Paint Materials",
    "Body labor total $1,240.00 Paint materials total $385.00 Paint labor rate $58.00",
    "\fAlternate Parts Supplier",
    "LKQ grille alternate supplier page lists used grille not correct style for vehicle",
    "CCC MOTOR Guide Pages",
    "MOTOR database included-not-included guide scan operations paint materials labor indicators",
  ].join("\n");
}

function drawFragmentedEstimateRow(page, font, line, description, labor, amount, y) {
  page.drawText(String(line), { x: 48, y, size: 8, font });
  page.drawText(description, { x: 82, y, size: 8, font });
  if (labor) page.drawText(labor, { x: 330, y, size: 8, font });
  page.drawText(amount, { x: 412, y, size: 8, font });
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

async function extractPdfPageTexts(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({
    data: bytes.slice ? bytes.slice() : new Uint8Array(bytes),
    disableWorker: true,
    useSystemFonts: true,
  }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return pages;
}

async function getOriginalPageAnnotationCount(bytes, pageIndex = 0) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPage(pageIndex).node.Annots()?.size() ?? 0;
}

async function extractOriginalPageAnnotationText(bytes, pageIndex = 0) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(pageIndex);
  const annots = page.node.Annots();
  if (!annots) return "";
  const chunks = [];
  for (let index = 0; index < annots.size(); index += 1) {
    const annot = annots.lookup(index);
    const contents = annot?.lookupMaybe?.(PDFName.of("Contents"), PDFString, PDFHexString);
    if (contents?.decodeText) chunks.push(contents.decodeText());
  }
  return chunks.join("\n");
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

  await run("Conestoga Audi line 2 OE docs link is detected", async () => {
    const links = detectEmbeddedEstimateLinks({
      text: "Line 2 OE docs https://secure.example.com/oe-docs/audi/procedure?id=2",
      estimateRole: "carrier",
      lineNumber: "2",
      nearbyOperation: "OE docs",
    });

    assert.equal(links.length, 1);
    assert.equal(links[0].lineNumber, "2");
    assert.equal(links[0].estimateRole, "carrier");
    assert.match(links[0].redactedUrl, /secure\.example\.com\/oe-docs\/audi\/procedure/);
  });

  await run("Conestoga Audi line 39 REVVAdas link is detected", async () => {
    const links = detectEmbeddedEstimateLinks({
      text: "Line 39 REVVAdas Report https://reports.example.com/revvadas/adas-report/39?token=secret",
      estimateRole: "shop",
      lineNumber: "39",
      nearbyOperation: "REVVAdas Report",
    });

    assert.equal(links.length, 1);
    assert.equal(links[0].lineNumber, "39");
    assert.equal(links[0].estimateRole, "shop");
    assert.match(links[0].nearbyOperation, /REVVAdas Report/);
    assert.doesNotMatch(links[0].redactedUrl, /token=secret/);
  });

  await run("link-present-but-not-retrieved becomes referenced_not_produced", async () => {
    const links = detectEmbeddedEstimateLinks({
      text: "Line 2 OE docs https://secure.example.com/oe-docs/audi/procedure?id=2",
      estimateRole: "carrier",
      lineNumber: "2",
      nearbyOperation: "OE docs",
    });

    assert.equal(links[0].retrievalStatus, "not_fetched");
    assert.equal(links[0].authorityStatus, "referenced_not_produced");
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
    assert.equal(result.annotationMetadata.length, 1);
    assert.equal(await getOriginalPageAnnotationCount(result.bytes), 2);
    const comments = await extractOriginalPageAnnotationText(result.bytes);
    assert.match(text, /NEEDS INVOICE|NEEDS OEM/);
    assert.doesNotMatch((await extractPdfPageTexts(result.bytes))[0], /Estimate line:|Current support:|Missing proof:|Next action:/);
    assert.match(result.annotationMetadata[0].comment, /Label:/);
    assert.match(result.annotationMetadata[0].comment, /Citation Density:/);
    assert.match(result.annotationMetadata[0].comment, /Estimate line:/);
    assert.match(result.annotationMetadata[0].comment, /Current support:/);
    assert.match(result.annotationMetadata[0].comment, /Missing proof:/);
    assert.match(result.annotationMetadata[0].comment, /Next action:/);
    assert.match(comments, /Finding #1/);
    assert.match(text, /Estimate evidence supports the existence of a difference/);
    assert.match(text, /CCC Secure Share source confirms this estimate line was present in the structured estimate data/);
    assert.match(text, /The CCC estimate data supports the existence of this line-item difference\. OEM\/P-page\/DEG\/legal support has not yet been verified/);
    assert.doesNotMatch(text, /Estimate documentation the existence|CCC Secure Share documentation this estimate line|OEMdocumentation/i);
    assert.doesNotMatch(text, /verified OEM support|CCC proves|carrier-violation proof/i);
  });

  await run("carrier annotated export keeps original estimate page and places visible callout on that page", async () => {
    const sourcePdfBytes = await createSourcePdf();
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      findings: [baseFinding()],
      request: { includeLegend: false, includeSummaryPage: false, annotationMode: "both", estimateRole: "carrier" },
    });
    const pages = await extractPdfPageTexts(result.bytes);

    assert.equal(result.originalPageCount, 1);
    assert.equal(result.annotatedFindingCount, 1);
    assert.equal(result.unresolvedAnchorCount, 0);
    assert.match(pages[0], /Estimate 123/);
    assert.match(pages[0], /Line 12 ADAS calibration 1\.5 hrs \$250\.00/);
    assert.match(pages[0], /1\.\s+(NEEDS INVOICE|NEEDS OEM)/);
    assert.doesNotMatch(pages[0], /Estimate line:|Current support:|Missing proof:|Next action:/);
    assert.equal(result.annotationMetadata[0].findingId, "finding-1");
    assert.equal(result.annotationMetadata[0].pageNumber, 1);
    assert.match(result.annotationMetadata[0].estimateLine, /Line 12: ADAS calibration/);
    assert.doesNotMatch(pages.join(" "), /Citation Density Gap Report|Estimate gaps ranked by repair impact/i);
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
    assert.equal(loaded.getPageCount(), 3);
    assert.match(text, /Original estimate page one sentinel/);
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

  await run("fragmented estimate rows produce on-page annotations", async () => {
    const sourcePdfBytes = await createKiaLikeEstimatePdf();
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      findings: [
        baseFinding({
          id: "kia-line-49",
          operationLabel: "A/M bumper cover",
          category: "parts_downgrade",
          carrierEvidence: {
            lineNumber: "49",
            description: "A/M bumper cover",
            amount: 312.4,
            laborHours: null,
            sourceLabel: "Carrier estimate",
          },
          citationStatus: {
            oem: "needed",
            pPages: "not_found",
            scrs: "not_applicable",
            deg: "not_applicable",
            nhtsa: "not_applicable",
            stateRegulation: "not_applicable",
            policy: "not_applicable",
            invoiceOrCompletionProof: "not_applicable",
            photoOrTeardownProof: "not_applicable",
          },
          missingAuthorityTypes: ["OEM or fit documentation"],
        }),
      ],
      request: { includeLegend: false, annotationMode: "both", estimateRole: "carrier" },
    });
    const pages = await extractPdfPageTexts(result.bytes);

    assert.equal(result.annotatedFindingCount, 1);
    assert.equal(result.unresolvedAnchorCount, 0);
    assert.match(pages[0], /49\s+A\/M bumper cover/);
    assert.match(pages[0], /1\.\s+NEEDS/);
    assert.match(pages[0], /A\/M bumper cover/);
    assert.match(result.annotationMetadata[0].comment, /Estimate line:/);
  });

  await run("note text produces an on-page referenced-not-produced annotation", async () => {
    const sourcePdfBytes = await createKiaLikeEstimatePdf();
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      findings: [
        baseFinding({
          id: "kia-line-68",
          operationLabel: "REVVDAdas Report",
          category: "adas_calibration",
          citationLabel: "REFERENCED / NOT PRODUCED",
          embeddedEstimateLinks: [{
            lineNumber: "68",
            estimateRole: "carrier",
            nearbyOperation: "REVVDAdas Report",
            redactedUrl: "referenced estimate link (URL not extracted)",
            retrievalStatus: "not_fetched",
            authorityStatus: "referenced_not_produced",
          }],
          carrierEvidence: {
            lineNumber: "68",
            description: "ADAS report available upon request and via this link",
            amount: 0,
            laborHours: null,
            sourceLabel: "Carrier estimate",
          },
          missingAuthorityTypes: ["linked ADAS report"],
        }),
      ],
      request: { includeLegend: false, annotationMode: "both", estimateRole: "carrier" },
    });
    const pages = await extractPdfPageTexts(result.bytes);

    assert.equal(result.annotatedFindingCount, 1);
    assert.equal(result.unresolvedAnchorCount, 0);
    assert.match(pages[0], /ADAS report available upon request and via this link/);
    assert.match(pages[0], /REFERENCED \/ NOT PRODUCED/);
  });

  await run("section heading fallback places missing lower-estimate item on original page", async () => {
    const sourcePdfBytes = await createKiaLikeEstimatePdf();
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      findings: [
        baseFinding({
          id: "missing-refinish",
          operationLabel: "Missing refinish labor feather prime block",
          category: "refinish",
          estimateGapType: "missing_from_carrier",
          carrierEvidence: undefined,
          carrierAnchor: {
            estimateRole: "carrier",
            lineNumber: null,
            pageNumber: 1,
            section: "Refinish",
            operation: "Feather prime block",
            description: "Missing refinish labor belongs in refinish section",
          },
          shopEvidence: {
            lineNumber: "120",
            description: "Feather prime block",
            amount: 100,
            laborHours: 1,
            sourceLabel: "Shop estimate",
          },
        }),
      ],
      request: { includeLegend: false, annotationMode: "both", estimateRole: "carrier" },
    });
    const pages = await extractPdfPageTexts(result.bytes);

    assert.equal(result.annotatedFindingCount, 1);
    assert.equal(result.unresolvedAnchorCount, 0);
    assert.match(pages[0], /Refinish/);
    assert.match(pages[0], /1\.\s+NEEDS/);
  });

  await run("mutated finding text maps back to original estimate text", async () => {
    const sourcePdfBytes = await createKiaLikeEstimatePdf();
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      findings: [
        baseFinding({
          id: "mutated-scan",
          operationLabel: "Proc SPre-repair scanm",
          category: "scan_diagnostic",
          carrierEvidence: {
            lineNumber: null,
            description: "Proc SPre-repair scanm",
            amount: 75,
            laborHours: 0.5,
            sourceLabel: "Carrier estimate",
          },
        }),
        baseFinding({
          id: "mutated-jambs",
          operationLabel: "Proc jambs Hours and",
          category: "refinish",
          citationLabel: undefined,
          carrierEvidence: {
            lineNumber: null,
            description: "Proc jambs Hours and",
            amount: 36,
            laborHours: 0.4,
            sourceLabel: "Carrier estimate",
          },
          citationStatus: {
            oem: "not_applicable",
            adas: "not_applicable",
            pPages: "needed",
            scrs: "not_applicable",
            deg: "not_applicable",
            nhtsa: "not_applicable",
            stateRegulation: "not_applicable",
            policy: "not_applicable",
            invoiceOrCompletionProof: "not_applicable",
            photoOrTeardownProof: "not_applicable",
          },
          missingAuthorityTypes: ["pPages"],
        }),
      ],
      request: { includeLegend: false, annotationMode: "both", estimateRole: "carrier" },
    });
    const pages = await extractPdfPageTexts(result.bytes);

    assert.equal(result.annotatedFindingCount, 2);
    assert.equal(result.unresolvedAnchorCount, 0);
    assert.match(pages[0], /Pre-repair scan/);
    assert.match(pages[0], /Mask jambs/);
    assert.doesNotMatch(pages[0], /Label:\s*NEEDS ADAS[\s\S]*Mask jambs/);
  });

  await run("KIA line 68 referenced ADAS report without extracted URL is detected", async () => {
    const links = detectEmbeddedEstimateLinks({
      text: "Line 68 REVVDAdas Report ADAS report available upon request and via this link",
      estimateRole: "carrier",
      nearbyOperation: "REVVDAdas Report",
    });

    assert.equal(links.length, 1);
    assert.equal(links[0].lineNumber, "68");
    assert.equal(links[0].retrievalStatus, "not_fetched");
    assert.equal(links[0].authorityStatus, "referenced_not_produced");
    assert.match(links[0].redactedUrl, /URL not extracted/);
  });

  await run("stored estimate text anchors Ram lines onto original pages when PDF coordinates are unavailable", async () => {
    const sourcePdfBytes = await createBlankSourcePdf(2);
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      sourceText: ramEstimateStoredText(),
      findings: [
        baseFinding({
          id: "ram-line-23",
          operationLabel: "LKQ grille not correct style",
          category: "parts_downgrade",
          carrierEvidence: {
            lineNumber: "23",
            description: "LKQ grille Note: not correct style for vehicle",
            amount: 185,
            laborHours: null,
            sourceLabel: "Carrier estimate",
          },
        }),
        baseFinding({
          id: "ram-line-39",
          operationLabel: "Pre-repair scan",
          category: "scan_diagnostic",
          carrierEvidence: {
            lineNumber: "39",
            description: "Pre-repair scan",
            amount: 75,
            laborHours: 0.5,
            sourceLabel: "Carrier estimate",
          },
        }),
        baseFinding({
          id: "ram-line-40",
          operationLabel: "In-process scan",
          category: "scan_diagnostic",
          carrierEvidence: {
            lineNumber: "40",
            description: "In-process scan",
            amount: 75,
            laborHours: 0.5,
            sourceLabel: "Carrier estimate",
          },
        }),
        baseFinding({
          id: "ram-line-41",
          operationLabel: "Seat belt dynamic function test",
          category: "scan_diagnostic",
          carrierEvidence: {
            lineNumber: "41",
            description: "Seat belt dynamic function test",
            amount: 52,
            laborHours: 0.4,
            sourceLabel: "Carrier estimate",
          },
        }),
        baseFinding({
          id: "ram-totals",
          operationLabel: "Paint materials and labor total difference",
          category: "labor_difference",
          carrierEvidence: {
            lineNumber: null,
            description: "Paint materials total $385.00 Paint labor rate $58.00",
            amount: 385,
            laborHours: null,
            sourceLabel: "Carrier estimate",
          },
        }),
        baseFinding({
          id: "ram-supplier",
          operationLabel: "Alternate parts supplier LKQ grille",
          category: "parts_downgrade",
          carrierEvidence: {
            lineNumber: null,
            description: "Alternate Parts Supplier LKQ grille not correct style",
            amount: null,
            laborHours: null,
            sourceLabel: "Carrier estimate",
          },
        }),
      ],
      request: { includeLegend: false, annotationMode: "both", estimateRole: "carrier" },
    });
    const pages = await extractPdfPageTexts(result.bytes);

    assert.equal(result.originalPageCount, 2);
    assert.equal(result.annotatedFindingCount, 6);
    assert.equal(result.unresolvedAnchorCount, 0);
    assert.doesNotMatch(result.warnings.join(" "), /all_findings_unanchored/);
    assert.match(result.warnings.join(" "), /stored extracted text/i);
    assert.match(pages.join(" "), /1\.\s+NEEDS/);
    assert.match(result.annotationMetadata.map((item) => item.estimateLine).join(" "), /Line 23: LKQ grille Note/);
    assert.match(result.annotationMetadata.map((item) => item.estimateLine).join(" "), /Line 39: Pre-repair scan/);
    assert.match(result.annotationMetadata.map((item) => item.estimateLine).join(" "), /Line 40: In-process scan/);
    assert.match(result.annotationMetadata.map((item) => item.estimateLine).join(" "), /Line 41: Seat belt dynamic function test/);
    assert.match(pages.join(" "), /Paint materials total/);
    assert.match(pages.join(" "), /Alternate Parts Supplier/);
    assert.doesNotMatch(pages.join(" "), /Unanchored Citation Density Findings/);
  });

  await run("Ram line 44 Egnyte REVVAdas link is detected and redacted", async () => {
    const links = detectEmbeddedEstimateLinks({
      text: "Line 44 REVVAdas Report ADAS report available upon request and via this link https://egnyte.example.com/revvadas/ram-report?token=secret",
      estimateRole: "carrier",
      nearbyOperation: "REVVAdas Report",
    });

    assert.equal(links.length, 1);
    assert.equal(links[0].lineNumber, "44");
    assert.match(links[0].redactedUrl, /egnyte\.example\.com\/revvadas\/ram-report/);
    assert.doesNotMatch(links[0].redactedUrl, /token=secret/);
    assert.equal(links[0].authorityStatus, "referenced_not_produced");
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

  await run("verified and ADAS labels come from authority status, not estimate gaps", async () => {
    const sourcePdfBytes = await createSourcePdf();
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      findings: [
        baseFinding({
          id: "verified-adas",
          citationLabel: "VERIFIED ADAS",
          bestAvailableAuthority: {
            type: "adas_procedure",
            status: "verified",
            title: "Reviewed calibration certificate",
            sourceType: "UploadedDocument",
            confidence: "high",
          },
          missingAuthority: [],
          citationStatus: {
            oem: "not_applicable",
            adas: "verified",
            pPages: "not_applicable",
            scrs: "not_applicable",
            deg: "not_applicable",
            nhtsa: "not_applicable",
            stateRegulation: "not_applicable",
            policy: "not_applicable",
            invoiceOrCompletionProof: "verified",
            photoOrTeardownProof: "not_applicable",
          },
          missingAuthorityTypes: [],
        }),
      ],
      request: { includeLegend: true, annotationMode: "both" },
    });
    const text = await extractPdfText(result.bytes);

    assert.match(text, /VERIFIED ADAS/);
    assert.match(result.annotationMetadata[0].comment, /Best authority:/);
    assert.match(result.annotationMetadata[0].comment, /Reviewed calibration certificate/);
    assert.match(result.annotationMetadata[0].comment, /Missing authority:/);
  });

  await run("uploaded documentation support uses VERIFIED DOCUMENTATION label", async () => {
    const sourcePdfBytes = await createSourcePdf();
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      findings: [
        baseFinding({
          id: "verified-documentation",
          citationLabel: undefined,
          citationStatus: {
            oem: "not_applicable",
            adas: "not_applicable",
            pPages: "not_applicable",
            scrs: "not_applicable",
            deg: "not_applicable",
            nhtsa: "not_applicable",
            stateRegulation: "not_applicable",
            policy: "not_applicable",
            invoiceOrCompletionProof: "verified",
            photoOrTeardownProof: "not_applicable",
          },
          missingAuthorityTypes: [],
        }),
      ],
      request: { includeLegend: true, annotationMode: "both" },
    });
    const text = await extractPdfText(result.bytes);

    assert.match(text, /VERIFIED DOCUMENTATION/);
  });

  await run("online fallback support is labeled ONLINE FALLBACK", async () => {
    const sourcePdfBytes = await createSourcePdf();
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      findings: [
        baseFinding({
          id: "online-fallback",
          citationLabel: undefined,
          bestAvailableAuthority: {
            type: "online_fallback",
            status: "referenced",
            title: "Online repair article",
            sourceType: "InternetOEM",
            confidence: "medium",
          },
        }),
      ],
      request: { includeLegend: true, annotationMode: "both" },
    });
    const text = await extractPdfText(result.bytes);

    assert.match(text, /ONLINE FALLBACK/);
    assert.doesNotMatch(text, /Label:\s*VERIFIED OEM/);
  });

  await run("non-ADAS operations are not labeled NEEDS ADAS by default", async () => {
    const sourcePdfBytes = await createSourcePdf();
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      findings: [
        baseFinding({
          id: "base-coat",
          operationLabel: "Base Coat tint and blend",
          category: "refinish",
          citationLabel: undefined,
          carrierEvidence: {
            lineNumber: "13",
            description: "Refinish labor 2.0 hrs $180.00",
            amount: 180,
            laborHours: 2,
            sourceLabel: "Carrier estimate",
          },
          citationStatus: {
            oem: "not_applicable",
            adas: "needed",
            pPages: "not_found",
            scrs: "not_applicable",
            deg: "not_applicable",
            nhtsa: "not_applicable",
            stateRegulation: "not_applicable",
            policy: "not_applicable",
            invoiceOrCompletionProof: "needed",
            photoOrTeardownProof: "not_applicable",
          },
          missingAuthorityTypes: ["invoiceOrCompletionProof"],
        }),
      ],
      request: { includeLegend: false, annotationMode: "both" },
    });
    const text = await extractPdfText(result.bytes);

    assert.doesNotMatch(text, /Label:\s*NEEDS ADAS/);
    assert.match(text, /NEEDS INVOICE/);
    assert.match(result.annotationMetadata[0].comment, /Label:\s*NEEDS INVOICE/);
  });
})();
