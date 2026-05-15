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
  FREE_MONTHLY_UPLOAD_LIMIT,
  FREE_UPLOAD_BATCH_MESSAGE,
  FREE_UPLOAD_LIMIT_MESSAGE,
  evaluateFreeUploadRequest,
  getFreeUploadRollingWindowStart,
  getFreeUploadUsageCount,
  getFreeUploadUsagePeriodKey,
  isPdfOrPhotoUpload,
  recordFreeUploadUsage,
  resolveFreeUploadQuotaStatus,
} = require("./freeUploadEntitlements.ts");

const tests = [];

function run(name, test) {
  tests.push({ name, test });
}

run("free user can upload first PDF or photo", () => {
  assert.equal(isPdfOrPhotoUpload({ filename: "estimate.pdf", type: "application/pdf" }), true);
  assert.equal(isPdfOrPhotoUpload({ filename: "damage.jpg", type: "image/jpeg" }), true);

  const pdf = evaluateFreeUploadRequest({
    files: [{ filename: "estimate.pdf", type: "application/pdf" }],
    used: 0,
  });
  const photo = evaluateFreeUploadRequest({
    files: [{ filename: "damage.png", type: "image/png" }],
    used: 0,
  });

  assert.equal(pdf.allowed, true);
  assert.equal(pdf.countedUploadCount, 1);
  assert.equal(photo.allowed, true);
  assert.equal(photo.countedUploadCount, 1);
});

run("free user cannot upload 2 files in same analysis", () => {
  const result = evaluateFreeUploadRequest({
    files: [
      { filename: "estimate.pdf", type: "application/pdf" },
      { filename: "damage.jpg", type: "image/jpeg" },
    ],
    used: 0,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.code, "FREE_UPLOAD_BATCH_LIMIT");
  assert.equal(result.message, FREE_UPLOAD_BATCH_MESSAGE);
  assert.equal(result.countedUploadCount, 0);
});

run("free user can upload 3 files across rolling month and is blocked on 4th", () => {
  assert.equal(FREE_MONTHLY_UPLOAD_LIMIT, 3);
  assert.equal(resolveFreeUploadQuotaStatus({ used: 0 }).allowed, true);
  assert.equal(resolveFreeUploadQuotaStatus({ used: 1 }).allowed, true);
  assert.equal(resolveFreeUploadQuotaStatus({ used: 2 }).allowed, true);

  const fourth = evaluateFreeUploadRequest({
    files: [{ filename: "fourth.pdf", type: "application/pdf" }],
    used: 3,
  });

  assert.equal(fourth.allowed, false);
  assert.equal(fourth.code, "FREE_MONTHLY_UPLOAD_LIMIT_REACHED");
  assert.equal(fourth.message, FREE_UPLOAD_LIMIT_MESSAGE);
  assert.equal(fourth.countedUploadCount, 0);
});

run("rejected upload does not count toward free monthly usage", () => {
  const rejected = evaluateFreeUploadRequest({
    files: [{ filename: "notes.txt", type: "text/plain" }],
    used: 0,
  });

  assert.equal(rejected.allowed, false);
  assert.equal(rejected.code, "FREE_UPLOAD_FILE_TYPE_LIMIT");
  assert.equal(rejected.countedUploadCount, 0);
});

run("rolling usage count queries successful FILE_UPLOAD records inside 30 days", async () => {
  const now = new Date("2026-05-10T12:00:00.000Z");
  let capturedWhere = null;
  const usageRecord = {
    async aggregate(args) {
      capturedWhere = args.where;
      return { _sum: { quantity: 3 } };
    },
  };

  const count = await getFreeUploadUsageCount({
    userId: "user_free",
    now,
    usageRecord,
  });

  assert.equal(count, 3);
  assert.equal(capturedWhere.userId, "user_free");
  assert.equal(capturedWhere.kind, "FILE_UPLOAD");
  assert.deepEqual(capturedWhere.createdAt, {
    gte: getFreeUploadRollingWindowStart(now),
  });
});

run("successful free upload recording writes one FILE_UPLOAD usage record", async () => {
  const now = new Date("2026-05-10T12:00:00.000Z");
  let capturedData = null;
  const usageRecord = {
    async create(args) {
      capturedData = args.data;
      return { id: "usage_1" };
    },
  };

  await recordFreeUploadUsage({
    userId: "user_free",
    now,
    metadataJson: {
      attachmentId: "attachment_1",
      fileName: "estimate.pdf",
    },
    usageRecord,
  });

  assert.equal(capturedData.userId, "user_free");
  assert.equal(capturedData.kind, "FILE_UPLOAD");
  assert.equal(capturedData.periodKey, getFreeUploadUsagePeriodKey(now));
  assert.equal(capturedData.quantity, 1);
  assert.equal(capturedData.metadata.attachmentId, "attachment_1");
});

(async () => {
  for (const { name, test } of tests) {
    await test();
    console.log(`PASS ${name}`);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
