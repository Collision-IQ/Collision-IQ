/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const JSZip = require("jszip");

const originalResolveFilename = Module._resolveFilename;
const originalLoad = Module._load;
Module._resolveFilename = function resolveFilenameWithAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    const absolute = path.join(process.cwd(), "src", request.slice(2));
    return originalResolveFilename.call(this, absolute, parent, isMain, options);
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};
Module._load = function loadWithServerOnlyShim(request, parent, isMain) {
  if (request === "server-only") {
    return {};
  }

  return originalLoad.call(this, request, parent, isMain);
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
  UNLIMITED_UPLOAD_BATCH_FILE_LIMIT,
  getUploadBatchLimitMessage,
  resolveUploadPlanLimits,
  validateUploadBatchFileCount,
} = require("./uploadLimits.ts");
const {
  prepareZipUpload,
  prepareUploadFile,
  validateUploadFilename,
} = require("./zipSafety.ts");
const {
  CCC_WORKFILE_DISCLAIMER,
  parseCccWorkfileArtifact,
} = require("../ccc/cccWorkfile.ts");
const {
  buildCccWorkfileScrubberBullets,
} = require("../ai/builders/estimateScrubberPdfBuilder.ts");

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

async function compressedZipBuffer(entries) {
  const zip = new JSZip();
  for (const [name, content] of entries) {
    zip.file(name, content);
  }
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
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

function freeEntitlements() {
  return {
    plan: "free",
    billingPlan: "free",
    isPlatformAdmin: false,
    entitlementSource: "free",
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

function box(type, payload) {
  const buffer = Buffer.alloc(8 + payload.length);
  buffer.writeUInt32BE(buffer.length, 0);
  buffer.write(type, 4, 4, "ascii");
  payload.copy(buffer, 8);
  return buffer;
}

function mp4WithDuration(seconds) {
  const timescale = 1000;
  const mvhd = Buffer.alloc(20);
  mvhd[0] = 0;
  mvhd.writeUInt32BE(0, 4);
  mvhd.writeUInt32BE(0, 8);
  mvhd.writeUInt32BE(timescale, 12);
  mvhd.writeUInt32BE(Math.round(seconds * timescale), 16);

  return Buffer.concat([
    box("ftyp", Buffer.from("isom0000", "ascii")),
    box("moov", box("mvhd", mvhd)),
  ]);
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
  assert.equal(result.rejectedFiles[0].code, "ZIP_DISALLOWED_TYPE");
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

run("5-second MP4 video accepted", async () => {
  const result = await prepareUploadFile(
    makeFile("damage.mp4", "video/mp4", mp4WithDuration(5)),
    resolveUploadPlanLimits(proEntitlements())
  );

  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].filename, "damage.mp4");
  assert.equal(result.files[0].type, "video/mp4");
  assert.equal(result.files[0].classification, "video");
});

run("video over 5 seconds rejected", async () => {
  const result = await prepareUploadFile(
    makeFile("damage.mp4", "video/mp4", mp4WithDuration(5.001)),
    resolveUploadPlanLimits(proEntitlements())
  );

  assert.equal(result.files.length, 0);
  assert.equal(result.rejectedFiles[0].code, "VIDEO_TOO_LONG");
  assert.equal(result.rejectedFiles[0].reason, "Videos must be 5 seconds or shorter.");
});

run(".mp4 accepted", async () => {
  const result = await prepareUploadFile(
    makeFile("clip.mp4", "video/mp4", mp4WithDuration(4)),
    resolveUploadPlanLimits(proEntitlements())
  );

  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].type, "video/mp4");
});

run(".mov accepted", async () => {
  const result = await prepareUploadFile(
    makeFile("clip.mov", "video/quicktime", mp4WithDuration(4)),
    resolveUploadPlanLimits(proEntitlements())
  );

  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].type, "video/quicktime");
});

run(".webm accepted", async () => {
  const result = await prepareUploadFile(
    makeFile("clip.webm", "video/webm", "webm-bytes-without-duration"),
    resolveUploadPlanLimits(proEntitlements())
  );

  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].type, "video/webm");
});

run("missing MIME but valid video extension accepted", async () => {
  const result = await prepareUploadFile(
    makeFile("clip.mp4", "", mp4WithDuration(4)),
    resolveUploadPlanLimits(proEntitlements())
  );

  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].type, "video/mp4");
  assert.equal(result.files[0].classification, "video");
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

run("Starter rejects second file", () => {
  const limits = resolveUploadPlanLimits(starterEntitlements());
  const result = validateUploadBatchFileCount(2, limits);

  assert.equal(limits.maxFilesPerReview, 1);
  assert.equal(result.valid, false);
  assert.equal(result.code, "MAX_FILES_REACHED");
  assert.equal(result.reason, "You can upload 1 file per review.");
});

