/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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
  buildRequiredEstimatorDeltaFindings,
  buildOemCitationDensityFindings,
  classifyPartSource,
  dataUrlToPdfBytes,
  extractPolicyApplicabilityDiagnostics,
  extractCitationDensityRowAnchors,
  OEM_CITATION_DENSITY_ARTIFACT_VERSION,
  OEM_CITATION_DENSITY_REPORT_IDENTITY,
} = require("./annotatedCitationDensityEstimate.ts");
const {
  extractPdfRowAnchors,
  buildEstimateRowAnchorSelectionOptions,
} = require("./citationDensityRowAnchors.ts");
const {
  detectEmbeddedEstimateLinks,
  buildAnnotatedEstimateReviewModel,
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

async function createLongFindingDetailSourcePdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Estimate 123 long detail source", { x: 50, y: 730, size: 12, font });
  page.drawText(
    "Line 12 LONG SOURCE ROW SENTINEL ALPHA LONG SOURCE ROW SENTINEL OMEGA ADAS calibration calibration calibration calibration calibration calibration calibration calibration calibration calibration calibration calibration calibration 1.5 hrs $250.00",
    { x: 50, y: 690, size: 8, font }
  );
  page.drawText("Line 13 Pre repair scan diagnostic row 0.5 hrs $75.00", { x: 50, y: 670, size: 11, font });
  page.drawText("Line 14 Post repair scan diagnostic row 0.5 hrs $75.00", { x: 50, y: 650, size: 11, font });
  page.drawText("Line 15 ADAS report referenced link row $0.00", { x: 50, y: 630, size: 11, font });
  page.drawText("Line 16 Paint material rate difference row $180.00", { x: 50, y: 610, size: 11, font });
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

async function createNoEstimateRowsPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText("Selected PDF cover sheet", { x: 50, y: 730, size: 12, font });
  page.drawText("This document has extractable text but no deterministic row content.", { x: 50, y: 700, size: 10, font });
  return await doc.save();
}

async function createWorkAuthorizationPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText("CONTRACT OF REPAIR", { x: 50, y: 730, size: 12, font });
  page.drawText("Work Authorization", { x: 50, y: 710, size: 11, font });
  page.drawText("Customer acknowledges Repairer has posted labor rates and daily protective care and custody $95.00", { x: 50, y: 690, size: 9, font });
  page.drawText("Payment Warranty Assignment of Proceeds Physical inspection demand", { x: 50, y: 670, size: 9, font });
  page.drawText("Customer Signature Vehicle owner / Date", { x: 50, y: 650, size: 9, font });
  return await doc.save();
}

async function createProductionBadAnchorFixturePdf({ includeValidEstimateRow = false } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 11; index += 1) {
    const page = doc.addPage([612, 792]);
    page.drawText(`SOR2 production fixture page ${index + 1}`, { x: 42, y: 746, size: 10, font });
  }

  const page1 = doc.getPage(0);
  page1.drawText("Claim 123 Owner Jane Driver Vehicle 2019 GM VIN=Vehicle Identification Number", { x: 42, y: 716, size: 8, font });
  page1.drawText("44 Air Conditioning Navigation Heated Seat Bluetooth Cruise Traction Telescopic Steering Wheel Equipment Options", { x: 42, y: 700, size: 8, font });
  page1.drawText("2019 Vehicle options package owner claim contact block", { x: 42, y: 684, size: 8, font });
  page1.drawText("4717 Vehicle options package owner claim contact block", { x: 42, y: 668, size: 8, font });

  if (includeValidEstimateRow) {
    const page4 = doc.getPage(3);
    drawCccEstimateRow(page4, font, 55, "", "Repl", "A/M molding", "0.2", "$66.75", 696);
  }

  const page9 = doc.getPage(8);
  page9.drawText("77 ANY PERSON WHO KNOWINGLY presents false or fraudulent information is subject to legal penalties.", { x: 42, y: 716, size: 8, font });
  page9.drawText("Legal notice fraud warning disclaimer alternate parts policy.", { x: 42, y: 700, size: 8, font });

  const page10 = doc.getPage(9);
  page10.drawText("Estimate based on MOTOR CRASH ESTIMATING GUIDE and CCC MOTOR database guide pages.", { x: 42, y: 716, size: 8, font });
  page10.drawText("SYMBOLS FOLLOWING estimate lines indicate included not included database logic.", { x: 42, y: 700, size: 8, font });

  const page11 = doc.getPage(10);
  page11.drawText("88 IMPORTANT INFORMATION ABOUT THE NAMED INSURANCE COMPANY'S PARTS POLICY", { x: 42, y: 716, size: 8, font });
  page11.drawText("Quality replacement aftermarket alternate LKQ used recycled CAPA parts policy language.", { x: 42, y: 700, size: 8, font });

  return await doc.save();
}

