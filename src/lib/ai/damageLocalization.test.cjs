/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict"); const fs = require("node:fs"); const Module = require("node:module"); const path = require("node:path"); const ts = require("typescript");
const cwd = process.cwd(), originalResolve = Module._resolveFilename; let falCalls = 0;
Module._resolveFilename = function (request, parent, isMain, options) { return request.startsWith("@/") ? originalResolve.call(this, path.join(cwd, "src", request.slice(2)), parent, isMain, options) : originalResolve.call(this, request, parent, isMain, options); };
const originalLoad = Module._load; Module._load = (request, parent, isMain) => request === "@fal-ai/client" ? { fal: { subscribe: async () => { falCalls++; throw new Error("unexpected FAL call"); } } } : originalLoad(request, parent, isMain);
require.extensions[".ts"] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, moduleResolution: ts.ModuleResolutionKind.NodeJs } }).outputText, filename);
const localization = require(path.join(__dirname, "damageLocalization.ts")); const segmentation = require(path.join(__dirname, "damageSegmentation.ts"));
const { maskQualification, centroidAdjacentToBoxes } = require(path.join(__dirname, "damagePhotoRegression.ts")); const { normalizeDamageImage } = require(path.join(__dirname, "damageImageNormalization.ts"));
const { createCanvas, loadImage } = require("@napi-rs/canvas"); const fixtureDir = path.join(__dirname, "__tests__", "fixtures");
const fixture = require(path.join(fixtureDir, "left-front-regression.json")), captured = require(path.join(fixtureDir, "left-front-fal-request.json"));
function maskForBox(box, width = 256, height = 192) { const pixels = new Uint8Array(width * height); for (let y = Math.floor(box.yMin * height); y < Math.ceil(box.yMax * height); y++) for (let x = Math.floor(box.xMin * width); x < Math.ceil(box.xMax * width); x++) pixels[y * width + x] = 1; return { width, height, pixels }; }
(async () => {
  const regions = fixture.localizationRegions;
  assert.equal(localization.preflightRegions(regions).rejected.length, 0);
  const requests = regions.map((region, index) => localization.buildFalRegionRequest("data:image/png;base64,omitted", 2048, 1536, region, index));
  requests.forEach((request, index) => {
    assert.ok(request.prompt.trim()); assert.notEqual(request.prompt.toLowerCase(), "wheel");
    assert.deepEqual(request.box_prompts[0], captured.requests[index].box); assert.deepEqual(request.point_prompts, captured.requests[index].points);
    assert.equal(request.box_prompts[0].object_id, index); assert.ok(request.point_prompts.some((point) => point.label === 1)); assert.ok(request.point_prompts.some((point) => point.label === 0));
  });
  assert.equal(new Set(requests.map((request) => request.prompt)).size, regions.length, "one component-specific request per region");
  for (const region of regions) {
    const metrics = maskQualification(maskForBox(region.box), fixture.zones.approvedPrimary, { doorsRoof: fixture.zones.prohibitedDoorsRoof });
    assert.ok(metrics.approvedOverlap > 0, `${region.id} overlaps approved damage`); assert.ok(centroidAdjacentToBoxes(metrics.centroid, fixture.zones.approvedPrimary));
    assert.equal(metrics.prohibitedOverlap.doorsRoof, 0);
  }
  assert.throws(() => localization.buildFalRegionRequest("x", 100, 100, { ...regions[0], segmentationPrompt: "wheel" }, 0), /localization-preflight-failed/);
  assert.throws(() => localization.buildFalRegionRequest("x", 100, 100, { ...regions[0], positivePoints: [] }, 0), /missing-positive-point/);
  // BMW wheel regression: whole-object and ground prompts are rejected, and
  // oversized boxes (which admit whole components and pavement) hard-fail.
  for (const badPrompt of ["rear wheel", "the tire", "gravel", "pavement", "rim"]) {
    assert.ok(
      localization.validateVisibleDamageRegion({ ...regions[0], segmentationPrompt: badPrompt }).includes("forbidden-default-or-generic-prompt"),
      `prompt "${badPrompt}" must be rejected`
    );
  }
  assert.ok(
    localization.validateVisibleDamageRegion({ ...regions[0], box: { xMin: .1, yMin: .2, xMax: .8, yMax: .5 } }).includes("box-too-large"),
    "boxes wider than 0.45 are rejected"
  );
  assert.equal(
    localization.validateVisibleDamageRegion({ ...regions[0], segmentationPrompt: "scuffed quarter panel above wheel arch" }).length,
    0,
    "surface-damage prompts naming a panel near the wheel stay valid"
  );
  const invalidZone = { id: "invalid", label: "damage", partName: "damage", description: "visible", visibleEvidence: "visible", damageType: "broken", confidence: .9, severity: "high", approximateLocation: "", evidenceLimits: "", boundingBox: { x: .1, y: .1, width: .2, height: .2 }, positivePoints: [], segmentationPrompt: "" };
  const blocked = await segmentation.segmentVisibleDamage({ imageDataUrl: "not-sent", sourceHash: "test", width: 100, height: 100, zones: [invalidZone], bypassCache: true });
  assert.equal(falCalls, 0, "FAL is not called after failed preflight"); assert.match(blocked.rejected[0].reason, /localization-preflight-failed/);
  const transform = localization.expandedCropTransform({ x: .2, y: .3, width: .2, height: .2 }); assert.deepEqual(transform.cropToSource({ x: .5, y: .5 }), { x: .30000000000000004, y: .4 });

  const normalized = await normalizeDamageImage(fs.readFileSync(path.join(fixtureDir, fixture.sourceFilename))); const image = await loadImage(normalized.buffer); const canvas = createCanvas(image.width, image.height); const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0); ctx.lineWidth = 6; ctx.font = "22px sans-serif";
  regions.forEach((region, index) => { const colors = ["#22c55e", "#f97316", "#ef4444"], color = colors[index % colors.length]; ctx.strokeStyle = color; ctx.strokeRect(region.box.xMin * image.width, region.box.yMin * image.height, (region.box.xMax - region.box.xMin) * image.width, (region.box.yMax - region.box.yMin) * image.height); ctx.fillStyle = color; ctx.fillText(`${region.id} ${(region.confidence * 100).toFixed(0)}% ${region.damageType}`, region.box.xMin * image.width, region.box.yMin * image.height - 10); for (const point of region.positivePoints) { ctx.beginPath(); ctx.arc(point.x * image.width, point.y * image.height, 12, 0, Math.PI * 2); ctx.fill(); } ctx.fillStyle = "#2563eb"; for (const point of region.negativePoints) { ctx.beginPath(); ctx.moveTo(point.x * image.width - 10, point.y * image.height - 10); ctx.lineTo(point.x * image.width + 10, point.y * image.height + 10); ctx.moveTo(point.x * image.width + 10, point.y * image.height - 10); ctx.lineTo(point.x * image.width - 10, point.y * image.height + 10); ctx.strokeStyle = "#2563eb"; ctx.stroke(); } });
  const outputDir = path.join(cwd, ".tmp", "damage-regression"); fs.mkdirSync(outputDir, { recursive: true }); const artifact = path.join(outputDir, "left-front-localization-preflight.png"); fs.writeFileSync(artifact, await canvas.encode("png"));
  const shape = { endpoint: captured.endpoint, sourceImageSha256: normalized.sourceHash, naturalWidth: image.width, naturalHeight: image.height, promptOmitted: false, pointPromptCount: requests.reduce((sum, request) => sum + request.point_prompts.length, 0), requests: regions.map((region, index) => ({ regionId: region.id, componentName: region.componentName, confidence: region.confidence, damageType: region.damageType, visibleEvidence: region.visibleEvidence, coordinateTransform: "normalized source coordinates multiplied by natural dimensions; minima floor, maxima ceil", ...requests[index], image_url: "[normalized source data URL omitted]" })) };
  fs.writeFileSync(path.join(outputDir, "fal-live-request-shape.json"), JSON.stringify(shape, null, 2)); console.log(`PASS damage localization preflight\n${artifact}`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
