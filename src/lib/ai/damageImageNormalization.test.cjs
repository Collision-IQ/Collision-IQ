/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs"); const path = require("node:path"); const ts = require("typescript");
require.extensions[".ts"] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const sharp = require("sharp");
const { normalizeDamageImage } = require(path.join(__dirname, "damageImageNormalization.ts"));
(async () => {
  const portrait = await sharp({ create: { width: 2, height: 3, channels: 3, background: "red" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const before = Buffer.from(portrait);
  const normalized = await normalizeDamageImage(portrait);
  assert.equal(normalized.naturalWidth, 3); assert.equal(normalized.naturalHeight, 2);
  assert.equal(normalized.originalOrientation, 6); assert.equal(normalized.normalizedOrientation, 1);
  assert.ok(portrait.equals(before), "source bytes remain unchanged");
  assert.equal(normalized.sourceHash.length, 64);
  console.log("PASS damage image normalization");
})().catch((error) => { console.error(error); process.exitCode = 1; });
