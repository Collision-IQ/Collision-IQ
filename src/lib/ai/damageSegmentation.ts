import { fal } from "@fal-ai/client";
import type { DamageZone, DamageZoneBoundingBox } from "@/lib/ai/visionDamageAnnotation";
import { buildFalRegionRequest, preflightRegions, regionBox, zoneToVisibleRegion, type FalRegionRequest } from "@/lib/ai/damageLocalization";

export const DAMAGE_SEGMENTATION_MODEL = "fal-ai/sam-3-1/image-rle";
export const MASK_VALIDATION_VERSION = "mask-v1";
export const DEFAULT_MIN_MASK_CONFIDENCE = 0.65;
export type SegmentationResult = { masks: AcceptedDamageMask[]; rejected: MaskRejection[]; requestId?: string; scores?: number[]; returnedBoxes?: Array<DamageZoneBoundingBox | null>; cached: boolean };
const segmentationCache = new Map<string, SegmentationResult>();

export type BinaryMask = { width: number; height: number; pixels: Uint8Array };
export type AcceptedDamageMask = BinaryMask & {
  zoneIndex: number;
  severity: DamageZone["severity"];
  confidence: number;
  box: DamageZoneBoundingBox;
};
export type MaskRejection = { index: number; reason: string };
export type FalRleRawShape = {
  requestId?: string; rleType: string; rleIsArray: boolean; rleArrayLength: number;
  rles: Array<{ length: number; prefix: string; startsWith: "object" | "array" | "digit" | "other" }>;
  scores?: number[]; boxes?: number[][]; metadata?: Array<{ score?: number; box?: number[] }>;
  width: number; height: number; expectedPixels: number; model: string; cached: false;
};

export class RleDecodeError extends Error {
  code: string;
  diagnostics: Record<string, number | string>;
  constructor(code: string, diagnostics: Record<string, number | string>) {
    super(`${code}: ${JSON.stringify(diagnostics)}`);
    this.name = "RleDecodeError"; this.code = code; this.diagnostics = diagnostics;
  }
}

export function validateNormalizedBox(value: unknown): DamageZoneBoundingBox | null {
  if (!value || typeof value !== "object") return null;
  const b = value as DamageZoneBoundingBox;
  if (![b.x, b.y, b.width, b.height].every(Number.isFinite)) return null;
  if (b.x < 0 || b.y < 0 || b.width <= 0 || b.height <= 0) return null;
  if (b.x + b.width > 1 || b.y + b.height > 1) return null;
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}

export function centerBoxToTopLeft(box: number[]): DamageZoneBoundingBox | null {
  if (box.length !== 4 || !box.every(Number.isFinite)) return null;
  const [cx, cy, width, height] = box;
  const x = Math.max(0, cx - width / 2);
  const y = Math.max(0, cy - height / 2);
  const xMax = Math.min(1, cx + width / 2);
  const yMax = Math.min(1, cy + height / 2);
  return validateNormalizedBox({ x, y, width: xMax - x, height: yMax - y });
}

export function normalizeRleStrings(value: unknown): string[] {
  const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : null;
  if (!values || !values.length || values.some((entry) => typeof entry !== "string" || !entry.length)) {
    throw new RleDecodeError("unsupported-rle-format", { rleType: typeof value, arrayLength: Array.isArray(value) ? value.length : 0 });
  }
  return values as string[];
}

function diagnosticPrefix(rle: string): string { return rle.slice(0, 120); }

