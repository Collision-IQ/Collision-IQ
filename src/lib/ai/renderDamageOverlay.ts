import { createCanvas, loadImage } from "@napi-rs/canvas";
import type {
  AnnotationStyle,
  DamageZone,
  DamageZoneSeverity,
} from "@/lib/ai/visionDamageAnnotation";
import type { AcceptedDamageMask } from "@/lib/ai/damageSegmentation";

type Ctx = ReturnType<ReturnType<typeof createCanvas>["getContext"]>;

const SEVERITY_COLORS: Record<DamageZoneSeverity, string> = {
  high: "#dc2626", // red
  medium: "#ea580c", // orange
  low: "#ca8a04", // amber
};

const COLOR_HINT_HEX: Record<string, string> = {
  red: "#dc2626",
  orange: "#ea580c",
  yellow: "#ca8a04",
  blue: "#2563eb",
};

const BANNER_BG = "rgba(15, 23, 42, 0.92)";
const BANNER_TEXT = "#e2e8f0";
const MARKER_TEXT = "#ffffff";

export type RenderDamageOverlayInput = {
  /** Data URL, http(s) URL, or raw image bytes. */
  imageSource: string | Buffer | Uint8Array;
  zones: DamageZone[];
  /** Validated source-resolution masks. Heat-map styles never invent a fallback shape. */
  masks?: AcceptedDamageMask[];
  disclaimer: string;
  /** callout = labels, heatmap = validated translucent masks, combined = both. */
  annotationStyle?: AnnotationStyle;
  /** Draw a small legend in a corner. Defaults on for heat-map styles. */
  showLegend?: boolean;
};

function drawDamageMasks(ctx: Ctx, masks: AcceptedDamageMask[], imgWidth: number, imgHeight: number): void {
  for (const mask of masks) {
    if (mask.width !== imgWidth || mask.height !== imgHeight) continue;
    const layer = createCanvas(imgWidth, imgHeight);
    const layerCtx = layer.getContext("2d");
    const imageData = layerCtx.createImageData(imgWidth, imgHeight);
    const rgb = mask.severity === "high" ? [220, 38, 38] : mask.severity === "medium" ? [234, 88, 12] : [202, 138, 4];
    const alpha = mask.severity === "high" ? 94 : mask.severity === "medium" ? 82 : 66;
    for (let i = 0; i < mask.pixels.length; i++) {
      if (!mask.pixels[i]) continue;
      const p = i * 4;
      imageData.data[p] = rgb[0]; imageData.data[p + 1] = rgb[1];
      imageData.data[p + 2] = rgb[2]; imageData.data[p + 3] = alpha;
    }
    layerCtx.putImageData(imageData, 0, 0);
    ctx.drawImage(layer, 0, 0);
  }
}

