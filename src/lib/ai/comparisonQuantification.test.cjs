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
const {
  buildEstimatorChangeRequestListPdf,
} = require("./builders/estimateScrubberPdfBuilder.ts");

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

run("comparison parser normalizes glued procedure hours without turning 1.0 into 11", () => {
  const analysis = buildComparisonAnalysis({
    shopEstimateText: [
      "Grand Total 1200.00",
      "Proc OEM documentation / procedure research11.0",
      "Proc A120.00Incl.",
    ].join("\n"),
    insurerEstimateText: "Grand Total 1000.00",
  });

  const researchRow = analysis.estimateComparisons.rows.find((row) =>
    /OEM documentation/i.test(`${row.operation ?? ""} ${row.partName ?? ""}`)
  );

  assert.equal(researchRow?.lhsValue, 1);
  assert.notEqual(researchRow?.lhsValue, 11);
  assert.doesNotMatch(`${researchRow?.operation ?? ""} ${researchRow?.partName ?? ""}`, /documentation11\.0/i);
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

run("estimate delta report buckets Honda newer-estimate ADAS additions and body labor change", () => {
  const analysis = buildComparisonAnalysis({
    shopEstimateText: [
      "Body Labor 16.3",
      "Proc Pre-repair scan 1.0",
      "Proc Post-repair scan 1.0",
      "Rpr Front bumper cover 2.0",
    ].join("\n"),
    insurerEstimateText: [
      "Body Labor 16.8",
      "Proc Pre-repair scan 1.0",
      "Proc Post-repair scan 1.0",
      "Rpr Front bumper cover 2.0",
      "REVVAdas Report",
      "In-process scan",
      "Four wheel alignment",
      "Radar calibration",
      "Camera calibration",
      "Steering angle sensor calibration",
      "Seat weight sensor zero point calibration",
      "Power window initialization",
    ].join("\n"),
    shopEstimateLabel: "Estimate 1",
    insurerEstimateLabel: "Estimate 2",
  });

  const document = buildEstimatorChangeRequestListPdf({
    report: null,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });
  const added = document.sections.find((section) =>
    section.bullets?.some((bullet) => /REVVAdas Report|In-process scan|Radar calibration/i.test(bullet))
  )?.bullets ?? [];
  const changed = document.sections.find((section) =>
    /^(Changed Labor \/ Qty \/ Price|CHANGED FROM PRIOR ESTIMATE|CHANGED BETWEEN ESTIMATES)$/i.test(
      section.title
    )
  )?.bullets ?? [];
  const text = JSON.stringify(document);

  assert.equal(document.header.title, "Estimate Delta / Change Requests");
  assert.match(added.join("\n"), /REVVAdas Report/i);
  assert.match(added.join("\n"), /In-process scan/i);
  assert.match(added.join("\n"), /Four wheel alignment/i);
  assert.match(added.join("\n"), /Radar calibration/i);
  assert.match(added.join("\n"), /Camera calibration|Steering angle sensor calibration|Seat weight sensor zero point calibration|Power window initialization/i);
  assert.match(changed.join("\n"), /Body labor hours.*16\.3.*16\.8/i);
  assert.doesNotMatch(text, /Estimate total|DOI|legal|Not clearly Not clearly/i);
});
