/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs"); const Module = require("node:module"); const path = require("node:path"); const ts = require("typescript");
if (process.env.RUN_FAL_DAMAGE_REGRESSION !== "true" || !process.env.FAL_KEY) {
  console.log("SKIP live FAL damage regression (set RUN_FAL_DAMAGE_REGRESSION=true and FAL_KEY)");
  process.exit(0);
}
const cwd = process.cwd(), originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) { return request.startsWith("@/") ? originalResolve.call(this, path.join(cwd, "src", request.slice(2)), parent, isMain, options) : originalResolve.call(this, request, parent, isMain, options); };
require.extensions[".ts"] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, moduleResolution: ts.ModuleResolutionKind.NodeJs } }).outputText, filename);
const dir = path.join(__dirname, "__tests__", "fixtures"), fixture = require(path.join(dir, "left-front-regression.json"));
const { normalizeDamageImage } = require(path.join(__dirname, "damageImageNormalization.ts"));
const { analyzeDamagePhoto } = require(path.join(__dirname, "visionDamageAnnotation.ts"));
const { segmentVisibleDamage, DAMAGE_SEGMENTATION_MODEL, MASK_VALIDATION_VERSION } = require(path.join(__dirname, "damageSegmentation.ts"));
const { maskQualification } = require(path.join(__dirname, "damagePhotoRegression.ts"));
const { renderDamageOverlay } = require(path.join(__dirname, "renderDamageOverlay.ts"));
(async () => {
  const normalized = await normalizeDamageImage(fs.readFileSync(path.join(dir, fixture.sourceFilename)));
  const analysis = await analyzeDamagePhoto({ imageUrls: [normalized.dataUrl], annotationStyle: "heatmap", userPrompt: "Identify only directly visible exterior collision damage. Keep the intact passenger-side headlamp, windshield, cabin, center hood, doors, and roof unmarked." });
  const outputDir = path.join(cwd, ".tmp", "damage-regression"); fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "left-front-live-localization.json"), JSON.stringify({ summary: analysis.summary, zones: analysis.zones, notEstablished: analysis.notEstablished }, null, 2));
  const requestPreflights = [];
  const segmented = await segmentVisibleDamage({
    imageDataUrl: normalized.dataUrl, sourceHash: normalized.sourceHash, width: normalized.naturalWidth, height: normalized.naturalHeight,
    zones: analysis.zones, cacheNamespace: `left-front-${Date.now()}`, bypassCache: true,
    onRequestPreflight: (entry) => {
      requestPreflights.push({ ...entry, request: { ...entry.request, image_url: "[normalized source data URL omitted]" } });
      fs.writeFileSync(path.join(outputDir, "fal-live-request-shape.json"), JSON.stringify({ endpoint: DAMAGE_SEGMENTATION_MODEL, sourceImageSha256: normalized.sourceHash, naturalWidth: normalized.naturalWidth, naturalHeight: normalized.naturalHeight, promptOmitted: false, requests: requestPreflights }, null, 2));
    },
    onRawResponse: (shape, rleStrings) => {
      fs.writeFileSync(path.join(outputDir, "fal-live-raw-shape.json"), JSON.stringify(shape, null, 2));
      fs.writeFileSync(path.join(outputDir, "fal-live-raw-rle.json"), JSON.stringify({ requestId: shape.requestId, rle: rleStrings }, null, 2));
    },
  });
  const prohibited = { windshieldCabin: fixture.zones.prohibitedWindshieldCabin, centerHood: fixture.zones.prohibitedCenterHood, intactPassengerHeadlamp: fixture.zones.prohibitedIntactPassengerHeadlamp, doorsRoof: fixture.zones.prohibitedDoorsRoof };
  const masks = segmented.masks.map((mask) => ({ confidence: mask.confidence, zoneIndex: mask.zoneIndex, metrics: maskQualification(mask, fixture.zones.approvedPrimary, prohibited) }));
  const record = { generatedAt: new Date().toISOString(), sourceHash: normalized.sourceHash, naturalWidth: normalized.naturalWidth, naturalHeight: normalized.naturalHeight, falEndpoint: DAMAGE_SEGMENTATION_MODEL, requestId: segmented.requestId, cached: segmented.cached, promptVersion: "visible-damage-v2", validationVersion: MASK_VALIDATION_VERSION, localizationBoxes: analysis.zones.map((z) => z.boundingBox), returnedScores: segmented.scores, returnedBoxes: segmented.returnedBoxes, acceptedMasks: masks, rejectedMasks: segmented.rejected };
  fs.writeFileSync(path.join(outputDir, "left-front-live-fal-result.json"), JSON.stringify(record, null, 2));
  const visual = await renderDamageOverlay({ imageSource: normalized.buffer, zones: analysis.zones, masks: segmented.masks, disclaimer: "Live FAL Left Front regression qualification", annotationStyle: "heatmap", showLegend: true });
  fs.writeFileSync(path.join(outputDir, "left-front-live-fal-overlay.png"), visual);
  if (!masks.some((m) => m.metrics.approvedOverlap >= fixture.thresholds.minimumPrimaryApprovedOverlap)) throw new Error("No live primary mask met approved-zone overlap");
  console.log(JSON.stringify(record, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
