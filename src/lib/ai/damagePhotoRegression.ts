import type { BinaryMask } from "@/lib/ai/damageSegmentation";
import type { DamageZoneBoundingBox } from "@/lib/ai/visionDamageAnnotation";

export function pixelsInBoxes(mask: BinaryMask, boxes: DamageZoneBoundingBox[]): number {
  let count = 0;
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
    if (!mask.pixels[y * mask.width + x]) continue;
    const nx = (x + 0.5) / mask.width, ny = (y + 0.5) / mask.height;
    if (boxes.some((b) => nx >= b.x && nx <= b.x + b.width && ny >= b.y && ny <= b.y + b.height)) count++;
  }
  return count;
}

export function maskQualification(mask: BinaryMask, approved: DamageZoneBoundingBox[], prohibited: Record<string, DamageZoneBoundingBox[]>) {
  let area = 0, sumX = 0, sumY = 0;
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) if (mask.pixels[y * mask.width + x]) {
    area++; sumX += (x + 0.5) / mask.width; sumY += (y + 0.5) / mask.height;
  }
  const ratio = (boxes: DamageZoneBoundingBox[]) => area ? pixelsInBoxes(mask, boxes) / area : 0;
  return {
    area,
    imageCoverage: area / mask.pixels.length,
    approvedOverlap: ratio(approved),
    prohibitedOverlap: Object.fromEntries(Object.entries(prohibited).map(([name, boxes]) => [name, ratio(boxes)])),
    centroid: area ? { x: sumX / area, y: sumY / area } : null,
  };
}

export function centroidAdjacentToBoxes(point: { x: number; y: number } | null, boxes: DamageZoneBoundingBox[], tolerance = 0.04): boolean {
  return !!point && boxes.some((b) => point.x >= b.x - tolerance && point.x <= b.x + b.width + tolerance && point.y >= b.y - tolerance && point.y <= b.y + b.height + tolerance);
}
