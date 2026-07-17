import type { DamageZone, DamageZoneBoundingBox, DamageZonePolygonPoint } from "@/lib/ai/visionDamageAnnotation";

export type VisibleDamageRegion = {
  id: string; componentName: string;
  damageType: NonNullable<DamageZone["damageType"]>;
  confidence: number; visibleEvidence: string;
  box: { xMin: number; yMin: number; xMax: number; yMax: number };
  positivePoints: DamageZonePolygonPoint[]; negativePoints: DamageZonePolygonPoint[];
  segmentationPrompt: string; severity: DamageZone["severity"];
};

export type FalRegionRequest = {
  image_url: string; prompt: string;
  box_prompts: Array<{ x_min: number; y_min: number; x_max: number; y_max: number; object_id: number }>;
  point_prompts: Array<{ x: number; y: number; label: 0 | 1; object_id: number }>;
  include_scores: true; include_boxes: true; return_multiple_masks: true; max_masks: 3; apply_mask: false; sync_mode: true;
};

export type LocalizationRejection = { regionId: string; reasons: string[] };

const FORBIDDEN_PROMPTS = new Set(["wheel", "vehicle", "collision", "car damage", "damaged car"]);

export function zoneToVisibleRegion(zone: DamageZone, index: number): VisibleDamageRegion | null {
  const b = zone.boundingBox;
  if (!b) return null;
  return {
    id: zone.id?.trim() || `visible-damage-${index + 1}`,
    componentName: zone.componentName?.trim() || zone.partName?.trim() || zone.label.trim(),
    damageType: zone.damageType ?? "unknown", confidence: zone.confidence,
    visibleEvidence: zone.visibleEvidence?.trim() || zone.description.trim(),
    box: { xMin: b.x, yMin: b.y, xMax: b.x + b.width, yMax: b.y + b.height },
    positivePoints: zone.positivePoints ?? [], negativePoints: zone.negativePoints ?? [],
    segmentationPrompt: zone.segmentationPrompt?.trim() || "", severity: zone.severity,
  };
}

export function regionBox(region: VisibleDamageRegion): DamageZoneBoundingBox {
  return { x: region.box.xMin, y: region.box.yMin, width: region.box.xMax - region.box.xMin, height: region.box.yMax - region.box.yMin };
}

export function validateVisibleDamageRegion(region: VisibleDamageRegion): string[] {
  const reasons: string[] = [], p = region.segmentationPrompt.trim().toLowerCase(), b = region.box;
  if (!p) reasons.push("missing-segmentation-prompt");
  else if (FORBIDDEN_PROMPTS.has(p)) reasons.push("forbidden-default-or-generic-prompt");
  if (![b.xMin, b.yMin, b.xMax, b.yMax].every(Number.isFinite) || b.xMin < 0 || b.yMin < 0 || b.xMax > 1 || b.yMax > 1 || b.xMin >= b.xMax || b.yMin >= b.yMax) reasons.push("invalid-box");
  if (!region.positivePoints.length) reasons.push("missing-positive-point");
  if (!region.componentName.trim()) reasons.push("missing-component-name");
  if (!region.visibleEvidence.trim()) reasons.push("missing-visible-evidence");
  if (!Number.isFinite(region.confidence) || region.confidence < 0 || region.confidence > 1) reasons.push("invalid-confidence");
  for (const point of [...region.positivePoints, ...region.negativePoints]) if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) reasons.push("invalid-point");
  return [...new Set(reasons)];
}

export function buildFalRegionRequest(imageUrl: string, width: number, height: number, region: VisibleDamageRegion, objectId: number): FalRegionRequest {
  const reasons = validateVisibleDamageRegion(region);
  if (reasons.length) throw new Error(`localization-preflight-failed:${region.id}:${reasons.join(",")}`);
  const px = (value: number, dimension: number, ceil = false) => (ceil ? Math.ceil(value * dimension) : Math.floor(value * dimension));
  return {
    image_url: imageUrl, prompt: region.segmentationPrompt,
    box_prompts: [{ x_min: px(region.box.xMin, width), y_min: px(region.box.yMin, height), x_max: px(region.box.xMax, width, true), y_max: px(region.box.yMax, height, true), object_id: objectId }],
    point_prompts: [
      ...region.positivePoints.map((p) => ({ x: px(p.x, width), y: px(p.y, height), label: 1 as const, object_id: objectId })),
      ...region.negativePoints.map((p) => ({ x: px(p.x, width), y: px(p.y, height), label: 0 as const, object_id: objectId })),
    ],
    include_scores: true, include_boxes: true, return_multiple_masks: true, max_masks: 3, apply_mask: false, sync_mode: true,
  };
}

export function preflightRegions(regions: VisibleDamageRegion[]) {
  const rejected: LocalizationRejection[] = regions.map((region) => ({ regionId: region.id, reasons: validateVisibleDamageRegion(region) })).filter((item) => item.reasons.length);
  return { approved: regions.filter((region) => !rejected.some((item) => item.regionId === region.id)), rejected };
}

export function expandedCropTransform(box: DamageZoneBoundingBox, expansion = 0.10) {
  const x = Math.max(0, box.x - box.width * expansion), y = Math.max(0, box.y - box.height * expansion);
  const xMax = Math.min(1, box.x + box.width * (1 + expansion)), yMax = Math.min(1, box.y + box.height * (1 + expansion));
  return {
    crop: { x, y, width: xMax - x, height: yMax - y },
    cropToSource: (point: DamageZonePolygonPoint) => ({ x: x + point.x * (xMax - x), y: y + point.y * (yMax - y) }),
  };
}
