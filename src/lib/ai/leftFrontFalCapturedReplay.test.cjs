/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict"); const fs = require("node:fs"); const Module = require("node:module"); const path = require("node:path"); const ts = require("typescript");
const cwd = process.cwd(), originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) { return request.startsWith("@/") ? originalResolve.call(this, path.join(cwd, "src", request.slice(2)), parent, isMain, options) : originalResolve.call(this, request, parent, isMain, options); };
const originalLoad = Module._load; Module._load = (request, parent, isMain) => request === "@fal-ai/client" ? { fal: {} } : originalLoad(request, parent, isMain);
require.extensions[".ts"] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, moduleResolution: ts.ModuleResolutionKind.NodeJs } }).outputText, filename);
const outputDir = path.join(cwd, ".tmp", "damage-regression");
if (!fs.existsSync(path.join(outputDir, "fal-live-raw-rle.json"))) {
  console.log("SKIP captured FAL replay (temporary full RLE capture has been cleaned up)");
  process.exit(0);
}
const raw = JSON.parse(fs.readFileSync(path.join(outputDir, "fal-live-raw-rle.json"), "utf8"));
const shape = JSON.parse(fs.readFileSync(path.join(outputDir, "fal-live-raw-shape.json"), "utf8"));
const fixtureDir = path.join(__dirname, "__tests__", "fixtures"), fixture = require(path.join(fixtureDir, "left-front-regression.json"));
const segmentation = require(path.join(__dirname, "damageSegmentation.ts")); const { maskQualification } = require(path.join(__dirname, "damagePhotoRegression.ts"));
const { normalizeDamageImage } = require(path.join(__dirname, "damageImageNormalization.ts")); const { renderDamageOverlay } = require(path.join(__dirname, "renderDamageOverlay.ts"));
(async () => {
  assert.equal(shape.expectedPixels, 3145728); assert.equal(raw.requestId, shape.requestId); assert.equal(raw.rle.length, shape.rleArrayLength);
  const decoded = raw.rle.map((rle, index) => segmentation.decodeCocoRle(rle, shape.width, shape.height, index));
  decoded.forEach((mask) => assert.equal(mask.pixels.length, 3145728));
  const sourceZoneIndices = shape.metadata.map((entry, index) => entry.index ?? index);
  const zones = shape.boxes.map((box, index) => ({ label: `captured mask ${index}`, description: "returned live FAL mask box", confidence: shape.scores[index], severity: "high", approximateLocation: "captured", evidenceLimits: "original localization boxes were not retained", boundingBox: segmentation.centerBoxToTopLeft(box) }));
  const validated = segmentation.validateMasks({ masks: decoded, zones, scores: shape.scores });
  const prohibited = { windshieldCabin: fixture.zones.prohibitedWindshieldCabin, centerHood: fixture.zones.prohibitedCenterHood, intactPassengerHeadlamp: fixture.zones.prohibitedIntactPassengerHeadlamp, doorsRoof: fixture.zones.prohibitedDoorsRoof };
  const acceptedMasks = validated.accepted.map((mask) => ({ zoneIndex: mask.zoneIndex, confidence: mask.confidence, severity: mask.severity, metrics: maskQualification(mask, fixture.zones.approvedPrimary, prohibited) }));
  const normalized = await normalizeDamageImage(fs.readFileSync(path.join(fixtureDir, fixture.sourceFilename)));
  const visual = await renderDamageOverlay({ imageSource: normalized.buffer, zones, masks: validated.accepted, disclaimer: `Captured live FAL regression ${shape.requestId}`, annotationStyle: "heatmap", showLegend: true });
  const artifactPath = path.join(outputDir, "left-front-live-fal-overlay.png"); fs.writeFileSync(artifactPath, visual);
  const record = { replayedAt: new Date().toISOString(), responseSource: "direct-live-fal-capture", requestId: shape.requestId, cached: shape.cached, model: shape.model, rleFormat: "array of row-major sparse (start,length) numeric strings", expectedPixels: shape.expectedPixels, decodedMasks: decoded.length, scores: shape.scores, boxes: shape.boxes, sourceZoneIndices, validationBasis: "returned mask boxes; original localization boxes were not retained by the failed capture run", acceptedMasks, rejectedMasks: validated.rejected, artifactPath };
  fs.writeFileSync(path.join(outputDir, "left-front-live-fal-result.json"), JSON.stringify(record, null, 2)); console.log(JSON.stringify(record, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