/** Decode official COCO compressed counts using safe arithmetic, not 32-bit bitwise operations. */
export function decodeCompressedCocoCounts(rle: string, expectedPixels: number, maskIndex = 0): number[] {
  const counts: number[] = [];
  let position = 0, total = 0;
  while (position < rle.length) {
    let value = 0, chunkIndex = 0, continuation = true, lastChunk = 0;
    while (continuation) {
      if (position >= rle.length) throw new RleDecodeError("rle-unterminated", { maskIndex, expectedPixels, decodedPixelsBeforeFailure: total, countIndex: counts.length, rleLength: rle.length, rlePrefix: diagnosticPrefix(rle) });
      const encoded = rle.charCodeAt(position++) - 48;
      if (encoded < 0 || encoded > 63) throw new RleDecodeError("rle-invalid-character", { maskIndex, expectedPixels, decodedPixelsBeforeFailure: total, countIndex: counts.length, rleLength: rle.length, rlePrefix: diagnosticPrefix(rle) });
      lastChunk = encoded % 32;
      const contribution = lastChunk * (2 ** (5 * chunkIndex));
      if (!Number.isSafeInteger(contribution) || !Number.isSafeInteger(value + contribution)) throw new RleDecodeError("rle-unsafe-integer", { maskIndex, expectedPixels, decodedPixelsBeforeFailure: total, countIndex: counts.length, rleLength: rle.length, rlePrefix: diagnosticPrefix(rle) });
      value += contribution;
      continuation = encoded >= 32;
      chunkIndex++;
      if (chunkIndex > 11) throw new RleDecodeError("rle-unsafe-integer", { maskIndex, expectedPixels, decodedPixelsBeforeFailure: total, countIndex: counts.length, rleLength: rle.length, rlePrefix: diagnosticPrefix(rle) });
    }
    if (lastChunk >= 16) value -= 2 ** (5 * chunkIndex);
    // Official pycocotools rule: m > 2, not m >= 2.
    if (counts.length > 2) value += counts[counts.length - 2];
    if (!Number.isSafeInteger(value) || value < 0) throw new RleDecodeError("rle-negative-count", { maskIndex, expectedPixels, decodedPixelsBeforeFailure: total, countIndex: counts.length, rleLength: rle.length, rlePrefix: diagnosticPrefix(rle) });
    total += value;
    if (!Number.isSafeInteger(total) || total > expectedPixels) throw new RleDecodeError("rle-overflow", { maskIndex, expectedPixels, decodedPixelsBeforeFailure: total - value, countIndex: counts.length, rleLength: rle.length, rlePrefix: diagnosticPrefix(rle) });
    counts.push(value);
  }
  if (total < expectedPixels) throw new RleDecodeError("rle-underflow", { maskIndex, expectedPixels, decodedPixelsBeforeFailure: total, countIndex: counts.length, rleLength: rle.length, rlePrefix: diagnosticPrefix(rle) });
  return counts;
}

/** Observed SAM 3.1 format: whitespace-separated row-major (start, length) foreground spans. */
export function decodeFalSparseRle(rle: string, width: number, height: number, maskIndex = 0): BinaryMask {
  const expectedPixels = width * height;
  const values = rle.trim().split(/\s+/).map(Number);
  if (values.length < 8 || values.length % 2 !== 0) throw new RleDecodeError("unsupported-rle-format", { maskIndex, expectedPixels, tokenCount: values.length, rleLength: rle.length, rlePrefix: diagnosticPrefix(rle) });
  const pixels = new Uint8Array(expectedPixels);
  let previousEnd = 0;
  for (let index = 0; index < values.length; index += 2) {
    const start = values[index], length = values[index + 1], countIndex = index / 2;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length <= 0) throw new RleDecodeError("rle-negative-count", { maskIndex, expectedPixels, decodedPixelsBeforeFailure: previousEnd, countIndex, rleLength: rle.length, rlePrefix: diagnosticPrefix(rle) });
    const end = start + length;
    if (!Number.isSafeInteger(end) || end > expectedPixels) throw new RleDecodeError("rle-overflow", { maskIndex, expectedPixels, decodedPixelsBeforeFailure: start, countIndex, rleLength: rle.length, rlePrefix: diagnosticPrefix(rle) });
    if (start < previousEnd) throw new RleDecodeError("rle-overlapping-span", { maskIndex, expectedPixels, decodedPixelsBeforeFailure: start, countIndex, rleLength: rle.length, rlePrefix: diagnosticPrefix(rle) });
    pixels.fill(1, start, end);
    previousEnd = end;
  }
  return { width, height, pixels };
}

