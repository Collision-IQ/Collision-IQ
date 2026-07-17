import {
  analyzeDamagePhoto,
  disclaimerForAnnotationStyle,
  VISION_AID_DISCLAIMER,
  type AnnotationStyle,
  type DamageZone,
} from "@/lib/ai/visionDamageAnnotation";
import { renderDamageOverlay } from "@/lib/ai/renderDamageOverlay";
import { normalizeDamageImage } from "@/lib/ai/damageImageNormalization";
import { DAMAGE_SEGMENTATION_MODEL, segmentVisibleDamage, type MaskRejection } from "@/lib/ai/damageSegmentation";

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
  originalImageDataUrl: string;
  overlayAvailable: boolean;
  overlayMessage?: string;
  maskRejections: MaskRejection[];
  processingMetadata: {
    sourceHash: string; naturalWidth: number; naturalHeight: number;
    originalOrientation: number; normalizedOrientation: 1; falModel: string;
    promptVersion: string; requestId?: string; generatedAt: string;
  };
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
  const normalized = await normalizeDamageImage(input.renderSource);
  const analysis = await analyzeDamagePhoto({
    imageUrls: [normalized.dataUrl],
    userPrompt: input.prompt,
    vehicleContext: input.vehicleContext,
    estimateContext: input.estimateContext,
    annotationStyle: input.annotationStyle,
    model: input.model,
  });

  const overlayDisclaimer = disclaimerForAnnotationStyle(input.annotationStyle);
  let masks = [] as Awaited<ReturnType<typeof segmentVisibleDamage>>["masks"];
  let maskRejections: MaskRejection[] = [];
  let requestId: string | undefined;
  if (input.annotationStyle === "heatmap" || input.annotationStyle === "combined") {
    try {
      const segmented = await segmentVisibleDamage({ imageDataUrl: normalized.dataUrl, sourceHash: normalized.sourceHash, width: normalized.naturalWidth, height: normalized.naturalHeight, zones: analysis.zones });
      masks = segmented.masks; maskRejections = segmented.rejected; requestId = segmented.requestId;
    } catch (error) {
      maskRejections = [{ index: -1, reason: error instanceof Error ? error.message : "segmentation-failed" }];
      console.warn("[damage-segmentation] visual overlay unavailable", { model: DAMAGE_SEGMENTATION_MODEL, message: maskRejections[0].reason });
    }
  }
  const pngBuffer = await renderDamageOverlay({
    imageSource: normalized.buffer,
    zones: analysis.zones,
    masks,
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
    originalImageDataUrl: normalized.dataUrl,
    overlayAvailable: input.annotationStyle === "callout" || masks.length > 0,
    ...(input.annotationStyle !== "callout" && masks.length === 0 ? { overlayMessage: "Visible damage area could not be localized with sufficient confidence." } : {}),
    maskRejections,
    processingMetadata: {
      sourceHash: normalized.sourceHash, naturalWidth: normalized.naturalWidth, naturalHeight: normalized.naturalHeight,
      originalOrientation: normalized.originalOrientation, normalizedOrientation: 1,
      falModel: DAMAGE_SEGMENTATION_MODEL, promptVersion: "visible-damage-v2", requestId, generatedAt: new Date().toISOString(),
    },
  };
}
