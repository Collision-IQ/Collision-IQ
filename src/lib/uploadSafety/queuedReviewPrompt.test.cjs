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
  ZIP_UPLOAD_PROGRESS_MESSAGE,
  buildZipExtractedReviewStartMessage,
  hasFailedBlockingUpload,
  isUploadBlockingAnalysis,
  shouldFlushQueuedReviewPrompt,
} = require("./queuedReviewPrompt.ts");

const zipUploading = {
  id: "zip-1",
  name: "Work Auth 21215.zip",
  mimeType: "application/zip",
  phase: "uploading",
  directUpload: true,
};

assert.equal(isUploadBlockingAnalysis([zipUploading]), true);
assert.equal(
  shouldFlushQueuedReviewPrompt({
    queuedPrompt: { id: 1, prompt: "review this", status: "queued" },
    lifecycleItems: [zipUploading],
    reviewableFileCount: 128,
  }),
  false
);

assert.equal(
  shouldFlushQueuedReviewPrompt({
    queuedPrompt: { id: 1, prompt: "review this", status: "queued" },
    lifecycleItems: [{ ...zipUploading, phase: "complete" }],
    reviewableFileCount: 128,
  }),
  true
);

assert.equal(
  shouldFlushQueuedReviewPrompt({
    queuedPrompt: { id: 1, prompt: "review this", status: "flushing" },
    lifecycleItems: [{ ...zipUploading, phase: "complete" }],
    reviewableFileCount: 128,
  }),
  false
);

assert.equal(hasFailedBlockingUpload([{ ...zipUploading, phase: "failed" }]), true);
assert.equal(
  shouldFlushQueuedReviewPrompt({
    queuedPrompt: { id: 1, prompt: "review this", status: "queued" },
    lifecycleItems: [{ ...zipUploading, phase: "failed" }],
    reviewableFileCount: 128,
  }),
  false
);

assert.equal(
  buildZipExtractedReviewStartMessage({ totalFiles: 128, pdfCount: 18, imageCount: 110 }),
  "ZIP extracted. I found 128 files: 18 PDFs, 110 images. Starting preliminary triage."
);
assert.equal(
  ZIP_UPLOAD_PROGRESS_MESSAGE,
  "I'm receiving and extracting the ZIP now. I'll start review as soon as files are available."
);

console.log("queuedReviewPrompt tests passed");