run("Free upload plan allows one PDF/photo per analysis", () => {
  const limits = resolveUploadPlanLimits(freeEntitlements());
  const result = validateUploadBatchFileCount(2, limits);

  assert.equal(limits.plan, "free");
  assert.equal(limits.maxFilesPerReview, 1);
  assert.equal(limits.zipAllowed, false);
  assert.equal(result.valid, false);
  assert.equal(
    result.reason,
    "Free accounts can upload 1 file per analysis. Please remove extra files and try again."
  );
});

run("Pro allows 6 and rejects 7 in same batch", () => {
  const limits = resolveUploadPlanLimits(proEntitlements());

  assert.equal(limits.maxFilesPerReview, 6);
  assert.equal(validateUploadBatchFileCount(6, limits).valid, true);
  assert.equal(validateUploadBatchFileCount(7, limits).valid, false);
  assert.equal(getUploadBatchLimitMessage(limits), "You can upload up to 6 files at a time.");
});

run("Trial allows 6 and rejects 7 in same batch", () => {
  const limits = resolveUploadPlanLimits({
    plan: "trial",
    billingPlan: "trial",
    isPlatformAdmin: false,
    entitlementSource: "trial",
  });

  assert.equal(limits.maxFilesPerReview, 6);
  assert.equal(validateUploadBatchFileCount(6, limits).valid, true);
  assert.equal(validateUploadBatchFileCount(7, limits).valid, false);
});

run("Admin/free-access allows more than 6 files", () => {
  const limits = resolveUploadPlanLimits(adminEntitlements());

  assert.equal(limits.maxFilesPerReview, UNLIMITED_UPLOAD_BATCH_FILE_LIMIT);
  assert.equal(validateUploadBatchFileCount(7, limits).valid, true);
  assert.equal(validateUploadBatchFileCount(50, limits).valid, true);
  assert.equal(validateUploadBatchFileCount(51, limits).valid, true);
  assert.equal(getUploadBatchLimitMessage(limits), "You can upload any number of files per review.");
});

run("Admin/unlimited resolves correctly via isPlatformAdmin or uploadCap: null", () => {
  const limits1 = resolveUploadPlanLimits({
    isPlatformAdmin: true,
    billingPlan: "none",
    entitlementSource: "locked",
    uploadCap: 10,
  });

  const limits2 = resolveUploadPlanLimits({
    isPlatformAdmin: false,
    billingPlan: "free",
    entitlementSource: "free",
    uploadCap: null,
  });

  assert.equal(limits1.plan, "admin");
  assert.equal(limits1.maxFilesPerReview, UNLIMITED_UPLOAD_BATCH_FILE_LIMIT);
  assert.equal(validateUploadBatchFileCount(7, limits1).valid, true);

  assert.equal(limits2.plan, "admin");
  assert.equal(limits2.maxFilesPerReview, UNLIMITED_UPLOAD_BATCH_FILE_LIMIT);
  assert.equal(validateUploadBatchFileCount(7, limits2).valid, true);
});

run("Pro/Admin can upload screenshots within plan size limits", () => {
  const proLimits = resolveUploadPlanLimits(proEntitlements());
  const adminLimits = resolveUploadPlanLimits(adminEntitlements());

  assert.equal(proLimits.maxUploadBytes, 30 * MB);
  assert.equal(adminLimits.maxUploadBytes, 50 * MB);
  assert.equal(5 * MB <= proLimits.maxUploadBytes, true);
  assert.equal(5 * MB <= adminLimits.maxUploadBytes, true);
});

run("AWF accepted for Pro and Admin", async () => {
  const proResult = await prepareUploadFile(
    makeFile("claim.AWF", "application/octet-stream", "opaque-awf"),
    resolveUploadPlanLimits(proEntitlements())
  );
  const adminResult = await prepareUploadFile(
    makeFile("claim.awf", "application/octet-stream", "opaque-awf"),
    resolveUploadPlanLimits(adminEntitlements())
  );

  assert.equal(proResult.files.length, 1);
  assert.equal(proResult.files[0].classification, "ccc_awf");
  assert.equal(adminResult.files.length, 1);
  assert.equal(adminResult.files[0].classification, "ccc_awf");
});

run("AWF rejected for Starter", async () => {
  const result = await prepareUploadFile(
    makeFile("claim.awf", "application/octet-stream", "opaque-awf"),
    resolveUploadPlanLimits(starterEntitlements())
  );

  assert.equal(result.files.length, 0);
  assert.equal(result.rejectedFiles[0].code, "CCC_WORKFILE_PLAN_REQUIRED");
});