async function createRam21975SourcePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 12; index += 1) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Carrier 21975 source page ${index + 1}`, { x: 42, y: 746, size: 10, font });
  }
  const page2 = doc.getPage(1);
  page2.drawText("FRONT BUMPER", { x: 42, y: 716, size: 10, font });
  drawCccEstimateRow(page2, font, 5, "#", "Repl", "A/M CAPA Bumper chrome, w/prk snsr", "1.0", "$487.50", 696);
  drawCccEstimateRow(page2, font, 8, "*", "Repl", "A/M Side retainer", "0.2", "$24.75", 680);
  drawCccEstimateRow(page2, font, 10, "**", "Repl", "A/M CAPA Lamp bracket", "0.3", "$38.20", 664);
  drawCccEstimateRow(page2, font, 11, "<>", "Repl", "A/M Upper cover primed", "0.4", "$112.00", 648);
  drawCccEstimateRow(page2, font, 13, "S01", "Repl", "A/M Lower deflector", "0.3", "$64.15", 632);
  drawCccEstimateRow(page2, font, 14, "S01", "Repl", "A/M Filler panel", "0.2", "$42.10", 616);
  drawCccEstimateRow(page2, font, 15, "", "Repl", "Park sensor outer", "0.2", "$71.25", 600);
  drawCccEstimateRow(page2, font, 16, "", "Repl", "Park sensor inner", "0.2", "$71.25", 584);
  drawCccEstimateRow(page2, font, 17, "", "Repl", "Sensor ring", "0.1", "$13.40", 568);
  drawCccEstimateRow(page2, font, 18, "", "Repl", "Sensor bezels", "0.1", "$18.90", 552);
  drawCccEstimateRow(page2, font, 21, "Subl", "Rpr", "Test fit-Front bumper", "0.5", "$30.00", 536);
  page2.drawText("GRILLE", { x: 42, y: 512, size: 10, font });
  drawCccEstimateRow(page2, font, 23, "LKQ", "Repl", "Grille chrome horizontal bars", "", "$185.00", 492);
  page2.drawText("NOTE: not correct style for vehicle", { x: 100, y: 478, size: 8, font });
  drawCccEstimateRow(page2, font, 25, "LKQ", "Repl", "Radiator support", "1.1", "$255.00", 462);
  drawCccEstimateRow(page2, font, 26, "", "R&I", "Aim headlamps", "0.4", "$24.00", 446);

  const page3 = doc.getPage(2);
  page3.drawText("VEHICLE DIAGNOSTICS", { x: 42, y: 716, size: 10, font });
  drawCccEstimateRow(page3, font, 39, "", "Subl", "Pre-repair scan", "0.5", "$75.00", 696);
  drawCccEstimateRow(page3, font, 40, "", "Subl", "In-proc repair scan", "0.5", "$75.00", 680);
  drawCccEstimateRow(page3, font, 41, "", "Subl", "Seat belt dynamic function test", "0.4", "$52.00", 664);
  drawCccEstimateRow(page3, font, 42, "", "Subl", "Post-repair scan", "0.5", "$75.00", 648);
  drawCccEstimateRow(page3, font, 43, "", "Subl", "Final road test", "0.3", "$40.00", 632);
  drawCccEstimateRow(page3, font, 44, "", "Subl", "REVVAdas Report", "", "$0.00", 616);
  page3.drawText("Egnyte link: https://example.egnyte.com/21975/revvadas-report", { x: 100, y: 602, size: 8, font });
  page3.drawText("MISCELLANEOUS OPERATIONS", { x: 42, y: 576, size: 10, font });
  drawCccEstimateRow(page3, font, 46, "", "Rpr", "Color sand polish", "0.5", "$30.00", 556);
  drawCccEstimateRow(page3, font, 47, "", "Rpr", "Pre-wash vehicle", "0.2", "$12.00", 540);
  drawCccEstimateRow(page3, font, 48, "", "Rpr", "Clean for delivery", "0.3", "$18.00", 524);
  drawCccEstimateRow(page3, font, 49, "", "Rpr", "Hazardous waste disposal", "", "$8.00", 508);
  drawCccEstimateRow(page3, font, 50, "", "R&I", "Battery reset", "0.2", "$12.00", 492);
  drawCccEstimateRow(page3, font, 51, "", "Rpr", "Corrosion protection", "0.4", "$24.00", 476);
  drawCccEstimateRow(page3, font, 52, "", "Rpr", "Feather prime block", "0.6", "$36.00", 460);
  page3.drawText("Subtotal $3,112.75", { x: 42, y: 430, size: 8, font });

  const page4 = doc.getPage(3);
  page4.drawText("ESTIMATE TOTALS", { x: 42, y: 716, size: 10, font });
  page4.drawText("Parts 3,214.95", { x: 42, y: 696, size: 8, font });
  page4.drawText("Body Labor 13.2 hrs @ $60/hr 792.00", { x: 42, y: 680, size: 8, font });
  page4.drawText("Paint Labor 3.2 hrs @ $60/hr 192.00", { x: 42, y: 664, size: 8, font });
  page4.drawText("Paint Supplies 3.2 hrs @ $40/hr 128.00", { x: 42, y: 648, size: 8, font });
  page4.drawText("Total Cost of Repairs 4,597.17", { x: 42, y: 632, size: 8, font });
  page4.drawText("Net Cost of Repairs 4,097.17", { x: 42, y: 616, size: 8, font });

  const page5 = doc.getPage(4);
  page5.drawText("SUPPLEMENT SUMMARY", { x: 42, y: 716, size: 10, font });
  drawCccEstimateRow(page5, font, 23, "LKQ", "Repl", "Grille chrome horizontal bars deleted/added", "", "$185.00", 696);
  page5.drawText("NOTE: not correct style for vehicle", { x: 100, y: 682, size: 8, font });
  drawCccEstimateRow(page5, font, 40, "", "Subl", "In-proc repair scan", "0.5", "$75.00", 666);
  drawCccEstimateRow(page5, font, 41, "", "Subl", "Seat belt dynamic function test", "0.4", "$52.00", 650);
  drawCccEstimateRow(page5, font, 43, "", "Subl", "Final road test", "0.3", "$40.00", 634);

  const page6 = doc.getPage(5);
  page6.drawText("SUPPLEMENT SUMMARY CONTINUED", { x: 42, y: 716, size: 10, font });
  drawCccEstimateRow(page6, font, 44, "", "Subl", "REVVAdas Report", "", "$0.00", 696);
  page6.drawText("Egnyte link: https://example.egnyte.com/21975/supplement-revvadas", { x: 100, y: 682, size: 8, font });
  page6.drawText("Parts total 3,214.95", { x: 42, y: 652, size: 8, font });
  page6.drawText("Net Cost of Repairs 4,097.17", { x: 42, y: 636, size: 8, font });

  const page7 = doc.getPage(6);
  page7.drawText("GEICO disclaimer: scan entries may be abbreviations and are not authorization.", { x: 42, y: 716, size: 8, font });
  page7.drawText("Line 40 disclaimer reference only. Line 41 disclaimer reference only.", { x: 42, y: 700, size: 8, font });

  const page8 = doc.getPage(7);
  page8.drawText("Abbreviations and disclaimer page: ADAS, scan, SRS terms are glossary only.", { x: 42, y: 716, size: 8, font });

  const page9 = doc.getPage(8);
  page9.drawText("CCC MOTOR Guide Pages", { x: 42, y: 716, size: 10, font });
  page9.drawText("MOTOR database included-not-included guide scan operations paint materials labor indicators", { x: 42, y: 696, size: 8, font });

  const page10 = doc.getPage(9);
  page10.drawText("Photo and diagnostic disclaimer: asTech diagnostic terms are not estimate rows.", { x: 42, y: 716, size: 8, font });

  const page11 = doc.getPage(10);
  page11.drawText("ALTERNATE PARTS SUPPLIERS", { x: 42, y: 716, size: 10, font });
  drawCccEstimateRow(page11, font, 23, "LKQ", "Supp", "Fenix Parts LKQ grille chrome horizontal bars", "", "$185.00", 696);
  page11.drawText("NOTE: not correct style for vehicle", { x: 100, y: 682, size: 8, font });

  const page12 = doc.getPage(11);
  page12.drawText("ALTERNATE PARTS SUPPLIERS", { x: 42, y: 716, size: 10, font });
  drawCccEstimateRow(page12, font, 25, "LKQ", "Supp", "Lentini LKQ radiator support", "", "$255.00", 696);

  return await doc.save();
}

async function createShop21975SourcePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText("Shop 21975 estimate", { x: 42, y: 746, size: 10, font });
  page.drawText("Parts", { x: 42, y: 716, size: 10, font });
  drawFragmentedEstimateRow(page, font, 25, "Test fit front bumper", "0.5", "$37.50", 692);
  drawFragmentedEstimateRow(page, font, 27, "OEM style grille chrome horizontal bars", "", "$410.00", 674);
  drawFragmentedEstimateRow(page, font, 29, "Radiator support front end", "", "$520.00", 656);
  page.drawText("Diagnostics and Sublet", { x: 42, y: 630, size: 10, font });
  drawFragmentedEstimateRow(page, font, 43, "Pre-repair scan sublet +34%", "", "$201.00", 606);
  drawFragmentedEstimateRow(page, font, 44, "Post-repair scan sublet +34%", "", "$201.00", 588);
  drawFragmentedEstimateRow(page, font, 45, "Final road test", "0.3", "$22.50", 570);
  page.drawText("Refinish", { x: 42, y: 544, size: 10, font });
  drawFragmentedEstimateRow(page, font, 50, "Finish sand and polish", "0.8", "$60.00", 520);
  page.drawText("Totals / Labor / Paint Supplies", { x: 42, y: 490, size: 10, font });
  page.drawText("Body labor rate $75.00 Paint labor rate $75.00 Paint supplies 3.7 @ $60.00", { x: 42, y: 472, size: 8, font });
  return await doc.save();
}

async function createMultiDeltaCarrierPdf(rows) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText("Carrier multi-delta estimate", { x: 42, y: 746, size: 10, font });
  page.drawText("Operations", { x: 42, y: 716, size: 10, font });
  rows.forEach((row, index) => {
    drawFragmentedEstimateRow(page, font, row.line, row.description, row.labor, row.amount, 692 - index * 18);
  });
  return await doc.save();
}

async function createShop21896LowerEstimatePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  const rows = [
    "Shop 21896 lower estimate",
    "Net Cost of Repairs $11,892.26",
    "REAR SUSPENSION",
    "60 Repl LT Hub assy $250.00 1.0",
    "61 R&I Rear suspension access $85.00 0.5",
    "ENGINE COMPARTMENT",
    "90 Rpr Engine compartment setup $45.00 0.2",
    "VEHICLE DIAGNOSTICS",
    "130 Subl Pre-repair scan $75.00 0.0",
    "REFINISH",
    "150 Rpr Finish sand and polish $80.00 0.8",
    "CCC/MOTOR guide and abbreviation boilerplate only",
  ];
  rows.forEach((row, index) => {
    page.drawText(row, { x: 42, y: 744 - index * 18, size: 8, font });
  });
  return await doc.save();
}

function drawFragmentedEstimateRow(page, font, line, description, labor, amount, y) {
  page.drawText(String(line), { x: 48, y, size: 8, font });
  page.drawText(description, { x: 82, y, size: 8, font });
  if (labor) page.drawText(labor, { x: 330, y, size: 8, font });
  page.drawText(amount, { x: 412, y, size: 8, font });
}

function drawCccEstimateRow(page, font, line, symbol, operation, description, labor, amount, y) {
  page.drawText(String(line), { x: 48, y, size: 8, font });
  if (symbol) page.drawText(symbol, { x: 66, y, size: 8, font });
  if (operation) page.drawText(operation, { x: 88, y, size: 8, font });
  page.drawText(description, { x: 126, y, size: 8, font });
  if (labor) page.drawText(labor, { x: 350, y, size: 8, font });
  if (amount) page.drawText(amount, { x: 430, y, size: 8, font });
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

function assertNoDetailLayoutOverlap(blocks) {
  const byPage = new Map();
  for (const block of blocks) {
    if (block.blockType === "footer") continue;
    const pageBlocks = byPage.get(block.pageIndex) ?? [];
    pageBlocks.push(block);
    byPage.set(block.pageIndex, pageBlocks);
  }

  for (const [pageIndex, pageBlocks] of byPage.entries()) {
    const sorted = pageBlocks.sort((a, b) => b.topY - a.topY || b.bottomY - a.bottomY);
    for (let index = 1; index < sorted.length; index += 1) {
      assert.ok(
        sorted[index].topY <= sorted[index - 1].bottomY,
        `detail layout overlap on page ${pageIndex}: ${sorted[index - 1].blockType} and ${sorted[index].blockType}`
      );
    }
  }
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(Buffer.from(bytes)).digest("hex");
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

function loadAnnotatedEstimateRouteWithMocks({ report, attachments, findings }) {
  const originalLoad = Module._load;
  const routePath = path.join(process.cwd(), "src", "app", "api", "reports", "citation-density", "annotated-estimate", "route.ts");
  delete require.cache[require.resolve(routePath)];
  Module._load = function loadWithRouteMocks(request, parent, isMain) {
    if (request === "@/lib/auth/require-current-user") {
      class UnauthorizedError extends Error {
        constructor(message, status = 401) {
          super(message);
          this.status = status;
        }
      }
      return {
        UnauthorizedError,
        requireCurrentUser: async () => ({ user: { id: "user-21975" } }),
      };
    }
    if (request === "@/lib/analysisReportStore") {
      return {
        getAnalysisReport: async () => report,
        getLatestActiveAnalysisReport: async () => report,
      };
    }
    if (request === "@/lib/uploadedAttachmentStore") {
      return {
        getUploadedAttachments: async (ids) => ids.map((id) => attachments.find((attachment) => attachment.id === id)).filter(Boolean),
      };
    }
    if (request === "@/lib/ai/builders/estimateScrubberPdfBuilder") {
      return {
        buildAnnotatedEstimateReviewModel: () => ({ citationDensityFindings: findings }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(routePath);
  } finally {
    Module._load = originalLoad;
  }
}

function loadOemCitationDensityRouteWithMocks({ report, attachments, driveEnabled = false, driveRetrievalResponse = null, driveRetrievalCalls }) {
  const originalLoad = Module._load;
  const routePath = path.join(process.cwd(), "src", "app", "api", "reports", "oem-citation-density", "annotated-estimate", "route.ts");
  delete require.cache[require.resolve(routePath)];
  Module._load = function loadWithRouteMocks(request, parent, isMain) {
    if (request === "@/lib/auth/require-current-user") {
      class UnauthorizedError extends Error {
        constructor(message, status = 401) {
          super(message);
          this.status = status;
        }
      }
      return {
        UnauthorizedError,
        requireCurrentUser: async () => ({ user: { id: "user-oem" } }),
      };
    }
    if (request === "@/lib/analysisReportStore") {
      return {
        getAnalysisReport: async () => report,
        getLatestActiveAnalysisReport: async () => report,
      };
    }
    if (request === "@/lib/uploadedAttachmentStore") {
      return {
        getUploadedAttachments: async (ids) => ids.map((id) => attachments.find((attachment) => attachment.id === id)).filter(Boolean),
      };
    }
    if (request === "@/lib/drive/download") {
      return {
        isDriveEnabled: () => driveEnabled,
      };
    }
    if (request === "@/lib/ai/driveRetrievalService") {
      return {
        retrieveDriveSupport: async (params) => {
          if (driveRetrievalCalls) driveRetrievalCalls.push(params);
          return driveRetrievalResponse;
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(routePath);
  } finally {
    Module._load = originalLoad;
  }
}

(async () => {
  await run("dataUrlToPdfBytes decodes uploaded PDF bytes and rejects non-PDF data", async () => {
    const bytes = await createSourcePdf();
    const dataUrl = `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`;
    assert.ok(dataUrlToPdfBytes(dataUrl).byteLength > 0);
    assert.equal(dataUrlToPdfBytes("data:text/plain;base64,SGVsbG8="), null);
  });

  await run("Work Auth labor-rate contract text is rejected as a bad estimate anchor", async () => {
    const sourcePdfBytes = await createWorkAuthorizationPdf();
    await assert.rejects(
      () => buildAnnotatedCitationDensityEstimatePdf({
        sourcePdfBytes,
        sourcePdfName: "Work Auth 21638.pdf",
        sourceText: [
          "CONTRACT OF REPAIR",
          "Customer acknowledges Repairer has posted labor rates and daily protective care and custody",
          "Assignment of Proceeds",
          "Physical inspection demand",
        ].join("\n"),
        findings: [
          baseFinding({
            id: "citation-density-labor-rates",
            operationLabel: "Customer acknowledges Repairer has posted labor rates",
            carrierEvidence: {
              lineNumber: null,
              description: "Customer acknowledges Repairer has posted labor rates and daily protective care and custody $95.00",
              amount: 95,
              laborHours: null,
              sourceLabel: "Carrier estimate",
            },
          }),
        ],
        request: { includeLegend: false, annotationMode: "both", estimateRole: "carrier" },
      }),
      (error) => {
        assert.match(error.message, /no findings matched extracted anchors|no annotations rendered/i);
        assert.ok(error.debugTrace.badAnchorRejectedCount >= 1);
        assert.equal(error.debugTrace.sourceAnchorDocumentType, "work_authorization");
        assert.match(error.debugTrace.badAnchorRejectReasons.join(" "), /support_contract|legal_notice|bad anchor rejected/i);
        return true;
      }
    );
  });

  await run("Delta Citation Density rejects production boilerplate/header anchors before rendering", async () => {
    const sourcePdfBytes = await createProductionBadAnchorFixturePdf();
    const { anchors } = await extractCitationDensityRowAnchors(sourcePdfBytes, {
      sourceDocumentRole: "carrier",
      sourceDocumentId: "carrier-estimate",
      actualSourcePdfName: "SOR2.pdf",
    });
    const cases = [
      {
        name: "page 10 MOTOR/CCC boilerplate",
        pattern: /motor crash estimating guide/i,
        operationLabel: "Non-OEM CAPA/LKQ issue",
        category: "parts_downgrade",
        expected: /motor ccc boilerplate|boilerplate/i,
      },
      {
        name: "page 11 insurer aftermarket-parts policy",
        pattern: /named insurance company'?s parts policy/i,
        operationLabel: "Mask jambs",
        category: "refinish",
        expected: /insurer policy language|policy/i,
      },
      {
        name: "page 9 fraud/legal disclaimer",
        pattern: /any person who knowingly/i,
        operationLabel: "Tint color",
        category: "refinish",
        expected: /legal disclaimer|legal/i,
      },
      {
        name: "page 1 vehicle options/header block",
        pattern: /air conditioning navigation heated seat/i,
        operationLabel: "Steering angle sensor calibration",
        category: "adas_calibration",
        expected: /vehicle options block|header block|header/i,
      },
      {
        name: "sourceLine 2019",
        pattern: /^2019 Vehicle options/i,
        operationLabel: "Steering column replacement",
        category: "structural_or_fit_verification",
        expected: /impossible estimate line number 2019|header block/i,
      },
      {
        name: "sourceLine 4717",
        pattern: /^4717 Vehicle options/i,
        operationLabel: "Steering column replacement",
        category: "structural_or_fit_verification",
        expected: /impossible estimate line number 4717|header block/i,
      },
    ];

    for (const testCase of cases) {
      const anchor = anchors.find((item) => testCase.pattern.test(item.rowText));
      assert.ok(anchor, `expected fixture anchor for ${testCase.name}`);
      try {
        const result = await buildAnnotatedCitationDensityEstimatePdf({
          sourcePdfBytes,
          sourcePdfName: "SOR2.pdf",
          sourceText: "",
          findings: [
            baseFinding({
              id: `citation-density-production-${testCase.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
              operationLabel: testCase.operationLabel,
              category: testCase.category,
              anchorId: anchor.anchorId,
              carrierEvidence: {
                lineNumber: anchor.lineNumber ?? "section",
                description: anchor.rowText,
                amount: null,
                laborHours: null,
                sourceLabel: "Carrier estimate",
              },
            }),
          ],
          request: { includeLegend: false, includeUnanchoredAppendix: true, annotationMode: "both", estimateRole: "carrier" },
        });
        assert.equal(result.annotationMetadata.length, 0, `${testCase.name} must not render a visible annotation`);
        if ((result.debugTrace.badAnchorRejectedCount ?? 0) > 0) {
          assert.match(result.debugTrace.badAnchorRejectReasons.join(" "), testCase.expected);
          assert.match(result.debugTrace.droppedFindings.map((item) => item.reason).join(" "), /anchor rejected|bad anchor rejected/i);
        }
      } catch (error) {
        if (!/no findings matched extracted anchors|no annotations rendered/i.test(error.message)) {
          throw error;
        }
        if ((error.debugTrace.badAnchorRejectedCount ?? 0) > 0) {
          assert.match(error.debugTrace.badAnchorRejectReasons.join(" "), testCase.expected);
          assert.match(error.debugTrace.droppedFindings.map((item) => item.reason).join(" "), /anchor rejected|bad anchor rejected/i);
        }
      }
    }
  });

  await run("Delta Citation Density preserves valid SOR2 page 4 line 55 estimate anchor", async () => {
    const sourcePdfBytes = await createProductionBadAnchorFixturePdf({ includeValidEstimateRow: true });
    const { anchors } = await extractCitationDensityRowAnchors(sourcePdfBytes, {
      sourceDocumentRole: "carrier",
      sourceDocumentId: "carrier-estimate",
      actualSourcePdfName: "SOR2.pdf",
    });
    const anchor = anchors.find((item) => item.pageNumber === 4 && String(item.lineNumber) === "55" && /A\/M molding/i.test(item.rowText));
    assert.ok(anchor, "expected page 4 line 55 A/M molding anchor");
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      sourcePdfName: "SOR2.pdf",
      sourceText: "",
      findings: [
        baseFinding({
          id: "citation-density-production-valid-line-55",
          operationLabel: "A/M molding",
          category: "parts_downgrade",
          anchorId: anchor.anchorId,
          carrierEvidence: {
            lineNumber: "55",
            description: "55 Repl A/M molding 0.2 $66.75",
            amount: 66.75,
            laborHours: 0.2,
            sourceLabel: "Carrier estimate",
          },
        }),
      ],
      request: { includeLegend: false, annotationMode: "both", estimateRole: "carrier" },
    });

    assert.equal(result.annotationMetadata.length, 1);
    assert.equal(result.annotationMetadata[0].sourcePageNumber, 4);
    assert.equal(result.annotationMetadata[0].sourceLineNumber, "55");
    assert.match(result.annotationMetadata[0].sourceAnchorText, /A\/M molding/i);
    assert.equal(result.debugTrace.badAnchorRejectedCount, 0);
  });

  await run("classifyPartSource detects AM LKQ CAPA OEM and used variants without unrelated matches", async () => {
    assert.deepEqual(classifyPartSource("Line 5 Repl A/M bumper cover"), ["AM"]);
    assert.deepEqual(classifyPartSource("Line 5 Repl AM bumper cover"), ["AM"]);
    assert.deepEqual(classifyPartSource("Line 23 LKQ grille chrome"), ["LKQ"]);
    assert.deepEqual(classifyPartSource("Line 10 A/M CAPA lamp bracket"), ["AM", "CAPA"]);
    assert.deepEqual(classifyPartSource("Line 5 OEM bumper chrome"), ["OEM"]);
    assert.deepEqual(classifyPartSource("Line 5 OE bumper chrome"), ["OE"]);
    assert.deepEqual(classifyPartSource("Line 5 Used recycled reconditioned recond reman remanufactured part"), [
      "USED",
      "RECYCLED",
      "RECONDITIONED",
      "REMAN",
    ]);
    assert.deepEqual(classifyPartSource("Line 5 damage repair primer labor"), []);
  });

  await run("PDF row anchors expose deterministic estimate-row fields and model-safe selection text", async () => {
    const sourcePdfBytes = await createKiaLikeEstimatePdf();
    const anchors = await extractPdfRowAnchors(sourcePdfBytes, {
      sourceDocumentRole: "carrier",
      sourceDocumentId: "carrier-source",
    });
    const line49 = anchors.find((anchor) => anchor.lineNumber === "49");
    const line64 = anchors.find((anchor) => anchor.lineNumber === "64");
    const totals = anchors.find((anchor) =>
      anchor.anchorType === "totals_row" && /Paint supplies total/.test(anchor.rowText)
    );
    const options = buildEstimateRowAnchorSelectionOptions(anchors);

    assert.ok(line49);
    const option49 = options.find((option) => option.anchorId === line49.anchorId);
    assert.equal(line49.anchorId, "carrier-source:p1:49:estimate_line");
    assert.equal(line49.sourceDocumentRole, "carrier");
    assert.equal(line49.section, "parts");
    assert.match(line49.description, /A\/M bumper cover/);
    assert.equal(line49.qty, 1);
    assert.equal(line49.price, 312.4);
    assert.ok(line49.pdfBoundingBox.width > 0);
    assert.equal(line49.pdfQuad.length, 8);
    assert.ok(line49.normalizedUiRect.xPct > 0 && line49.normalizedUiRect.xPct < 1);
    assert.ok(line49.normalizedUiRect.yPct > 0 && line49.normalizedUiRect.yPct < 1);

    assert.ok(line64);
    assert.equal(line64.lineNumber, "64");
    assert.match(line64.description, /Blind spot radar calibration/);
    assert.equal(line64.labor, 1.2);
    assert.equal(line64.price, 210);

    assert.ok(totals);
    assert.equal(totals.anchorType, "totals_row");
    assert.match(totals.rowText, /Paint supplies total/);

    assert.ok(option49);
    assert.equal(option49.anchorId, line49.anchorId);
    assert.match(option49.text, /Line 49/);
    assert.match(option49.text, /Qty 1/);
    assert.equal(Object.prototype.hasOwnProperty.call(option49, "x"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(option49, "pdfQuad"), false);
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
    assert.equal(loaded.getPageCount(), 3);
    assert.equal(result.annotationMetadata.length, 1);
    assert.equal(await getOriginalPageAnnotationCount(result.bytes), 1);
    const comments = await extractOriginalPageAnnotationText(result.bytes);
    const pageTexts = await extractPdfPageTexts(result.bytes);
    assert.doesNotMatch(pageTexts[0], /NEEDS INVOICE|NEEDS OEM|Estimate line:|Current support:|Missing proof:|Next action:/);
    assert.match(pageTexts.slice(1).join(" "), /Citation Density Finding Details/);
    assert.match(pageTexts.slice(1).join(" "), /NEEDS INVOICE|NEEDS OEM/);
    assert.match(result.annotationMetadata[0].comment, /Label:/);
    assert.match(result.annotationMetadata[0].comment, /Finding id: finding-1/);
    assert.match(result.annotationMetadata[0].comment, /Anchor id:/);
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
    assert.doesNotMatch(pages[0], /NEEDS INVOICE|NEEDS OEM|Finding Details|Missing proof|Next action/);
    assert.match(pages.slice(1).join(" "), /Citation Density Finding Details/);
    assert.match(pages.slice(1).join(" "), /Finding number:\s*1/);
    assert.doesNotMatch(pages[0], /Estimate line:|Current support:|Missing proof:|Next action:/);
    assert.equal(result.annotationMetadata[0].findingId, "finding-1");
    assert.equal(result.annotationMetadata[0].pageNumber, 1);
    assert.match(result.annotationMetadata[0].estimateLine, /Line 12: ADAS calibration/);
    assert.doesNotMatch(pages.join(" "), /Citation Density Gap Report|Estimate gaps ranked by repair impact/i);
    assert.ok(result.debugTrace);
    assert.equal(result.debugTrace.extractedAnchorCount > 0, true);
    assert.equal(result.debugTrace.findingCount, 1);
    assert.equal(result.debugTrace.anchoredFindingCount, 1);
    assert.equal(result.debugTrace.renderedPdfAnnotationCount, 1);
    assert.equal(result.debugTrace.metadataArtifactId, result.debugTrace.renderedPdfArtifactId);
  });

  await run("finding detail pages paginate long fields without omitting anchored content", async () => {
    const sourcePdfBytes = await createLongFindingDetailSourcePdf();
    const longWhy = [
      "WHY SENTINEL ALPHA",
      Array.from({ length: 160 }, (_, index) => `why-detail-${index}`).join(" "),
      "WHY SENTINEL OMEGA",
    ].join(" ");
    const longNext = [
      "NEXT SENTINEL ALPHA",
      Array.from({ length: 190 }, (_, index) => `next-action-${index}`).join(" "),
      "NEXT SENTINEL OMEGA",
    ].join(" ");
    const longSupport = [
      "SUPPORT SENTINEL ALPHA",
      Array.from({ length: 80 }, (_, index) => `https://support.example.com/claim/long-reference-${index}`).join("; "),
      "SUPPORT SENTINEL OMEGA",
    ].join("; ");
    const detailRows = [
      {
        lineNumber: "12",
        description: "LONG SOURCE ROW SENTINEL ALPHA ADAS calibration LONG SOURCE ROW SENTINEL OMEGA",
      },
      { lineNumber: "13", description: "Pre repair scan diagnostic row" },
      { lineNumber: "14", description: "Post repair scan diagnostic row" },
      { lineNumber: "15", description: "ADAS report referenced link row" },
      { lineNumber: "16", description: "Paint material rate difference row" },
    ];
    const findings = detailRows.map((row, index) => baseFinding({
      id: `long-detail-${index + 1}`,
      operationLabel: `ADAS calibration long detail ${index + 1}`,
      carrierEvidence: {
        lineNumber: row.lineNumber,
        description: row.description,
        amount: 250,
        laborHours: 1.5,
        sourceLabel: "Carrier estimate",
      },
      currentSupportSummary: `Support summary for long detail ${index + 1}`,
      missingProofSummary: `Missing proof for long detail ${index + 1}. ${longWhy}`,
      recommendedNextAction: `Recommended action for long detail ${index + 1}. ${longNext}`,
      bestAvailableAuthority: {
        title: longSupport,
        authorityType: "oem",
        status: "missing",
      },
    }));

    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      findings,
      request: { includeLegend: false, includeSummaryPage: false, annotationMode: "both", estimateRole: "carrier" },
    });
    const loaded = await PDFDocument.load(result.bytes);
    const pages = await extractPdfPageTexts(result.bytes);
    const detailText = pages.slice(result.originalPageCount).join(" ");

    assert.equal(result.originalPageCount, 1);
    assert.equal(result.annotatedFindingCount, findings.length);
    assert.equal(result.unresolvedAnchorCount, 0);
    assert.equal(await getOriginalPageAnnotationCount(result.bytes), result.annotatedFindingCount);
    assert.ok(result.debugTrace.renderedPdfAnnotationCount > 0);
    assert.equal(result.debugTrace.renderedPdfAnnotationCount, findings.length);
    assert.ok(loaded.getPageCount() >= result.originalPageCount + findings.length + 1);
    for (let index = 1; index <= findings.length; index += 1) {
      assert.match(detailText, new RegExp(`Finding number:\\s*${index}`));
      assert.match(detailText, new RegExp(`long-detail-${index}`));
    }
    const detailLayoutBlocks = result.debugTrace.detailLayoutBlocks;
    assert.ok(detailLayoutBlocks.length > 0);
    assertNoDetailLayoutOverlap(detailLayoutBlocks);
    const findingHeaderPages = detailLayoutBlocks
      .filter((block) => block.blockType === "finding-header")
      .map((block) => ({ findingNumber: block.findingNumber, pageIndex: block.pageIndex }));
    assert.equal(findingHeaderPages.length, findings.length);
    assert.equal(new Set(findingHeaderPages.map((block) => block.pageIndex)).size, findings.length);
    for (let index = 1; index < findingHeaderPages.length; index += 1) {
      assert.ok(findingHeaderPages[index].pageIndex > findingHeaderPages[index - 1].pageIndex);
    }
    const continuationPages = detailLayoutBlocks
      .filter((block) => block.blockType === "continuation-header")
      .map((block) => block.findingNumber);
    assert.ok(continuationPages.includes(1));
    assert.match(detailText, /LONG SOURCE ROW SENTINEL ALPHA/);
    assert.match(detailText, /LONG SOURCE ROW SENTINEL OMEGA/);
    assert.match(detailText, /WHY SENTINEL ALPHA/);
    assert.match(detailText, /WHY SENTINEL OMEGA/);
    assert.match(detailText, /NEXT SENTINEL ALPHA/);
    assert.match(detailText, /NEXT SENTINEL OMEGA/);
    assert.match(detailText, /SUPPORT SENTINEL ALPHA/);
    assert.match(detailText, /SUPPORT SENTINEL OMEGA/);
    assert.match(detailText, /Finding 1 continued/);
  });

  await run("Citation Density delta report annotates more than four row-backed estimate differences", async () => {
    const deltaRows = [
      { line: 11, description: "Pre-repair scan", labor: "0.5", amount: "$75.00", shopLabor: "0.8", shopAmount: "$150.00" },
      { line: 12, description: "Post-repair scan", labor: "0.5", amount: "$75.00", shopLabor: "0.8", shopAmount: "$150.00" },
      { line: 13, description: "Camera calibration", labor: "0.6", amount: "$120.00", shopLabor: "1.2", shopAmount: "$240.00" },
      { line: 14, description: "Four wheel alignment", labor: "0.3", amount: "$40.00", shopLabor: "0.9", shopAmount: "$135.00" },
      { line: 15, description: "Seat belt inspection", labor: "0.2", amount: "$28.00", shopLabor: "0.7", shopAmount: "$98.00" },
      { line: 16, description: "Hood panel repair", labor: "0.4", amount: "$60.00", shopLabor: "1.0", shopAmount: "$150.00" },
      { line: 17, description: "Fender liner replace", labor: "0.3", amount: "$45.00", shopLabor: "0.8", shopAmount: "$120.00" },
    ];
    const sourcePdfBytes = await createMultiDeltaCarrierPdf(deltaRows);
    const formatFixtureRow = (line, description, labor, amount) =>
      `Line ${line} ${description}${labor ? ` ${labor} hrs` : ""} ${amount}`;
    const rawEstimateText = deltaRows
      .map((row) => formatFixtureRow(row.line, row.description, row.labor, row.amount))
      .join("\n");
    const estimateComparisons = {
      rows: deltaRows.map((row) => ({
        id: `delta-row-${row.line}`,
        category: "Operations",
        operation: row.description,
        lhsSource: "Shop estimate",
        rhsSource: "Carrier estimate",
        lhsValue: formatFixtureRow(row.line, row.description, row.shopLabor, row.shopAmount),
        rhsValue: formatFixtureRow(row.line, row.description, row.labor, row.amount),
        delta: `Carrier lower than shop for line ${row.line}`,
        deltaType: "changed",
      })),
    };
    const model = buildAnnotatedEstimateReviewModel({
      report: null,
      analysis: {
        mode: "comparison",
        issues: [],
        operations: [],
        evidence: [],
        findings: [],
        summary: { confidence: "high" },
        rawEstimateText,
        estimateComparisons,
      },
      panel: null,
      assistantAnalysis: null,
    });
    const deltaFindings = model.citationDensityFindings.filter((finding) => /-comparison-/i.test(finding.id));

    assert.ok(deltaFindings.length > 4);
    assert.equal(model.citationDensityDiagnostics.annotationLimitApplied, false);
    assert.equal(model.citationDensityDiagnostics.maxAnnotationLimit, null);
    assert.equal(model.citationDensityDiagnostics.totalDeltaCandidates, deltaRows.length);
    assert.ok(model.citationDensityDiagnostics.acceptedDeltaFindings > 4);

    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      sourceDocumentId: "carrier-multi-delta",
      sourcePdfName: "Carrier Multi Delta Estimate.pdf",
      sourceText: rawEstimateText,
      findings: deltaFindings,
      deltaDiagnostics: model.citationDensityDiagnostics,
      request: { includeLegend: false, annotationMode: "both", estimateRole: "carrier" },
    });
    const deltaAnnotations = result.annotationMetadata.filter((item) => /-comparison-/i.test(item.findingId));
    const traceTools = result.debugTrace.toolUsageTrace.map((entry) => entry.tool);
    const imageOcrTrace = result.debugTrace.toolUsageTrace.find((entry) => entry.tool === "image_photo_ocr_evidence");

    assert.ok(result.annotatedFindingCount > 4);
    assert.ok(deltaAnnotations.length > 4);
    assert.equal(result.debugTrace.annotationLimitApplied, false);
    assert.equal(result.debugTrace.maxAnnotationLimit, null);
    assert.equal(result.debugTrace.totalDeltaCandidates, deltaRows.length);
    assert.ok(result.debugTrace.acceptedDeltaFindings > 4);
    assert.ok(result.debugTrace.unannotatedMaterialDeltas.length < result.debugTrace.totalDeltaCandidates);
    assert.ok(traceTools.includes("estimate_comparison_delta_engine"));
    assert.ok(traceTools.includes("row_anchor_matcher"));
    assert.ok(traceTools.includes("annotation_qa"));
    assert.ok(traceTools.includes("finding_validator"));
    assert.ok(traceTools.includes("support_evidence_ledger"));
    assert.ok(imageOcrTrace);
    assert.equal(imageOcrTrace.ran, false);
    assert.match(imageOcrTrace.skipReason, /no image\/photo\/OCR evidence/i);
    assert.ok(deltaAnnotations.every((annotation) =>
      deltaRows.some((row) =>
        annotation.sourceLineNumber === String(row.line) &&
        new RegExp(row.description, "i").test(annotation.sourceAnchorText)
      )
    ));
  });

  await run("Citation Density and OEM Citation Density reject mismatched artifact identities", async () => {
    const sourcePdfBytes = await createSourcePdf();
    await assert.rejects(
      buildAnnotatedCitationDensityEstimatePdf({
        sourcePdfBytes,
        findings: [
          baseFinding({
            id: "oem-citation-density-wrong-viewer",
            reportType: "oem-citation-density",
          }),
        ],
        request: { includeLegend: false, annotationMode: "both", estimateRole: "carrier" },
      }),
      (error) => {
        assert.match(error.message, /OEM Citation Density Report finding/i);
        assert.equal(error.debugTrace.artifactReportType, "oem-citation-density");
        assert.equal(error.debugTrace.findingIdPrefixCheckPassed, false);
        return true;
      }
    );

    await assert.rejects(
      buildAnnotatedCitationDensityEstimatePdf({
        sourcePdfBytes,
        findings: [
          baseFinding({
            id: "citation-density-wrong-viewer",
            reportType: "citation-density",
          }),
        ],
        reportIdentity: OEM_CITATION_DENSITY_REPORT_IDENTITY,
        request: { includeLegend: false, annotationMode: "both", estimateRole: "carrier" },
      }),
      (error) => {
      assert.match(error.message, /Delta Citation Density Report finding/i);
        assert.equal(error.debugTrace.artifactReportType, "citation-density");
        assert.equal(error.debugTrace.findingIdPrefixCheckPassed, false);
        return true;
      }
    );
  });

  await run("blank annotation output hard-fails when anchors exist but no finding matches", async () => {
    const sourcePdfBytes = await createSourcePdf();
    await assert.rejects(
      buildAnnotatedCitationDensityEstimatePdf({
        sourcePdfBytes,
        findings: [
          baseFinding({
            id: "bad-anchor",
            anchorId: "carrier-source:p1:999:estimate_line",
            operationLabel: "No matching anchor should render",
            carrierEvidence: {
              description: "No matching anchor should render",
              sourceLabel: "Carrier estimate",
            },
          }),
        ],
        request: { includeLegend: false, includeSummaryPage: false, annotationMode: "both" },
      }),
      /Findings generated but no findings matched extracted anchors/
    );
  });

  await run("unmatched findings hard-fail when extracted estimate anchors exist", async () => {
    const sourcePdfBytes = await createSourcePdf();
    await assert.rejects(
      buildAnnotatedCitationDensityEstimatePdf({
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
      }),
      /Findings generated but no findings matched extracted anchors/
    );
  });

  await run("anchor fallback hard-fails instead of accepting appendix-only output", async () => {
    const sourcePdfBytes = await createTwoPageSourcePdf();
    await assert.rejects(
      buildAnnotatedCitationDensityEstimatePdf({
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
      }),
      /Findings generated but no findings matched extracted anchors/
    );
  });

  await run("unmatched page-level cues are suppressed from visible estimate annotations", async () => {
    const sourcePdfBytes = await createTwoPageSourcePdf();
    await assert.rejects(
      buildAnnotatedCitationDensityEstimatePdf({
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
      }),
      /Findings generated but no findings matched extracted anchors/
    );
  });

  await run("zero extracted PDF anchors fail closed instead of producing appendix-only output", async () => {
    const sourcePdfBytes = await createBlankSourcePdf(1);
    await assert.rejects(
      buildAnnotatedCitationDensityEstimatePdf({
        sourcePdfBytes,
        sourceText: "Line 12 ADAS calibration 1.5 hrs $250.00",
        findings: [baseFinding()],
        request: { includeLegend: false, includeSummaryPage: false, annotationMode: "both" },
      }),
      /Delta Citation Density Report could not extract selectable text from the selected estimate PDF/
    );
  });

  await run("generic and corrupted finding labels are suppressed before visible annotation metadata", async () => {
    const sourcePdfBytes = await createSourcePdf();
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      findings: [
        baseFinding({ id: "generic-repair", operationLabel: "Repair Operation" }),
        baseFinding({ id: "proc-report", operationLabel: "Proc Report" }),
        baseFinding({ id: "screenshot-cue", operationLabel: "Comparison or screenshot cues" }),
        baseFinding({ id: "bad-pre-scan", operationLabel: "Proc Pre-repair scanm" }),
        baseFinding({
          id: "guide-legend",
          operationLabel: "A/M=AFTERMARKET CAPA definitions LKQ/RCY/USED definitions",
          carrierEvidence: null,
          currentSupportSummary: "CCC/MOTOR guide paragraphs and abbreviation legend text.",
          missingProofSummary: "Aftermarket crash part boilerplate disclaimer page.",
        }),
        baseFinding({
          id: "equipment-footer",
          operationLabel: "Vehicle equipment list",
          carrierEvidence: null,
          currentSupportSummary: "Vehicle equipment: 4 Wheel DriveTilt WheelFM RadioSkyview Roof",
          missingProofSummary: "Totals footer merge claim owner VIN deductible page text.",
        }),
      ],
      request: { includeLegend: false, includeUnanchoredAppendix: true, annotationMode: "both" },
    });
    const text = await extractPdfText(result.bytes);

    assert.equal(result.annotatedFindingCount, 0);
    assert.equal(result.unresolvedAnchorCount, 0);
    assert.equal(result.annotationMetadata.length, 0);
    assert.match(result.warnings.join(" "), /suppressed from the visible estimate layer/i);
    assert.doesNotMatch(text, /Repair Operation|Proc Report|Comparison or screenshot cues|Proc Pre-repair scanm|A\/M=AFTERMARKET|CCC\/MOTOR guide|Vehicle equipment|4 Wheel DriveTilt/i);
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
    assert.equal(loaded.getPageCount(), 4);
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

    assert.ok(result.annotatedFindingCount >= 1);
    assert.equal(result.unresolvedAnchorCount, 0);
    assert.match(pages[0], /49\s+A\/M bumper cover/);
    assert.doesNotMatch(pages[0], /NEEDS ADAS|NEEDS INVOICE|REFERENCED \/ NOT PRODUCED/);
    assert.match(pages.slice(1).join(" "), /Citation Density Finding Details/);
    assert.match(pages[0], /A\/M bumper cover/);
    assert.match(result.annotationMetadata.find((item) => item.findingId === "kia-line-49").comment, /Estimate line:/);
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
    assert.doesNotMatch(pages[0], /REFERENCED \/ NOT PRODUCED/);
    assert.match(pages.slice(1).join(" "), /REFERENCED \/ NOT PRODUCED/);
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
    assert.doesNotMatch(pages[0], /NEEDS ADAS|NEEDS OEM|NEEDS INVOICE|ESTIMATE GAP ONLY/);
    assert.match(pages.slice(1).join(" "), /Citation Density Finding Details/);
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

  await run("row anchor index extracts 21975 carrier rows and restores exact row-backed markers", async () => {
    const sourcePdfBytes = await createRam21975SourcePdf();
    const anchors = await extractPdfRowAnchors(sourcePdfBytes, { sourceDocumentRole: "carrier", sourceDocumentId: "carrier-21975" });
    const anchorFor = (pageNumber, lineNumber) =>
      anchors.find((anchor) => anchor.pageNumber === pageNumber && anchor.lineNumber === lineNumber);

    assert.ok(anchors.length > 40, `expected more than 40 SOR-1 anchors, got ${anchors.length}`);
    for (const lineNumber of ["5", "8", "10", "11", "13", "14", "15", "16", "17", "18", "21", "23", "25", "26"]) {
      assert.ok(anchorFor(2, lineNumber), `expected page 2 line ${lineNumber}`);
    }
    assert.ok(anchorFor(2, "23"));
    assert.match(anchorFor(2, "23").noteText, /not correct style for vehicle/i);
    for (const lineNumber of ["39", "40", "41", "42", "43", "44"]) {
      assert.ok(anchorFor(3, lineNumber), `expected page 3 line ${lineNumber}`);
    }
    assert.equal(anchorFor(3, "44").anchorType, "embedded_link_row");
    assert.match(anchorFor(3, "44").rowText, /egnyte/i);
    assert.ok(anchors.some((anchor) => anchor.pageNumber === 4 && anchor.anchorType === "totals_row" && /Parts 3,214\.95/i.test(anchor.rowText)));
    assert.ok(anchors.some((anchor) => anchor.pageNumber === 4 && anchor.anchorType === "totals_row" && /Body Labor 13\.2 hrs @ \$60\/hr/i.test(anchor.rowText)));
    assert.ok(anchors.some((anchor) => anchor.pageNumber === 4 && anchor.anchorType === "totals_row" && /Paint Supplies 3\.2 hrs @ \$40\/hr/i.test(anchor.rowText)));
    assert.ok(anchors.some((anchor) => anchor.pageNumber === 4 && anchor.anchorType === "totals_row" && /Net Cost of Repairs 4,097\.17/i.test(anchor.rowText)));
    assert.ok(anchors.some((anchor) => anchor.pageNumber === 9 && anchor.anchorType === "guide_row" && /MOTOR database/i.test(anchor.rowText)));
    assert.ok(anchorFor(11, "23"));
    assert.equal(anchorFor(11, "23").anchorType, "supplier_row");
    assert.ok(anchorFor(12, "25"));
    assert.equal(anchorFor(12, "25").anchorType, "supplier_row");
    assert.equal(anchors.some((anchor) => /Repair Operation|Proc Report/i.test(anchor.rowText)), false);

    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      findings: [
        baseFinding({
          id: "generic-parts",
          operationLabel: "Parts correctness support",
          category: "parts_downgrade",
          carrierEvidence: undefined,
          missingAuthorityTypes: ["parts correctness support"],
        }),
        baseFinding({
          id: "generic-diagnostics",
          operationLabel: "Diagnostic and ADAS report support",
          category: "scan_diagnostic",
          carrierEvidence: undefined,
          missingAuthorityTypes: ["ADAS report", "scan report"],
        }),
        baseFinding({
          id: "generic-totals",
          operationLabel: "Labor Rate and Paint-Material Delta",
          category: "labor_difference",
          carrierEvidence: undefined,
          missingAuthorityTypes: ["P-page/DEG"],
        }),
        baseFinding({
          id: "generic-supplier",
          operationLabel: "Supplier parts evidence",
          category: "parts_downgrade",
          carrierEvidence: undefined,
          missingAuthorityTypes: ["supplier evidence"],
        }),
        baseFinding({
          id: "generic-structural-frame",
          operationLabel: "Structural frame and measurement verification",
          category: "structural_or_fit_verification",
          carrierEvidence: undefined,
          missingAuthorityTypes: ["measurement support"],
        }),
      ],
      request: { includeLegend: false, annotationMode: "both", estimateRole: "carrier" },
    });
    const pages = await extractPdfPageTexts(result.bytes);
    const metadataFor = (pageNumber, lineNumber) =>
      result.annotationMetadata.find((item) => item.pageNumber === pageNumber && item.sourceLineNumber === lineNumber);

    assert.ok(result.debugMetadata.extractedRowAnchorCount > 40);
    assert.ok(result.debugMetadata.visibleAnnotationCount > 0);
    assert.doesNotMatch(result.warnings.join(" "), /No estimate rows could be extracted from the source PDF/);
    assert.ok(result.debugMetadata.anchorsByPage["2"].includes("line 23"));
    for (const lineNumber of ["39", "40", "41", "42", "43", "44"]) {
      assert.ok(result.debugMetadata.anchorsByPage["3"].includes(`line ${lineNumber}`));
    }
    assert.ok(metadataFor(2, "23"));
    assert.ok(metadataFor(3, "39"));
    assert.ok(metadataFor(3, "40"));
    assert.ok(metadataFor(3, "42"));
    assert.ok(metadataFor(3, "44"));
    assert.equal(metadataFor(3, "44").anchorType, "embedded_link_row");
    assert.notEqual(metadataFor(3, "43").label, "NEEDS ADAS");
    assert.notEqual(metadataFor(2, "23").label, "NEEDS ADAS");
    assert.equal(result.annotationMetadata.find((item) => item.anchorType === "totals_row").label, "NEEDS INVOICE");
    assert.equal(result.annotationMetadata.some((item) => item.pageNumber === 4 && /scan|adas|seat belt/i.test(item.sourceAnchorText)), false);
    assert.equal(result.annotationMetadata.some((item) => item.pageNumber === 7 && /scan|adas|seat belt/i.test(item.sourceAnchorText)), false);
    assert.equal(result.annotationMetadata.some((item) => item.pageNumber === 9 && /scan|adas/i.test(item.sourceAnchorText)), false);
    assert.equal(result.annotationMetadata.some((item) => item.findingId === "generic-structural-frame"), false);
    assert.doesNotMatch(result.warnings.join(" "), /No line-level anchors could be placed/);
    assert.doesNotMatch(pages.join(" "), /No estimate rows could be extracted from the source PDF/);
    assert.doesNotMatch(pages.join(" "), /No line-level anchors could be placed/);
    assert.doesNotMatch(pages.slice(0, result.originalPageCount).join(" "), /NEEDS ADAS|REFERENCED \/ NOT PRODUCED|Missing proof|Next action/);
  });

  await run("SOR-1 selected estimate generates row-backed AM/LKQ vs OEM part-source findings", async () => {
    const sourcePdfBytes = await createRam21975SourcePdf();
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      sourceDocumentId: "sor-1-21975",
      sourcePdfName: "SOR-1 21975.pdf",
      comparisonEstimateTexts: [
        {
          sourceDocumentId: "shop-21975",
          fileName: "Shop 21975.pdf",
          estimateRole: "shop",
          text: [
            "Line 5 Repl OEM Bumper chrome, w/prk snsr",
            "Line 8 Repl OEM Side retainer",
            "Line 10 Repl OEM Lamp bracket",
            "Line 23 OEM style grille chrome horizontal bars",
            "Line 25 OE Radiator support front end",
          ].join("\n"),
        },
      ],
      findings: [],
      request: { includeLegend: false, annotationMode: "both", estimateRole: "carrier" },
    });
    const pages = await extractPdfPageTexts(result.bytes);
    const detailsText = pages.slice(result.originalPageCount).join(" ");
    const partSourceMetadata = result.annotationMetadata.filter((item) =>
      /AM\/LKQ part usage vs OEM part usage/.test(item.shortTitle) ||
      /^part-source-oem-variance-/i.test(item.findingId)
    );

    assert.ok(result.renderedPdfAnnotationCount > 0 || result.debugTrace.renderedPdfAnnotationCount > 0);
    assert.ok(result.debugTrace.partSourceCandidateCount > 0);
    assert.ok(result.debugTrace.partSourceAcceptedCandidateCount > 0);
    assert.ok(result.debugTrace.partSourceRejectedCandidateCount > 0);
    assert.ok(result.debugTrace.partSourceFindingCount > 0);
    assert.ok(result.debugTrace.partSourceAnchoredFindingCount > 0);
    assert.equal(result.debugTrace.partSourceUnanchoredFindingCount, 0);
    assert.equal(result.debugTrace.droppedFindings.some((item) => /fallback matched/i.test(item.reason)), false);
    assert.ok(Array.isArray(result.debugTrace.fallbackMatchedFindings));
    assert.ok(partSourceMetadata.length >= 4, `expected multiple part-source markers, got ${partSourceMetadata.length}`);
    assert.ok(partSourceMetadata.some((item) => item.sourceLineNumber === "5" && item.anchorType === "estimate_line"));
    assert.ok(partSourceMetadata.some((item) => item.sourceLineNumber === "8" && item.anchorType === "estimate_line"));
    assert.ok(partSourceMetadata.some((item) => item.sourceLineNumber === "10" && item.anchorType === "estimate_line"));
    assert.ok(partSourceMetadata.some((item) => item.sourceLineNumber === "23" && item.anchorType === "estimate_line"));
    assert.equal(partSourceMetadata.some((item) => item.anchorType === "supplier_row"), false);
    assert.ok(result.annotationMetadata.some((item) => /A\/M CAPA Bumper chrome, w\/prk snsr/i.test(item.sourceAnchorText)));
    assert.ok(result.annotationMetadata.some((item) => /A\/M Side retainer/i.test(item.sourceAnchorText)));
    assert.ok(result.annotationMetadata.some((item) => /A\/M CAPA Lamp bracket/i.test(item.sourceAnchorText)));
    assert.ok(result.annotationMetadata.some((item) => /LKQ.*Grille chrome horizontal bars/i.test(item.sourceAnchorText)));
    assert.match(detailsText, /AM\/LKQ part usage vs OEM part usage/);
    assert.match(detailsText, /Exact selected row text: .*A\/M CAPA Bumper chrome, w\/prk snsr/i);
    assert.match(detailsText, /Comparison row text: (?:Line )?5 Repl OEM Bumper chrome, w\/prk snsr/i);
    assert.match(detailsText, /Selected part source classification: AM, CAPA/i);
    assert.match(detailsText, /Comparison part source classification: OEM/i);
    assert.match(detailsText, /LKQ/i);
    assert.match(detailsText, /OEM|OE/i);
    assert.equal(
      result.debugTrace.partSourceRows.some((row) => row.anchorId.includes(":p11:") || row.anchorId.includes(":p12:")),
      true
    );
    assert.equal(partSourceMetadata.some((item) => item.sourceLineNumber === "2017"), false);
    assert.ok(result.debugTrace.partSourceComparisonMatches.some((item) =>
      /Bumper chrome/i.test(item.selectedRowText) && /OEM Bumper chrome/i.test(item.comparisonRowText || "")
    ));
  });

  await run("part-source relevance gate rejects vehicle-year and boilerplate rows", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("Carrier estimate relevance fixture", { x: 42, y: 746, size: 10, font });
    page.drawText("2017 Honda Civic AM bumper quality replacement parts notice warranty disclaimer", { x: 48, y: 716, size: 8, font });
    drawCccEstimateRow(page, font, 5, "#", "Repl", "A/M CAPA Bumper chrome, w/prk snsr", "1.0", "$487.50", 696);
    page.drawText("2018 Quality replacement parts may include AM LKQ CAPA parts subject to insurer policy disclaimer", { x: 48, y: 676, size: 8, font });
    const sourcePdfBytes = await doc.save();
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      sourceDocumentId: "relevance-source",
      sourcePdfName: "SOR relevance.pdf",
      findings: [],
      request: { includeLegend: false, annotationMode: "both", estimateRole: "carrier" },
    });

    const partSourceMetadata = result.annotationMetadata.filter((item) => /^part-source-oem-variance-/i.test(item.findingId));
    assert.ok(partSourceMetadata.some((item) => item.sourceLineNumber === "5" && item.anchorType === "estimate_line"));
    assert.equal(partSourceMetadata.some((item) => item.sourceLineNumber === "2017"), false);
    assert.equal(partSourceMetadata.some((item) => /quality replacement parts notice|warranty disclaimer/i.test(item.sourceAnchorText)), false);
    assert.ok(result.debugTrace.partSourceAcceptedCandidateCount > 0);
    assert.ok(result.debugTrace.partSourceRejectedCandidateCount > 0);
    assert.ok(result.debugTrace.rejectedLineNumberCandidates.some((item) => String(item.lineNumber) === "2017"));
    assert.ok(result.debugTrace.partSourceRejectedCandidates.some((item) =>
      item.rejectionReasons.some((reason) => /boilerplate|disclaimer/i.test(reason))
    ));
    assert.equal(result.debugTrace.partSourceFindingCount, partSourceMetadata.length);
    assert.ok(result.debugTrace.renderedPdfAnnotationCount > 0);
  });

  await run("OEM Citation Density generator creates source-page repair-standard findings without verified OEM overclaim", async () => {
    const sourcePdfBytes = await createRam21975SourcePdf();
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      sourceDocumentId: "oem-carrier-21975",
      sourcePdfName: "SOR-1 21975.pdf",
      uploadedFileNames: ["SOR-1 21975.pdf"],
      sourceText: "Carrier estimate evidence only. No OEM procedure attached.",
      findings: [],
      reportIdentity: OEM_CITATION_DENSITY_REPORT_IDENTITY,
      findingGenerator: buildOemCitationDensityFindings,
      request: { includeLegend: false, annotationMode: "both", estimateRole: "carrier" },
    });
    const detailText = (await extractPdfPageTexts(result.bytes)).slice(result.originalPageCount).join(" ");

    assert.equal(result.debugTrace.reportType, "oem-citation-density");
    assert.equal(result.debugTrace.citationDensityArtifactVersion, OEM_CITATION_DENSITY_ARTIFACT_VERSION);
    assert.ok(result.debugTrace.findingCount > 0);
    assert.ok(result.debugTrace.anchoredFindingCount > 0);
    assert.ok(result.debugTrace.renderedPdfAnnotationCount > 0);
    assert.ok(result.debugTrace.findingsWithNextActionCount > 0);
    assert.equal(result.debugTrace.findingsWithoutNextActionCount, 0);
    assert.ok(result.debugTrace.estimateOnlyFindingCount > 0);
    assert.ok(result.debugTrace.firstOemCitationDensityFindings.some((finding) =>
      /part-source|diagnostics|ADAS|calibration/i.test(finding.title) &&
      finding.nextAction.length > 20 &&
      finding.evidenceTier
    ));
    assert.equal(result.annotationMetadata.every((item) => item.findingId && item.anchorId && item.sourceAnchorId === item.anchorId), true);
    assert.equal(result.annotationMetadata.some((item) => item.label === "VERIFIED OEM"), false);
    assert.ok(result.annotationMetadata.some((item) => /LKQ|A\/M|CAPA|scan|calibration/i.test(item.sourceAnchorText)));
    assert.match(detailText, /OEM Citation Density Finding Details/);
    assert.match(detailText, /Next action/i);
    assert.doesNotMatch(detailText, /OEM requires/i);
  });

  await run("OEM Citation Density marks findings authority-trace incomplete when retrieval is unavailable", async () => {
    const sourcePdfBytes = await createRam21975SourcePdf();
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      sourceDocumentId: "oem-carrier-no-authority",
      sourcePdfName: "SOR-1 21975.pdf",
      uploadedFileNames: ["SOR-1 21975.pdf"],
      sourceText: "Carrier estimate evidence only. No OEM procedure attached.",
      findings: [],
      reportIdentity: OEM_CITATION_DENSITY_REPORT_IDENTITY,
      findingGenerator: buildOemCitationDensityFindings,
      request: { includeLegend: false, annotationMode: "both", estimateRole: "carrier" },
    });

    assert.ok(result.annotationMetadata.some((item) => item.label === "AUTHORITY TRACE INCOMPLETE"));
    assert.equal(result.annotationMetadata.some((item) => item.label === "VERIFIED OEM"), false);
    assert.equal(result.debugTrace.authoritySearchTrace.authorityCoverageStatus, "incomplete");
    assert.equal(result.debugTrace.authorityBackedFindingCount, 0);
  });

  await run("OEM Citation Density labels broad position support without marking every line VERIFIED OEM", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("Carrier estimate with broad OEM position support", { x: 42, y: 742, size: 10, font });
    drawCccEstimateRow(page, font, 5, "#", "Repl", "A/M CAPA Bumper chrome, w/prk snsr", "1.0", "$487.50", 712);
    const sourcePdfBytes = await doc.save();

    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      sourceDocumentId: "carrier-position-only",
      sourcePdfName: "Carrier position-only estimate.pdf",
      sourceText: "Uploaded OEM position statement: use OEM repair procedures and position statements when required.",
      findings: [],
      reportIdentity: OEM_CITATION_DENSITY_REPORT_IDENTITY,
      authorityTrace: {
        authorityTraceStarted: true,
        authorityTraceCompleted: true,
        authorityTraceBlockedReason: null,
        authorityCoverageStatus: "partial",
        googleDriveOrInternalSearchRan: true,
        sandPolishSupportFound: false,
        driveSearchAttempted: true,
        driveSearchAvailable: true,
        driveMakeModelFolderMatched: true,
        driveMatchedFolders: ["OEM position statements"],
        driveDocumentsReviewed: ["OEM position statement.pdf"],
        onlineSearchAttempted: false,
        onlineSourcesReviewed: [],
        jurisdictionResolved: null,
        jurisdictionSourcesReviewed: [],
        oemSourcesReviewed: ["OEM position statement.pdf"],
        adasSourcesReviewed: [],
        motorPPageSourcesReviewed: [],
        scrsSourcesReviewed: [],
        policyLegalSourcesReviewed: [],
        authoritySources: [{
          title: "OEM position statement.pdf",
          sourceType: "oem_position_statement",
          evidenceTier: 2,
          verified: true,
        }],
      },
      findingGenerator: buildOemCitationDensityFindings,
      request: { includeLegend: false, annotationMode: "both", estimateRole: "carrier" },
    });

    const labels = result.annotationMetadata.map((item) => item.label);
    assert.ok(labels.includes("OEM POSITION REFERENCED"));
    assert.equal(labels.includes("VERIFIED OEM"), false);
    assert.ok(result.debugTrace.oemPositionStatementSourceCount >= 1);
    assert.equal(result.debugTrace.oemProcedureSourceCount, 0);
  });

  await run("OEM Citation Density labels verified ADAS authority as ADAS, not OEM", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("Carrier estimate with ADAS authority", { x: 42, y: 742, size: 10, font });
    drawCccEstimateRow(page, font, 15, "", "Proc", "Camera calibration", "1.0", "$250.00", 712);
    const sourcePdfBytes = await doc.save();

    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      sourceDocumentId: "carrier-adas-authority",
      sourcePdfName: "Carrier ADAS estimate.pdf",
      sourceText: "Carrier estimate evidence.",
      findings: [],
      reportIdentity: OEM_CITATION_DENSITY_REPORT_IDENTITY,
      authorityTrace: {
        authorityTraceStarted: true,
        authorityTraceCompleted: true,
        authorityTraceBlockedReason: null,
        authorityCoverageStatus: "partial",
        googleDriveOrInternalSearchRan: true,
        sandPolishSupportFound: false,
        driveSearchAttempted: true,
        driveSearchAvailable: true,
        driveMakeModelFolderMatched: true,
        driveMatchedFolders: ["OEM procedures"],
        driveDocumentsReviewed: ["Camera calibration procedure.pdf"],
        onlineSearchAttempted: false,
        onlineSourcesReviewed: [],
        jurisdictionResolved: null,
        jurisdictionSourcesReviewed: [],
        oemSourcesReviewed: ["Camera calibration procedure.pdf"],
        adasSourcesReviewed: ["Camera calibration procedure.pdf"],
        motorPPageSourcesReviewed: [],
        scrsSourcesReviewed: [],
        policyLegalSourcesReviewed: [],
        authoritySources: [{
          title: "Camera calibration procedure.pdf",
          sourceType: "oem_procedure",
          evidenceTier: 1,
          verified: true,
        }],
      },
      findingGenerator: buildOemCitationDensityFindings,
      request: { includeLegend: false, annotationMode: "both", estimateRole: "carrier" },
    });

    const labels = result.annotationMetadata.map((item) => item.label);
    assert.ok(labels.includes("VERIFIED ADAS"));
    assert.equal(labels.includes("VERIFIED OEM"), false);
  });

  await run("OEM Citation Density does not treat glass w/o tint as refinish P-page support", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("Carrier estimate with glass descriptor", { x: 42, y: 742, size: 10, font });
    drawCccEstimateRow(page, font, 12, "", "Repl", "Quarter glass w/o tint", "", "$412.00", 712);
    drawCccEstimateRow(page, font, 13, "A/M", "Repl", "Bumper cover", "0.6", "$250.00", 692);
    const sourcePdfBytes = await doc.save();

    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      sourceDocumentId: "carrier-glass-no-tint",
      sourcePdfName: "Carrier glass estimate.pdf",
      sourceText: "Carrier estimate evidence only. No OEM procedure attached.",
      findings: [],
      reportIdentity: OEM_CITATION_DENSITY_REPORT_IDENTITY,
      findingGenerator: buildOemCitationDensityFindings,
      request: { includeLegend: false, annotationMode: "both", estimateRole: "carrier" },
    });

    assert.equal(result.annotationMetadata.some((item) =>
      item.targetLineNumber === "12" && /NEEDS P-PAGE|refinish/i.test(`${item.label} ${item.shortTitle}`)
    ), false);
    assert.ok(result.annotationMetadata.some((item) => item.targetLineNumber === "13"));
  });

  await run("OEM Citation Density excludes abbreviation legend and disclaimer pages as primary anchors", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    page.drawText("2023 Tesla Model Y carrier estimate", { x: 42, y: 742, size: 10, font });
    page.drawText("A/M=AFTERMARKET CAPA definitions LKQ/RCY/USED definitions", { x: 42, y: 710, size: 8, font });
    page.drawText("Fraud warning disclaimer and CCC/MOTOR guide included/not included paragraphs", { x: 42, y: 692, size: 8, font });
    page.drawText("RECOND REFN R&I abbreviation legend aftermarket crash part boilerplate", { x: 42, y: 674, size: 8, font });
    drawCccEstimateRow(page, font, 21, "A/M", "Repl", "RT Hub assy", "0.6", "$185.00", 650);
    const sourcePdfBytes = await doc.save();

    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      sourceDocumentId: "oem-carrier-21548",
      sourcePdfName: "SOR3 carrier estimate.pdf",
      uploadedFileNames: ["SOR3 carrier estimate.pdf"],
      sourceText: "Carrier estimate evidence only. No OEM procedure attached.",
      findings: [],
      reportIdentity: OEM_CITATION_DENSITY_REPORT_IDENTITY,
      findingGenerator: buildOemCitationDensityFindings,
      request: { includeLegend: false, annotationMode: "both", estimateRole: "carrier" },
    });

    const metadataText = result.annotationMetadata.map((item) => item.sourceAnchorText).join(" ");
    assert.ok(result.annotationMetadata.some((item) => item.sourceLineNumber === "21"));
    assert.match(metadataText, /RT Hub assy/);
    assert.doesNotMatch(metadataText, /A\/M=AFTERMARKET|CAPA definitions|LKQ\/RCY\/USED|Fraud warning|CCC\/MOTOR guide|included\/not included|RECOND|REFN|abbreviation legend|aftermarket crash part/i);
  });

  await run("one selected estimate flags AM/LKQ/CAPA rows for documentation and basis review", async () => {
    const sourcePdfBytes = await createRam21975SourcePdf();
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      sourceDocumentId: "sor-1-21975",
      sourcePdfName: "SOR-1 21975.pdf",
      findings: [],
      request: { includeLegend: false, annotationMode: "both", estimateRole: "carrier" },
    });
    const text = (await extractPdfPageTexts(result.bytes)).slice(result.originalPageCount).join(" ");

    assert.ok(result.debugTrace.partSourceFindingCount > 0);
    assert.ok(result.annotationMetadata.some((item) => item.sourceLineNumber === "5" && item.label === "NEEDS OEM"));
    assert.match(text, /document(?:ed)? part-type authorization/i);
    assert.match(text, /fit\/finish\/style correctness|fit\/finish validation/i);
    assert.match(text, /warranty\/quality/i);
    assert.match(text, /invoice\/supplier|supplier\/invoice/i);
    assert.match(text, /OEM\/insurer basis/i);
  });

  await run("annotated-estimate route selects lower estimate and returns matching PDF/viewer metadata", async () => {
    const carrierPdfBytes = await createRam21975SourcePdf();
    const shopPdfBytes = await createShop21975SourcePdf();
    const carrierDataUrl = `data:application/pdf;base64,${Buffer.from(carrierPdfBytes).toString("base64")}`;
    const shopDataUrl = `data:application/pdf;base64,${Buffer.from(shopPdfBytes).toString("base64")}`;
    const attachments = [
      {
        id: "shop-21975",
        filename: "Shop 21975.pdf",
        type: "application/pdf",
        text: "Shop estimate repair facility grand total $9,875.00",
        imageDataUrl: shopDataUrl,
        pageCount: 3,
      },
      {
        id: "carrier-21975",
        filename: "SOR-1 21975.pdf",
        type: "application/pdf",
        text: "Carrier estimate GEICO estimate total $4,097.17 net total $4,097.17",
        imageDataUrl: carrierDataUrl,
        pageCount: 12,
      },
    ];
    const route = loadAnnotatedEstimateRouteWithMocks({
      report: {
        id: "case-21975",
        artifactIds: ["shop-21975", "carrier-21975"],
        createdAt: new Date().toISOString(),
        report: { analysis: null, evidenceRegistry: [] },
      },
      attachments,
      findings: [
        baseFinding({
          id: "route-line-23",
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
          id: "route-line-44",
          operationLabel: "REVVAdas Report",
          category: "adas_calibration",
          estimateGapType: "referenced_not_produced",
          citationLabel: "REFERENCED / NOT PRODUCED",
          carrierAnchor: {
            sourceDocumentId: "carrier-21975",
            estimateRole: "carrier",
            lineNumber: "44",
            pageNumber: 3,
            section: "Vehicle Diagnostics",
            operation: "REVVAdas Report",
            description: "REVVAdas Report ADAS report available upon request and via this link",
          },
          carrierEvidence: {
            lineNumber: "44",
            description: "REVVAdas Report ADAS report available upon request and via this link",
            amount: 0,
            laborHours: null,
            sourceLabel: "Carrier estimate",
          },
          missingAuthorityTypes: ["linked ADAS report"],
        }),
        baseFinding({
          id: "route-totals",
          operationLabel: "Paint supplies and net cost totals",
          category: "labor_difference",
          carrierEvidence: {
            lineNumber: null,
            description: "Paint Supplies 3.2 hrs @ $40/hr Net Cost of Repairs",
            amount: 128,
            laborHours: null,
            sourceLabel: "Carrier estimate",
          },
        }),
        baseFinding({
          id: "route-supplier",
          operationLabel: "Alternate parts supplier LKQ grille",
          category: "parts_downgrade",
          carrierEvidence: {
            lineNumber: null,
            description: "Alternate Parts Suppliers Fenix Parts LKQ grille chrome horizontal bars",
            amount: 185,
            laborHours: null,
            sourceLabel: "Carrier estimate",
          },
        }),
      ],
    });

    const response = await route.POST(new Request("http://localhost/api/reports/citation-density/annotated-estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case-21975", targetEstimate: "auto", includeLegend: false }),
    }));
    assert.equal(response.status, 200);
    const json = await response.json();

    assert.equal(json.ok, true);
    assert.equal(json.selectedSourceDocumentId, "carrier-21975");
    assert.equal(json.selectedSourceLabel, "SOR-1 21975.pdf");
    assert.deepEqual(json.debugCounts.uploadedFileNames, ["Shop 21975.pdf", "SOR-1 21975.pdf"]);
    assert.equal(json.debugCounts.selectedEstimateFileName, "SOR-1 21975.pdf");
    assert.equal(json.debugCounts.selectedEstimateTotal, 4097.17);
    assert.equal(json.debugCounts.actualSourcePdfName, "SOR-1 21975.pdf");
    assert.equal(json.debugCounts.actualSourcePdfByteLength, carrierPdfBytes.byteLength);
    assert.notEqual(json.debugCounts.actualSourcePdfByteLength, 29144);
    assert.notEqual(json.debugCounts.actualSourcePdfByteLength, shopPdfBytes.byteLength);
    assert.equal(json.debugCounts.actualSourcePdfPageCount, 12);
    assert.equal(json.debugCounts.sourcePdfStage, "original");
    assert.equal(json.debugCounts.sourcePdfHash, sha256(carrierPdfBytes));
    assert.equal(json.debugCounts.textExtractionMethod, "pdfjs-legacy-primary");
    assert.equal(json.debugCounts.textExtractionError, undefined);
    assert.ok(json.debugCounts.textExtractionWarnings.some((warning) => warning.includes("Configured PDF.js workerSrc")));
    assert.match(json.debugCounts.pdfWorkerResolvedPath, /pdf\.worker\.mjs$/);
    assert.equal(json.debugCounts.pdfWorkerExists, true);
    assert.match(json.debugCounts.pdfWorkerSrc, /^file:\/\//);
    assert.equal(json.debugCounts.pdfjsImportMode, "externalized-node-module");
    assert.equal(json.debugCounts.textExtractionInfrastructureStage, "get-text-content");
    assert.ok(json.debugCounts.extractedTextPageCount >= 12);
    assert.match(json.debugCounts.firstPageTextSample, /Carrier 21975 source page 1/);
    assert.equal(json.debugCounts.firstNonEmptyTextPage, 1);
    assert.match(json.debugCounts.firstNonEmptyTextSample, /Carrier 21975 source page 1/);
    assert.equal(json.debugCounts.perPageTextLengths.length, 12);
    assert.equal(json.debugCounts.perPageTextItemCounts.length, 12);
    assert.ok(json.debugCounts.perPageTextItemCounts.some((count) => count > 0));
    assert.equal(json.debugCounts.citationDensityArtifactVersion, "citation-density-part-source-relevance-v1");
    assert.ok(json.debugCounts.buildCommit);
    assert.ok(json.debugCounts.extractedAnchorCount > 40);
    assert.ok(json.debugCounts.findingCount >= 4);
    assert.ok(json.debugCounts.anchoredFindingCount >= 4);
    assert.equal(json.debugCounts.unanchoredFindingCount, 0);
    assert.ok(json.debugCounts.renderedPdfAnnotationCount >= 4);
    assert.ok(json.debugCounts.viewerAnnotationCount >= 4);
    assert.ok(json.debugCounts.partSourceCandidateCount > 0);
    assert.ok(json.debugCounts.partSourceAcceptedCandidateCount > 0);
    assert.ok(json.debugCounts.partSourceRejectedCandidateCount > 0);
    assert.equal(json.debugCounts.artifactId, json.artifactId);
    assert.equal(json.debugCounts.renderedPdfArtifactId, json.debugCounts.metadataArtifactId);
    assert.ok(json.annotationMetadata.length >= 4);
    assert.equal(json.annotationMetadata.every((item) => item.findingId && item.anchorId && item.sourceAnchorId === item.anchorId), true);
    assert.ok(json.annotationMetadata.some((item) => item.findingId === "route-line-44" && item.pageNumber === 3 && item.anchorType === "embedded_link_row"));
    assert.ok(json.annotationMetadata.some((item) => item.findingId === "route-totals" && item.pageNumber === 4 && item.anchorType === "totals_row"));
    assert.ok(json.annotationMetadata.some((item) => item.findingId === "route-supplier" && item.pageNumber === 11 && item.anchorType === "supplier_row"));

    const metadataResponse = await route.GET(new Request(`http://localhost/api/reports/citation-density/annotated-estimate?metadata=1&artifactId=${json.artifactId}`));
    assert.equal(metadataResponse.status, 200);
    const metadataJson = await metadataResponse.json();
    assert.equal(metadataJson.artifactId, json.artifactId);
    assert.deepEqual(
      metadataJson.annotationMetadata.map((item) => `${item.findingId}:${item.anchorId}`),
      json.annotationMetadata.map((item) => `${item.findingId}:${item.anchorId}`)
    );

    const pdfResponse = await route.GET(new Request(`http://localhost/api/reports/citation-density/annotated-estimate?artifactId=${json.artifactId}`));
    assert.equal(pdfResponse.status, 200);
    const outputBytes = new Uint8Array(await pdfResponse.arrayBuffer());
    const outputPages = await extractPdfPageTexts(outputBytes);
    const loaded = await PDFDocument.load(outputBytes);
    const originalPageAnnotationCount = Array.from({ length: 12 }, (_, index) => loaded.getPage(index).node.Annots()?.size() ?? 0)
      .reduce((sum, count) => sum + count, 0);
    assert.ok(originalPageAnnotationCount >= 4);
    assert.doesNotMatch(outputPages.join(" "), /No estimate rows could be extracted|Unanchored Citation Density Findings|Repair Operation|Proc Report/);
  });

  await run("annotated-estimate route accepts explicit selectedSourceDocumentId for Shop 21638 estimate", async () => {
    const carrierPdfBytes = await createRam21975SourcePdf();
    const shopPdfBytes = await createShop21975SourcePdf();
    const carrierDataUrl = `data:application/pdf;base64,${Buffer.from(carrierPdfBytes).toString("base64")}`;
    const shopDataUrl = `data:application/pdf;base64,${Buffer.from(shopPdfBytes).toString("base64")}`;
    const attachments = [
      {
        id: "shop-21638",
        filename: "Shop 21638.pdf",
        type: "application/pdf",
        text: "Shop estimate repair facility Grand Total $20,290.23 Pre-repair scan sublet Finish sand and polish",
        imageDataUrl: shopDataUrl,
        pageCount: 1,
      },
      {
        id: "carrier-sor-21638",
        filename: "SOR-1 21638.pdf",
        type: "application/pdf",
        text: "Carrier SOR-1 estimate GEICO lower estimate gross total $12,046.49 net total $12,046.49 A/M CAPA LKQ calibration",
        imageDataUrl: carrierDataUrl,
        pageCount: 12,
      },
    ];
    const route = loadAnnotatedEstimateRouteWithMocks({
      report: {
        id: "case-21638-explicit-shop",
        artifactIds: ["shop-21638", "carrier-sor-21638"],
        createdAt: new Date().toISOString(),
        report: { analysis: null, evidenceRegistry: [] },
      },
      attachments,
      findings: [
        baseFinding({
          id: "route-shop-line-43",
          operationLabel: "Pre-repair scan sublet",
          category: "scan_diagnostic",
          primaryAnnotationRole: "shop",
          applicableEstimateRoles: ["shop"],
          carrierEvidence: undefined,
          shopEvidence: {
            lineNumber: "43",
            description: "Pre-repair scan sublet +34%",
            amount: 201,
            laborHours: null,
            sourceLabel: "Shop estimate",
          },
        }),
      ],
    });

    const response = await route.POST(new Request("http://localhost/api/reports/citation-density/annotated-estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "case-21638-explicit-shop",
        selectedSourceDocumentId: "shop-21638",
        selectedEstimateRole: "shop",
        sourceFilename: "Shop 21638.pdf",
        targetEstimate: "shop",
        includeLegend: false,
      }),
    }));
    assert.equal(response.status, 200);
    const json = await response.json();

    assert.equal(json.selectedSourceDocumentId, "shop-21638");
    assert.equal(json.selectedSourceLabel, "Shop 21638.pdf");
    assert.equal(json.selectedEstimateRole, "shop");
    assert.equal(json.debugCounts.selectedEstimateFileName, "Shop 21638.pdf");
    assert.equal(json.debugCounts.actualSourcePdfName, "Shop 21638.pdf");
    assert.ok(json.annotationMetadata.some((item) => item.sourceDocumentId === "shop-21638" && item.targetLineNumber === "43"));
  });

  await run("OEM Citation Density route returns annotated PDF artifact and OEM debug metadata", async () => {
    const carrierPdfBytes = await createRam21975SourcePdf();
    const carrierDataUrl = `data:application/pdf;base64,${Buffer.from(carrierPdfBytes).toString("base64")}`;
    const attachments = [
      {
        id: "carrier-oem-21975",
        filename: "SOR-1 21975.pdf",
        type: "application/pdf",
        text: "Carrier estimate with LKQ grille, A/M CAPA bumper, pre scan, calibration. No OEM procedure attached.",
        imageDataUrl: carrierDataUrl,
        pageCount: 12,
      },
    ];
    const report = {
      id: "report-oem-21975",
      artifactIds: attachments.map((attachment) => attachment.id),
      report: {
        narrative: "OEM Citation Density fixture",
        evidenceRegistry: [
          {
            id: "carrier-oem-21975",
            sourceType: "carrier_estimate",
            label: "SOR-1 21975.pdf",
            ingestionState: "ingested",
            evidenceStatus: "verified",
            relatedIssueKeys: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    };
    const route = loadOemCitationDensityRouteWithMocks({ report, attachments });
    const response = await route.POST(new Request("http://localhost/api/reports/oem-citation-density/annotated-estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "report-oem-21975",
        targetEstimate: "all",
        annotationMode: "both",
        includeLegend: false,
        redactSensitive: true,
      }),
    }));
    assert.equal(response.status, 200);
    const json = await response.json();

    assert.equal(json.ok, true);
    assert.equal(json.reportType, "oem-citation-density");
    assert.equal(json.debugCounts.artifactVersion, OEM_CITATION_DENSITY_ARTIFACT_VERSION);
    assert.match(json.downloadUrl, /\/api\/reports\/oem-citation-density\/annotated-estimate\?artifactId=/);
    assert.match(json.annotationMetadataUrl, /metadata=1&artifactId=/);
    assert.ok(json.annotationMetadata.length > 0);
    assert.equal(json.annotationMetadata.every((item) => item.findingId && item.anchorId && item.sourceAnchorId === item.anchorId), true);
    assert.ok(json.debugCounts.findingCount > 0);
    assert.ok(json.debugCounts.renderedPdfAnnotationCount > 0);
    assert.ok(json.debugCounts.findingsWithNextActionCount > 0);
    assert.equal(json.debugCounts.findingsWithoutNextActionCount, 0);
    assert.ok(json.debugCounts.firstFindings.some((finding) => finding.evidenceTier && finding.confidence && finding.nextAction));
    assert.equal(json.annotationMetadata.some((item) => item.label === "VERIFIED OEM"), false);

    const metadataResponse = await route.GET(new Request(`http://localhost/api/reports/oem-citation-density/annotated-estimate?metadata=1&artifactId=${json.artifactId}`));
    assert.equal(metadataResponse.status, 200);
    const metadataJson = await metadataResponse.json();
    assert.equal(metadataJson.artifactVersion, OEM_CITATION_DENSITY_ARTIFACT_VERSION);
    assert.equal(metadataJson.reportType, "oem-citation-density");

    const pdfResponse = await route.GET(new Request(`http://localhost/api/reports/oem-citation-density/annotated-estimate?artifactId=${json.artifactId}`));
    assert.equal(pdfResponse.status, 200);
    assert.equal(pdfResponse.headers.get("content-type"), "application/pdf");
    const outputBytes = new Uint8Array(await pdfResponse.arrayBuffer());
    const outputPages = await extractPdfPageTexts(outputBytes);
    assert.match(outputPages.join(" "), /OEM Citation Density Finding Details/);
  });

  await run("OEM Citation Density defaults to the lower estimate and exposes OEM selection diagnostics", async () => {
    const carrierPdfBytes = await createRam21975SourcePdf();
    const shopPdfBytes = await createShop21975SourcePdf();
    const carrierDataUrl = `data:application/pdf;base64,${Buffer.from(carrierPdfBytes).toString("base64")}`;
    const shopDataUrl = `data:application/pdf;base64,${Buffer.from(shopPdfBytes).toString("base64")}`;
    const attachments = [
      {
        id: "shop-oem-21975",
        filename: "Shop 21975.pdf",
        type: "application/pdf",
        text: "Shop estimate repair facility grand total $9,875.00 OEM-style repair plan",
        imageDataUrl: shopDataUrl,
        pageCount: 1,
      },
      {
        id: "carrier-oem-21975",
        filename: "SOR-1 21975.pdf",
        type: "application/pdf",
        text: "Carrier estimate GEICO estimate total $4,097.17 net total $4,097.17 A/M CAPA LKQ",
        imageDataUrl: carrierDataUrl,
        pageCount: 12,
      },
    ];
    const report = {
      id: "report-oem-lower-selection",
      artifactIds: attachments.map((attachment) => attachment.id),
      report: {
        narrative: "OEM Citation Density lower-estimate fixture",
        evidenceRegistry: [],
      },
    };
    const route = loadOemCitationDensityRouteWithMocks({ report, attachments });
    const response = await route.POST(new Request("http://localhost/api/reports/oem-citation-density/annotated-estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "report-oem-lower-selection",
        annotationMode: "both",
        includeLegend: false,
        redactSensitive: true,
      }),
    }));
    assert.equal(response.status, 200);
    const json = await response.json();

    assert.equal(json.ok, true);
    assert.equal(json.targetEstimate, "auto");
    assert.equal(json.outputs.length, 1);
    assert.equal(json.selectedSourceDocumentId, "carrier-oem-21975");
    assert.equal(json.selectedSourceLabel, "SOR-1 21975.pdf");
    assert.equal(json.selectedEstimateForOemDensity, "SOR-1 21975.pdf");
    assert.match(json.selectedEstimateReason, /lower estimate PDF/i);
    assert.equal(json.selectedEstimateTotal, 4097.17);
    assert.equal(json.comparisonEstimateTotal, 9875);
    assert.equal(json.debugCounts.selectedEstimateForOemDensity, "SOR-1 21975.pdf");
    assert.match(json.debugCounts.selectedEstimateReason, /lower estimate PDF/i);
    assert.equal(json.debugCounts.selectedEstimateTotal, 4097.17);
    assert.equal(json.debugCounts.comparisonEstimateTotal, 9875);
    assert.equal(json.debugCounts.actualSourcePdfName, "SOR-1 21975.pdf");
    assert.notEqual(json.debugCounts.actualSourcePdfByteLength, shopPdfBytes.byteLength);
    assert.equal(json.annotationMetadata.every((item) => item.sourceDocumentId === "carrier-oem-21975"), true);
  });

  await run("OEM Citation Density selects SOR3 lower estimate over Shop 21548", async () => {
    const carrierPdfBytes = await createRam21975SourcePdf();
    const shopPdfBytes = await createShop21975SourcePdf();
    const carrierDataUrl = `data:application/pdf;base64,${Buffer.from(carrierPdfBytes).toString("base64")}`;
    const shopDataUrl = `data:application/pdf;base64,${Buffer.from(shopPdfBytes).toString("base64")}`;
    const attachments = [
      {
        id: "shop-21548",
        filename: "Shop 21548.pdf",
        type: "application/pdf",
        text: "Shop estimate repair facility Grand Total $9,307.40 OEM-style repair plan",
        imageDataUrl: shopDataUrl,
        pageCount: 1,
      },
      {
        id: "carrier-sor3",
        filename: "SOR3.pdf",
        type: "application/pdf",
        text: "Carrier SOR3 estimate Vehicle: 2023 TESL Model Y AWD w/Long Range Battery gross $5,737.10 net $5,237.10 A/M RT Hub assy Four Wheel Alignment ADAS calibration",
        imageDataUrl: carrierDataUrl,
        pageCount: 12,
      },
    ];
    const report = {
      id: "report-oem-sor3-lower-selection",
      artifactIds: attachments.map((attachment) => attachment.id),
      report: {
        narrative: "OEM Citation Density SOR3 lower-estimate fixture",
        evidenceRegistry: [],
      },
    };
    const route = loadOemCitationDensityRouteWithMocks({ report, attachments });
    const response = await route.POST(new Request("http://localhost/api/reports/oem-citation-density/annotated-estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "report-oem-sor3-lower-selection",
        sourceDocumentId: "shop-21548",
        annotationMode: "both",
        includeLegend: false,
        redactSensitive: true,
      }),
    }));
    assert.equal(response.status, 200);
    const json = await response.json();

    assert.equal(json.selectedSourceDocumentId, "carrier-sor3");
    assert.equal(json.selectedSourceLabel, "SOR3.pdf");
    assert.equal(json.selectedEstimateForOemDensity, "SOR3.pdf");
    assert.match(json.selectedEstimateReason, /lower estimate PDF/i);
    assert.match(json.selectedEstimateReason, /supplied source document/i);
    assert.equal(json.selectedEstimateTotal, 5237.10);
    assert.equal(json.comparisonEstimateTotal, 9307.40);
    assert.equal(json.debugCounts.selectedEstimateForOemDensity, "SOR3.pdf");
    assert.equal(json.annotationMetadata.every((item) => item.sourceDocumentId === "carrier-sor3"), true);
  });

  await run("OEM Citation Density ignores shop sourceDocumentId and selects lower SOR 21638 from request context", async () => {
    const carrierPdfBytes = await createRam21975SourcePdf();
    const shopPdfBytes = await createShop21975SourcePdf();
    const carrierDataUrl = `data:application/pdf;base64,${Buffer.from(carrierPdfBytes).toString("base64")}`;
    const shopDataUrl = `data:application/pdf;base64,${Buffer.from(shopPdfBytes).toString("base64")}`;
    const attachments = [
      {
        id: "shop-21638",
        filename: "Shop 21638.pdf",
        type: "application/pdf",
        text: "Shop estimate repair facility Grand Total $20,290.23 OEM-style repair plan",
        imageDataUrl: shopDataUrl,
        pageCount: 1,
      },
      {
        id: "carrier-sor-21638",
        filename: "SOR-1 21638.pdf",
        type: "application/pdf",
        text: "Carrier SOR-1 estimate GEICO lower estimate gross total $12,046.49 net total $12,046.49 A/M CAPA LKQ calibration",
        imageDataUrl: carrierDataUrl,
        pageCount: 12,
      },
    ];
    const report = {
      id: "report-oem-21638-source-doc-selected",
      artifactIds: ["shop-21638"],
      report: {
        narrative: "OEM Citation Density 21638 sourceDocumentId fixture",
        evidenceRegistry: [],
      },
    };
    const route = loadOemCitationDensityRouteWithMocks({ report, attachments });
    const response = await route.POST(new Request("http://localhost/api/reports/oem-citation-density/annotated-estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "report-oem-21638-source-doc-selected",
        sourceDocumentId: "shop-21638",
        artifactIds: ["shop-21638", "carrier-sor-21638"],
        targetEstimate: "auto",
        annotationMode: "both",
        includeLegend: false,
        redactSensitive: true,
      }),
    }));
    assert.equal(response.status, 200);
    const json = await response.json();

    assert.equal(json.selectedSourceDocumentId, "carrier-sor-21638");
    assert.equal(json.selectedEstimateForOemDensity, "SOR-1 21638.pdf");
    assert.match(json.selectedEstimateReason, /lower estimate PDF/i);
    assert.match(json.selectedEstimateReason, /supplied source document/i);
    assert.equal(json.selectedEstimateTotal, 12046.49);
    assert.equal(json.comparisonEstimateTotal, 20290.23);
    assert.equal(json.debugCounts.selectedEstimateDiagnostics.candidateAttachmentCount, 2);
    assert.equal(json.debugCounts.selectedEstimateDiagnostics.candidateEstimateCount, 2);
    assert.equal(json.debugCounts.selectedEstimateDiagnostics.selectedEstimateForOemDensity, "SOR-1 21638.pdf");
    assert.equal(json.debugCounts.selectedEstimateDiagnostics.selectionBypassedReason.includes("sourceDocumentId ignored"), true);
    assert.equal(json.annotationMetadata.every((item) => item.sourceDocumentId === "carrier-sor-21638"), true);
  });

  await run("OEM Citation Density respects explicit Shop 21638 selectedSourceDocumentId when target is shop", async () => {
    const carrierPdfBytes = await createRam21975SourcePdf();
    const shopPdfBytes = await createShop21975SourcePdf();
    const carrierDataUrl = `data:application/pdf;base64,${Buffer.from(carrierPdfBytes).toString("base64")}`;
    const shopDataUrl = `data:application/pdf;base64,${Buffer.from(shopPdfBytes).toString("base64")}`;
    const attachments = [
      {
        id: "shop-21638",
        filename: "Shop 21638.pdf",
        type: "application/pdf",
        text: "Shop estimate repair facility Grand Total $20,290.23 OEM-style repair plan",
        imageDataUrl: shopDataUrl,
        pageCount: 1,
      },
      {
        id: "carrier-sor-21638",
        filename: "SOR-1 21638.pdf",
        type: "application/pdf",
        text: "Carrier SOR-1 estimate GEICO lower estimate gross total $12,046.49 net total $12,046.49 A/M CAPA LKQ calibration",
        imageDataUrl: carrierDataUrl,
        pageCount: 12,
      },
    ];
    const report = {
      id: "report-oem-21638-explicit-shop",
      artifactIds: ["shop-21638", "carrier-sor-21638"],
      report: {
        narrative: "OEM Citation Density 21638 explicit shop fixture",
        evidenceRegistry: [],
      },
    };
    const route = loadOemCitationDensityRouteWithMocks({ report, attachments });
    const response = await route.POST(new Request("http://localhost/api/reports/oem-citation-density/annotated-estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "report-oem-21638-explicit-shop",
        selectedSourceDocumentId: "shop-21638",
        selectedEstimateRole: "shop",
        sourceFilename: "Shop 21638.pdf",
        artifactIds: ["shop-21638", "carrier-sor-21638"],
        targetEstimate: "shop",
        annotationMode: "both",
        includeLegend: false,
        redactSensitive: true,
      }),
    }));
    assert.equal(response.status, 200);
    const json = await response.json();

    assert.equal(json.selectedSourceDocumentId, "shop-21638");
    assert.equal(json.selectedSourceLabel, "Shop 21638.pdf");
    assert.equal(json.selectedEstimateRole, "shop");
    assert.equal(json.selectedEstimateForOemDensity, "Shop 21638.pdf");
    assert.equal(json.debugCounts.selectedEstimateDiagnostics.candidateEstimateCount, 2);
    assert.equal(json.annotationMetadata.every((item) => item.sourceDocumentId === "shop-21638"), true);
  });

  await run("OEM Citation Density route attempts Drive authority retrieval and exposes reviewed sources", async () => {
    const carrierPdfBytes = await createRam21975SourcePdf();
    const carrierDataUrl = `data:application/pdf;base64,${Buffer.from(carrierPdfBytes).toString("base64")}`;
    const attachments = [{
      id: "carrier-oem-drive",
      filename: "2023 Ram SOR-1.pdf",
      type: "application/pdf",
      text: "2023 Ram 1500 carrier estimate A/M CAPA bumper blind spot radar calibration total $4,097.17",
      imageDataUrl: carrierDataUrl,
      pageCount: 12,
    }];
    const report = {
      id: "report-oem-drive",
      artifactIds: attachments.map((attachment) => attachment.id),
      report: {
        narrative: "OEM Citation Density Drive fixture",
        evidenceRegistry: [],
      },
    };
    const driveRetrievalCalls = [];
    const route = loadOemCitationDensityRouteWithMocks({
      report,
      attachments,
      driveEnabled: true,
      driveRetrievalCalls,
      driveRetrievalResponse: {
        request: {},
        usage: { topMatchesOnly: true, excerptsOnly: true, fullDocumentDumpAllowed: false },
        results: [{
          id: "drive-result-1",
          filename: "Ram Blind Spot Calibration Procedure.pdf",
          documentClass: "oem_procedure",
          sourceBucket: "oem_procedures",
          relevanceScore: 0.91,
          confidence: "high",
          matchReason: "Matched blind spot radar calibration query.",
          excerpt: { excerpt: "OEM procedure excerpt for blind spot radar calibration.", charCount: 58, pageLabel: "12" },
          metadata: {
            fileId: "drive-file-1",
            documentClass: "oem_procedure",
            sourceBucket: "oem_procedures",
            sourceLane: "oem_lane",
            source: "OEM Procedures/Ram",
            pageHint: "12",
            vehicleMatchLevel: "manufacturer_match",
          },
          relevanceReasons: [],
        }],
      },
    });
    const response = await route.POST(new Request("http://localhost/api/reports/oem-citation-density/annotated-estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "report-oem-drive",
        sourceDocumentId: "carrier-oem-drive",
        annotationMode: "both",
        includeLegend: false,
        redactSensitive: true,
      }),
    }));
    assert.equal(response.status, 200);
    const json = await response.json();

    assert.equal(driveRetrievalCalls.length, 1);
    assert.equal(json.debugTrace.authoritySearchTrace.googleDriveOrInternalSearchRan, true);
    assert.equal(json.debugTrace.authoritySearchTrace.authorityCoverageStatus, "partial");
    assert.deepEqual(json.debugTrace.authoritySearchTrace.driveDocumentsReviewed, ["Ram Blind Spot Calibration Procedure.pdf"]);
    assert.deepEqual(json.debugTrace.authoritySearchTrace.driveMatchedFolders, ["OEM Procedures/Ram"]);
    assert.equal(json.debugCounts.googleDriveInternalAuthoritySearch.driveSearchAttempted, true);
  });

  await run("OEM Citation Density healthy Drive with zero exact matches is not authority-trace incomplete", async () => {
    const carrierPdfBytes = await createRam21975SourcePdf();
    const carrierDataUrl = `data:application/pdf;base64,${Buffer.from(carrierPdfBytes).toString("base64")}`;
    const attachments = [{
      id: "carrier-oem-drive-empty",
      filename: "2023 Ram SOR-1.pdf",
      type: "application/pdf",
      text: "2023 Ram 1500 carrier estimate A/M CAPA bumper blind spot radar calibration total $4,097.17",
      imageDataUrl: carrierDataUrl,
      pageCount: 12,
    }];
    const report = {
      id: "report-oem-drive-empty",
      artifactIds: attachments.map((attachment) => attachment.id),
      report: {
        narrative: "OEM Citation Density Drive empty fixture",
        evidenceRegistry: [],
      },
    };
    const route = loadOemCitationDensityRouteWithMocks({
      report,
      attachments,
      driveEnabled: true,
      driveRetrievalResponse: {
        request: {
          vehicle: { year: 2023, make: "Ram", model: "1500" },
          topics: [{ topic: "adas_calibration" }],
        },
        usage: { topMatchesOnly: true, excerptsOnly: true, fullDocumentDumpAllowed: false },
        results: [],
      },
    });
    const response = await route.POST(new Request("http://localhost/api/reports/oem-citation-density/annotated-estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "report-oem-drive-empty",
        annotationMode: "both",
        includeLegend: false,
        redactSensitive: true,
      }),
    }));
    assert.equal(response.status, 200);
    const json = await response.json();
    const labels = json.annotationMetadata.map((item) => item.label);

    assert.equal(json.debugTrace.authoritySearchTrace.authorityTraceCompleted, true);
    assert.equal(json.debugTrace.authoritySearchTrace.authorityCoverageStatus, "complete");
    assert.equal(json.debugTrace.authoritySearchTrace.driveSearchCompleted, true);
    assert.equal(labels.includes("AUTHORITY TRACE INCOMPLETE"), false);
    assert.ok(labels.includes("AUTHORITY SEARCH COMPLETED - NO LINE AUTHORITY MATCH"));
  });

  await run("OEM Citation Density normalizes TESL Model Y into Drive search terms", async () => {
    const carrierPdfBytes = await createRam21975SourcePdf();
    const carrierDataUrl = `data:application/pdf;base64,${Buffer.from(carrierPdfBytes).toString("base64")}`;
    const attachments = [{
      id: "carrier-tesl-model-y",
      filename: "SOR3.pdf",
      type: "application/pdf",
      text: "Vehicle Description: 2023 TESL Model Y AWD w/Long Range Battery\nCarrier SOR3 estimate A/M RT Hub assy four wheel alignment ADAS calibration gross $5,737.10 net $5,237.10",
      imageDataUrl: carrierDataUrl,
      pageCount: 12,
    }];
    const report = {
      id: "report-oem-tesl-model-y",
      artifactIds: attachments.map((attachment) => attachment.id),
      report: {
        narrative: "OEM Citation Density Tesla Model Y Drive fixture",
        evidenceRegistry: [],
      },
    };
    const driveRetrievalCalls = [];
    const route = loadOemCitationDensityRouteWithMocks({
      report,
      attachments,
      driveEnabled: true,
      driveRetrievalCalls,
      driveRetrievalResponse: {
        request: {
          vehicle: { year: 2023, make: "Tesla", model: "Model Y", trim: "AWD Long Range" },
          topics: [{ topic: "adas_calibration" }, { topic: "aftermarket_non_oem_parts_dispute" }],
        },
        usage: { topMatchesOnly: true, excerptsOnly: true, fullDocumentDumpAllowed: false },
        results: [{
          id: "drive-result-tesla-1",
          filename: "Tesla Model Y Collision Repair Procedure.pdf",
          documentClass: "oem_procedure",
          sourceBucket: "oem_procedures",
          relevanceScore: 0.91,
          confidence: "high",
          matchReason: "Matched Tesla Model Y query.",
          excerpt: { excerpt: "Tesla Model Y repair procedure excerpt.", charCount: 39, pageLabel: "4" },
          metadata: {
            fileId: "drive-file-tesla-1",
            documentClass: "oem_procedure",
            sourceBucket: "oem_procedures",
            sourceLane: "oem_lane",
            source: "OEM Procedures/Tesla/Model Y",
            pageHint: "4",
            vehicleMatchLevel: "exact_vehicle_match",
          },
          relevanceReasons: [],
        }],
      },
    });
    const response = await route.POST(new Request("http://localhost/api/reports/oem-citation-density/annotated-estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "report-oem-tesl-model-y",
        annotationMode: "both",
        includeLegend: false,
        redactSensitive: true,
      }),
    }));
    assert.equal(response.status, 200);
    const json = await response.json();

    assert.equal(driveRetrievalCalls.length, 1);
    assert.match(driveRetrievalCalls[0].userQuery, /Vehicle: 2023 Tesla Model Y/i);
    assert.deepEqual(json.debugTrace.authoritySearchTrace.driveMatchedFolders, ["OEM Procedures/Tesla/Model Y"]);
    assert.deepEqual(json.debugTrace.authoritySearchTrace.driveDocumentsReviewed, ["Tesla Model Y Collision Repair Procedure.pdf"]);
    assert.ok(json.debugTrace.authoritySearchTrace.driveSearchTerms.includes("Tesla"));
    assert.ok(json.debugTrace.authoritySearchTrace.driveSearchTerms.includes("Model Y"));
  });

  await run("optional real SOR-1 local fixture extracts selectable text and row anchors", async () => {
    const fixturePath = path.join(process.cwd(), ".local-fixtures", "SOR-1 21975.pdf");
    if (!fs.existsSync(fixturePath)) {
      console.log(`skip - optional fixture missing at ${fixturePath}`);
      return;
    }
    const bytes = fs.readFileSync(fixturePath);
    const doc = await PDFDocument.load(bytes);
    const result = await extractCitationDensityRowAnchors(new Uint8Array(bytes), {
      sourceDocumentRole: "carrier",
      sourceDocumentId: "carrier-21975",
      actualSourcePdfName: "SOR-1 21975.pdf",
      actualSourcePdfPageCount: doc.getPageCount(),
    });

    assert.equal(result.actualSourcePdfName, "SOR-1 21975.pdf");
    assert.equal(result.actualSourcePdfByteLength, bytes.byteLength);
    assert.equal(result.actualSourcePdfPageCount, 12);
    assert.equal(result.sourcePdfStage, "original");
    assert.equal(result.sourcePdfHash, sha256(bytes));
    assert.ok(result.extractedTextPageCount > 0);
    assert.ok(result.firstPageTextSample || result.firstNonEmptyTextSample);
    assert.ok(result.perPageTextLengths.some((length) => length > 0));
    assert.ok(result.perPageTextItemCounts.some((count) => count > 0));
    assert.ok(result.anchors.length > 0);
  });

  await run("annotated-estimate route fails closed when selected PDF yields zero row anchors", async () => {
    const noRowsPdfBytes = await createNoEstimateRowsPdf();
    const dataUrl = `data:application/pdf;base64,${Buffer.from(noRowsPdfBytes).toString("base64")}`;
    const route = loadAnnotatedEstimateRouteWithMocks({
      report: {
        id: "case-no-anchors",
        artifactIds: ["carrier-no-anchors"],
        createdAt: new Date().toISOString(),
        report: { analysis: null, evidenceRegistry: [] },
      },
      attachments: [{
        id: "carrier-no-anchors",
        filename: "SOR-1 21975.pdf",
        type: "application/pdf",
        text: "Carrier estimate total $100.00",
        imageDataUrl: dataUrl,
        pageCount: 1,
      }],
      findings: [baseFinding({
        id: "no-anchor-finding",
        operationLabel: "ADAS calibration",
        carrierEvidence: {
          lineNumber: "44",
          description: "REVVAdas Report",
          amount: 0,
          laborHours: null,
          sourceLabel: "Carrier estimate",
        },
      })],
    });

    const response = await route.POST(new Request("http://localhost/api/reports/citation-density/annotated-estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case-no-anchors", targetEstimate: "auto", includeLegend: false }),
    }));
    assert.equal(response.status, 422);
    const json = await response.json();

    assert.equal(json.ok, false);
    assert.equal(json.error, "Delta Citation Density Report could not extract estimate row anchors from the selected estimate PDF. No annotation PDF was produced.");
    assert.equal(json.userMessage, json.error);
    assert.equal(json.artifactId, undefined);
    assert.deepEqual(json.debugCounts.uploadedFileNames, ["SOR-1 21975.pdf"]);
    assert.equal(json.debugCounts.selectedEstimateFileName, "SOR-1 21975.pdf");
    assert.equal(json.debugCounts.actualSourcePdfName, "SOR-1 21975.pdf");
    assert.equal(json.debugCounts.actualSourcePdfByteLength, noRowsPdfBytes.byteLength);
    assert.equal(json.debugCounts.actualSourcePdfPageCount, 1);
    assert.equal(json.debugCounts.sourcePdfStage, "original");
    assert.equal(json.debugCounts.sourcePdfHash, sha256(noRowsPdfBytes));
    assert.equal(json.debugCounts.textExtractionMethod, "pdfjs-legacy-primary");
    assert.equal(json.debugCounts.textExtractionError, undefined);
    assert.ok(json.debugCounts.textExtractionWarnings.some((warning) => warning.includes("Configured PDF.js workerSrc")));
    assert.match(json.debugCounts.pdfWorkerResolvedPath, /pdf\.worker\.mjs$/);
    assert.equal(json.debugCounts.pdfWorkerExists, true);
    assert.match(json.debugCounts.pdfWorkerSrc, /^file:\/\//);
    assert.equal(json.debugCounts.pdfjsImportMode, "externalized-node-module");
    assert.equal(json.debugCounts.textExtractionInfrastructureStage, "get-text-content");
    assert.equal(json.debugCounts.extractedTextPageCount, 1);
    assert.match(json.debugCounts.firstPageTextSample, /Selected PDF cover sheet/);
    assert.equal(json.debugCounts.firstNonEmptyTextPage, 1);
    assert.match(json.debugCounts.firstNonEmptyTextSample, /Selected PDF cover sheet/);
    assert.equal(json.debugCounts.perPageTextLengths.length, 1);
    assert.ok(json.debugCounts.perPageTextLengths[0] > 0);
    assert.deepEqual(json.debugCounts.perPageTextItemCounts, [2]);
    assert.equal(json.debugCounts.extractedAnchorCount, 0);
    assert.equal(json.debugCounts.findingCount, 1);
    assert.equal(json.debugCounts.anchoredFindingCount, 0);
    assert.equal(json.debugCounts.unanchoredFindingCount, 1);
    assert.equal(json.debugCounts.renderedPdfAnnotationCount, 0);
    assert.equal(json.debugCounts.viewerAnnotationCount, undefined);
    assert.equal(json.debugCounts.artifactId, undefined);
    assert.equal(json.debugCounts.renderedPdfArtifactId, undefined);
    assert.equal(json.debugCounts.metadataArtifactId, undefined);
    assert.match(json.debugCounts.droppedFindings.map((item) => item.reason).join(" "), /no estimate row anchors extracted/);
  });

  await run("annotated-estimate route returns no-estimate 422 when only Work Auth is uploaded", async () => {
    const workAuthPdfBytes = await createWorkAuthorizationPdf();
    const dataUrl = `data:application/pdf;base64,${Buffer.from(workAuthPdfBytes).toString("base64")}`;
    const route = loadAnnotatedEstimateRouteWithMocks({
      report: {
        id: "case-work-auth-only",
        artifactIds: ["work-auth"],
        createdAt: new Date().toISOString(),
        report: { analysis: null, evidenceRegistry: [] },
      },
      attachments: [{
        id: "work-auth",
        filename: "Work Auth 21638.pdf",
        type: "application/pdf",
        text: "CONTRACT OF REPAIR Work Authorization Customer acknowledges Repairer has posted labor rates Assignment of Proceeds Physical inspection demand Customer Signature",
        imageDataUrl: dataUrl,
        pageCount: 1,
      }],
      findings: [baseFinding({ id: "citation-density-labor-rates" })],
    });

    const response = await route.POST(new Request("http://localhost/api/reports/citation-density/annotated-estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case-work-auth-only", targetEstimate: "auto", includeLegend: false }),
    }));
    const json = await response.json();

    assert.equal(response.status, 422);
    assert.equal(json.error, "No estimate PDFs were found for Citation Density.");
    assert.match(json.userMessage, /No estimate PDFs were found for Citation Density/);
    assert.equal(json.acceptedEstimateCandidates.length, 0);
    assert.equal(json.rejectedSourceCandidates[0].filename, "Work Auth 21638.pdf");
    assert.ok(["work_authorization", "support_contract", "legal_support"].includes(json.rejectedSourceCandidates[0].detectedDocumentType));
  });

  await run("extracted PDF rows anchor Ram diagnostic lines only on their source pages", async () => {
    const sourcePdfBytes = await createRam21975SourcePdf();
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      sourceDocumentId: "carrier-21975",
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
            description: "In-proc repair scan",
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
          id: "ram-line-42",
          operationLabel: "Post-repair scan",
          category: "scan_diagnostic",
          carrierEvidence: {
            lineNumber: "42",
            description: "Post-repair scan",
            amount: 75,
            laborHours: 0.5,
            sourceLabel: "Carrier estimate",
          },
        }),
        baseFinding({
          id: "ram-line-43",
          operationLabel: "Final road test",
          category: "road_test",
          citationLabel: undefined,
          carrierEvidence: {
            lineNumber: "43",
            description: "Final road test",
            amount: 40,
            laborHours: 0.3,
            sourceLabel: "Carrier estimate",
          },
          citationStatus: {
            oem: "not_applicable",
            adas: "needed",
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
        baseFinding({
          id: "ram-line-44",
          operationLabel: "REVVAdas Report",
          category: "adas_calibration",
          estimateGapType: "referenced_not_produced",
          citationLabel: "REFERENCED / NOT PRODUCED",
          embeddedEstimateLinks: [{
            sourceDocumentId: "carrier-21975",
            lineNumber: "44",
            estimateRole: "carrier",
            nearbyOperation: "REVVAdas Report",
            redactedUrl: "https://egnyte.example.com/revvadas/ram-report",
            retrievalStatus: "not_fetched",
            authorityStatus: "referenced_not_produced",
          }],
          carrierAnchor: {
            sourceDocumentId: "carrier-21975",
            estimateRole: "carrier",
            lineNumber: "44",
            pageNumber: 3,
            section: "Diagnostics and Calibration",
            operation: "REVVAdas Report",
            description: "REVVAdas Report ADAS report available upon request and via this link",
          },
          carrierEvidence: {
            lineNumber: "44",
            description: "REVVAdas Report ADAS report available upon request and via this link",
            amount: 0,
            laborHours: null,
            sourceLabel: "Carrier estimate",
          },
          missingAuthorityTypes: ["linked ADAS report"],
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

    assert.equal(result.originalPageCount, 12);
    assert.ok(result.annotatedFindingCount >= 9);
    assert.equal(result.unresolvedAnchorCount, 0);
    assert.doesNotMatch(result.warnings.join(" "), /all_findings_unanchored/);
    assert.doesNotMatch(pages.slice(0, result.originalPageCount).join(" "), /NEEDS ADAS|NEEDS OEM|NEEDS INVOICE|REFERENCED \/ NOT PRODUCED|ESTIMATE GAP ONLY/);
    assert.match(pages.slice(result.originalPageCount).join(" "), /Citation Density Finding Details/);
    assert.match(result.annotationMetadata.map((item) => item.estimateLine).join(" "), /Line 23: LKQ grille Note/);
    assert.match(result.annotationMetadata.map((item) => item.estimateLine).join(" "), /Line 39: Pre-repair scan/);
    assert.match(result.annotationMetadata.map((item) => item.estimateLine).join(" "), /Line 40: In-proc repair scan/);
    assert.match(result.annotationMetadata.map((item) => item.estimateLine).join(" "), /Line 41: Seat belt dynamic function test/);
    assert.match(result.annotationMetadata.map((item) => item.estimateLine).join(" "), /Line 42: Post-repair scan/);
    assert.match(result.annotationMetadata.map((item) => item.estimateLine).join(" "), /Line 43: Final road test/);
    const line23 = result.annotationMetadata.find((item) => item.findingId === "ram-line-23");
    const line39 = result.annotationMetadata.find((item) => item.findingId === "ram-line-39");
    const line40 = result.annotationMetadata.find((item) => item.findingId === "ram-line-40");
    const line41 = result.annotationMetadata.find((item) => item.findingId === "ram-line-41");
    const line42 = result.annotationMetadata.find((item) => item.findingId === "ram-line-42");
    const line43 = result.annotationMetadata.find((item) => item.findingId === "ram-line-43");
    const line44 = result.annotationMetadata.find((item) => item.findingId === "ram-line-44");
    const totals = result.annotationMetadata.find((item) => item.findingId === "ram-totals");
    const supplier = result.annotationMetadata.find((item) => item.findingId === "ram-supplier");
    assert.equal(line23.anchorType, "estimate_line");
    assert.match(line23.sourceAnchorText, /not correct style for vehicle/i);
    assert.equal(line23.targetLineNumber, "23");
    assert.equal(line23.pageNumber, 2);
    assert.equal(line23.sourceDocumentRole, "carrier");
    assert.equal(line39.pageNumber, 3);
    assert.equal(line39.sourcePdfPageNumber, 3);
    assert.equal(line40.sourcePdfPageNumber, 3);
    assert.equal(line40.sourceLineNumber, "40");
    assert.match(line40.sourceAnchorText, /In-proc repair scan/);
    assert.equal(line41.pageNumber, 3);
    assert.equal(line41.sourcePdfPageNumber, 3);
    assert.equal(line41.sourceLineNumber, "41");
    assert.match(line41.sourceAnchorText, /Seat belt dynamic function test/);
    assert.equal(line42.pageNumber, 3);
    assert.equal(line42.sourcePdfPageNumber, 3);
    assert.equal(line42.sourceLineNumber, "42");
    assert.match(line42.sourceAnchorText, /Post-repair scan/);
    assert.equal(line43.pageNumber, 3);
    assert.equal(line43.sourcePdfPageNumber, 3);
    assert.equal(line43.sourceLineNumber, "43");
    assert.notEqual(line43.label, "NEEDS ADAS");
    assert.equal(line44.pageNumber, 3);
    assert.equal(line44.sourcePdfPageNumber, 3);
    assert.equal(line44.sourceLineNumber, "44");
    assert.equal(line44.anchorType, "embedded_link_row");
    assert.match(line44.sourceAnchorText, /egnyte|revvadas/i);
    assert.equal(totals.anchorType, "totals_row");
    assert.equal(totals.pageNumber, 4);
    assert.equal(supplier.anchorType, "supplier_row");
    assert.equal(supplier.pageNumber, 11);
    const scanLike = result.annotationMetadata.filter((item) => /scan|seat belt|road test|revvadas|adas/i.test(`${item.estimateLine} ${item.sourceAnchorText}`));
    assert.ok(scanLike.every((item) => item.pageNumber === 3));
    assert.equal(result.annotationMetadata.some((item) => item.pageNumber === 4 && /scan|seat belt|road test|adas/i.test(item.sourceAnchorText)), false);
    assert.equal(result.annotationMetadata.some((item) => item.pageNumber === 7 && /scan|seat belt|adas/i.test(item.sourceAnchorText)), false);
    assert.equal(result.annotationMetadata.some((item) => item.pageNumber === 9 && /scan|adas/i.test(item.sourceAnchorText)), false);
    for (const metadata of result.annotationMetadata) {
      assert.ok(metadata.findingId);
      assert.ok(metadata.anchorId);
      assert.equal(metadata.sourceAnchorId, metadata.anchorId);
      assert.equal(metadata.sourcePdfPageNumber, metadata.pageNumber);
      assert.equal(metadata.sourcePageNumber, metadata.pageNumber);
      assert.equal(metadata.sourceAnchorType, metadata.anchorType);
      assert.ok(metadata.sourceAnchorText);
      assert.ok(metadata.sourceAnchorNormalizedText);
      assert.ok(metadata.sourceDocumentId);
      assert.ok(["carrier", "shop"].includes(metadata.sourceDocumentRole));
      assert.equal(typeof metadata.targetNormalizedText, "string");
      assert.ok(metadata.targetNormalizedText.length > 0);
      assert.ok(metadata.xPct > 0 && metadata.xPct < 1);
      assert.ok(metadata.yPct > 0 && metadata.yPct < 1);
      assert.ok(metadata.wPct > 0 && metadata.wPct < 1);
      assert.ok(metadata.hPct > 0 && metadata.hPct < 1);
    }
    assert.match(pages.join(" "), /Paint Supplies 3\.2 hrs @ \$40\/hr|Paint materials total/);
    assert.match(pages.join(" "), /Alternate Parts Suppliers/i);
    assert.doesNotMatch(pages.join(" "), /Unanchored Citation Density Findings/);
  });

  await run("shop 21975 scan sublets and finish sand anchor to concrete rows", async () => {
    const sourcePdfBytes = await createShop21975SourcePdf();
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      findings: [
        baseFinding({
          id: "shop-line-43",
          operationLabel: "Pre-repair scan sublet +34%",
          category: "scan_diagnostic",
          shopEvidence: {
            lineNumber: "43",
            description: "Pre-repair scan sublet $201.00 +34%",
            amount: 201,
            laborHours: null,
            sourceLabel: "Shop estimate",
          },
          carrierEvidence: undefined,
        }),
        baseFinding({
          id: "shop-line-44",
          operationLabel: "Post-repair scan sublet +34%",
          category: "scan_diagnostic",
          shopEvidence: {
            lineNumber: "44",
            description: "Post-repair scan sublet $201.00 +34%",
            amount: 201,
            laborHours: null,
            sourceLabel: "Shop estimate",
          },
          carrierEvidence: undefined,
        }),
        baseFinding({
          id: "shop-line-50",
          operationLabel: "Finish sand and polish",
          category: "refinish",
          citationLabel: "NEEDS ADAS",
          shopEvidence: {
            lineNumber: "50",
            description: "Finish sand and polish",
            amount: 60,
            laborHours: 0.8,
            sourceLabel: "Shop estimate",
          },
          carrierEvidence: undefined,
          citationStatus: {
            oem: "needed",
            adas: "needed",
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
        baseFinding({
          id: "shop-totals",
          operationLabel: "Body labor and paint supplies rate delta",
          category: "labor_difference",
          shopEvidence: {
            lineNumber: null,
            description: "Body labor rate $75.00 Paint supplies 3.7 @ $60.00",
            amount: 75,
            laborHours: null,
            sourceLabel: "Shop estimate",
          },
          carrierEvidence: undefined,
          citationStatus: {
            oem: "not_applicable",
            adas: "needed",
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
      request: { includeLegend: false, annotationMode: "both", estimateRole: "shop" },
    });

    assert.equal(result.annotatedFindingCount, 4);
    assert.equal(result.unresolvedAnchorCount, 0);
    assert.equal(result.annotationMetadata.find((item) => item.findingId === "shop-line-43").targetLineNumber, "43");
    assert.equal(result.annotationMetadata.find((item) => item.findingId === "shop-line-44").targetLineNumber, "44");
    assert.equal(result.annotationMetadata.find((item) => item.findingId === "shop-line-50").label, "NEEDS P-PAGE");
    assert.equal(result.annotationMetadata.find((item) => item.findingId === "shop-totals").anchorType, "totals_row");
    assert.equal(result.annotationMetadata.every((item) => item.sourceDocumentRole === "shop"), true);
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

  await run("annotation metadata exposes stable PDF coordinate context", async () => {
    const sourcePdfBytes = await createSourcePdf();
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      sourceDocumentId: "carrier-source-pdf",
      findings: [baseFinding()],
      request: { includeLegend: false, annotationMode: "both" },
    });
    const metadata = result.annotationMetadata[0];

    assert.equal(metadata.coordinateSpace, "pdf-points");
    assert.equal(metadata.sourceDocumentId, "carrier-source-pdf");
    assert.match(metadata.sourceAnchorId, /^carrier-source-pdf:p1:12:estimate_line$/);
    assert.equal(metadata.pdfPageWidth, 612);
    assert.equal(metadata.pdfPageHeight, 792);
    assert.equal(metadata.rotation, 0);
    assert.equal(metadata.targetLineNumber, "12");
    assert.match(metadata.targetRawText, /Line 12 ADAS calibration/);
    assert.ok(metadata.xPct > 0 && metadata.xPct < 1);
    assert.ok(metadata.yPct > 0 && metadata.yPct < 1);
    assert.ok(metadata.wPct > 0 && metadata.wPct < 1);
    assert.ok(metadata.hPct > 0 && metadata.hPct < 1);
    assert.ok(["estimate_line", "line_note", "embedded_link_row", "supplier_row", "totals_row", "section_row", "guide_row"].includes(metadata.anchorType));
    assert.ok(["high", "medium", "low"].includes(metadata.matchConfidence));
  });

  await run("finish sand and paint deltas are not OEM or ADAS by default", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("Estimate refinish page", { x: 50, y: 730, size: 12, font });
    page.drawText("Line 119 finish sand and polish 0.8 hrs $80.00", { x: 50, y: 690, size: 11, font });
    const sourcePdfBytes = await doc.save();
    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      findings: [
        baseFinding({
          id: "finish-sand",
          operationLabel: "Finish sand and polish",
          category: "refinish",
          citationLabel: undefined,
          carrierEvidence: {
            lineNumber: "119",
            description: "finish sand and polish",
            amount: 80,
            laborHours: 0.8,
            sourceLabel: "Shop estimate",
          },
          citationStatus: {
            oem: "needed",
            adas: "needed",
            pPages: "needed",
            scrs: "not_applicable",
            deg: "not_applicable",
            nhtsa: "not_applicable",
            stateRegulation: "not_applicable",
            policy: "not_applicable",
            invoiceOrCompletionProof: "not_applicable",
            photoOrTeardownProof: "not_applicable",
          },
          missingAuthorityTypes: ["OEM procedure", "P-page"],
        }),
      ],
      request: { includeLegend: false, annotationMode: "both" },
    });
    const text = await extractPdfText(result.bytes);

    assert.doesNotMatch(text, /Label:\s*NEEDS ADAS/);
    assert.doesNotMatch(text, /Label:\s*NEEDS OEM/);
    assert.match(text, /NEEDS P-PAGE/);
  });

  await run("required detectors reject boilerplate and create wheel hub battery and sand-polish findings", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    page.drawText("2023 Tesla Model Y carrier estimate", { x: 42, y: 742, size: 10, font });
    drawCccEstimateRow(page, font, 32, "A/M", "Repl", "RF wheel opening molding", "0.2", "$35.00", 728);
    drawCccEstimateRow(page, font, 37, "", "R&I", "LT wheel opening molding", "0.2", "$30.00", 720);
    drawCccEstimateRow(page, font, 43, "", "Subl", "RF wheel repair", "0.0", "$75.00", 710);
    drawCccEstimateRow(page, font, 44, "", "Subl", "Tire Mount and Balance", "0.0", "$25.00", 638);
    drawCccEstimateRow(page, font, 47, "", "Subl", "Four Wheel Alignment", "0.0", "$129.00", 620);
    drawCccEstimateRow(page, font, 48, "", "R&I", "Fender liner unrelated access trim", "0.2", "$12.00", 602);
    drawCccEstimateRow(page, font, 11, "A/M", "Repl", "RT Hub assy", "0.6", "$185.00", 692);
    drawCccEstimateRow(page, font, 12, "", "Rpr", "Finish sand and polish", "0.5", "$40.00", 674);
    drawCccEstimateRow(page, font, 13, "", "R&I", "D&R battery/Reset Electronics", "0.3", "$24.00", 656);
    page.drawText("ABBREVIATIONS AND DISCLAIMER alternate parts policy paragraphs are for reference only", { x: 42, y: 584, size: 8, font });
    page.drawText("A/M=AFTERMARKET CAPA definitions LKQ/RCY/USED definitions fraud disclaimer CCC/MOTOR guide paragraphs", { x: 42, y: 566, size: 8, font });
    const sourcePdfBytes = await doc.save();

    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      sourcePdfName: "Tesla carrier estimate.pdf",
      sourceText: "2023 Tesla Model Y",
      comparisonEstimateTexts: [{
        fileName: "Shop estimate.pdf",
        estimateRole: "shop",
        text: [
          "Vehicle equipment: 4 Wheel DriveTilt WheelFM RadioSkyview Roof",
          "Line 210 Repl RT/Front Wheel 0.3 M",
          "Line 50 Repl RF wheel 0.3 M",
          "Line 51 R&I LF wheel 0.2 M",
          "Note: removed for access to left liner, wheel flare and bumper hardware; time adjusted 0.1 x 2",
        ].join("\n"),
      }],
      findings: [],
      findingGenerator: buildRequiredEstimatorDeltaFindings,
      request: { includeLegend: false, annotationMode: "both", estimateRole: "carrier" },
    });

    const joined = result.annotationMetadata.map((item) => `${item.findingId} ${item.shortTitle} ${item.comment}`).join(" ");
    assert.match(joined, /wheel_labor_delta/);
    assert.match(joined, /am_wheel_end_safety/);
    assert.match(joined, /sand_polish_p_page_support/);
    assert.match(joined, /battery_reset_electrical_rate/);
    assert.match(joined, /Carrier may be missing or inadequately documenting wheel R&I\/access labor/);
    assert.match(joined, /safety-critical wheel-end component/);
    assert.match(joined, /Carrier aftermarket warranty language may address fit, corrosion, or part replacement/);
    assert.match(joined, /ADAS compatibility, crash-test equivalency, or related manufacturer warranty preservation/);
    assert.match(joined, /EV weight and ADAS sensitivity increase the need for OEM procedure verification/);
    assert.match(joined, /mechanical\/electrical procedure context, not a generic miscellaneous charge/);
    assert.match(joined, /CCC\/MOTOR\/P-page\/database support/);
    assert.doesNotMatch(joined, /automatically void/i);
    assert.match(joined, /does not prove an OEM-only requirement without authority/i);
    const wheelLaborMetadata = result.annotationMetadata.filter((item) => /wheel_labor_delta/.test(item.findingId));
    assert.ok(wheelLaborMetadata.length > 0 && wheelLaborMetadata.length <= 2);
    assert.deepEqual(wheelLaborMetadata.map((item) => item.targetLineNumber).sort(), ["43", "47"]);
    assert.match(joined, /line 43 .*RF wheel repair/i);
    assert.match(joined, /line 44 .*Tire Mount and Balance/i);
    assert.match(joined, /line 47 .*Four Wheel Alignment/i);
    assert.match(joined, /Line 50 Repl RF wheel 0\.3 M/i);
    assert.doesNotMatch(joined, /4 Wheel DriveTilt WheelFM RadioSkyview Roof/i);
    assert.equal(wheelLaborMetadata.some((item) => /liner unrelated access trim/i.test(item.sourceAnchorText)), false);
    assert.equal(wheelLaborMetadata.some((item) => /wheel opening molding/i.test(item.sourceAnchorText)), false);
    assert.equal(result.annotationMetadata.some((item) => /ABBREVIATIONS|DISCLAIMER|alternate parts policy|A\/M=AFTERMARKET|CAPA definitions|LKQ\/RCY\/USED|fraud disclaimer|CCC\/MOTOR guide/i.test(item.sourceAnchorText)), false);
    assert.ok(result.debugTrace.requiredDetectorFindingCount >= 4);
    assert.ok(result.debugTrace.acceptedEstimateRowFindingCount >= 4);
    assert.ok(result.debugTrace.rejectedBoilerplateCount >= 0);
    assert.equal(result.debugTrace.authoritySearchTrace.googleDriveOrInternalSearchRan, false);
  });

  await run("delta citation density leads with structured shop-to-shop line-pair deltas", async () => {
    const sourcePdfBytes = await createShop21896LowerEstimatePdf();
    const comparisonText = [
      "Shop Final 21896 final estimate",
      "Net Cost of Repairs $17,397.20",
      "REAR SUSPENSION",
      "60 Repl LT Hub assy $275.00 1.0",
      "64 O/H Rear suspension $150.00 3.0",
      "65 Repl LT Control arm $310.00 0.5",
      "66 Repl Crossmember $620.00 1.5",
      "67 Repl Link arm $135.00 0.4",
      "68 Repl Lateral arm $145.00 0.4",
      "69 Repl TPMS sensor $85.00 0.0",
      "125 Repl LT side bracket $95.00 0.3",
      "ENGINE COMPARTMENT",
      "91 Rpr Coolant purge $65.00 0.4",
      "92 Repl Coolant $42.00 0.0",
      "96 Repl Compartment panel $480.00 1.2",
      "VEHICLE DIAGNOSTICS",
      "133 Subl Service mode setup $95.00 0.0",
      "134 Subl Firmware update $120.00 0.0",
      "135 Subl In-process scan $85.00 0.0",
      "136 Subl Camera calibration $220.00 0.0",
      "137 Subl DTC research $75.00 0.0",
      "REFINISH",
      "150 Rpr Finish sand and polish $80.00 0.8",
    ].join("\n");

    const result = await buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes,
      sourcePdfName: "Shop 21896.pdf",
      sourceDocumentId: "shop-21896",
      sourceText: "Shop 21896 lower estimate\nNet Cost of Repairs $11,892.26",
      comparisonEstimateTexts: [{
        fileName: "Shop Final 21896.pdf",
        sourceDocumentId: "shop-final-21896",
        estimateRole: "shop",
        text: comparisonText,
      }],
      findings: [],
      findingGenerator: buildRequiredEstimatorDeltaFindings,
      request: { includeLegend: false, annotationMode: "both", estimateRole: "shop" },
    });

    const joined = result.annotationMetadata
      .map((item) => `${item.findingId} ${item.shortTitle} ${item.comment} ${item.sourceAnchorText}`)
      .join(" ");
    const firstTitles = result.annotationMetadata.slice(0, 8).map((item) => item.shortTitle).join(" ");

    assert.ok(result.debugTrace.lineItemDeltaFindingCount >= 10);
    assert.match(joined, /Source\/lower estimate: Shop 21896\.pdf/i);
    assert.match(joined, /Comparison\/final estimate: Shop Final 21896\.pdf/i);
    assert.match(joined, /Amount delta: \$5?|\$620\.00|\$480\.00/i);
    assert.match(joined, /Labor delta: (?:3\.0|2\.5|1\.5) hours/i);
    assert.match(joined, /Delta category: missing_operation/i);
    assert.match(joined, /Added in the comparison\/final estimate/i);
    assert.match(joined, /TPMS sensor/i);
    assert.match(joined, /Rear suspension/i);
    assert.match(joined, /Crossmember/i);
    assert.match(joined, /Control arm/i);
    assert.match(joined, /Link arm/i);
    assert.match(joined, /Lateral arm/i);
    assert.match(joined, /Coolant purge/i);
    assert.match(joined, /Coolant/i);
    assert.match(joined, /Compartment panel/i);
    assert.match(joined, /LT side bracket/i);
    assert.match(joined, /Service mode setup/i);
    assert.match(joined, /Firmware update/i);
    assert.match(joined, /In-process scan/i);
    assert.match(joined, /Camera calibration/i);
    assert.match(joined, /DTC research/i);
    assert.match(joined, /Label:\s*NEEDS ADAS/i);
    assert.doesNotMatch(joined, /Operation present in higher estimate/i);
    assert.doesNotMatch(joined, /higher estimate/i);
    assert.doesNotMatch(joined, /carrier estimate/i);
    assert.doesNotMatch(joined, /CCC\/MOTOR guide and abbreviation boilerplate only/i);
    assert.doesNotMatch(firstTitles, /Finish sand and polish/i);
  });

  await run("policy diagnostics detect vehicle mismatch and garbled extraction fallback", async () => {
    const mismatch = extractPolicyApplicabilityDiagnostics({
      activeEstimateVehicle: "2023 Tesla Model Y",
      policyText: [
        "Policy Number PA-123456",
        "Named Insured Jane Example",
        "Insured Vehicle: 2020 Honda Accord VIN 1HGCM82633A004352",
        "Collision deductible $500 Comprehensive deductible $250",
        "If We Cannot Agree appraisal Payment of Loss",
        "Form PA01 Endorsement UM123 Governing law Pennsylvania",
      ].join("\n"),
    });
    assert.equal(mismatch.policyNumber, "PA-123456");
    assert.match(mismatch.vehicleMismatch.warning, /Policy uploaded, but insured vehicle appears to be 2020 Honda Accord/);
    assert.equal(mismatch.ocrFallbackRecommended, false);

    const garbled = extractPolicyApplicabilityDiagnostics({
      activeEstimateVehicle: "2023 Tesla Model Y",
      policyText: "ÃÂâ€ ï¿½ ÃÂâ€™ unreadable policy bytes ÃÂâ€œ",
    });
    assert.equal(garbled.extractionConfidence, "failed");
    assert.equal(garbled.ocrFallbackRecommended, true);
  });
})();
