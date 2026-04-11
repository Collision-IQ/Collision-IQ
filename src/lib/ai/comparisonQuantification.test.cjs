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

const { buildComparisonAnalysis } = require("./builders/comparisonEngine.ts");
const { buildExportModel } = require("./builders/buildExportModel.ts");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const SHOP_TEXT = `
Grand Total 12850.50
Body Labor 10.5
Paint Labor 6.0
Rpr Left Fender 4.0
Repl Front Bumper Cover 2.5
Scan Pre-repair scan 1.0
`;

const CARRIER_TEXT = `
Grand Total 10300.25
Body Labor 7.0
Paint Labor 4.0
Rpr Left Fender 2.0
Repl Front Bumper Cover 2.5
`;

run("comparison analysis emits currency total row and hour-based labor rows", () => {
  const analysis = buildComparisonAnalysis({
    shopEstimateText: SHOP_TEXT,
    insurerEstimateText: CARRIER_TEXT,
  });

  const totalRow = analysis.estimateComparisons.rows.find((row) => row.id === "estimate-total");
  assert.equal(totalRow.valueUnit, "currency");
  assert.equal(totalRow.delta, 2550.25);

  const bodyHoursRow = analysis.estimateComparisons.rows.find((row) => row.id === "labor-body-hours");
  assert.equal(bodyHoursRow.valueUnit, "hours");
  assert.equal(bodyHoursRow.delta, 3.5);

  const operationHoursRow = analysis.estimateComparisons.rows.find((row) => row.id === "operation-labor-1");
  assert.equal(operationHoursRow.valueUnit, "hours");
  assert.equal(operationHoursRow.delta, 2);
});

run("export financial gap summary only uses currency-backed comparison rows for total gap", () => {
  const analysis = buildComparisonAnalysis({
    shopEstimateText: SHOP_TEXT,
    insurerEstimateText: CARRIER_TEXT,
  });

  const exportModel = buildExportModel({
    analysis,
    report: null,
    message: "",
  });

  assert.equal(exportModel.financialGapBreakdown.totalGap, "$2,550 (directional only)");
});
