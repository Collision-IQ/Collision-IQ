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
require.extensions[".ts"] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
}).outputText, filename);
const lib = require(path.join(__dirname, "renderDamageOverlay.ts"));
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const zone = (overrides) => ({
  label: "scratched door", description: "scratch field", confidence: .9, severity: "high",
  approximateLocation: "", evidenceLimits: "", damageType: "scuffed",
  boundingBox: { x: .2, y: .2, width: .3, height: .2 },
  positivePoints: [{ x: .25, y: .3 }, { x: .35, y: .3 }, { x: .45, y: .3 }],
  ...overrides,
});

// gradientHeatZones: unmasked zones with a usable box qualify; masked or
// box-less zones do not.
{
  const zones = [zone(), zone({ boundingBox: undefined }), zone({ boundingBox: { x: .8, y: .8, width: .4, height: .1 } }), zone({ damageType: "torn" })];
  const masks = [{ width: 1, height: 1, pixels: new Uint8Array([1]), zoneIndex: 3, severity: "high", confidence: .9, box: zones[3].boundingBox }];
  const selected = lib.gradientHeatZones(zones, masks);
  assert.deepEqual(selected.map((entry) => entry.index), [0], "only the unmasked valid-box zone renders as gradient heat");
  // Without masks, the SAM-eligible zone falls back to gradient heat too.
  assert.deepEqual(lib.gradientHeatZones(zones).map((entry) => entry.index), [0, 3]);
}

(async () => {
  // Synthetic mid-gray photo: any heat shows as a red-over-green channel shift.
  const W = 200, H = 200;
  const base = createCanvas(W, H);
  const baseCtx = base.getContext("2d");
  baseCtx.fillStyle = "#808080";
  baseCtx.fillRect(0, 0, W, H);
  const png = await base.encode("png");

  const rendered = await lib.renderDamageOverlay({
    imageSource: png,
    zones: [zone()],
    masks: [],
    disclaimer: "test artifact",
    annotationStyle: "heatmap",
    showLegend: false,
  });
  const image = await loadImage(rendered);
  const probe = createCanvas(image.width, image.height);
  const ctx = probe.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const px = (nx, ny) => ctx.getImageData(Math.round(nx * W), Math.round(ny * H), 1, 1).data;

  // Heat present at each positive point (red channel pulled well above green).
  for (const point of [{ x: .25, y: .3 }, { x: .35, y: .3 }, { x: .45, y: .3 }]) {
    const data = px(point.x, point.y);
    assert.ok(data[0] - data[1] > 15, `red heat at positive point ${JSON.stringify(point)} (r=${data[0]} g=${data[1]})`);
    assert.equal(data[3], 255);
  }

  // The wheel regression: pixels outside the (feather-expanded) box stay
  // untouched — heat can never bleed onto a wheel/tire/pavement area the
  // vision box excluded. Box spans x .2-.5, y .2-.4; sample far corner.
  for (const point of [{ x: .8, y: .8 }, { x: .75, y: .3 }, { x: .35, y: .75 }]) {
    const data = px(point.x, point.y);
    assert.ok(Math.abs(data[0] - data[1]) <= 2 && Math.abs(data[0] - 128) <= 3, `no heat outside box at ${JSON.stringify(point)} (r=${data[0]} g=${data[1]})`);
  }

  // Callout style is unchanged by the gradient path: no heat at the points.
  const callout = await lib.renderDamageOverlay({
    imageSource: png, zones: [zone({ boundingBox: { x: .55, y: .55, width: .3, height: .2 }, positivePoints: [{ x: .65, y: .65 }] })],
    disclaimer: "test artifact", annotationStyle: "callout",
  });
  const calloutImage = await loadImage(callout);
  const calloutProbe = createCanvas(calloutImage.width, calloutImage.height).getContext("2d");
  calloutProbe.drawImage(calloutImage, 0, 0);
  const calloutData = calloutProbe.getImageData(Math.round(.65 * W), Math.round(.65 * H), 1, 1).data;
  assert.ok(Math.abs(calloutData[0] - calloutData[1]) <= 2, "callout mode draws no gradient heat");

  console.log("PASS render damage overlay gradients");
})().catch((error) => { console.error(error); process.exitCode = 1; });
