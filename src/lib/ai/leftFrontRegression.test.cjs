/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, moduleResolution: ts.ModuleResolutionKind.NodeJs }
}).outputText, filename);

const fixtureDir = path.join(__dirname, "__tests__", "fixtures");
const fixture = require(path.join(fixtureDir, "left-front-regression.json"));
const photoPath = path.join(fixtureDir, fixture.sourceFilename);
const segmentation = require(path.join(__dirname, "damageSegmentation.ts"));
const qualification = require(path.join(__dirname, "damagePhotoRegression.ts"));
const { normalizeDamageImage } = require(path.join(__dirname, "damageImageNormalization.ts"));
const { renderDamageOverlay } = require(path.join(__dirname, "renderDamageOverlay.ts"));
const { createCanvas, loadImage } = require("@napi-rs/canvas");

function maskFromRectangles(width, height, rectangles) {
  const pixels = new Uint8Array(width * height);
  for (const r of rectangles) for (let y = Math.floor(r.y * height); y < Math.ceil((r.y + r.height) * height); y++)
    for (let x = Math.floor(r.x * width); x < Math.ceil((r.x + r.width) * width); x++) if (x >= 0 && y >= 0 && x < width && y < height) pixels[y * width + x] = 1;
  return { width, height, pixels };
}
function encodeUncompressedCoco(mask) {
  const counts = []; let current = 0, run = 0;
  for (let x = 0; x < mask.width; x++) for (let y = 0; y < mask.height; y++) {
    const value = mask.pixels[y * mask.width + x];
    if (value === current) run++; else { counts.push(run); run = 1; current = value; }
  }
  counts.push(run); return counts.join(" ");
}

