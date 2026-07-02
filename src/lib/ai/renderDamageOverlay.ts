import { createCanvas, loadImage } from "@napi-rs/canvas";
import type {
  AnnotationStyle,
  DamageZone,
  DamageZoneSeverity,
} from "@/lib/ai/visionDamageAnnotation";

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
  disclaimer: string;
  /** callout = boxes+labels, heatmap = translucent blobs, combined = both. */
  annotationStyle?: AnnotationStyle;
  /** Draw a small legend in a corner. Defaults on for heat-map styles. */
  showLegend?: boolean;
};

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

function severityToIntensity(severity: DamageZoneSeverity): number {
  if (severity === "high") return 0.9;
  if (severity === "medium") return 0.65;
  return 0.4;
}

type HeatColor = { center: string; mid: string; edge: string };

function heatColorForIntensity(intensity: number): HeatColor {
  if (intensity >= 0.8) {
    return {
      center: "rgba(255, 0, 0, 0.42)",
      mid: "rgba(255, 90, 0, 0.25)",
      edge: "rgba(255, 0, 0, 0.0)",
    };
  }
  if (intensity >= 0.55) {
    return {
      center: "rgba(255, 140, 0, 0.35)",
      mid: "rgba(255, 190, 0, 0.22)",
      edge: "rgba(255, 140, 0, 0.0)",
    };
  }
  return {
    center: "rgba(255, 230, 0, 0.30)",
    mid: "rgba(255, 230, 0, 0.16)",
    edge: "rgba(255, 230, 0, 0.0)",
  };
}

function heatColorForHint(hint: "blue"): HeatColor {
  // Only "blue" (verify-only) needs a distinct scale; red/orange/yellow follow intensity.
  void hint;
  return {
    center: "rgba(0, 120, 255, 0.22)",
    mid: "rgba(0, 120, 255, 0.12)",
    edge: "rgba(0, 120, 255, 0.0)",
  };
}

// Blob half-axes stay close to the reported zone so heat concentrates on the
// damage instead of washing over undamaged panel/wheel/background. A little over
// half the box gives a soft feathered edge; a hard cap prevents a single
// over-sized model box from tinting the whole image.
const HEAT_RADIUS_FACTOR = 0.55;
const HEAT_RADIUS_CAP = 0.24; // fraction of the image dimension

/** Resolve a zone's center + radius in pixels from bbox or polygon. */
function resolveZoneGeometry(
  zone: DamageZone,
  imgWidth: number,
  imgHeight: number
): { cx: number; cy: number; rx: number; ry: number } | null {
  const radius = (span: number, imageDim: number) =>
    Math.max(Math.min(span * HEAT_RADIUS_FACTOR, imageDim * HEAT_RADIUS_CAP), 12);

  if (zone.boundingBox) {
    const bw = zone.boundingBox.width * imgWidth;
    const bh = zone.boundingBox.height * imgHeight;
    return {
      cx: zone.boundingBox.x * imgWidth + bw / 2,
      cy: zone.boundingBox.y * imgHeight + bh / 2,
      rx: radius(bw, imgWidth),
      ry: radius(bh, imgHeight),
    };
  }
  if (zone.polygon && zone.polygon.length >= 3) {
    const xs = zone.polygon.map((p) => p.x * imgWidth);
    const ys = zone.polygon.map((p) => p.y * imgHeight);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      rx: radius(maxX - minX, imgWidth),
      ry: radius(maxY - minY, imgHeight),
    };
  }
  return null;
}

function drawHeatZone(
  ctx: Ctx,
  zone: DamageZone,
  imgWidth: number,
  imgHeight: number
): void {
  const geo = resolveZoneGeometry(zone, imgWidth, imgHeight);
  if (!geo) return;

  const intensity = zone.heatmap?.intensity ?? severityToIntensity(zone.severity);
  const color =
    zone.heatmap?.colorHint === "blue"
      ? heatColorForHint("blue")
      : heatColorForIntensity(intensity);

  const radius = Math.max(geo.rx, geo.ry);
  const gradient = ctx.createRadialGradient(
    geo.cx,
    geo.cy,
    radius * 0.1,
    geo.cx,
    geo.cy,
    radius
  );
  gradient.addColorStop(0, color.center);
  gradient.addColorStop(0.55, color.mid);
  gradient.addColorStop(1, color.edge);

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(geo.cx, geo.cy, geo.rx, geo.ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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
    const bx = zone.boundingBox.x * imgWidth;
    const by = zone.boundingBox.y * imgHeight;
    const bw = zone.boundingBox.width * imgWidth;
    const bh = zone.boundingBox.height * imgHeight;

    // Dashed outline around the visible damage zone.
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([lineWidth * 4, lineWidth * 3]);
    ctx.strokeRect(bx, by, bw, bh);
    ctx.restore();

    anchorX = bx;
    anchorY = by;
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
 * annotationStyle it renders labeled callout chips (dashed outlines + numbered
 * labels), a translucent heat map (feathered radial blobs colored by visible
 * intensity), or both. A fixed disclaimer banner runs along the bottom. Returns
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
    for (const zone of input.zones) {
      drawHeatZone(ctx, zone, imgWidth, imgHeight);
    }
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