run("AWF rejected for Trial until upgraded to Pro", async () => {
  const result = await prepareUploadFile(
    makeFile("claim.awf", "application/octet-stream", "opaque-awf"),
    resolveUploadPlanLimits({
      plan: "trial",
      billingPlan: "trial",
      isPlatformAdmin: false,
      entitlementSource: "trial",
    })
  );

  assert.equal(result.files.length, 0);
  assert.equal(result.rejectedFiles[0].code, "CCC_WORKFILE_PLAN_REQUIRED");
});

run("CCC companion unsupported files rejected unless explicitly allowed", async () => {
  const unsupported = await prepareUploadFile(
    makeFile("claim.bin", "application/octet-stream", "opaque"),
    resolveUploadPlanLimits(proEntitlements())
  );
  const allowed = await prepareUploadFile(
    makeFile("claim.xml", "application/xml", "<estimate />"),
    resolveUploadPlanLimits(proEntitlements())
  );

  assert.equal(unsupported.files.length, 0);
  assert.equal(unsupported.rejectedFiles[0].code, "UNSUPPORTED_EXTENSION");
  assert.equal(allowed.files.length, 1);
  assert.equal(allowed.files[0].classification, "ccc_companion_file");
});

run("AWF parser stores opaque metadata and hash", () => {
  const parsed = parseCccWorkfileArtifact({
    filename: "claim.awf",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("opaque-awf"),
    classification: "ccc_awf",
  });

  assert.equal(parsed.metadata.classification, "ccc_awf");
  assert.equal(parsed.metadata.parserStatus, "opaque_artifact");
  assert.equal(parsed.metadata.sha256.length, 64);
  assert.equal(parsed.text.includes(CCC_WORKFILE_DISCLAIMER), true);
});

run("Estimate Scrubber can receive ccc_awf context", () => {
  const bullets = buildCccWorkfileScrubberBullets({
    disclaimer: CCC_WORKFILE_DISCLAIMER,
    artifacts: [
      {
        id: "artifact-1",
        filename: "claim.awf",
        classification: "ccc_awf",
        parserStatus: "opaque_artifact",
        sha256: "abc",
        sizeBytes: 10,
      },
    ],
  });

  assert.equal(bullets[0], CCC_WORKFILE_DISCLAIMER);
  assert.equal(bullets.some((line) => line.includes("ccc_awf")), true);
});

run("unsafe ZIP filenames rejected", () => {
  const rejected = validateUploadFilename("../evil.pdf");
  assert.equal(rejected?.code, "UNSAFE_FILENAME");
});

run("blocked extensions rejected inside ZIP", async () => {
  const result = await prepareZipUpload({
    filename: "docs.zip",
    buffer: await zipBuffer([["launch.exe", "nope"]]),
    limits: resolveUploadPlanLimits(proEntitlements()),
  });

  assert.equal(result.files.length, 0);
  assert.equal(result.rejectedFiles[0].code, "ZIP_DISALLOWED_TYPE");
});

run("excessive ZIP entry count rejects whole archive", async () => {
  const entries = Array.from({ length: 51 }, (_, index) => [
    `file-${index}.txt`,
    "1",
  ]);
  const result = await prepareZipUpload({
    filename: "docs.zip",
    buffer: await zipBuffer(entries),
    limits: resolveUploadPlanLimits(adminEntitlements()),
  });

  assert.equal(result.files.length, 0);
  assert.equal(result.rejectedFiles[0].code, "ZIP_TOO_MANY_ENTRIES");
});

run("zip-slip entry rejects whole archive", async () => {
  const result = await prepareZipUpload({
    filename: "docs.zip",
    buffer: await zipBuffer([["../evil.pdf", "bad"]]),
    limits: resolveUploadPlanLimits(proEntitlements()),
  });

  assert.equal(result.files.length, 0);
  assert.equal(result.rejectedFiles[0].code, "ZIP_UNSAFE_PATH");
});

run("high compression ratio rejects whole archive", async () => {
  const result = await prepareZipUpload({
    filename: "docs.zip",
    buffer: await compressedZipBuffer([["huge.txt", "a".repeat(1024 * 1024)]]),
    limits: resolveUploadPlanLimits(proEntitlements()),
  });

  assert.equal(result.files.length, 0);
  assert.equal(result.rejectedFiles[0].code, "ZIP_BOMB_SUSPECTED");
});

if (process.env.VITEST) {
  const vitestTest = globalThis.__vitest_index__?.test;
  if (typeof vitestTest !== "function") {
    throw new Error("Vitest test API was not available for zipSafety.test.cjs");
  }

  for (const { name, test } of tests) {
    vitestTest(name, test);
  }
} else {
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
}
