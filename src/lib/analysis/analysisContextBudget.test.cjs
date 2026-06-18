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
    filename: "citation-density-annotated-estimate.pdf",
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
      attachment({ id: "report", filename: "citation-density-annotated-estimate.pdf", text: reportText, pageCount: 28 }),
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
