/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { PDFDocument } = require("pdf-lib");

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
  extractCitationDensityRowAnchors,
} = require("../src/lib/reports/annotatedCitationDensityEstimate.ts");

async function main() {
  const pdfPathArg = process.argv[2];
  if (!pdfPathArg) {
    console.error('Usage: node scripts/debugCitationDensityPdfText.cjs ".local-fixtures/SOR-1 21975.pdf"');
    process.exitCode = 1;
    return;
  }

  const pdfPath = path.resolve(process.cwd(), pdfPathArg);
  const bytes = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(bytes);
  const pageCount = pdfDoc.getPageCount();
  const result = await extractCitationDensityRowAnchors(new Uint8Array(bytes), {
    sourceDocumentRole: "carrier",
    sourceDocumentId: path.basename(pdfPath),
    actualSourcePdfName: path.basename(pdfPath),
    actualSourcePdfPageCount: pageCount,
  });

  const payload = {
    filePath: pdfPath,
    byteLength: bytes.byteLength,
    pageCount,
    textExtractionMethod: result.textExtractionMethod,
    textExtractionError: result.textExtractionError,
    textExtractionWarnings: result.textExtractionWarnings,
    sourcePdfStage: result.sourcePdfStage,
    sourcePdfHash: result.sourcePdfHash,
    extractedTextPageCount: result.extractedTextPageCount,
    perPageTextLengths: result.perPageTextLengths,
    perPageTextItemCounts: result.perPageTextItemCounts,
    firstNonEmptyTextPage: result.firstNonEmptyTextPage,
    firstNonEmptyTextSample: result.firstNonEmptyTextSample,
    extractedAnchorCount: result.anchors.length,
    first20AnchorIds: result.anchors.slice(0, 20).map((anchor) => anchor.anchorId),
    first20ParsedVisualLines: result.visualLines.slice(0, 20).map((line) => ({
      pageNumber: line.pageNumber,
      text: line.text,
      x: round(line.x),
      y: round(line.y),
      width: round(line.width),
      height: round(line.height),
      textItemCount: line.words.length,
    })),
  };

  console.log(JSON.stringify(payload, null, 2));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