(async () => {
  const source = fs.readFileSync(photoPath);
  assert.equal(crypto.createHash("sha256").update(source).digest("hex"), fixture.sourceSha256);
  const normalized = await normalizeDamageImage(source);
  assert.equal(normalized.sourceHash, fixture.normalizedSha256);
  assert.equal(normalized.naturalWidth, fixture.naturalWidth); assert.equal(normalized.naturalHeight, fixture.naturalHeight);

  const representative = maskFromRectangles(128, 96, fixture.representativeFalResponse.maskRectangles);
  const decoded = segmentation.decodeCocoRle(encodeUncompressedCoco(representative), 128, 96);
  assert.deepEqual(decoded.pixels, representative.pixels, "representative FAL RLE round trips");
  const converted = segmentation.centerBoxToTopLeft(fixture.representativeFalResponse.boxCxCyWh);
  assert.ok(converted && Math.abs(converted.x - .10) < 1e-9 && Math.abs(converted.y - .395) < 1e-9);

  const zone = { label: "vehicle-left front visible damage", description: "missing/displaced headlamp, bumper and grille", confidence: .93, severity: "high", approximateLocation: "viewer left", evidenceLimits: "visible exterior only", boundingBox: { x: .10, y: .38, width: .40, height: .37 } };
  const duplicate = { ...decoded, pixels: decoded.pixels.slice() };
  const outside = maskFromRectangles(128, 96, [{ x: .42, y: .20, width: .20, height: .15 }]);
  const validated = segmentation.validateMasks({ masks: [decoded, duplicate, outside], zones: [zone, zone, zone], scores: [.93, .91, .90] });
  assert.equal(validated.accepted.length, 1, "one primary mask survives");
  assert.ok(validated.rejected.some((r) => r.reason === "duplicate-mask"));
  assert.ok(validated.rejected.some((r) => r.reason === "empty-mask" || r.reason === "insufficient-prompt-intersection"));

  const prohibited = {
    windshieldCabin: fixture.zones.prohibitedWindshieldCabin,
    centerHood: fixture.zones.prohibitedCenterHood,
    intactPassengerHeadlamp: fixture.zones.prohibitedIntactPassengerHeadlamp,
    doorsRoof: fixture.zones.prohibitedDoorsRoof,
  };
  const metrics = qualification.maskQualification(validated.accepted[0], fixture.zones.approvedPrimary, prohibited);
  const t = fixture.thresholds;
  assert.ok(metrics.approvedOverlap >= t.minimumPrimaryApprovedOverlap);
  assert.ok(metrics.prohibitedOverlap.windshieldCabin <= t.maximumWindshieldCabinOverlap);
  assert.ok(metrics.prohibitedOverlap.centerHood <= t.maximumCenterHoodOverlap);
  assert.ok(metrics.prohibitedOverlap.intactPassengerHeadlamp <= t.maximumIntactPassengerHeadlampOverlap);
  assert.ok(metrics.prohibitedOverlap.doorsRoof <= t.maximumDoorsRoofOverlap);
  assert.ok(metrics.imageCoverage <= t.maximumImageCoverage);
  assert.ok(qualification.centroidAdjacentToBoxes(metrics.centroid, fixture.zones.approvedPrimary));

  const fullMask = maskFromRectangles(normalized.naturalWidth, normalized.naturalHeight, fixture.representativeFalResponse.maskRectangles);
  const rendered = await renderDamageOverlay({ imageSource: normalized.buffer, zones: [zone], masks: [{ ...fullMask, zoneIndex: 0, severity: "high", confidence: .93, box: zone.boundingBox }], disclaimer: "Regression qualification artifact", annotationStyle: "heatmap", showLegend: false });
  const renderedImage = await loadImage(rendered); const canvas = createCanvas(renderedImage.width, renderedImage.height); const ctx = canvas.getContext("2d"); ctx.drawImage(renderedImage, 0, 0);
  const outlines = [[fixture.zones.approvedPrimary, "#22c55e"], [fixture.zones.prohibitedWindshieldCabin, "#3b82f6"], [fixture.zones.prohibitedCenterHood, "#a855f7"], [fixture.zones.prohibitedIntactPassengerHeadlamp, "#06b6d4"], [fixture.zones.prohibitedDoorsRoof, "#f59e0b"]];
  ctx.lineWidth = 5; for (const [boxes, color] of outlines) { ctx.strokeStyle = color; for (const b of boxes) ctx.strokeRect(b.x * normalized.naturalWidth, b.y * normalized.naturalHeight, b.width * normalized.naturalWidth, b.height * normalized.naturalHeight); }
  ctx.fillStyle = "rgba(0,0,0,.78)"; ctx.fillRect(12, 12, 850, 150); ctx.fillStyle = "white"; ctx.font = "24px sans-serif";
  ctx.fillText(`confidence 0.93 | approved ${(metrics.approvedOverlap * 100).toFixed(1)}% | coverage ${(metrics.imageCoverage * 100).toFixed(1)}%`, 28, 52);
  ctx.fillText(`prohibited W/C ${(metrics.prohibitedOverlap.windshieldCabin * 100).toFixed(1)}% | hood ${(metrics.prohibitedOverlap.centerHood * 100).toFixed(1)}% | headlamp ${(metrics.prohibitedOverlap.intactPassengerHeadlamp * 100).toFixed(1)}% | doors/roof ${(metrics.prohibitedOverlap.doorsRoof * 100).toFixed(1)}%`, 28, 88);
  ctx.fillText(`rejected: ${validated.rejected.map((r) => r.reason).join(", ")}`, 28, 124);
  const outputDir = path.join(cwd, ".tmp", "damage-regression"); fs.mkdirSync(outputDir, { recursive: true });
  const artifactPath = path.join(outputDir, "left-front-deterministic-qualification.png"); fs.writeFileSync(artifactPath, await canvas.encode("png"));
  fs.writeFileSync(path.join(outputDir, "left-front-deterministic-metrics.json"), JSON.stringify({ sourceHash: normalized.sourceHash, dimensions: [normalized.naturalWidth, normalized.naturalHeight], confidence: .93, metrics, accepted: validated.accepted.length, rejected: validated.rejected }, null, 2));
  console.log(JSON.stringify({ pass: true, artifactPath, metrics, rejected: validated.rejected }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
