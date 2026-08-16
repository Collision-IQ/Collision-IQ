/* eslint-disable @typescript-eslint/no-require-imports */
// Regression: the DV calculation must reproduce the adjudicated RO 22210
// pilot numbers (2026 Honda CR-V Hybrid Sport-L AWD) and the Civic-file
// CarFax path exactly. These figures were verified by hand in the pilot run.
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
  adjustCompForMileage,
  classify17cDamage,
  computeDvCalculation,
  mileageMultiplier17c,
  projectStigmaPct,
} = require("./acvMath.ts");
const { defaultTaxRatePctForState } = require("./salesTax.ts");

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

function comp(askingPrice, mileage) {
  return {
    tier: "clean",
    title: "comp",
    askingPrice,
    mileage,
    source: "test",
    trimMatch: "exact",
    dateAccessed: "2026-08-14",
  };
}

const NO_SEVERITY = { structural: false, airbag: false, adasCalibration: false };

run("RO 22210: per-comp $0.07/mile adjustments match the pilot worksheet", () => {
  const subject = 1495;
  const trenton = adjustCompForMileage(comp(38498, 4961), subject);
  assert.equal(trenton.mileageDifference, 3466);
  assert.equal(trenton.adjustment, 242.62);
  assert.equal(trenton.adjustedValue, 38740.62);

  const davis = adjustCompForMileage(comp(36791, 1616), subject);
  assert.equal(davis.adjustment, 8.47);
  assert.equal(davis.adjustedValue, 36799.47);

  const fredBeans = adjustCompForMileage(comp(38985, 833), subject);
  assert.equal(fredBeans.adjustment, -46.34);
  assert.equal(fredBeans.adjustedValue, 38938.66);
});

run("RO 22210: ACV math holds; no market data -> Repair-Cost Method controls", () => {
  const calc = computeDvCalculation({
    cleanComps: [comp(38498, 4961), comp(36791, 1616), comp(38985, 833)],
    oneLossComps: [],
    subjectMileage: 1495,
    taxRatePct: 6,
    repairTotal: 11336.12,
    severity: { structural: false, airbag: false, adasCalibration: true },
    appraisalFee: 350,
  });

  // The comp-side worksheet math is unchanged from the pilot.
  assert.equal(calc.averageAdjusted, 38159.58);
  assert.equal(calc.taxAmount, 2289.58);
  assert.equal(calc.preLossAcv, 40449.16);
  // No CarFax and no 1-loss set: the Repair-Cost Method controls (it replaced
  // the projected-stigma stopgap). DSR 28.03% -> base 35%, no adders.
  assert.equal(calc.postLoss.method, "repair_cost_derived");
  assert.equal(calc.postLoss.projected, true);
  assert.equal(calc.repairCost.baseFactor, 0.35);
  assert.equal(calc.repairCost.appliedFactor, 0.35);
  assert.equal(calc.repairCost.repairCostDv, 3967.64);
  assert.equal(calc.marketDv, null);
  assert.equal(calc.diminishedValue, 3967.64);
  assert.equal(calc.totalDemand, 4317.64);
  assert.equal(calc.postLoss.value, 36481.52);
  // Insurer 17c cross-check: moderate damage, under 20k miles.
  assert.equal(calc.crossCheck17c.damageClass, "moderate");
  assert.equal(calc.crossCheck17c.mileageMultiplier, 1.0);
  assert.equal(calc.crossCheck17c.value, 2022.46);
});

run("McLaren X3 golden: repair-cost + market methods reconcile by average", () => {
  // Worked example from the owner's repair_cost_dv.py module: ACV 33,076.95,
  // gross repair 7,047.41, CarFax 29,890. DSR 21.31% -> base 35% +10%
  // structural +5% repaired panels = 50%. Repair DV 3,523.71, market
  // 3,186.95, reconciled 3,355.33, total demand 3,705.33.
  const calc = computeDvCalculation({
    cleanComps: [comp(31204.67, 30000)],
    oneLossComps: [],
    subjectMileage: 30000,
    taxRatePct: 6,
    repairTotal: 7047.41,
    severity: {
      structural: true,
      airbag: false,
      adasCalibration: false,
      repairedOuterPanels: 3,
      aftermarketParts: true,
    },
    appraisalFee: 350,
    carfaxPostLossValue: 29890,
  });

  assert.equal(calc.preLossAcv, 33076.95);
  assert.equal(Math.round(calc.repairCost.dsr * 10000) / 10000, 0.2131);
  assert.equal(calc.repairCost.baseFactor, 0.35);
  assert.equal(calc.repairCost.appliedFactor, 0.5);
  assert.equal(calc.repairCost.repairCostDv, 3523.71);
  assert.equal(calc.marketDv, 3186.95);
  assert.equal(calc.diminishedValue, 3355.33);
  assert.equal(calc.totalDemand, 3705.33);
  assert.ok(calc.reconciliationUsed.includes("average"));
  // aftermarket adder is 0 in the schedule — flagged but not priced
  assert.equal(calc.repairCost.adders["aftermarket parts"], undefined);
});

