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
  resolveUploadTransport,
  validateDirectUploadCandidate,
} = require("./directUploadRouting.ts");
const { resolveUploadPlanLimits } = require("./uploadLimits.ts");

function limitsFor(plan, isPlatformAdmin = false) {
  return resolveUploadPlanLimits({
    billingPlan: plan,
    plan,
    entitlementSource: plan,
    isPlatformAdmin,
  });
}

function file(name, size, type = "application/octet-stream") {
  return { name, size, type };
}

const MB = 1024 * 1024;
const workAuthZip = file("Work Auth 21215.zip", Math.round(40.8 * MB), "application/zip");

{
  const free = limitsFor("free");
  const rejection = validateDirectUploadCandidate(workAuthZip, free);
  assert.equal(rejection?.code, "ZIP_PLAN_REQUIRED");
}

{
  const starter = limitsFor("starter");
  const smallZip = file("starter-small.zip", 25 * MB, "application/zip");
  assert.equal(validateDirectUploadCandidate(smallZip, starter), null);
  assert.equal(validateDirectUploadCandidate(workAuthZip, starter)?.code, "ZIP_TOO_LARGE");
}

{
  const pro = limitsFor("pro");
  assert.equal(validateDirectUploadCandidate(workAuthZip, pro), null);
  assert.equal(resolveUploadTransport(workAuthZip, pro).uploadMode, "direct-storage");
}

{
  const admin = limitsFor("admin", true);
  assert.equal(validateDirectUploadCandidate(workAuthZip, admin), null);
  assert.equal(resolveUploadTransport(workAuthZip, admin).uploadMode, "direct-storage");
}

{
  const pro = limitsFor("pro");
  assert.equal(
    resolveUploadTransport(file("estimate.pdf", 2 * MB, "application/pdf"), pro).uploadMode,
    "api-upload"
  );
}

{
  const starter = limitsFor("starter");
  assert.equal(
    validateDirectUploadCandidate(file("walkaround.mp4", 3 * MB, "video/mp4"), starter)?.code,
    "VIDEO_PLAN_REQUIRED"
  );
}

{
  const pro = limitsFor("pro");
  const video = file("walkaround.mp4", 12 * MB, "video/mp4");
  assert.equal(validateDirectUploadCandidate(video, pro), null);
  assert.equal(resolveUploadTransport(video, pro).uploadMode, "direct-storage");
}

console.log("directUploadRouting tests passed");
