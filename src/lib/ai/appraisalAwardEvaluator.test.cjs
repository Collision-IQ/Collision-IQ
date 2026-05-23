/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

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

const {
  evaluateAppraisalAward,
} = require("./appraisalAwardEvaluator.ts");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("does not default to carrier merely because broader scope is disputed", () => {
  const basis = evaluateAppraisalAward({
    repairOperations: ["ADAS calibration", "post-repair scan", "structural measurement"],
    fileEvidenceSupportSignals: ["Support verified from reviewed file evidence."],
    oemProcedureSupportSignals: ["OEM procedure supports calibration after sensor removal."],
    invoiceScanCalibrationAlignmentIndicators: ["Calibration record referenced in reviewed documentation."],
    carrierVulnerabilitySignals: ["Carrier estimate omits calibration and structural measurement."],
    reviewedFileCount: 185,
    totalKnownFileCount: 186,
  });

  assert.equal(basis.posture, "SHOP_SUPPORTED");
  assert.match(basis.reason, /safe|OEM|repair/i);
});

run("recommends reconciled supported amount when both estimates have vulnerabilities", () => {
  const basis = evaluateAppraisalAward({
    repairOperations: ["post-repair scan", "blend refinish disputed"],
    fileEvidenceSupportSignals: ["Support verified from reviewed file evidence."],
    carrierVulnerabilitySignals: ["Carrier estimate omits post-repair scan."],
    shopVulnerabilitySignals: ["Blend operation support present; final proof incomplete."],
    reviewedFileCount: 50,
    totalKnownFileCount: 55,
  });

  assert.equal(basis.posture, "RECONCILED_SUPPORTED");
  assert.match(basis.recommendedLanguage, /reconciled supported amount/i);
});

run("does not treat non-isolated standalone file as unsupported when support exists", () => {
  const basis = evaluateAppraisalAward({
    repairOperations: ["road-test verification", "alignment printout referenced"],
    fileEvidenceSupportSignals: ["Support referenced from reviewed documentation."],
    invoiceScanCalibrationAlignmentIndicators: ["Referenced support present; completion record not fully isolated."],
    carrierVulnerabilitySignals: ["Carrier estimate omits alignment and road-test verification."],
    reviewedFileCount: 100,
    totalKnownFileCount: 100,
  });

  assert.notEqual(basis.posture, "CARRIER_SUPPORTED");
  assert.equal(basis.shopVulnerabilities.length, 0);
});

run("defers only for material final-award evidence, not any near-complete omission", () => {
  const nearComplete = evaluateAppraisalAward({
    carrierVulnerabilitySignals: ["Carrier estimate omits calibration."],
    oemProcedureSupportSignals: ["OEM procedure supports calibration."],
    reviewedFileCount: 185,
    totalKnownFileCount: 186,
    unresolvedMaterialEvidence: ["one unrelated photo not reviewed"],
  });
  assert.notEqual(nearComplete.posture, "DEFER_FOR_MATERIAL_EVIDENCE");

  const material = evaluateAppraisalAward({
    reviewedFileCount: 185,
    totalKnownFileCount: 186,
    unresolvedMaterialEvidence: ["final invoice not reviewed"],
  });
  assert.equal(material.posture, "DEFER_FOR_MATERIAL_EVIDENCE");
});

run("appraisal instruction contains safety-first non-partisan mission governance", () => {
  const { buildAppraisalAwardEvaluatorInstruction } = require("./appraisalAwardEvaluator.ts");
  const instruction = buildAppraisalAwardEvaluatorInstruction();

  assert.match(instruction, /non-partisan repair intelligence and appraisal support system/i);
  assert.match(instruction, /policyholder and public safety/i);
  assert.match(instruction, /EVs and heavier vehicle platforms/i);
  assert.match(instruction, /carrier underpayment/i);
  assert.match(instruction, /shop overreach/i);
  assert.match(instruction, /Which repair path is OE\/safety supported/i);
});
