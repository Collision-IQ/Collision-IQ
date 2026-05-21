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

const {
  classifyRetryableProviderError,
  isRetryableProviderMessage,
} = require("./providerRetryableError.ts");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("classifies 429 as retryable", () => {
  const result = classifyRetryableProviderError(
    { status: 429, message: "Too Many Requests" },
    { provider: "openai", stage: "analysis" }
  );

  assert.equal(result.retryable, true);
  assert.equal(result.status, 429);
  assert.equal(result.provider, "openai");
  assert.equal(result.stage, "analysis");
});

run("classifies quota/overloaded message as retryable", () => {
  const result = classifyRetryableProviderError(
    { message: "Provider quota exceeded for this minute" },
    { provider: "openai", stage: "analysis" }
  );

  assert.equal(result.retryable, true);
  assert.equal(result.status, null);
});

run("does not classify ordinary failures as retryable", () => {
  const result = classifyRetryableProviderError(
    { status: 400, message: "Invalid prompt format" },
    { provider: "openai", stage: "analysis" }
  );

  assert.equal(result.retryable, false);
  assert.equal(result.status, 400);
});

run("detects retryable message fragments", () => {
  assert.equal(isRetryableProviderMessage("rate limit reached"), true);
  assert.equal(isRetryableProviderMessage("service overloaded"), true);
  assert.equal(isRetryableProviderMessage("invalid request body"), false);
});
