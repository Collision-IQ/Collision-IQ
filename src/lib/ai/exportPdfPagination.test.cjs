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

const { __testables } = require("./builders/exportPdf.ts");

function run(name, test) {
  try {
    test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function makeFakeDoc() {
  return {
    calls: [],
    internal: {
      pageSize: {
        getWidth: () => 216,
        getHeight: () => 279,
      },
    },
    currentPage: 1,
    setFont(font, style) {
      this.calls.push(["setFont", font, style]);
    },
    setFontSize(size) {
      this.calls.push(["setFontSize", size]);
    },
    setTextColor(r, g, b) {
      this.calls.push(["setTextColor", r, g, b]);
    },
    setLineHeightFactor(value) {
      this.calls.push(["setLineHeightFactor", value]);
    },
    addPage() {
      this.currentPage += 1;
      this.calls.push(["addPage"]);
    },
    getCurrentPageInfo() {
      return { pageNumber: this.currentPage };
    },
    setDrawColor() {},
    setLineWidth() {},
    rect() {},
    splitTextToSize(value, width) {
      const maxChars = Math.max(1, Math.floor(width / 2.6));
      const text = `${value}`;
      const lines = [];
      for (let index = 0; index < text.length; index += maxChars) {
        lines.push(text.slice(index, index + maxChars));
      }
      return lines.length > 0 ? lines : [""];
    },
  };
}

run("page state reset reapplies baseline typography after a page add", () => {
  const doc = makeFakeDoc();
  const layout = __testables.createPdfPageLayout(doc);
  const state = { y: layout.topMargin + 40, lastPageNumber: 1 };

  __testables.addPdfPage(doc, state, layout, { force: true });

  assert.equal(state.y, layout.topMargin);
  assert.equal(doc.currentPage, 2);
  assert.equal(
    doc.calls.some((entry) => entry[0] === "setFont" && entry[1] === "Helvetica" && entry[2] === "Normal"),
    true
  );
  assert.equal(
    doc.calls.some((entry) => entry[0] === "setFontSize" && entry[1] === 10),
    true
  );
  assert.equal(
    doc.calls.some((entry) => entry[0] === "setLineHeightFactor" && entry[1] === 1.15),
    true
  );
});

run("duplicate page-add guard avoids accidental empty intermediate pages", () => {
  const doc = makeFakeDoc();
  const layout = __testables.createPdfPageLayout(doc);
  const state = { y: layout.topMargin, lastPageNumber: 1 };

  const added = __testables.addPdfPage(doc, state, layout);

  assert.equal(added, false);
  assert.equal(doc.currentPage, 1);
});

run("section keep-together estimate includes heading and first content block", () => {
  const doc = makeFakeDoc();
  const height = __testables.estimateSectionKeepTogetherHeight(doc, 120, {
    title: "Top Dispute Drivers",
    bullets: ["A short first bullet that should stay with the heading."],
  });

  assert.equal(height > 9, true);
});

run("full section estimate grows with long comparison content for pagination checks", () => {
  const doc = makeFakeDoc();
  const height = __testables.estimateSectionHeight(doc, 120, {
    title: "Structured Estimate Comparison",
    comparisonRows: [
      {
        label: "Paint",
        leftLabel: "Shop",
        leftValue: "Long left value ".repeat(10),
        rightLabel: "Carrier",
        rightValue: "Long right value ".repeat(10),
        delta: "Long delta ".repeat(6),
        note: "Long note ".repeat(8),
      },
    ],
  });

  assert.equal(height > 20, true);
});
