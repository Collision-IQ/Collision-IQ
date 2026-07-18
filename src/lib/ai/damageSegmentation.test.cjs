/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");
const cwd = process.cwd();
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith("@/")) return originalResolve.call(this, path.join(cwd, "src", request.slice(2)), parent, isMain, options);
  return originalResolve.call(this, request, parent, isMain, options);
};
const originalLoad = Module._load;
Module._load = (request, parent, isMain) => request === "@fal-ai/client" ? { fal: {} } : originalLoad(request, parent, isMain);
require.extensions[".ts"] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
}).outputText, filename);
const lib = require(path.join(__dirname, "damageSegmentation.ts"));

function encodeCompressedCounts(counts) {
  let output = "";
  counts.forEach((count, index) => {
    let value = index > 2 ? count - counts[index - 2] : count;
    let more = true;
    while (more) {
      let chunk = value & 0x1f;
      value >>= 5;
      more = (chunk & 0x10) ? value !== -1 : value !== 0;
      if (more) chunk |= 0x20;
      output += String.fromCharCode(chunk + 48);
    }
  });
  return output;
}
function expectCode(fn, code) { assert.throws(fn, (error) => error && error.code === code); }

function zone(box, severity = "high") { return { label: "damage", description: "visible", confidence: "high", severity, approximateLocation: "", evidenceLimits: "", boundingBox: box }; }

assert.deepEqual(lib.validateNormalizedBox({ x: .1, y: .2, width: .3, height: .4 }), { x: .1, y: .2, width: .3, height: .4 });
assert.equal(lib.validateNormalizedBox({ x: .9, y: .2, width: .2, height: .4 }), null);
const converted = lib.centerBoxToTopLeft([.5, .5, .4, .2]);
assert.ok(Math.abs(converted.x - .3) < 1e-9 && Math.abs(converted.y - .4) < 1e-9 && Math.abs(converted.width - .4) < 1e-9 && Math.abs(converted.height - .2) < 1e-9);
assert.deepEqual(lib.objectFitContainRect(200, 200, 400, 200), { scale: .5, width: 200, height: 100, offsetX: 0, offsetY: 50 });

assert.deepEqual(lib.normalizeRleStrings("abc"), ["abc"]);
assert.deepEqual(lib.normalizeRleStrings(["a", "b"]), ["a", "b"]);
expectCode(() => lib.normalizeRleStrings(["a", ""]), "unsupported-rle-format");
const aligned = lib.normalizeFalRlePayload({ rle: ["a", "b"], scores: [.9, .7], boxes: [[.2, .2, .1, .1], [.8, .8, .1, .1]], metadata: [{ score: .1 }, { score: .2 }] });
assert.deepEqual(aligned.scores, [.9, .7]); assert.deepEqual(aligned.boxes[1], [.8, .8, .1, .1]);
const reordered = lib.normalizeFalRlePayload({ rle: ["a", "b"], metadata: [{ index: 3, score: .9 }, { index: 1, score: .8 }] });
assert.deepEqual(reordered.zoneIndices, [3, 1]); assert.deepEqual(reordered.scores, [.9, .8]);

// Official m > 2 delta restoration: the third count is absolute; the fourth is delta-coded.
assert.deepEqual(lib.decodeCompressedCocoCounts(encodeCompressedCounts([2, 1, 3, 2]), 8), [2, 1, 3, 2]);
// Negative signed delta and multi-character continuation both round-trip.
assert.deepEqual(lib.decodeCompressedCocoCounts(encodeCompressedCounts([2, 3, 4, 1]), 10), [2, 3, 4, 1]);
assert.deepEqual(lib.decodeCompressedCocoCounts(encodeCompressedCounts([40, 1, 1]), 42), [40, 1, 1]);
assert.deepEqual(lib.decodeCompressedCocoCounts(encodeCompressedCounts([2048 * 1536]), 2048 * 1536), [3145728]);
expectCode(() => lib.decodeCompressedCocoCounts(encodeCompressedCounts([5]), 4), "rle-overflow");
expectCode(() => lib.decodeCompressedCocoCounts(encodeCompressedCounts([3]), 4), "rle-underflow");
expectCode(() => lib.decodeCompressedCocoCounts("@", 4), "rle-negative-count");
expectCode(() => lib.decodeCompressedCocoCounts("P", 4), "rle-unterminated");
expectCode(() => lib.decodeCompressedCocoCounts("p", 4), "rle-invalid-character");

