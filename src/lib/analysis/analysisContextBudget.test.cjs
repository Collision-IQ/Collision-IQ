/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

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
    },
    fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};

const {
  applyAnalysisContextBudget,
  classifyAnalysisAttachment,
} = require("./analysisContextBudget.ts");

function attachment(overrides) {
  return {
    id: overrides.id,
    filename: overrides.filename,
    type: overrides.type ?? "application/pdf",
    text: overrides.text,
    pageCount: overrides.pageCount,
    classification: "pdf",
  };
}

function run(name, test) {
  try {
    test();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

run("generated Collision IQ report PDFs are classified as generated_report_artifact", () => {
  assert.equal(classifyAnalysisAttachment(attachment({
    id: "report",
    filename: "delta-citation-density-report.pdf",
    text: "Collision IQ Citation Density Finding Details Annotation Legend Unanchored Citation Density Findings",
  })), "generated_report_artifact");
});

run("analysis context budget reduces huge policy and generated report before model input", () => {
  const policyText = [
    "Allstate Policy Number PA-123 Claim Number CLM-9",
    "Insured Vehicle: 2024 Jeep Gladiator VIN 1C6HJTAG9RL133873",
    "Collision deductible $500 Comprehensive deductible $250",
    "If We Cannot Agree appraisal Payment of Loss Action Against Us Governing law Pennsylvania",
    "Endorsement UM123 Form AU-456",
    "policy boilerplate ".repeat(9000),
  ].join("\n");
  const estimateText = [
    "Carrier SOR3 estimate Vehicle: 2023 Tesla Model Y VIN 7SAYGDEE0PA190520",
    "Line 50 A/M RT Hub assy MO512686 0.6 $189.99",
    "Line 20 RT front wheel repair sublet 0.0 labor $189.99",
    "Line 21 tire mount/balance $25",
    "Line 60 D&R battery/Reset Electronics 0.3",
  ].join("\n");
  const reportText = "Collision IQ Citation Density Finding Details ".repeat(1300);
  const supportText = "CCC MOTOR P-page finish sand and polish denib color sand buff refinish correction ".repeat(600);

  const result = applyAnalysisContextBudget({
    attachments: [
      attachment({ id: "policy", filename: "Allstate Policy_Redacted.pdf", text: policyText, pageCount: 56 }),
      attachment({ id: "report", filename: "delta-citation-density-report.pdf", text: reportText, pageCount: 28 }),
      attachment({ id: "estimate", filename: "Carrier SOR3 Tesla Estimate.pdf", text: estimateText, pageCount: 8 }),
      attachment({ id: "support", filename: "linked-support.pdf", text: supportText, pageCount: 12 }),
    ],
    userIntent: "Review Tesla A/M hub, wheel R&I, CCC/MOTOR sand polish, policy mismatch, ADAS warranty.",
    provider: "openai",
    model: "gpt-5.5",
    contextBudgetLimit: 24000,
  });

  assert.ok(result.diagnostics.rawAttachmentTextChars > 200000);
  assert.ok(result.diagnostics.selectedContextTextChars <= 24000);
  assert.ok(result.diagnostics.contextReductionApplied);
  assert.equal(result.diagnostics.generatedReportArtifactExcluded, true);
  assert.match(result.diagnostics.policyVehicleMismatch, /2024 Jeep Gladiator/);
  assert.match(result.diagnostics.policyVehicleMismatch, /2023 Tesla Model Y/);
  assert.match(result.diagnostics.policyVehicleMismatch, /Confirm applicability before relying on policy language/);
  assert.equal(result.diagnostics.policyExtractionConfidence, "high");
  assert.ok(result.diagnostics.authoritySearchQueries.some((query) => /CCC MOTOR P-page/i.test(query)));
  assert.ok(result.diagnostics.authoritySearchQueries.some((query) => /AM LKQ CAPA aftermarket warranty/i.test(query)));
  assert.ok(result.diagnostics.toolUsageTrace.some((step) => step.tool === "google_drive_internal_query_generation" && step.status === "success"));
  assert.doesNotMatch(result.attachments.find((item) => item.id === "report").text, /Finding Details Collision IQ Citation Density Finding Details Collision IQ Citation Density/);
});

run("garbled policy extraction recommends fallback and still avoids whole-policy context", () => {
  const garbledPolicy = [
    "Allstate Policy Number PA-123456",
    "ÃƒÃ‚Ã¢â‚¬Â Ã¯Â¿Â½ ÃƒÃ‚Ã¢â‚¬â„¢ unreadable policy bytes ÃƒÃ‚Ã¢â‚¬Å“",
    "policy coverage appraisal deductible ".repeat(1200),
  ].join("\n");
  const estimateText = "Carrier estimate Vehicle: 2023 Tesla Model Y Line 12 Repl A/M RT Hub assy 1.6 M";

  const result = applyAnalysisContextBudget({
    attachments: [
      attachment({ id: "estimate", filename: "Carrier Tesla estimate.pdf", text: estimateText }),
      attachment({ id: "policy", filename: "Allstate policy corrupted extraction.pdf", text: garbledPolicy, pageCount: 44 }),
    ],
    userIntent: "Review policy and Tesla estimate applicability.",
    provider: "openai",
    model: "gpt-5.5",
    contextBudgetLimit: 7000,
  });

  const policy = result.diagnostics.attachmentClassifications.find((item) => item.id === "policy");
  assert.equal(result.diagnostics.policyExtractionConfidence, "failed");
  assert.ok(policy.selectedTextChars < policy.rawTextChars);
  assert.match(result.attachments.find((item) => item.id === "policy").text, /Policy document exists, but structured facts were not confidently extracted/);
});

// ── RO 22047 regression: estimates demoted to policy_document ────────────────
// Every CCC estimate carries "Policy #:", "Deductible", and appraisal wording
// in standard header/boilerplate. The policy-keyword check used to run before
// estimate detection, so BOTH estimates of every review were classified
// policy_document: 9K policy text cap instead of 14K, policy structured-facts
// extraction run on estimates, and the vehicle header line trimmed out
// (make/model resolved null downstream). Estimate detection must win first.

const CCC_BOILERPLATE = [
  "Insured: SAMPLE, OWNER Policy #: 00987654321 Claim #: 009876543210000",
  "Type of Loss: Collision Date of Loss: 06/06/2026 Deductible: 1000.00",
  "The parties agree that an appraisal clause may apply to this loss.",
  "CCC ONE Estimating - A product of CCC Intelligent Solutions Inc.",
  "MOTOR CRASH ESTIMATING GUIDE coverage abbreviations follow.",
].join("\n");

const ESTIMATE_BODY = [
  "Line Oper Description Part Number Qty Extended Price $ Labor Paint",
  "1 R&I RT Bumper cover PT00654961A 1 78.00 0.3 0.0",
  "2 Repl LT Headlamp assy PT00983789A 1 1,130.27 0.5 0.0",
  "3 Rpr Quarter panel 0 0.00 2.5 1.3",
  "SUBTOTALS 3,254.43 33.9 10.9",
  "ESTIMATE TOTALS",
  "Grand Total 11,296.09",
  "Total Cost of Repairs 9,218.43",
].join("\n");

const SHOP_ESTIMATE = attachment({
  id: "shop-estimate",
  filename: "Shop 12345.pdf",
  text: [
    "Sample repair facility header",
    "Preliminary Estimate",
    "RO Number: 12345 Written By: SAMPLE ESTIMATOR",
    "Workfile ID: abc12345",
    "VEHICLE 2024 SAMPLE TRUCK 4D P/U Electric GREEN",
    CCC_BOILERPLATE,
    ESTIMATE_BODY,
  ].join("\n"),
});

const CARRIER_EOR = attachment({
  id: "carrier-eor",
  filename: "Carrier EOR 12345.pdf",
  text: [
    "SAMPLE MUTUAL AUTOMOBILE ASSOCIATION",
    "Estimate of Record",
    "Written By: SAMPLE APPRAISER, License Number: 000000",
    "Workfile ID: def67890",
    // Carrier EORs still name the repair facility in the header block.
    "Inspection Location: Repair Facility: SAMPLE COLLISION CENTER",
    "VEHICLE 2024 SAMPLE TRUCK 4D P/U Electric GREEN",
    CCC_BOILERPLATE,
    ESTIMATE_BODY,
  ].join("\n"),
});

run("shop estimate with policy boilerplate classifies as shop_estimate", () => {
  assert.equal(classifyAnalysisAttachment(SHOP_ESTIMATE), "shop_estimate");
});

run("carrier Estimate of Record classifies as carrier_estimate despite repair-facility header", () => {
  assert.equal(classifyAnalysisAttachment(CARRIER_EOR), "carrier_estimate");
});

run("OCR-recovered scanned estimate stays an estimate", () => {
  const scanned = attachment({
    id: "scanned-ocr-estimate",
    filename: "Insurer estimate scan.pdf",
    text: [
      "[[OCR text recovered from a scanned/image-only PDF. Machine-read; verify figures against the source.]]",
      "",
      "===== Page 1 =====",
      "Estimate of Record",
      "Workfile ID: b1fd7ff4",
      CCC_BOILERPLATE,
      ESTIMATE_BODY,
    ].join("\n"),
  });
  assert.equal(classifyAnalysisAttachment(scanned), "carrier_estimate");
});

run("SOR supplement with policy boilerplate classifies as supplement", () => {
  const supplement = attachment({
    id: "supplement-sor",
    filename: "SOR-1 12345-1.pdf",
    text: [
      "Preliminary Supplement 1 with Summary",
      "Insurance carrier reviewed supplement of record.",
      "Workfile ID: xyz00001",
      CCC_BOILERPLATE,
      ESTIMATE_BODY,
      "SUPPLEMENT SUMMARY",
    ].join("\n"),
  });
  assert.equal(classifyAnalysisAttachment(supplement), "supplement");
});

run("fragmented one-token-per-line EOR (embedded OCR layer) still classifies as carrier_estimate", () => {
  // PDFs with an embedded OCR text layer extract one token per line, so the
  // carrier designation reads "Estimate\nof\nRecord" (observed in production
  // on a carrier EOR re-issued with an OCR layer).
  const fragmented = attachment({
    id: "fragmented-eor",
    filename: "Carrier EOR fragmented.pdf",
    text: [
      "SAMPLE", "MUTUAL", "AUTOMOBILE", "ASSOCIATION",
      "Workfile", "ID:", "blfd7ff4",
      "Estimate", "of", "Record",
      "Written", "By:", "SAMPLE", "APPRAISER",
      "Repair", "Facility",
      CCC_BOILERPLATE,
      ESTIMATE_BODY,
    ].join("\n"),
  });
  assert.equal(classifyAnalysisAttachment(fragmented), "carrier_estimate");
});

run("true policy declarations still classify as policy_document", () => {
  const policyDoc = attachment({
    id: "policy-doc",
    filename: "Auto policy declarations.pdf",
    text: [
      "PERSONAL AUTO POLICY DECLARATIONS",
      "Policy #: 00987654321 Effective 01/01/2026 to 07/01/2026",
      "Coverage: Collision Deductible: 1000.00 Comprehensive Deductible: 500.00",
      "Endorsement PP 03 05 attached. If we cannot agree on the amount of loss,",
      "either party may demand an appraisal. Payment of loss terms apply.",
    ].join("\n"),
  });
  assert.equal(classifyAnalysisAttachment(policyDoc), "policy_document");
});

run("estimates keep the estimate text budget instead of the policy cap", () => {
  // Pad the estimate above the 9K policy cap but below the 14K estimate cap:
  // under the old classification this text was policy-summarized; now it must
  // survive intact.
  const padded = attachment({
    ...SHOP_ESTIMATE,
    text: `${SHOP_ESTIMATE.text}\n${"4 Repl Sample part PT00000000A 1 10.00 0.1 0.0\n".repeat(220)}`,
  });
  assert.ok(padded.text.length > 9000 && padded.text.length < 14000, `pad size ${padded.text.length}`);
  const result = applyAnalysisContextBudget({
    attachments: [padded],
    provider: "anthropic",
    model: "claude-opus-4-8",
  });
  assert.equal(result.diagnostics.attachmentClassifications[0].documentClass, "shop_estimate");
  assert.equal(result.attachments[0].text, padded.text);
  assert.doesNotMatch(result.attachments[0].text, /POLICY DOCUMENT STRUCTURED FACTS/);
});

run("vehicle header line survives budgeting for an estimate", () => {
  const result = applyAnalysisContextBudget({
    attachments: [SHOP_ESTIMATE],
    provider: "anthropic",
    model: "claude-opus-4-8",
  });
  assert.match(result.attachments[0].text, /VEHICLE 2024 SAMPLE TRUCK/);
});