run("Civic file: CarFax market DV reconciles with the repair-cost method", () => {
  // Market: ACV 18,828.39 − CarFax 15,370.00 = 3,458.39. Repair-cost: DSR
  // 42.49% -> base 45%, no adders -> 8,000 × 45% = 3,600.00. Reconciled
  // (average) = 3,529.20; total demand 3,879.20.
  const calc = computeDvCalculation({
    cleanComps: [comp(17762.63, 30000)],
    oneLossComps: [],
    subjectMileage: 30000,
    taxRatePct: 6,
    repairTotal: 8000,
    severity: NO_SEVERITY,
    appraisalFee: 350,
    carfaxPostLossValue: 15370,
  });

  assert.equal(calc.preLossAcv, 18828.39);
  assert.equal(calc.postLoss.method, "carfax_hbv");
  assert.equal(calc.postLoss.projected, false);
  assert.equal(calc.marketDv, 3458.39);
  assert.equal(calc.repairCost.repairCostDv, 3600);
  assert.equal(calc.diminishedValue, 3529.2);
  assert.equal(calc.totalDemand, 3879.2);
});

run("HARD RULE: a 1-loss comp set at/above the clean average is discarded", () => {
  // A loss-history vehicle can never be worth as much as its clean twin.
  // When the auto-derived 1-loss average meets or exceeds the clean-comp
  // average, the set is bad data: fall back to projected stigma, never
  // report zero/negative DV off it.
  const oneLoss = [
    { ...comp(39000, 1495), tier: "one_loss" },
    { ...comp(40000, 1495), tier: "one_loss" },
    { ...comp(41000, 1495), tier: "one_loss" },
  ];
  const calc = computeDvCalculation({
    cleanComps: [comp(38000, 1495)],
    oneLossComps: oneLoss,
    subjectMileage: 1495,
    taxRatePct: 6,
    repairTotal: 10000,
    severity: NO_SEVERITY,
    appraisalFee: 350,
  });
  assert.equal(calc.postLoss.method, "repair_cost_derived");
  assert.equal(calc.postLoss.projected, true);
  assert.ok(calc.diminishedValue > 0, "DV must be positive after fallback");
  assert.ok(
    calc.postLoss.rationale.includes("discarded"),
    "rationale must document the discarded 1-loss set"
  );
});

run("three confirmed 1-loss comps price the post-loss market directly", () => {
  const oneLoss = [
    { ...comp(30000, 1495), tier: "one_loss" },
    { ...comp(31000, 1495), tier: "one_loss" },
    { ...comp(32000, 1495), tier: "one_loss" },
  ];
  const calc = computeDvCalculation({
    cleanComps: [comp(38000, 1495)],
    oneLossComps: oneLoss,
    subjectMileage: 1495,
    taxRatePct: 0,
    repairTotal: 10000,
    severity: NO_SEVERITY,
    appraisalFee: 350,
  });
  assert.equal(calc.postLoss.method, "one_loss_comps");
  assert.equal(calc.postLoss.value, 31000);
});

run("a comp without a readable mileage adjusts by zero, never invents miles", () => {
  const entry = adjustCompForMileage(comp(25000, undefined), 10000);
  assert.equal(entry.adjustment, 0);
  assert.equal(entry.adjustedValue, 25000);
  assert.equal(entry.mileageDifference, undefined);
});

run("DV clamps at zero when the post-loss input exceeds the ACV", () => {
  const calc = computeDvCalculation({
    cleanComps: [comp(20000, 10000)],
    oneLossComps: [],
    subjectMileage: 10000,
    taxRatePct: 0,
    repairTotal: 1000,
    severity: NO_SEVERITY,
    appraisalFee: 350,
    carfaxPostLossValue: 25000,
  });
  assert.equal(calc.diminishedValue, 0);
  assert.equal(calc.totalDemand, 350);
});

run("stigma ladder tracks severity and flags, capped at 12", () => {
  assert.equal(projectStigmaPct({ severityRatioPct: 5, severity: NO_SEVERITY }), 3);
  assert.equal(projectStigmaPct({ severityRatioPct: 15, severity: NO_SEVERITY }), 4.5);
  assert.equal(projectStigmaPct({ severityRatioPct: 28, severity: NO_SEVERITY }), 6);
  assert.equal(projectStigmaPct({ severityRatioPct: 40, severity: NO_SEVERITY }), 8);
  assert.equal(projectStigmaPct({ severityRatioPct: 60, severity: NO_SEVERITY }), 10);
  assert.equal(
    projectStigmaPct({
      severityRatioPct: 60,
      severity: { structural: true, airbag: true, adasCalibration: false },
    }),
    12
  );
});

run("17c damage classes and mileage bands", () => {
  assert.deepEqual(classify17cDamage({ severityRatioPct: 60, severity: { ...NO_SEVERITY, structural: true } }), {
    damageClass: "severe_structural",
    damageMultiplier: 1.0,
  });
  assert.deepEqual(classify17cDamage({ severityRatioPct: 30, severity: { ...NO_SEVERITY, structural: true } }), {
    damageClass: "major",
    damageMultiplier: 0.75,
  });
  assert.deepEqual(classify17cDamage({ severityRatioPct: 10, severity: NO_SEVERITY }), {
    damageClass: "minor",
    damageMultiplier: 0.25,
  });
  assert.equal(mileageMultiplier17c(19999), 1.0);
  assert.equal(mileageMultiplier17c(20000), 0.8);
  assert.equal(mileageMultiplier17c(100000), 0);
});

run("state tax defaults: PA 6, NJ 6.625, OR 0, unknown falls back to 6", () => {
  assert.equal(defaultTaxRatePctForState("PA"), 6);
  assert.equal(defaultTaxRatePctForState("NJ"), 6.625);
  assert.equal(defaultTaxRatePctForState("OR"), 0);
  assert.equal(defaultTaxRatePctForState(undefined), 6);
  assert.equal(defaultTaxRatePctForState("ZZ"), 6);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nacvMath suite passed");