function wrapText(ctx: Ctx, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Callout stroke/label color: explicit colorHint wins, else severity color. */
function calloutColorForZone(zone: DamageZone): string {
  const hint = zone.heatmap?.colorHint;
  if (hint && COLOR_HINT_HEX[hint]) return COLOR_HINT_HEX[hint];
  return SEVERITY_COLORS[zone.severity] ?? SEVERITY_COLORS.low;
}

/** Rounded-rectangle path helper. */
function roundedRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawCalloutZone(
  ctx: Ctx,
  zone: DamageZone,
  index: number,
  imgWidth: number,
  imgHeight: number,
  lineWidth: number,
  labelFont: number
): void {
  const number = index + 1;
  const color = calloutColorForZone(zone);

  let anchorX: number;
  let anchorY: number;

  if (zone.boundingBox) {
    // Anchor the numbered label at the zone's top-left. The dashed outline was
    // removed by request — numbered labels (and the heat map, in combined mode)
    // carry the callout without boxing the damage.
    anchorX = zone.boundingBox.x * imgWidth;
    anchorY = zone.boundingBox.y * imgHeight;
  } else {
    // No geometry: stack label chips down the left margin so every zone shows.
    anchorX = lineWidth + 4;
    anchorY = lineWidth + 4 + index * (labelFont * 2.4);
  }

  // Numbered label chip: "N. label".
  const text = `${number}. ${zone.label}`.trim();
  ctx.font = `bold ${labelFont}px sans-serif`;
  const padX = Math.round(labelFont * 0.5);
  const padY = Math.round(labelFont * 0.35);
  const textWidth = Math.min(ctx.measureText(text).width, imgWidth * 0.6);
  const chipW = textWidth + padX * 2;
  const chipH = labelFont + padY * 2;

  // Keep the chip on-canvas.
  let chipX = anchorX;
  let chipY = anchorY - chipH - lineWidth;
  if (chipY < 0) chipY = anchorY + lineWidth;
  if (chipX + chipW > imgWidth) chipX = Math.max(0, imgWidth - chipW);

  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.92;
  roundedRect(ctx, chipX, chipY, chipW, chipH, Math.round(labelFont * 0.35));
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = MARKER_TEXT;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  // Clip long labels to the chip width.
  ctx.save();
  roundedRect(ctx, chipX, chipY, chipW, chipH, Math.round(labelFont * 0.35));
  ctx.clip();
  ctx.fillText(text, chipX + padX, chipY + chipH / 2);
  ctx.restore();
  ctx.restore();
}

function drawLegend(ctx: Ctx, imgWidth: number, imgHeight: number, baseFont: number): void {
  const rows = [
    { color: "rgba(220,38,38,0.85)", label: "Strongest visible deformation" },
    { color: "rgba(234,88,12,0.85)", label: "Moderate dent / crease" },
    { color: "rgba(202,138,4,0.85)", label: "Light scuff / scratch" },
    { color: "rgba(37,99,235,0.85)", label: "Verify-only area" },
  ];
  const font = Math.max(11, Math.round(baseFont * 0.82));
  ctx.font = `${font}px sans-serif`;
  const swatch = Math.round(font * 1.1);
  const pad = Math.round(font * 0.8);
  const rowH = Math.round(font * 1.6);
  const titleH = Math.round(font * 1.8);
  const maxLabel = Math.max(...rows.map((r) => ctx.measureText(r.label).width));
  const boxW = pad * 2 + swatch + Math.round(font * 0.6) + maxLabel;
  const boxH = pad * 2 + titleH + rows.length * rowH;
  const boxX = imgWidth - boxW - pad;
  const boxY = imgHeight - boxH - pad;

  ctx.save();
  ctx.fillStyle = "rgba(15, 23, 42, 0.82)";
  roundedRect(ctx, boxX, boxY, boxW, boxH, Math.round(font * 0.5));
  ctx.fill();

  ctx.fillStyle = "#f1f5f9";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${font}px sans-serif`;
  ctx.fillText("Visible Damage Heat Map", boxX + pad, boxY + pad + titleH / 2);

  ctx.font = `${font}px sans-serif`;
  rows.forEach((row, i) => {
    const ry = boxY + pad + titleH + i * rowH + rowH / 2;
    ctx.fillStyle = row.color;
    roundedRect(ctx, boxX + pad, ry - swatch / 2, swatch, swatch, Math.round(swatch * 0.25));
    ctx.fill();
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText(row.label, boxX + pad + swatch + Math.round(font * 0.6), ry);
  });
  ctx.restore();
}

/**
 * Draw deterministic damage-zone overlays onto the source image. Depending on
 * annotationStyle it renders labeled callout chips, validated contour masks, or
 * both. A fixed disclaimer banner runs along the bottom. Returns
 * a PNG buffer. This never fabricates a replacement image — it only annotates
 * pixels that already exist.
 */
export async function renderDamageOverlay(
  input: RenderDamageOverlayInput
): Promise<Buffer> {
  const style: AnnotationStyle = input.annotationStyle ?? "callout";
  const drawHeat = style === "heatmap" || style === "combined";
  const drawCallouts = style === "callout" || style === "combined";
  const showLegend = input.showLegend ?? drawHeat;

  const image = await loadImage(input.imageSource);
  const imgWidth = image.width;
  const imgHeight = image.height;

  const baseFont = Math.max(14, Math.round(imgWidth / 55));
  const bannerPadding = Math.round(baseFont * 0.8);
  const bannerLineHeight = Math.round(baseFont * 1.35);

  const probe = createCanvas(imgWidth, 10).getContext("2d");
  probe.font = `${baseFont}px sans-serif`;
  const disclaimerLines = wrapText(probe, input.disclaimer, imgWidth - bannerPadding * 2);
  const bannerHeight = bannerPadding * 2 + disclaimerLines.length * bannerLineHeight;

  const canvas = createCanvas(imgWidth, imgHeight + bannerHeight);
  const ctx = canvas.getContext("2d");

  // Base photo — always preserved underneath.
  ctx.drawImage(image, 0, 0, imgWidth, imgHeight);

  // Heat map first (so callouts land on top and stay legible).
  if (drawHeat) {
    drawDamageMasks(ctx, input.masks ?? [], imgWidth, imgHeight);
  }

  if (drawCallouts) {
    const lineWidth = Math.max(2, Math.round(imgWidth / 350));
    const labelFont = Math.max(13, Math.round(imgWidth / 48));
    input.zones.forEach((zone, index) => {
      drawCalloutZone(ctx, zone, index, imgWidth, imgHeight, lineWidth, labelFont);
    });
  }

  if (showLegend && input.zones.length > 0) {
    drawLegend(ctx, imgWidth, imgHeight, baseFont);
  }

  // Disclaimer banner.
  ctx.fillStyle = BANNER_BG;
  ctx.fillRect(0, imgHeight, imgWidth, bannerHeight);
  ctx.fillStyle = BANNER_TEXT;
  ctx.font = `${baseFont}px sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  disclaimerLines.forEach((line, i) => {
    ctx.fillText(line, bannerPadding, imgHeight + bannerPadding + i * bannerLineHeight);
  });

  return canvas.encode("png");
}
