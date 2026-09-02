/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

/**
 * pdf-lib must be imported from exactly one specifier.
 *
 * pdf-lib publishes two builds (package `main` -> cjs/index.js, package
 * `module` -> es/index.js). A bundler resolves the bare "pdf-lib" specifier to
 * the ESM copy, while any deep path such as "pdf-lib/cjs/core" always loads the
 * CJS copy. Importing from both puts TWO independent copies of every pdf-lib
 * class in one bundle.
 *
 * That breaks pdf-lib silently rather than loudly. PDFContext.obj() dispatches
 * on `instanceof PDFObject`, which is false across module instances, so a
 * PDFHexString built by one copy is serialized by the other as a plain object:
 * `<< /value /FEFF... >>` in place of a string. Acrobat rejects the resulting
 * file with "Expected a string object." — and nothing catches it under Node,
 * where both specifiers resolve to the same build.
 *
 * The rule is therefore mechanical: no deep pdf-lib import paths in src/.
 */

const { readdirSync, statSync, readFileSync } = require("node:fs");
const { join, relative } = require("node:path");

const DEEP_IMPORT = /["']pdf-lib\/[^"']+["']/g;
const SRC_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SRC_EXTENSIONS.test(entry)) out.push(full);
  }
  return out;
}

/** Strip comments so prose CITING the bad path is provenance, not a
 *  violation. Line count is preserved so reported lines stay accurate. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/gm, (m, pre) => pre + " ".repeat(m.length - pre.length));
}

const violations = [];
for (const file of walk(join(process.cwd(), "src"))) {
  const source = stripComments(readFileSync(file, "utf8"));
  for (const [lineNo, line] of source.split("\n").entries()) {
    for (const match of line.match(DEEP_IMPORT) ?? []) {
      violations.push(`${relative(process.cwd(), file).replace(/\\/g, "/")}:${lineNo + 1}  ${match}`);
    }
  }
}

if (violations.length > 0) {
  console.error(
    `pdf-lib deep imports found (${violations.length}). Import everything from "pdf-lib":\n  ` +
      violations.join("\n  ")
  );
  process.exit(1);
}
console.log("pdf-lib imports OK — single specifier across src");
