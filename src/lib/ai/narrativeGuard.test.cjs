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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};

const {
  guardDamageZoneNarrative,
  estimateEstablishesDamageZone,
  containsSpeculativeDamageZoneNarrative,
  DAMAGE_ZONE_AND_DETERMINATION_DIRECTIVE,
} = require("./narrativeGuard.ts");

let passed = 0;
let failed = 0;
function run(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(error && error.stack ? error.stack : error);
  }
}

run("strips the speculative 'reads like' comparison narrative", () => {
  const input =
    "Looking at both estimates as a whole, the shop estimate reads like a multi-zone repair involving front-end, while the carrier estimate reads more like a flatter carrier scope. Body labor appears reduced by about 2 hours.";
  const out = guardDamageZoneNarrative(input, { estimateText: "no impact field here" });
  assert.equal(containsSpeculativeDamageZoneNarrative(out), false);
  assert.equal(/reads like|reads more like/i.test(out), false);
  // The factual sentence survives.
  assert.match(out, /Body labor appears reduced by about 2 hours\./);
});

run("replaces banned damage-zone path/zone phrases with neutral scope", () => {
  const input =
    "This front-end repair path appears fit-sensitive. The rear-end repair path is unclear. This is a localized repair zone.";
  const out = guardDamageZoneNarrative(input, { estimateText: "" });
  assert.equal(/front-end repair path|rear-end repair path|localized repair zone/i.test(out), false);
  assert.match(out, /the documented repair scope/i);
});

run("leaves evidence-anchored phrases untouched (front-end parts, fit-sensitive repair path)", () => {
  const input =
    "The shop estimate is broader on OEM-style front-end parts. OEM support indicates a fit-sensitive repair path.";
  const out = guardDamageZoneNarrative(input, { estimateText: "" });
  assert.match(out, /OEM-style front-end parts/i);
  assert.match(out, /fit-sensitive repair path/i);
});

run("does not strip when the estimate documents Point of Impact", () => {
  const established =
    "Point of Impact: 12 Front\nThe carrier estimate reads like a front-end repair.";
  const out = guardDamageZoneNarrative(established, { estimateText: established });
  // Zone is established by the documented Point of Impact, so text is preserved.
  assert.equal(out, established);
  assert.equal(estimateEstablishesDamageZone(established), true);
});

run("estimateEstablishesDamageZone is false without a Point of Impact field", () => {
  assert.equal(estimateEstablishesDamageZone("2019 Chevrolet Traverse Premier, rear bumper cover"), false);
  assert.equal(estimateEstablishesDamageZone(""), false);
  assert.equal(estimateEstablishesDamageZone(null), false);
});

run("directive names the five required determination fields and the bans", () => {
  for (const field of ["Evidence Reviewed", "Finding", "Why It Matters", "Missing Documentation", "Next Step"]) {
    assert.ok(DAMAGE_ZONE_AND_DETERMINATION_DIRECTIVE.includes(field), `directive missing: ${field}`);
  }
  assert.match(DAMAGE_ZONE_AND_DETERMINATION_DIRECTIVE, /front-end repair path/i);
  assert.match(DAMAGE_ZONE_AND_DETERMINATION_DIRECTIVE, /Point of Impact/i);
});

run("empty / nullish input returns empty string", () => {
  assert.equal(guardDamageZoneNarrative("", {}), "");
  assert.equal(guardDamageZoneNarrative(null, {}), "");
  assert.equal(guardDamageZoneNarrative(undefined, {}), "");
});

console.log(`\nnarrativeGuard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
