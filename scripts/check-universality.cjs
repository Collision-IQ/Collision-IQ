/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

/**
 * Universality guard — Dispute Delta / report pipeline (directive 2026-07-29).
 *
 * Rule code must be RO/carrier/claim-agnostic. Adjudicated disputes live under
 * tests/fixtures/ as regression fixtures ONLY; a conditional in src/ keyed to an
 * RO number or carrier name is wrong by construction.
 *
 * This guard fails the build when a fixture token (RO number, fixture carrier,
 * fixture shop) appears in non-test source CODE. It deliberately ignores:
 *   - test files (*.test.*, __tests__/) — tests may reference fixtures freely;
 *   - comments — citing the RO that motivated a rule is provenance, not logic.
 *
 * ALLOWLIST semantics:
 *   - "vocabulary": carrier names used as recognition/extraction data (knowing
 *     what "USAA" looks like is data; branching on it would be a violation).
 *   - "grandfathered": known violations that predate the directive, kept
 *     visible as warnings until migrated. Do NOT add new entries of this kind
 *     without an owner sign-off note.
 *
 * Extend FIXTURE_TOKENS as fixtures are added (see runbook Section 3).
 */

const { readdirSync, statSync, readFileSync } = require("node:fs");
const { join, relative } = require("node:path");

// RO numbers use digit-boundary lookarounds (not \b) so camelCase identifiers
// like resolveRo21896CanonicalDeltaSet cannot smuggle a fixture RO past the guard.
const FIXTURE_TOKENS =
  /(?<!\d)(?:22140|22104|22108|22009|22006|21986|21896|21888|21638)(?!\d)|\b(?:USAA|Conestoga)\b/g;

const SRC_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE = /(?:\.test\.[a-z]+$|[\\/]__tests__[\\/])/;

// path (repo-relative, forward slashes) -> { kind, reason }
const ALLOWLIST = {
  "src/lib/ai/extractors/extractEstimateFacts.ts": {
    kind: "vocabulary",
    reason: "carrier recognition list — extraction data, not a carrier-keyed rule",
  },
  "src/app/api/analysis/route.ts": {
    kind: "vocabulary",
    reason: "carrier extraction regex — recognition data, not a carrier-keyed rule",
  },
  "src/lib/reports/canonicalDelta.ts": {
    kind: "vocabulary",
    reason: '"e.g. USAA" example text inside a validation error message',
  },
};

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SRC_EXTENSIONS.test(entry)) out.push(full);
  }
  return out;
}

/** Strip block and line comments so provenance citations never trip the guard.
 *  Preserves line count so reported line numbers stay accurate. Protocol "//"
 *  (https://) is not treated as a comment start. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/gm, (m, pre) => pre + " ".repeat(m.length - pre.length));
}

const violations = [];
const warnings = [];

for (const file of walk(join(process.cwd(), "src"))) {
  const rel = relative(process.cwd(), file).replace(/\\/g, "/");
  if (TEST_FILE.test(rel)) continue;
  const allow = ALLOWLIST[rel];
  const code = stripComments(readFileSync(file, "utf8"));
  const hits = [];
  for (const [lineNo, line] of code.split("\n").entries()) {
    const found = line.match(FIXTURE_TOKENS);
    if (found) hits.push({ line: lineNo + 1, tokens: [...new Set(found)] });
  }
  if (!hits.length) continue;
  if (allow) {
    if (allow.kind === "grandfathered") warnings.push({ rel, hits, allow });
    continue; // vocabulary entries are silently allowed
  }
  violations.push({ rel, hits });
}

for (const w of warnings) {
  console.warn(`universality WARN (grandfathered): ${w.rel} — ${w.allow.reason}`);
  for (const h of w.hits) console.warn(`    :${h.line}  ${h.tokens.join(", ")}`);
}

if (violations.length) {
  console.error("\nuniversality FAIL — fixture tokens in non-test rule code:");
  for (const v of violations) {
    console.error(`  ${v.rel}`);
    for (const h of v.hits) console.error(`    :${h.line}  ${h.tokens.join(", ")}`);
  }
  console.error(
    "\nFixture references belong under tests/ (or an ALLOWLIST vocabulary entry" +
      " if this is recognition data). A conditional keyed to an RO/carrier is" +
      " wrong by construction — make the rule generic and add a fixture instead."
  );
  process.exit(1);
}

console.log(
  `universality OK — ${warnings.length} grandfathered warning(s), 0 violations`
);