function decodeUncompressedCounts(rle: string, expectedPixels: number, maskIndex: number): number[] {
  const counts = rle.split(/[\s,]+/).filter(Boolean).map(Number);
  let total = 0;
  for (let index = 0; index < counts.length; index++) {
    const count = counts[index];
    if (!Number.isSafeInteger(count) || count < 0) throw new RleDecodeError("rle-negative-count", { maskIndex, expectedPixels, decodedPixelsBeforeFailure: total, countIndex: index, rleLength: rle.length, rlePrefix: diagnosticPrefix(rle) });
    total += count;
    if (total > expectedPixels) throw new RleDecodeError("rle-overflow", { maskIndex, expectedPixels, decodedPixelsBeforeFailure: total - count, countIndex: index, rleLength: rle.length, rlePrefix: diagnosticPrefix(rle) });
  }
  if (total < expectedPixels) throw new RleDecodeError("rle-underflow", { maskIndex, expectedPixels, decodedPixelsBeforeFailure: total, countIndex: counts.length, rleLength: rle.length, rlePrefix: diagnosticPrefix(rle) });
  return counts;
}

// COCO walks pixels column-major; output pixels are conventional row-major.
export function decodeCocoRle(rle: string, width: number, height: number, maskIndex = 0): BinaryMask {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("invalid-mask-dimensions");
  }
  const expectedPixels = width * height, trimmed = rle.trim();
  if (!trimmed) throw new RleDecodeError("unsupported-rle-format", { maskIndex, expectedPixels, rleLength: rle.length, rlePrefix: "" });
  if (/^\d+(?:\s+\d+){7,}$/.test(trimmed) && trimmed.split(/\s+/).length % 2 === 0) {
    return decodeFalSparseRle(trimmed, width, height, maskIndex);
  }
  const counts = /^[\d\s,]+$/.test(trimmed)
    ? decodeUncompressedCounts(trimmed, expectedPixels, maskIndex)
    : /^[\x30-\x6f]+$/.test(trimmed)
      ? decodeCompressedCocoCounts(trimmed, expectedPixels, maskIndex)
      : (() => { throw new RleDecodeError("unsupported-rle-format", { maskIndex, expectedPixels, rleLength: rle.length, rlePrefix: diagnosticPrefix(rle) }); })();
  const pixels = new Uint8Array(expectedPixels);
  let cursor = 0, foreground = false;
  for (const count of counts) {
    for (let i = 0; i < count; i++, cursor++) {
      if (foreground) {
        const x = Math.floor(cursor / height), y = cursor % height;
        pixels[y * width + x] = 1;
      }
    }
    foreground = !foreground;
  }
  return { width, height, pixels };
}

function expandedBox(box: DamageZoneBoundingBox, amount = 0.04): DamageZoneBoundingBox {
  const x = Math.max(0, box.x - amount), y = Math.max(0, box.y - amount);
  const xMax = Math.min(1, box.x + box.width + amount);
  const yMax = Math.min(1, box.y + box.height + amount);
  return { x, y, width: xMax - x, height: yMax - y };
}

function clipAndMeasure(mask: BinaryMask, box: DamageZoneBoundingBox) {
  const clip = expandedBox(box);
  let total = 0, insidePrompt = 0, kept = 0;
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
    const i = y * mask.width + x;
    if (!mask.pixels[i]) continue;
    total++;
    const nx = (x + 0.5) / mask.width, ny = (y + 0.5) / mask.height;
    if (nx >= box.x && nx <= box.x + box.width && ny >= box.y && ny <= box.y + box.height) insidePrompt++;
    if (nx >= clip.x && nx <= clip.x + clip.width && ny >= clip.y && ny <= clip.y + clip.height) kept++;
    else mask.pixels[i] = 0;
  }
  return { total, insidePrompt, kept };
}

export function maskIoU(a: BinaryMask, b: BinaryMask): number {
  if (a.width !== b.width || a.height !== b.height) return 0;
  let intersection = 0, union = 0;
  for (let i = 0; i < a.pixels.length; i++) {
    if (a.pixels[i] || b.pixels[i]) union++;
    if (a.pixels[i] && b.pixels[i]) intersection++;
  }
  return union ? intersection / union : 0;
}

