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

const { selectAcademyServiceCta } = require("./serviceCta.ts");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("DV intent beats valuation intent", () => {
  const result = selectAcademyServiceCta({
    intentText: "Need diminished value and ACV support after repair.",
    estimateCount: 2,
  });

  assert.equal(result.serviceKey, "academy_diminished_value");
  assert.equal(result.button, "Start Diminished Value Review");
});

run("valuation intent beats two-estimate RTA", () => {
  const result = selectAcademyServiceCta({
    intentText: "Two estimates are uploaded, but the question is total loss market value and comparable listings.",
    estimateCount: 2,
  });

  assert.equal(result.serviceKey, "academy_value_dispute");
  assert.equal(result.button, "Start Valuation Review");
});

run("two estimates trigger RTA when no stronger value intent exists", () => {
  const result = selectAcademyServiceCta({
    intentText: "Carrier estimate and shop estimate disagree on repair scope.",
    estimateCount: 2,
  });

  assert.equal(result.serviceKey, "academy_appraisal_clause");
  assert.equal(result.button, "Start Right to Appraisal Review");
});
