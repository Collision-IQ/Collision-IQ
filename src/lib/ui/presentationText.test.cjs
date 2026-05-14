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
  cleanEstimateLineForCustomer,
  cleanEstimateLineForTechnicalExport,
  cleanOperationDisplayText,
  isMalformedEstimateLine,
  normalizeEstimateOperationLabel,
  sanitizeEstimateLine,
} = require("./presentationText.ts");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const cases = [
  ["fuel71218877627121.940.2", "Fuel"],
  ["rear bumper refinish 123123123", "Rear Bumper Refinish"],
  ["door_replace.9999.888", "Door Replace"],
  ["   frame   repair   ", "Frame Repair"],
  ["123456789", "Repair Operation"],
  ["", "Repair Operation"],
];

run("cleanOperationDisplayText normalizes noisy operation labels", () => {
  for (const [input, expected] of cases) {
    assert.equal(cleanOperationDisplayText(input), expected);
  }
});

run("normalizeEstimateOperationLabel keeps meaningful estimator-grade labels and drops generic-only rows", () => {
  assert.equal(
    normalizeEstimateOperationLabel("Repl Impact bar 68293716AC 1 449.00 Incl."),
    "Repl Impact bar"
  );
  assert.equal(normalizeEstimateOperationLabel("Repl"), "");
  assert.equal(normalizeEstimateOperationLabel("R&I"), "");
  assert.equal(
    normalizeEstimateOperationLabel("Subl Pre-repair scan +34% 1 201.00 T m"),
    "Subl Pre-repair scan"
  );
  assert.equal(normalizeEstimateOperationLabel("Repair Operation"), "");
});

run("estimate-line sanitizer hides known parser junk for customer output", () => {
  for (const input of ["Proc 2 #** Procedure research &", "wheelm0.1", "battery primarym0.3"]) {
    const result = sanitizeEstimateLine(input);
    assert.equal(result.malformed, true);
    assert.equal(result.hideFromCustomer, true);
    assert.equal(cleanEstimateLineForCustomer(input), "");
    assert.equal(cleanEstimateLineForTechnicalExport(input), "Parser review needed");
  }
});

run("estimate-line sanitizer cleans fused part-number descriptions for technical output", () => {
  assert.equal(isMalformedEstimateLine("rear bumper68184713AB"), true);
  assert.equal(cleanEstimateLineForTechnicalExport("rear bumper68184713AB"), "Rear Bumper");
  assert.equal(cleanEstimateLineForCustomer("rear bumper68184713AB"), "Rear Bumper");
});
