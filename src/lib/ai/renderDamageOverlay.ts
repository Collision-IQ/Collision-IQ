import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { DamageZone, DamageZoneSeverity } from "@/lib/ai/visionDamageAnnotation";

const SEVERITY_COLORS: Record<DamageZoneSeverity, string> = {
  high: "#dc2626", // red
  medium: "#ea580c", // orange
  low: "#ca8a04", // amber
};

const BANNER_BG = "rgba(15, 23, 42, 0.92)";
const BANNER_TEXT = "#e2e8f0";
const MARKER_TEXT = "#ffffff";

export type RenderDamageOverlayInput = {
  /** Data URL, http(s) URL, or raw image bytes. */
  imageSource: string | Buffer | Uint8Array;
  zones: DamageZone[];
  disclaimer: string;
};

function wrapText(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  text: string,
  maxWidth: number
): string[] {
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

/**
 * Draw deterministic damage-zone overlays onto the source image. Numbered
 * markers and (when available) normalized bounding boxes are rendered, colored
 * by severity, with a fixed disclaimer banner along the bottom. Returns a PNG
 * buffer. This never fabricates a replacement image — it only annotates pixels
 * that already exist.
 */
export async function renderDamageOverlay(
  input: RenderDamageOverlayInput
): Promise<Buffer> {
  const image = await loadImage(input.imageSource);
  const imgWidth = image.width;
  const imgHeight = image.height;

  // Reserve a banner whose height scales with the image so text stays legible.
  const baseFont = Math.max(14, Math.round(imgWidth / 55));
  const bannerPadding = Math.round(baseFont * 0.8);
  const bannerLineHeight = Math.round(baseFont * 1.35);

  // Measure disclaimer wrapping using a temp context before sizing the canvas.
  const probe = createCanvas(imgWidth, 10).getContext("2d");
  probe.font = `${baseFont}px sans-serif`;
  const disclaimerLines = wrapText(
    probe,
    input.disclaimer,
    imgWidth - bannerPadding * 2
  );
  const bannerHeight =
    bannerPadding * 2 + disclaimerLines.length * bannerLineHeight;

  const canvas = createCanvas(imgWidth, imgHeight + bannerHeight);
  const ctx = canvas.getContext("2d");

  // Base photo.
  ctx.drawImage(image, 0, 0, imgWidth, imgHeight);

  // Damage zones.
  const lineWidth = Math.max(2, Math.round(imgWidth / 350));
  const markerRadius = Math.max(12, Math.round(imgWidth / 45));
  const markerFont = Math.round(markerRadius * 1.1);

  input.zones.forEach((zone, index) => {
    const number = index + 1;
    const color = SEVERITY_COLORS[zone.severity] ?? SEVERITY_COLORS.low;

    let markerX: number;
    let markerY: number;

    if (zone.boundingBox) {
      const bx = zone.boundingBox.x * imgWidth;
      const by = zone.boundingBox.y * imgHeight;
      const bw = zone.boundingBox.width * imgWidth;
      const bh = zone.boundingBox.height * imgHeight;

      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.strokeRect(bx, by, bw, bh);

      markerX = bx + markerRadius;
      markerY = by + markerRadius;
    } else {
      // No box: stack markers down the left margin so every zone is shown.
      markerX = markerRadius + lineWidth;
      markerY = markerRadius + lineWidth + index * (markerRadius * 2.4);
    }

    // Numbered marker disc.
    ctx.beginPath();
    ctx.arc(markerX, markerY, markerRadius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = MARKER_TEXT;
    ctx.font = `bold ${markerFont}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(number), markerX, markerY);
  });

  // Disclaimer banner.
  ctx.fillStyle = BANNER_BG;
  ctx.fillRect(0, imgHeight, imgWidth, bannerHeight);
  ctx.fillStyle = BANNER_TEXT;
  ctx.font = `${baseFont}px sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  disclaimerLines.forEach((line, i) => {
    ctx.fillText(
      line,
      bannerPadding,
      imgHeight + bannerPadding + i * bannerLineHeight
    );
  });

  return canvas.encode("png");
}
