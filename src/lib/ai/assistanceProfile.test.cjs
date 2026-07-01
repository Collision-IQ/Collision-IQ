/* eslint-disable @typescript-eslint/no-require-imports */
// Tests for src/lib/ai/assistanceProfile.ts
// Run from project root: node src/lib/ai/assistanceProfile.test.cjs

"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const fs = require("node:fs");
const ts = require("typescript");

const cwd = process.cwd();
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveWithAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(this, path.join(cwd, "src", request.slice(2)), parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
require.extensions[".ts"] = function compileTsModule(module, filename) {
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
  buildAssistanceProfileInstruction,
  buildConversationBehaviorDirective,
} = require(path.join(cwd, "src/lib/ai/assistanceProfile.ts"));

let passed = 0;
let failed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    failures.push({ name, err });
    failed++;
  }
}

console.log("\nbuildConversationBehaviorDirective (system prompt)");

test("always includes the chatbot-first + length calibration directive", () => {
  const out = buildConversationBehaviorDirective("policyholder");
  assert.match(out, /chatbot first/i);
  assert.match(out, /never say you are "waiting for estimate files"/i);
  assert.match(out, /60% short/);
});

test("uses the selected role's tone guidance", () => {
  assert.match(buildConversationBehaviorDirective("policyholder"), /vehicle owner|plain, calm/i);
  assert.match(buildConversationBehaviorDirective("shop"), /repair shop|technical and tactical/i);
  assert.match(buildConversationBehaviorDirective("attorney_or_appraiser"), /attorney \/ appraiser|evidence- and citation/i);
});

test("infers audience from tone when no profile is set", () => {
  const out = buildConversationBehaviorDirective(null);
  assert.match(out, /infer the audience/i);
  assert.match(out, /chatbot first/i); // directive still present
});

console.log("\nbuildAssistanceProfileInstruction (retrieval-safe, short)");

test("is empty when no profile — never pollutes a retrieval query", () => {
  assert.equal(buildAssistanceProfileInstruction(null), "");
  assert.equal(buildAssistanceProfileInstruction("other"), "");
});

test("short line for a profile and NOT the long behavior directive", () => {
  const out = buildAssistanceProfileInstruction("shop");
  assert.match(out, /ASSISTANCE PROFILE: shop/);
  assert.doesNotMatch(out, /chatbot first/i);
  assert.doesNotMatch(out, /60% short/);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const { name, err } of failures) console.error(`\nFAILED: ${name}\n${err.stack || err.message}`);
  process.exit(1);
}
