/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalSchemaWarningFlag = process.env.COLLISION_IQ_DISABLE_SCHEMA_WARNING;
delete process.env.DATABASE_URL;
process.env.COLLISION_IQ_DISABLE_SCHEMA_WARNING = "1";

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
  isUploadedAttachmentOptionalColumnMismatch,
  saveUploadedAttachmentWithDelegate,
} = require("./uploadedAttachmentStore.ts");

async function run(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function main() {
await run("upload metadata fallback stores core attachment fields when optional columns are missing", async () => {
  const calls = [];
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);

  try {
    const delegate = {
      create: async (args) => {
        calls.push(args);

        if (calls.length === 1) {
          const error = new Error("The column `UploadedAttachment.classification` does not exist.");
          error.code = "P2022";
          error.meta = { column: "UploadedAttachment.classification" };
          throw error;
        }

        assert.deepEqual(Object.keys(args.data).sort(), [
          "filename",
          "imageDataUrl",
          "ownerId",
          "ownerType",
          "pageCount",
          "text",
          "type",
        ]);
        assert.equal("classification" in args.data, false);
        assert.equal("metadata" in args.data, false);
        assert.equal("sha256" in args.data, false);
        assert.equal("classification" in args.select, false);

        return {
          id: "att_1",
          filename: args.data.filename,
          type: args.data.type,
          text: args.data.text,
          imageDataUrl: args.data.imageDataUrl,
          pageCount: args.data.pageCount,
        };
      },
    };

    const stored = await saveUploadedAttachmentWithDelegate(delegate, {
      ownerUserId: "user_1",
      filename: "estimate.awf",
      type: "application/octet-stream",
      text: "Opaque CCC workfile artifact",
      imageDataUrl: undefined,
      pageCount: 1,
      classification: "ccc_awf",
      sizeBytes: 2048,
      sha256: "abc123",
      metadata: {
        artifactFamily: "ccc_workfile",
        format: "awf",
        safeReadableMetadata: {},
        parserStatus: "opaque",
      },
      source: "direct_upload",
    });

    assert.equal(calls.length, 2);
    assert.equal(stored.id, "att_1");
    assert.equal(stored.filename, "estimate.awf");
    assert.equal(stored.classification, undefined);
    assert.equal(stored.sha256, undefined);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /uploaded-attachment-store/);
  } finally {
    console.warn = originalWarn;
  }
});

await run("optional UploadedAttachment metadata column mismatch is detected narrowly", async () => {
  assert.equal(
    isUploadedAttachmentOptionalColumnMismatch({
      code: "P2022",
      message: "The column `UploadedAttachment.classification` does not exist.",
    }),
    true
  );
  assert.equal(
    isUploadedAttachmentOptionalColumnMismatch({
      code: "P2022",
      message: "The column `UploadedAttachment.filename` does not exist.",
    }),
    false
  );
  assert.equal(
    isUploadedAttachmentOptionalColumnMismatch(new Error("classification is unavailable")),
    false
  );
  assert.equal(
    isUploadedAttachmentOptionalColumnMismatch(new Error("column classification does not exist")),
    true
  );
});

if (originalDatabaseUrl) {
  process.env.DATABASE_URL = originalDatabaseUrl;
}
if (originalSchemaWarningFlag === undefined) {
  delete process.env.COLLISION_IQ_DISABLE_SCHEMA_WARNING;
} else {
  process.env.COLLISION_IQ_DISABLE_SCHEMA_WARNING = originalSchemaWarningFlag;
}
}

main().catch((error) => {
  if (originalDatabaseUrl) {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
  if (originalSchemaWarningFlag === undefined) {
    delete process.env.COLLISION_IQ_DISABLE_SCHEMA_WARNING;
  } else {
    process.env.COLLISION_IQ_DISABLE_SCHEMA_WARNING = originalSchemaWarningFlag;
  }
  throw error;
});