const decoded = lib.decodeCocoRle("2 2", 2, 2);
assert.deepEqual([...decoded.pixels], [0, 1, 0, 1]);
// COCO sequential runs are columns: foreground sequential indexes 1,2 become (x=0,y=1),(x=1,y=0).
assert.deepEqual([...lib.decodeCocoRle("1 2 1", 2, 2).pixels], [0, 1, 1, 0]);
expectCode(() => lib.decodeCocoRle("5", 2, 2), "rle-overflow");
expectCode(() => lib.decodeCocoRle("3", 2, 2), "rle-underflow");
const sparse = lib.decodeFalSparseRle("1 2 5 1 8 2 11 1", 4, 3);
assert.deepEqual([...sparse.pixels], [0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1], "FAL sparse spans expand row-major");
expectCode(() => lib.decodeFalSparseRle("1 3 3 1 8 1 10 1", 4, 3), "rle-overlapping-span");
expectCode(() => lib.decodeFalSparseRle("1 2 5 1 8 2 12 1", 4, 3), "rle-overflow");

const capturedPath = path.join(process.cwd(), ".tmp", "damage-regression", "fal-live-raw-rle.json");
if (fs.existsSync(capturedPath)) {
  const captured = JSON.parse(fs.readFileSync(capturedPath, "utf8"));
  // The capture is a machine-local artifact from the last live FAL run; its
  // region count varies by run, so validate decodability, not a fixed count.
  assert.ok(captured.rle.length >= 1, "captured RLE payload is non-empty");
  captured.rle.forEach((rle, index) => {
    const mask = lib.decodeCocoRle(rle, 2048, 1536, index);
    assert.equal(mask.pixels.length, 3145728);
    assert.ok(mask.pixels.some(Boolean), `captured mask ${index} has foreground pixels`);
  });
}
const makeMask = (indices) => { const pixels = new Uint8Array(100); indices.forEach((i) => pixels[i] = 1); return { width: 10, height: 10, pixels }; };
const inside = makeMask([22, 23, 32, 33]);
let result = lib.validateMasks({ masks: [inside], zones: [zone({ x: .2, y: .2, width: .2, height: .2 })], scores: [.9] });
assert.equal(result.accepted.length, 1);
result = lib.validateMasks({ masks: [makeMask([22])], zones: [zone({ x: .2, y: .2, width: .2, height: .2 })], scores: [.4] });
assert.equal(result.rejected[0].reason, "confidence-below-threshold");
result = lib.validateMasks({ masks: [makeMask([0, 1, 2])], zones: [zone({ x: .7, y: .7, width: .2, height: .2 })], scores: [.9] });
assert.equal(result.rejected[0].reason, "empty-mask");
const duplicate = makeMask([22, 23, 32, 33]);
result = lib.validateMasks({ masks: [inside, duplicate], zones: [zone({ x: .2, y: .2, width: .2, height: .2 }), zone({ x: .2, y: .2, width: .2, height: .2 }, "low")], scores: [.9, .9] });
assert.equal(result.accepted.length, 1);
assert.equal(result.rejected[0].reason, "duplicate-mask");

// BMW wheel regression: SAM latching onto a component that bleeds well past
// the tight damage box (wheel/tire under a scuff-sized box). The mask keeps
// enough box intersection to pass the 0.6 rule but exceeds the region-scale
// cap (1.4 × box area) and is rejected.
{
  const componentBleed = makeMask([22, 23, 32, 33, 24, 34]); // 4 in-box + 2 bleeding right
  const tightBox = zone({ x: .2, y: .2, width: .2, height: .2 }); // 4% area; cap = 5.6%
  const bleed = lib.validateMasks({ masks: [componentBleed], zones: [tightBox], scores: [.95] });
  assert.equal(bleed.accepted.length, 0);
  assert.equal(bleed.rejected[0].reason, "mask-exceeds-region-scale");
}

// A mask only half-inside its prompt box no longer passes (threshold 0.6):
{
  const straddling = makeMask([22, 23, 26, 27]); // 2 inside the box, 2 far right
  const box = zone({ x: .2, y: .2, width: .2, height: .2 });
  const straddleResult = lib.validateMasks({ masks: [straddling], zones: [box], scores: [.9] });
  assert.equal(straddleResult.accepted.length, 0);
  assert.equal(straddleResult.rejected[0].reason, "insufficient-prompt-intersection");
}
console.log("PASS damage segmentation contracts");