export function validateMasks(params: {
  masks: BinaryMask[]; zones: DamageZone[]; scores: number[]; zoneIndices?: number[]; minConfidence?: number;
}): { accepted: AcceptedDamageMask[]; rejected: MaskRejection[] } {
  const accepted: AcceptedDamageMask[] = [], rejected: MaskRejection[] = [];
  params.masks.forEach((mask, index) => {
    const zoneIndex = params.zoneIndices?.[index] ?? index, zone = params.zones[zoneIndex];
    const box = validateNormalizedBox(zone?.boundingBox), confidence = params.scores[index];
    if (!box) return void rejected.push({ index, reason: "missing-or-invalid-prompt-box" });
    if (!Number.isFinite(confidence) || confidence < (params.minConfidence ?? DEFAULT_MIN_MASK_CONFIDENCE)) return void rejected.push({ index, reason: "confidence-below-threshold" });
    const measure = clipAndMeasure(mask, box);
    if (!measure.total || !measure.kept) return void rejected.push({ index, reason: "empty-mask" });
    if (measure.insidePrompt / measure.total < 0.5) return void rejected.push({ index, reason: "insufficient-prompt-intersection" });
    if (measure.total / mask.pixels.length > 0.45) return void rejected.push({ index, reason: "implausibly-large-mask" });
    const positivePoints = zone.positivePoints ?? [], negativePoints = zone.negativePoints ?? [];
    const containsPoint = (point: { x: number; y: number }) => mask.pixels[Math.min(mask.height - 1, Math.floor(point.y * mask.height)) * mask.width + Math.min(mask.width - 1, Math.floor(point.x * mask.width))] === 1;
    if (positivePoints.length && !positivePoints.some(containsPoint)) return void rejected.push({ index, reason: "missing-positive-point" });
    if (negativePoints.some(containsPoint)) return void rejected.push({ index, reason: "contains-negative-point" });
    let area = 0, sumX = 0, sumY = 0;
    for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) if (mask.pixels[y * mask.width + x]) { area++; sumX += (x + 0.5) / mask.width; sumY += (y + 0.5) / mask.height; }
    const permitted = expandedBox(box);
    if (!area || sumX / area < permitted.x || sumX / area > permitted.x + permitted.width || sumY / area < permitted.y || sumY / area > permitted.y + permitted.height) return void rejected.push({ index, reason: "centroid-outside-region" });
    if (accepted.some((prior) => maskIoU(prior, mask) > 0.85)) return void rejected.push({ index, reason: "duplicate-mask" });
    accepted.push({ ...mask, zoneIndex, severity: zone.severity, confidence, box });
  });
  return { accepted, rejected };
}

type FalRleOutput = { rle?: string | string[]; scores?: number[]; metadata?: Array<{ index?: number; score?: number; box?: number[] }>; boxes?: number[][] };

export function normalizeFalRlePayload(data: FalRleOutput) {
  const rles = normalizeRleStrings(data.rle);
  return {
    rles,
    scores: rles.map((_, index) => data.scores?.[index] ?? data.metadata?.[index]?.score ?? NaN),
    boxes: rles.map((_, index) => data.boxes?.[index] ?? data.metadata?.[index]?.box),
    metadata: rles.map((_, index) => data.metadata?.[index]),
    zoneIndices: rles.map((_, index) => data.metadata?.[index]?.index ?? index),
  };
}

