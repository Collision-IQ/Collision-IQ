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
    },
    fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};

const { budgetChatAttachments, buildChatAttachmentOmissionNotice } = require("./chatAttachmentBudget.ts");

function run(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function image(index, filename = `Photo ${index}.jpg`) {
  return {
    id: `image-${index}`,
    filename,
    mime: "image/jpeg",
    text: "",
    imageDataUrl: "data:image/jpeg;base64,abc",
  };
}

function pdf(id, filename, text) {
  return {
    id,
    filename,
    mime: "application/pdf",
    text,
  };
}

const isImageDocument = (document) => document.mime?.startsWith("image/") && Boolean(document.imageDataUrl);
const isVideoDocument = (document) => document.mime?.startsWith("video/");

run("146 attachments do not all go into chat first pass", () => {
  const documents = [
    pdf("carrier", "Carrier Estimate 21548.pdf", "Carrier estimate line items"),
    pdf("shop", "Shop Estimate SOR3.pdf", "Shop estimate supplement line items"),
    pdf("invoice", "Calibration Invoice.pdf", "Invoice for calibration"),
    ...Array.from({ length: 143 }, (_, index) => image(index + 1)),
  ];

  const decision = budgetChatAttachments({
    documents,
    userMessage: "Review this claim file.",
    isImageDocument,
    isVideoDocument,
  });

  assert.equal(decision.largeMultimodalRequest, true);
  assert.equal(decision.included.length < documents.length, true);
  assert.equal(decision.imageCount, 143);
  assert.equal(decision.includedImageCount <= 6, true);
  assert.equal(decision.omitted.length > 100, true);
});

run("primary carrier and shop estimate PDFs remain included", () => {
  const documents = [
    ...Array.from({ length: 40 }, (_, index) => image(index + 1)),
    pdf("carrier", "Carrier Estimate 21548.pdf", "Carrier estimate line items"),
    pdf("shop", "SOR3 Shop Supplement.pdf", "Shop supplement line items"),
  ];

  const decision = budgetChatAttachments({
    documents,
    userMessage: "What does this case show?",
    isImageDocument,
    isVideoDocument,
  });

  assert.equal(decision.included.some((document) => document.id === "carrier"), true);
  assert.equal(decision.included.some((document) => document.id === "shop"), true);
});

run("omitted images are named with reasons", () => {
  const decision = budgetChatAttachments({
    documents: Array.from({ length: 20 }, (_, index) => image(index + 1, `Photo ${index + 1}.jpg`)),
    userMessage: "Review the estimate file.",
    isImageDocument,
    isVideoDocument,
  });

  assert.equal(decision.omitted.length > 0, true);
  for (const omitted of decision.omitted) {
    assert.match(omitted.filename, /Photo \d+\.jpg/);
    assert.match(omitted.reason, /photo_omitted|image_cap/);
  }
});

run("explicit photo review raises but still caps representative images", () => {
  const decision = budgetChatAttachments({
    documents: Array.from({ length: 40 }, (_, index) => image(index + 1)),
    userMessage: "Please review the photos and visible damage.",
    isImageDocument,
    isVideoDocument,
  });

  assert.equal(decision.includedImageCount, 24);
  assert.equal(decision.omitted.length, 16);
});

run("large-case omission notice does not claim omitted photos were reviewed", () => {
  const decision = budgetChatAttachments({
    documents: Array.from({ length: 20 }, (_, index) => image(index + 1)),
    userMessage: "Review the estimates.",
    isImageDocument,
    isVideoDocument,
  });

  const notice = buildChatAttachmentOmissionNotice(decision.omitted);

  assert.match(notice, /not reviewed in this first-pass model request/i);
  assert.match(notice, /Do not claim these omitted photos were reviewed/i);
  assert.doesNotMatch(notice, /\b(?:I|we)\s+reviewed\b/i);
  assert.match(notice, /Photo \d+\.jpg/);
});
