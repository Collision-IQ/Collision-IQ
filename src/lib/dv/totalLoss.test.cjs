/* eslint-disable @typescript-eslint/no-require-imports */
// Total-loss (value dispute) mode — golden numbers from the Nguyen / 2012
// Honda Odyssey EX-L worked example (claim 000830008041D01, Allstate/CCC).
// Every figure below appears on the reference report; do not adjust the
// engine to make a guard pass.
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

const {
  buildTotalLossGap,
  computeTotalLossAcv,
  renderTotalLossLetterParagraphs,
} = require("./totalLoss.ts");
const { parseCarrierValuation, compsReadjustedAtRate } = require("./carrierValuation.ts");

let failures = 0;
function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(error && error.message ? error.message : error);
  }
}

function comp(dealer, asking, odometer) {
  return {
    tier: "clean",
    title: dealer,
    dealer,
    askingPrice: asking,
    mileage: odometer,
    source: "cars.com",
    trimMatch: "exact",
    dateAccessed: "2026-08-03",
  };
}

// The carrier's CCC report as parsed (values printed on p.3 of the reference).
const ODYSSEY_CARRIER = {
  vendor: "CCC",
  carrier: "ALLSTATE FIRE AND CASUALTY INSURANCE COMPANY",
  reportRef: "132401407-1",
  claimRef: "000830008041D01",
  odometer: 89652,
  statewideValue: 9060,
  baseVehicleValue: 9460,
  blendedValuation: 9260,
  conditionAdjustment: -53,
  priorDamageAdjustment: null,
  aftermarketAdjustment: null,
  refurbishmentAdjustment: null,
  titleHistoryAdjustment: null,
  dateOfLossAllowance: 1047.95,
  adjustedVehicleValue: 10254.95,
  tax: 615.3,
  taxRate: 0.06,
  fees: 83,
  deductible: null,
  total: 10953.25,
  comps: [
    { n: 1, source: "", dealer: "Bergeys Kia", location: "", distanceMi: null, odometer: 114362, vin: "", listPrice: 9890, adjustedValue: 9245, updated: "" },
    { n: 2, source: "", dealer: "22nd St Motors", location: "", distanceMi: null, odometer: 102142, vin: "", listPrice: 11995, adjustedValue: 11096, updated: "" },
    { n: 3, source: "", dealer: "Motozone", location: "", distanceMi: null, odometer: 96239, vin: "", listPrice: 9995, adjustedValue: 8993, updated: "" },
    { n: 4, source: "", dealer: "Malik Autohaus", location: "", distanceMi: null, odometer: 118925, vin: "", listPrice: 8900, adjustedValue: 8366, updated: "" },
  ],
};

const ODYSSEY_ACV = computeTotalLossAcv({
  subjectOdometer: 89652,
  comps: [
    comp("Audi Owings Mills", 11136, 110730),
    comp("Hamilton Honda", 10297, 140123),
    comp("Jet Auto Mall", 9495, 122460),
  ],
  taxRatePct: 6,
  appraisalFee: 300,
});

run("Odyssey: comp ledger and pre-tax ACV match the reference report", () => {
  const adjusted = ODYSSEY_ACV.adjustments.map((entry) => entry.adjustedValue);
  assert.deepEqual(adjusted, [12611.46, 13829.97, 11791.56]);
  assert.equal(ODYSSEY_ACV.compListAverage, 10309.33);
  assert.equal(ODYSSEY_ACV.mileageAdjustmentAverage, 2435.0);
  assert.equal(ODYSSEY_ACV.preTaxAcv, 12744.33);
});

run("Odyssey: total-loss demand is pre-tax ACV + fee, tax/fees excluded", () => {
  assert.equal(ODYSSEY_ACV.appraisalFee, 300);
  assert.equal(ODYSSEY_ACV.demand, 13044.33);
  // Tax is computed for reference only and is NOT part of the demand.
  assert.equal(ODYSSEY_ACV.tax, 764.66);
  assert.equal(ODYSSEY_ACV.acvWithTax, 13508.99);
  assert.ok(ODYSSEY_ACV.demandBasis.includes("settlement worksheet"));
});

