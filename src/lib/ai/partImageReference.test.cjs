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
  extractPartNumberFromImagePrompt,
  buildPartImageSearchQuery,
} = require("./partImageReference.ts");

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

run("detects an Audi part number in a diagram request", () => {
  assert.equal(extractPartNumberFromImagePrompt("diagram of Audi part # 8V5821467B"), "8V5821467B");
  assert.equal(extractPartNumberFromImagePrompt("show me a picture of part number 167-880-44-09"), "167-880-44-09");
  assert.equal(extractPartNumberFromImagePrompt("exploded view for OEM 0009981007"), "0009981007");
});

run("ordinary image prompts never divert to part search", () => {
  assert.equal(extractPartNumberFromImagePrompt("matte black 2020 Honda Civic coupe, bronze wheels"), null);
  assert.equal(extractPartNumberFromImagePrompt("front bumper damage on a silver SUV"), null);
  // Context cue without a part-shaped token: no diversion.
  assert.equal(extractPartNumberFromImagePrompt("diagram of a front suspension"), null);
  // Part-shaped token without any part/diagram cue: no diversion.
  assert.equal(extractPartNumberFromImagePrompt("GLE450e in a studio"), null);
});

run("search query keeps vehicle context and the part number", () => {
  assert.equal(
    buildPartImageSearchQuery("diagram of Audi part # 8V5821467B", "8V5821467B"),
    "Audi part # 8V5821467B"
  );
  assert.match(
    buildPartImageSearchQuery("picture of bracket for 2015 Audi A3", "8V5821467B"),
    /2015 Audi A3 8V5821467B$/
  );
});

console.log(`\npartImageReference: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
