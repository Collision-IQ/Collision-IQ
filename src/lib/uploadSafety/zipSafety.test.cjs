/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const JSZip = require("jszip");

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
  MB,
  resolveUploadPlanLimits,
} = require("./uploadLimits.ts");
const {
  prepareZipUpload,
  prepareUploadFile,
  validateUploadFilename,
} = require("./zipSafety.ts");

const tests = [];

function run(name, test) {
  tests.push({ name, test });
}

async function zipBuffer(entries) {
  const zip = new JSZip();
  for (const [name, content] of entries) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

function starterEntitlements() {
  return {
    plan: "starter",
    billingPlan: "starter",
    isPlatformAdmin: false,
    entitlementSource: "starter_subscription",
  };
}

function proEntitlements() {
  return {
    plan: "pro",
    billingPlan: "pro",
    isPlatformAdmin: false,
    entitlementSource: "paid_subscription",
  };
}

function adminEntitlements() {
  return {
    plan: "admin",
    billingPlan: "team",
    isPlatformAdmin: true,
    entitlementSource: "free_access_admin",
  };
}

function makeFile(name, type, content = "image-bytes") {
  return new File([Buffer.from(content)], name, { type });
}

run("Starter rejects ZIP and files over 10 MB", async () => {
  const limits = resolveUploadPlanLimits(starterEntitlements());
  assert.equal(limits.maxUploadBytes, 10 * MB);
  assert.equal(limits.zipAllowed, false);

  const result = await prepareZipUpload({
    filename: "docs.zip",
    buffer: await zipBuffer([["estimate.pdf", "pdf"]]),
    limits,
  });

  assert.equal(result.files.length, 0);
  assert.equal(result.rejectedFiles[0].code, "ZIP_NOT_ALLOWED");
  assert.equal(10 * MB + 1 > limits.maxUploadBytes, true);
});

run("Pro accepts ZIP up to 30 MB", async () => {
  const limits = resolveUploadPlanLimits(proEntitlements());
  assert.equal(limits.maxUploadBytes, 30 * MB);
  assert.equal(limits.zipAllowed, true);

  const result = await prepareZipUpload({
    filename: "docs.zip",
    buffer: await zipBuffer([["estimate.pdf", "hello"]]),
    limits,
  });

  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].filename, "estimate.pdf");
  assert.equal(result.rejectedFiles.length, 0);
});

run("direct PNG screenshot accepted", async () => {
  const result = await prepareUploadFile(
    makeFile("screen.png", "image/png"),
    resolveUploadPlanLimits(proEntitlements())
  );

  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].filename, "screen.png");
  assert.equal(result.files[0].type, "image/png");
  assert.equal(result.files[0].classification, "image");
  assert.equal(result.files[0].source, "direct_upload");
  assert.equal(result.files[0].sizeBytes, Buffer.byteLength("image-bytes"));
});

run("direct JPG screenshot accepted", async () => {
  const result = await prepareUploadFile(
    makeFile("screen.jpg", "image/jpeg"),
    resolveUploadPlanLimits(proEntitlements())
  );

  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].filename, "screen.jpg");
  assert.equal(result.files[0].type, "image/jpeg");
  assert.equal(result.files[0].classification, "image");
});

run("screenshot inside ZIP accepted", async () => {
  const result = await prepareZipUpload({
    filename: "screens.zip",
    buffer: await zipBuffer([["screens/screen.webp", "webp"]]),
    limits: resolveUploadPlanLimits(proEntitlements()),
  });

  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].filename, "screen.webp");
  assert.equal(result.files[0].type, "image/webp");
  assert.equal(result.files[0].classification, "image");
  assert.equal(result.files[0].source, "zip_extraction");
  assert.equal(result.files[0].sourceArchive, "screens.zip");
});

run("unsupported image type rejected", async () => {
  const result = await prepareUploadFile(
    makeFile("screen.gif", "image/gif"),
    resolveUploadPlanLimits(proEntitlements())
  );

  assert.equal(result.files.length, 0);
  assert.equal(result.rejectedFiles[0].code, "UNSUPPORTED_EXTENSION");
});

run("Starter still limited to 1 screenshot/photo", () => {
  const limits = resolveUploadPlanLimits(starterEntitlements());
  assert.equal(limits.maxFilesPerReview, 1);
  assert.equal(limits.maxUploadBytes, 10 * MB);
});

run("Pro/Admin can upload screenshots within plan size limits", () => {
  const proLimits = resolveUploadPlanLimits(proEntitlements());
  const adminLimits = resolveUploadPlanLimits(adminEntitlements());

  assert.equal(proLimits.maxUploadBytes, 30 * MB);
  assert.equal(adminLimits.maxUploadBytes, 50 * MB);
  assert.equal(5 * MB <= proLimits.maxUploadBytes, true);
  assert.equal(5 * MB <= adminLimits.maxUploadBytes, true);
});

run("unsafe ZIP filenames rejected", () => {
  const rejected = validateUploadFilename("../evil.pdf");
  assert.equal(rejected?.code, "UNSAFE_FILENAME");
});

run("blocked extensions rejected", async () => {
  const result = await prepareZipUpload({
    filename: "docs.zip",
    buffer: await zipBuffer([["launch.exe", "nope"]]),
    limits: resolveUploadPlanLimits(proEntitlements()),
  });

  assert.equal(result.files.length, 0);
  assert.equal(result.rejectedFiles[0].code, "BLOCKED_EXTENSION");
});

run("excessive extracted file count rejected", async () => {
  const limits = {
    ...resolveUploadPlanLimits(proEntitlements()),
    maxExtractedFiles: 2,
  };
  const result = await prepareZipUpload({
    filename: "docs.zip",
    buffer: await zipBuffer([
      ["one.pdf", "1"],
      ["two.pdf", "2"],
      ["three.pdf", "3"],
    ]),
    limits,
  });

  assert.equal(result.files.length, 2);
  assert.equal(result.rejectedFiles.some((file) => file.code === "ZIP_TOO_MANY_FILES"), true);
});

run("oversized extracted total rejected", async () => {
  const limits = {
    ...resolveUploadPlanLimits(proEntitlements()),
    maxExtractedTotalBytes: 5,
  };
  const result = await prepareZipUpload({
    filename: "docs.zip",
    buffer: await zipBuffer([
      ["one.txt", "1234"],
      ["two.txt", "5678"],
    ]),
    limits,
  });

  assert.equal(result.files.length, 1);
  assert.equal(result.rejectedFiles.some((file) => file.code === "ZIP_EXTRACTED_TOO_LARGE"), true);
});

(async () => {
  for (const { name, test } of tests) {
    try {
      await test();
      console.log(`PASS ${name}`);
    } catch (error) {
      console.error(`FAIL ${name}`);
      throw error;
    }
  }
})();