run("Odyssey: gap analysis reproduces the page-1 table and shortfall", () => {
  const gap = buildTotalLossGap({
    acv: ODYSSEY_ACV,
    carrier: ODYSSEY_CARRIER,
    subjectOdometer: 89652,
  });
  assert.equal(gap.shortfall, 2489.38);
  assert.equal(Math.round(gap.shortfallPct * 1000) / 10, 24.3);
  assert.equal(gap.carrierListAverage, 10195.0);
  assert.equal(gap.carrierAdjustedAverage, 9425.0);
  // The strongest argument: the carrier's OWN comps at $0.07/mi.
  assert.equal(gap.carrierReadjustedAverage, 11473.55);

  const byLabel = Object.fromEntries(gap.rows.map((row) => [row.label.split(" (")[0], row]));
  assert.equal(byLabel["Comparable listings — average asking"].difference, 114.33);
  assert.equal(byLabel["Statewide-value blend"].carrier, -200);
  assert.equal(byLabel["Condition adjustment"].carrier, -53);
  assert.equal(byLabel["Other allowances"].carrier, 1047.95);
  const preTax = gap.rows.find((row) => row.total);
  assert.equal(preTax.carrier, 10254.95);
  assert.equal(preTax.ours, 12744.33);
  assert.equal(preTax.difference, 2489.38);
});

run("Odyssey: carrier comps re-run individually at $0.07/mi", () => {
  const rows = compsReadjustedAtRate(ODYSSEY_CARRIER, 89652);
  assert.deepEqual(
    rows.map((row) => row.readjusted),
    [11619.7, 12869.3, 10456.09, 10949.11]
  );
});

run("letter speaks as the owner and never names an appraiser", () => {
  const gap = buildTotalLossGap({
    acv: ODYSSEY_ACV,
    carrier: ODYSSEY_CARRIER,
    subjectOdometer: 89652,
  });
  const paragraphs = renderTotalLossLetterParagraphs({
    acv: ODYSSEY_ACV,
    carrier: ODYSSEY_CARRIER,
    gap,
    vehicleLabel: "2012 Honda Odyssey EX-L",
    lossDate: "01/01/2026",
    carrierName: "Allstate Insurance",
  });
  const body = paragraphs.join("\n\n");
  assert.ok(body.includes("$12,744.33"), "appraised value stated");
  assert.ok(body.includes("$13,044.33"), "demand stated");
  assert.ok(body.includes("$11,473.55"), "carrier comps re-run figure stated");
  assert.ok(body.includes("appraisal clause"), "appraisal clause invoked");
  assert.ok(/\bI ask for\b/.test(body), "owner voice");
  assert.ok(!/Menichetti|License\s*#?\s*739698/i.test(body), "no appraiser identity");
});

run("CCC parser reads a real Market Valuation Report", () => {
  const fixture = path.join(__dirname, "../../../tests/fixtures/carrierValuation/ccc_report.txt");
  if (!fs.existsSync(fixture)) {
    console.log("  (fixture absent — skipped)");
    return;
  }
  const cv = parseCarrierValuation(fs.readFileSync(fixture, "utf8"));
  assert.equal(cv.vendor, "CCC");
  assert.equal(cv.baseVehicleValue, 80246);
  assert.equal(cv.statewideValue, 79242);
  assert.equal(cv.blendedValuation, 79744);
  assert.equal(cv.adjustedVehicleValue, 79744);
  assert.equal(cv.tax, 4784.64);
  assert.equal(cv.total, 84528.64);
  assert.equal(cv.comps.length, 9);
  assert.equal(cv.comps[0].listPrice, 71990);
  assert.equal(cv.comps[0].adjustedValue, 78827);
  assert.equal(cv.comps[0].odometer, 6677);
  assert.equal(cv.comps[0].vin.length, 17);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\ntotalLoss suite passed");
