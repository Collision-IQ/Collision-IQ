import {
  analyzeDamagePhoto,
  disclaimerForAnnotationStyle,
  VISION_AID_DISCLAIMER,
  type AnnotationStyle,
  type DamageZone,
} from "@/lib/ai/visionDamageAnnotation";
import { renderDamageOverlay } from "@/lib/ai/renderDamageOverlay";

export const ANNOTATION_STYLES: readonly AnnotationStyle[] = ["callout", "heatmap", "combined"];

export function coerceAnnotationStyle(value: unknown): AnnotationStyle {
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    const match = ANNOTATION_STYLES.find((style) => style === lowered);
    if (match) return match;
  }
  return "callout";
}

export type RunDamageAnnotationInput = {
  /** URL/data URL the vision model fetches. */
  visionImageUrl: string;
  /** What the deterministic renderer draws on (bytes preferred). */
  renderSource: string | Buffer;
  prompt?: string;
  vehicleContext?: string;
  estimateContext?: string;
  annotationStyle: AnnotationStyle;
  model?: string;
};

export type RunDamageAnnotationResult = {
  summary: string;
  zones: DamageZone[];
  notEstablished: string[];
  recommendedNextPhotos: string[];
  annotationStyle: AnnotationStyle;
  disclaimer: string;
  pngBuffer: Buffer;
  annotatedImageDataUrl: string;
};

/**
 * Full annotate pipeline for a single image: run vision to get structured damage
 * zones, then draw deterministic overlays (callout / heatmap / combined) on the
 * ORIGINAL photo. Returns both the raw PNG buffer (for blob persistence) and a
 * self-contained data URL (so callers never depend on blob storage). Never
 * fabricates a replacement image.
 */
export async function runDamageAnnotation(
  input: RunDamageAnnotationInput
): Promise<RunDamageAnnotationResult> {
  const analysis = await analyzeDamagePhoto({
    imageUrls: [input.visionImageUrl],
    userPrompt: input.prompt,
    vehicleContext: input.vehicleContext,
    estimateContext: input.estimateContext,
    annotationStyle: input.annotationStyle,
    model: input.model,
  });

  const overlayDisclaimer = disclaimerForAnnotationStyle(input.annotationStyle);
  const pngBuffer = await renderDamageOverlay({
    imageSource: input.renderSource,
    zones: analysis.zones,
    disclaimer: overlayDisclaimer,
    annotationStyle: input.annotationStyle,
  });

  return {
    summary: analysis.summary,
    zones: analysis.zones,
    notEstablished: analysis.notEstablished,
    recommendedNextPhotos: analysis.recommendedNextPhotos,
    annotationStyle: input.annotationStyle,
    // Surface the style-specific label to the client; VISION_AID_DISCLAIMER
    // remains the artifact's baked-in footer via the renderer.
    disclaimer: overlayDisclaimer || VISION_AID_DISCLAIMER,
    pngBuffer,
    annotatedImageDataUrl: `data:image/png;base64,${pngBuffer.toString("base64")}`,
  };
}
