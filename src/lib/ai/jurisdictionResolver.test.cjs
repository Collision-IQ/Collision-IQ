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
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
    },
    fileName: filename,
  });

  module._compile(compiled.outputText, filename);
};

const { resolveJurisdiction } = require("./jurisdictionResolver.ts");
const { buildPolicyRightsReviewPdf } = require("./builders/policyRightsReviewPdfBuilder.ts");
const { buildDoiComplaintPacketPdf } = require("./builders/doiComplaintPacketPdfBuilder.ts");
const { buildDisputeIntelligencePdf } = require("./builders/disputeIntelligencePdfBuilder.ts");
const { classifyEstimateScrubCitationGapBucket } = require("./builders/estimateScrubberPdfBuilder.ts");
const { formatRepairIntelligenceSourceStatus } = require("./builders/carrierPdfBuilder.ts");

function run(name, test) {
  try {
    test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function buildReport(text) {
  return {
    summary: {
      riskScore: "moderate",
      confidence: "moderate",
      criticalIssues: 0,
      evidenceQuality: "moderate",
    },
    vehicle: {
      vin: "1C4SJVBP0PS123456",
      year: 2023,
      make: "Jeep",
      model: "Grand Wagoneer",
      confidence: 0.9,
      source: "attachment",
    },
    issues: [],
    requiredProcedures: [],
    presentProcedures: [],
    missingProcedures: [],
    supplementOpportunities: [],
    evidence: [],
    recommendedActions: ["Review uploaded claim documents."],
    evidenceRegistry: [
      {
        id: "estimate-1",
        sourceType: "estimate",
        label: "Uploaded estimate",
        extractedText: text,
        extractedSummary: text,
        structuredFacts: {},
        ingestionState: "uploaded",
        evidenceStatus: "documented",
        relatedIssueKeys: [],
        createdAt: "2026-05-09T00:00:00.000Z",
        updatedAt: "2026-05-09T00:00:00.000Z",
      },
    ],
    ingestionMeta: { uploadedFileCount: 1 },
  };
}

const ANALYSIS = {
  mode: "single",
  parserStatus: "ok",
  findings: [],
  supplements: [],
  evidence: [],
  operations: [],
  rawEstimateText: "",
  narrative: "Claim file review.",
};

run("shop ZIP governs over owner ZIP when they disagree (Fix 4)", () => {
  const report = buildReport([
    "Owner address: 123 Market Street, Philadelphia, PA 19103",
    "Repair facility address: 10 Main Street, Austin, TX 78701",
  ].join("\n"));
  const resolved = resolveJurisdiction({ report });

  // The repair-shop ZIP on the estimate is the governing-state control, not owner ZIP.
  assert.equal(resolved.state, "TX");
  assert.equal(resolved.source, "shop_zip");
  assert.equal(resolved.confidence, "high");
});

run("owner ZIP governs only when no shop ZIP is present", () => {
  const report = buildReport("Owner address: 123 Market Street, Philadelphia, PA 19103");
  const resolved = resolveJurisdiction({ report });

  assert.equal(resolved.state, "PA");
  assert.equal(resolved.source, "owner_zip");
  assert.equal(resolved.confidence, "high");
});

run("shop ZIP resolves as the governing control", () => {
  const report = buildReport("Repair facility address: 100 Garage Road, Lancaster, PA 17602");
  const resolved = resolveJurisdiction({ report });

  assert.equal(resolved.state, "PA");
  assert.equal(resolved.source, "shop_zip");
  assert.equal(resolved.confidence, "high");
});

run("policy governing law beats shop ZIP", () => {
  const report = buildReport([
    "This policy is governed by the laws of Pennsylvania.",
    "Repair facility address: 10 Main Street, Austin, TX 78701",
  ].join("\n"));
  report.evidenceRegistry[0].sourceType = "policy_document";
  report.evidenceRegistry[0].label = "Policy declarations";
  const resolved = resolveJurisdiction({ report });

  assert.equal(resolved.state, "PA");
  assert.equal(resolved.source, "policy_governing_law");
  assert.equal(resolved.confidence, "high");
});

run("missing jurisdiction evidence resolves unknown", () => {
  const report = buildReport("Estimate total: $12,345.67\nClaim number: 19103-555");
  const resolved = resolveJurisdiction({ report });

  assert.equal(resolved.state, null);
  assert.equal(resolved.source, "unknown");
  assert.equal(resolved.confidence, "unknown");
});

run("inspection site ZIP resolves as medium-confidence fallback, not owner ZIP", () => {
  const report = buildReport([
    "Owner: ANNEGAYL",
    "Insured: ANNEGAYL",
    "Inspection Site:",
    "Conestoga Autobody",
    "961 Lancaster Ave",
    "Berwyn, PA 19312",
  ].join("\n"));
  const resolved = resolveJurisdiction({ report });

  assert.equal(resolved.state, "PA");
  assert.equal(resolved.stateCode, "PA");
  assert.equal(resolved.source, "inspection_site_zip_fallback");
  assert.equal(resolved.confidence, "medium");
  assert.equal(resolved.basis, "Inspection Site ZIP from uploaded estimate.");
});

run("owner and insured name proximity does not classify inspection ZIP as owner ZIP", () => {
  const report = buildReport([
    "Owner: ANNEGAYL",
    "Insured: ANNEGAYL",
    "Inspection Site:",
    "Conestoga Autobody",
    "961 Lancaster Ave",
    "Berwyn, PA 19312",
  ].join("\n"));
  const resolved = resolveJurisdiction({ report });

  assert.notEqual(resolved.state, "MD");
  assert.notEqual(resolved.source, "owner_zip");
  assert.notEqual(resolved.confidence, "high");
});

run("Policy Rights and DOI render inspection-site jurisdiction source consistently", () => {
  const report = buildReport([
    "Owner: ANNEGAYL",
    "Insured: ANNEGAYL",
    "Inspection Site:",
    "Conestoga Autobody",
    "961 Lancaster Ave",
    "Berwyn, PA 19312",
  ].join("\n"));
  const params = { report, analysis: ANALYSIS, panel: null, assistantAnalysis: null };
  const policy = buildPolicyRightsReviewPdf(params);
  const doi = buildDoiComplaintPacketPdf(params);
  const policySummary = Object.fromEntries(policy.summary.map((item) => [item.label, item.value]));
  const doiSummary = Object.fromEntries(doi.summary.map((item) => [item.label, item.value]));
  const combined = JSON.stringify({ policy, doi });

  assert.equal(policySummary.Jurisdiction, "Pennsylvania (PA)");
  assert.equal(policySummary["Jurisdiction Source"], "inspection_site_zip_fallback");
  assert.equal(policySummary["Jurisdiction Confidence"], "Medium");
  assert.match(JSON.stringify(policy), /Inspection Site ZIP from uploaded estimate/i);
  assert.equal(doiSummary.Jurisdiction, policySummary.Jurisdiction);
  assert.equal(doiSummary["Jurisdiction Source"], policySummary["Jurisdiction Source"]);
  assert.equal(doiSummary["Jurisdiction Confidence"], policySummary["Jurisdiction Confidence"]);
  assert.doesNotMatch(combined, /owner_zip|Jurisdiction Confidence","value":"High|Detection confidence: High/i);
});

run("Policy Rights and DOI do not rewrite owner zip without real owner address block", () => {
  const report = buildReport([
    "Owner: ANNEGAYL",
    "OwnerZip: 19312",
    "Insured: ANNEGAYL",
    "Inspection Site",
    "Conestoga Autobody",
    "961 Lancaster Ave",
    "Berwyn, PA 19312",
  ].join("\n"));
  const resolved = resolveJurisdiction({ report });
  const policy = buildPolicyRightsReviewPdf({ report, narrative: "Claim file review." });
  const doi = buildDoiComplaintPacketPdf({ report, narrative: "Claim file review." });
  const policySummary = Object.fromEntries(policy.summary.map((item) => [item.label, item.value]));
  const doiSummary = Object.fromEntries(doi.summary.map((item) => [item.label, item.value]));

  assert.equal(resolved.source, "inspection_site_zip_fallback");
  assert.equal(resolved.confidence, "medium");
  assert.equal(policySummary["Jurisdiction Source"], resolved.source);
  assert.equal(doiSummary["Jurisdiction Source"], resolved.source);
  assert.equal(policySummary["Jurisdiction Confidence"], doiSummary["Jurisdiction Confidence"]);
  assert.equal(policySummary["Jurisdiction Source"], doiSummary["Jurisdiction Source"]);
  assert.doesNotMatch(JSON.stringify({ policy, doi }), /owner_zip|Owner ZIP from uploaded claim documents|Detection confidence: High/i);
});

run("real owner address block resolves owner_zip when no shop/inspection ZIP is present", () => {
  const report = buildReport([
    "Owner address: 123 Market Street",
    "Philadelphia, PA 19103",
  ].join("\n"));
  const resolved = resolveJurisdiction({ report });

  assert.equal(resolved.source, "owner_zip");
  assert.equal(resolved.confidence, "high");
});

run("Repair Intelligence, Policy Rights, and DOI use same resolved jurisdiction", () => {
  const report = buildReport([
    "Owner address: 123 Market Street, Philadelphia, PA 19103",
    "Repair facility address: 10 Main Street, Lancaster, PA 17602",
  ].join("\n"));
  const params = { report, analysis: ANALYSIS, panel: null, assistantAnalysis: null };
  const repair = buildDisputeIntelligencePdf(params);
  const policy = buildPolicyRightsReviewPdf(params);
  const doi = buildDoiComplaintPacketPdf(params);
  const policyJurisdiction = policy.summary.find((item) => item.label === "Jurisdiction")?.value;
  const doiJurisdiction = doi.summary.find((item) => item.label === "Jurisdiction")?.value;

  // Shop ZIP governs (Lancaster PA); all three artifacts resolve the same PA jurisdiction.
  assert.equal(policyJurisdiction, "Pennsylvania (PA)");
  assert.equal(doiJurisdiction, "Pennsylvania (PA)");
  assert.doesNotMatch(JSON.stringify({ repair, policy, doi }), /Texas \(TX\)|Jurisdiction: TX|Detected jurisdiction: Texas/i);
});

run("scrubber buckets proof gaps separately from missing and reduced", () => {
  assert.equal(classifyEstimateScrubCitationGapBucket({
    text: "Pre repair scan missing from carrier estimate; OEM procedure referenced but not produced",
    estimatePresence: "missing",
    sources: [],
  }), "needs_oem_procedure");
  assert.equal(classifyEstimateScrubCitationGapBucket({
    text: "Calibration completed pending invoice and completion record",
    estimatePresence: "present",
    sources: [],
  }), "needs_invoice_or_completion_proof");
  assert.equal(classifyEstimateScrubCitationGapBucket({
    text: "Refinish labor allowance reduced by carrier",
    estimatePresence: "under-documented",
    sources: [],
  }), "reduced_by_carrier");
});

run("Repair Intelligence does not verify referenced-but-missing Toyota procedure pages", () => {
  const status = formatRepairIntelligenceSourceStatus("Toyota repair procedure pages referenced but not produced");

  assert.equal(status, "Referenced but not produced");
  assert.doesNotMatch(status, /Verified/i);
});

run("Chrysler Grand Wagoneer PA fixture has no verified legal citations without PA legal source", () => {
  const report = buildReport("Owner address: 123 Market Street, Philadelphia, PA 19103");
  const policy = buildPolicyRightsReviewPdf({
    report,
    analysis: ANALYSIS,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(policy.summary.find((item) => item.label === "Jurisdiction")?.value, "Pennsylvania (PA)");
  assert.equal(policy.summary.find((item) => item.label === "Verified Legal Citations")?.value, "0");
});