export async function segmentVisibleDamage(params: {
  imageDataUrl: string; sourceHash: string; width: number; height: number; zones: DamageZone[];
  cacheNamespace?: string; bypassCache?: boolean;
  onRawResponse?: (shape: FalRleRawShape, rleStrings: string[]) => void;
  onRequestPreflight?: (request: { regionId: string; componentName: string; confidence: number; damageType: string; visibleEvidence: string; normalizedBox: DamageZoneBoundingBox; request: FalRegionRequest }) => void;
}): Promise<SegmentationResult> {
  const regionEntries = params.zones.map((zone, index) => ({ zone, index, region: zoneToVisibleRegion(zone, index) })).filter((entry): entry is { zone: DamageZone; index: number; region: NonNullable<ReturnType<typeof zoneToVisibleRegion>> } => entry.region !== null);
  const preflight = preflightRegions(regionEntries.map((entry) => entry.region));
  const rejectedPreflight = preflight.rejected.map((item, index) => ({ index: -1 - index, reason: `localization-preflight-failed:${item.regionId}:${item.reasons.join(",")}` }));
  const approvedEntries = regionEntries.filter((entry) => preflight.approved.includes(entry.region));
  if (!approvedEntries.length) return { masks: [], rejected: rejectedPreflight.length ? rejectedPreflight : [{ index: -1, reason: "no-valid-visible-damage-regions" }], cached: false };
  const cacheKey = [params.cacheNamespace ?? "production", params.sourceHash, DAMAGE_SEGMENTATION_MODEL, "3.1", "visible-damage-v2", MASK_VALIDATION_VERSION,
    approvedEntries.map((entry) => `${entry.region.id}:${entry.region.segmentationPrompt}:${JSON.stringify(entry.region.box)}:${JSON.stringify(entry.region.positivePoints)}:${JSON.stringify(entry.region.negativePoints)}`).join(";")].join(":");
  const cached = params.bypassCache ? undefined : segmentationCache.get(cacheKey);
  if (cached) return { ...cached, cached: true };
  const accepted: AcceptedDamageMask[] = [], rejected: MaskRejection[] = [...rejectedPreflight];
  const scores: number[] = [], returnedBoxes: Array<DamageZoneBoundingBox | null> = [], requestIds: string[] = [];
  for (let requestIndex = 0; requestIndex < approvedEntries.length; requestIndex++) {
    const entry = approvedEntries[requestIndex], request = buildFalRegionRequest(params.imageDataUrl, params.width, params.height, entry.region, entry.index);
    params.onRequestPreflight?.({ regionId: entry.region.id, componentName: entry.region.componentName, confidence: entry.region.confidence, damageType: entry.region.damageType, visibleEvidence: entry.region.visibleEvidence, normalizedBox: regionBox(entry.region), request });
    const response = await fal.subscribe(DAMAGE_SEGMENTATION_MODEL, { input: request as never, logs: false });
    requestIds.push(response.requestId);
    const data = response.data as FalRleOutput, payload = normalizeFalRlePayload(data), rles = payload.rles;
    params.onRawResponse?.({ requestId: response.requestId, rleType: typeof data.rle, rleIsArray: Array.isArray(data.rle), rleArrayLength: Array.isArray(data.rle) ? data.rle.length : 1, rles: rles.map((rle) => ({ length: rle.length, prefix: diagnosticPrefix(rle), startsWith: rle.startsWith("{") ? "object" : rle.startsWith("[") ? "array" : /^\d/.test(rle) ? "digit" : "other" })), scores: data.scores, boxes: data.boxes, metadata: data.metadata, width: params.width, height: params.height, expectedPixels: params.width * params.height, model: DAMAGE_SEGMENTATION_MODEL, cached: false }, rles);
    const decoded = rles.map((rle, index) => decodeCocoRle(rle, params.width, params.height, index));
    const validated = validateMasks({ masks: decoded, zones: params.zones, scores: payload.scores, zoneIndices: rles.map(() => entry.index) });
    for (const mask of validated.accepted.sort((a, b) => b.confidence - a.confidence)) {
      if (!accepted.some((prior) => maskIoU(prior, mask) > 0.85)) { accepted.push(mask); break; }
    }
    rejected.push(...validated.rejected.map((item) => ({ ...item, reason: `${entry.region.id}:${item.reason}` })));
    scores.push(...payload.scores); returnedBoxes.push(...payload.boxes.map((box) => box ? centerBoxToTopLeft(box) : null));
  }
  const result: SegmentationResult = {
    masks: accepted, rejected, requestId: requestIds.join(","), scores, returnedBoxes, cached: false,
  };
  if (result.masks.length) segmentationCache.set(cacheKey, result);
  return result;
}

export function objectFitContainRect(containerWidth: number, containerHeight: number, naturalWidth: number, naturalHeight: number) {
  const scale = Math.min(containerWidth / naturalWidth, containerHeight / naturalHeight);
  const width = naturalWidth * scale, height = naturalHeight * scale;
  return { scale, width, height, offsetX: (containerWidth - width) / 2, offsetY: (containerHeight - height) / 2 };
}
