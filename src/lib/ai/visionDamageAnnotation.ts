import { fal } from "@fal-ai/client";
import {
  FalConfigurationError,
  FalUpstreamError,
} from "@/lib/ai/falOpenrouterVision";

// Re-exported so consumers (the annotate route) can map provider errors without
// reaching into the queue-based vision module directly.
export { FalConfigurationError, FalUpstreamError } from "@/lib/ai/falOpenrouterVision";

const FAL_VISION_QUEUE = "openrouter/router/vision";
const DEFAULT_VISION_MODEL_FALLBACK = "google/gemini-2.5-flash";
const MAX_IMAGES = 10;

/**
 * Single label rendered onto every annotated artifact and surfaced to the
 * client. The annotation pipeline is an aid, not a measurement of record.
 */
export const VISION_AID_DISCLAIMER =
  "AI-generated visual aid. Not a forensic reconstruction. Not a substitute for inspection, measurement, scan, calibration, OEM procedure, or repair documentation.";

/** The overlay styles the annotator can render on top of the original photo. */
export type AnnotationStyle = "callout" | "heatmap" | "combined";

/** Short, style-specific disclaimer stamped on the artifact and returned to chat. */
export function disclaimerForAnnotationStyle(style: AnnotationStyle): string {
  return style === "heatmap"
    ? "AI visual aid — visible damage heat map only. Not a forensic measurement."
    : "AI visual aid — visible damage annotation only. Not a forensic measurement.";
}

export type DamageZoneConfidence = number;
export type DamageZoneSeverity = "high" | "medium" | "low";
export type DamageZoneColorHint = "red" | "orange" | "yellow" | "blue";

/** Normalized 0-1 box, origin at the image top-left. */
export type DamageZoneBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Normalized 0-1 polygon point, origin at the image top-left. */
export type DamageZonePolygonPoint = { x: number; y: number };

/** Heat-map hint for a zone. intensity is a visual-only 0-1 concentration value. */
export type DamageZoneHeatmap = {
  intensity: number;
  radius?: number;
  colorHint?: DamageZoneColorHint;
};

export type DamageZone = {
  id?: string;
  label: string;
  partName?: string;
  componentName?: string;
  damageType?: "missing" | "displaced" | "deformed" | "cracked" | "torn" | "scuffed" | "broken" | "unknown";
  visibleEvidence?: string;
  positivePoints?: DamageZonePolygonPoint[];
  negativePoints?: DamageZonePolygonPoint[];
  segmentationPrompt?: string;
  description: string;
  confidence: DamageZoneConfidence;
  severity: DamageZoneSeverity;
  approximateLocation: string;
  evidenceLimits: string;
  boundingBox?: DamageZoneBoundingBox;
  polygon?: DamageZonePolygonPoint[];
  heatmap?: DamageZoneHeatmap;
};

export type DamageAnnotationResult = {
  summary: string;
  zones: DamageZone[];
  notEstablished: string[];
  recommendedNextPhotos: string[];
};

export type AnalyzeDamagePhotoInput = {
  imageUrls: string[];
  userPrompt?: string;
  vehicleContext?: string;
  estimateContext?: string;
  model?: string;
  /** Influences the vision prompt (heat-map modes request intensity hints). */
  annotationStyle?: AnnotationStyle;
};

export class VisionAnnotationValidationError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "VisionAnnotationValidationError";
    this.code = code;
  }
}

export class VisionAnnotationParseError extends Error {
  details?: unknown;
  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "VisionAnnotationParseError";
    this.details = details;
  }
}

let configuredKey: string | null = null;

function configureFalClient(): void {
  const key = process.env.FAL_KEY?.trim();
  if (!key) {
    throw new FalConfigurationError("FAL_KEY is not configured.");
  }
  if (key !== configuredKey) {
    fal.config({ credentials: key });
    configuredKey = key;
  }
}

function normalizeModel(value: string | undefined): string {
  return (
    value?.trim() ||
    process.env.FAL_OPENROUTER_VISION_MODEL?.trim() ||
    DEFAULT_VISION_MODEL_FALLBACK
  );
}

function buildSystemPrompt(annotationStyle: AnnotationStyle): string {
  const wantsHeatmap = annotationStyle === "heatmap" || annotationStyle === "combined";
  return [
    "You are a collision damage analyst examining photographs of a damaged vehicle.",
    "Return ONLY a single JSON object and nothing else — no prose, no markdown fences.",
    "The JSON must match this exact schema:",
    "{",
    '  "summary": string,',
    '  "zones": [',
    "    {",
    '      "label": string,',
    '      "id": string,',
    '      "componentName": string,',
    '      "damageType": "missing" | "displaced" | "deformed" | "cracked" | "torn" | "scuffed" | "broken" | "unknown",',
    '      "visibleEvidence": string,',
    '      "positivePoints": [{ "x": number, "y": number }],',
    '      "negativePoints": [{ "x": number, "y": number }],',
    '      "segmentationPrompt": string,',
    '      "description": string,',
    '      "confidence": number,',
    '      "severity": "high" | "medium" | "low",',
    '      "approximateLocation": string,',
    '      "evidenceLimits": string,',
    '      "boundingBox": { "xMin": number, "yMin": number, "xMax": number, "yMax": number }' +
      (wantsHeatmap ? "," : ""),
    ...(wantsHeatmap
      ? ['      "heatmap": { "intensity": number, "colorHint": "red" | "orange" | "yellow" | "blue" }']
      : []),
    "    }",
    "  ],",
    '  "notEstablished": string[],',
    '  "recommendedNextPhotos": string[]',
    "}",
    "Rules:",
    "- confidence is a number from 0 through 1. boundingBox is OPTIONAL. Use normalized xMin/yMin/xMax/yMax coordinates in [0,1], origin top-left, with each minimum strictly less than its maximum.",
    "- Draw a TIGHT boundingBox around ONLY the visibly damaged area (the specific dent, crease, scrape, scuff, or crush) — not the whole panel or the whole side of the vehicle. Prefer several small, localized zones over one large box. A box wider than ~0.35 or taller than ~0.35 of the image is almost always too large; shrink it to the actual damage.",
    "- Identify only exterior damage directly visible in the photograph. Do not highlight an entire panel merely because a neighboring component is damaged. Do not infer hidden structural, mechanical, restraint, or ADAS damage. Return tight boxes around visible deformation, displacement, breakage, missing components, cracks, tears, or impact scuffs.",
    "- For every boundingBox, provide at least one positivePoint on directly visible damaged material, a broken edge, missing-component opening, torn/displaced component, or impact scuff. Do not blindly use the box center.",
    "- Add negativePoints on nearby intact hood, glass, headlamp, wheel, cabin, or background when needed to keep segmentation from expanding. All points use normalized coordinates in [0,1].",
    "- segmentationPrompt must specifically name the visible component and damage inside this region. Never use generic prompts such as vehicle, collision, car damage, damaged car, or wheel.",
    "- Estimator markup may help locate an area, but markup alone does not establish that every pixel or the entire panel is visibly damaged.",
    "- Do NOT mark clearly undamaged, unmarked areas: glossy/reflective paint with no mark, reflections of other cars/trees/sky, shadows, wheels, tires, glass, badges, or background. Away from estimator markings, only mark genuine visible deformation or surface damage on this vehicle.",
    "- Keep each label short enough for an image callout (a few words).",
    "- confidence reflects how clearly the photo supports the finding; severity reflects how severe the apparent damage is.",
    "- Be conservative. Do not invent damage that is not visible. Do not infer hidden, structural, sensor, suspension, or mechanical damage unless it is visibly apparent. Do not make legal conclusions. Put anything you cannot determine from the photo in notEstablished.",
    "- recommendedNextPhotos lists additional angles/photos that would resolve uncertainty.",
    ...(wantsHeatmap
      ? [
          "- heatmap.intensity is a VISUAL-ONLY 0-1 concentration hint, not a measurement. Use higher intensity only for visibly stronger dents, creases, buckling, or deformation; use lower intensity for scratches, scuffs, possible adjacent-panel involvement, or verify-only areas.",
          "- Intensity guidance: high visible deformation 0.85-1.0; medium denting/creasing 0.60-0.84; light scratches/scuffs or possible adjacent involvement 0.30-0.59; uncertain/verify-only 0.15-0.29.",
          "- An estimator-marked location outranks the raw surface appearance: a mark reading 'REPLACE' or a bold 'X' should use intensity 0.80-1.0 (colorHint 'red'); a traced scratch/scuff line 0.45-0.65 (colorHint 'orange'/'yellow'); a mark that only says to verify/inspect 0.15-0.29 (colorHint 'blue') — even if the bare paint looks subtle.",
        ]
      : []),
  ].join("\n");
}

function buildUserPrompt(input: AnalyzeDamagePhotoInput): string {
  const parts: string[] = [
    "Analyze the attached vehicle photo(s) for visible damage and return the JSON object described in the system instructions.",
  ];
  if (input.vehicleContext?.trim()) {
    parts.push(`Vehicle context: ${input.vehicleContext.trim()}`);
  }
  if (input.estimateContext?.trim()) {
    parts.push(`Estimate context: ${input.estimateContext.trim()}`);
  }
  if (input.userPrompt?.trim()) {
    parts.push(`Additional instructions from the user: ${input.userPrompt.trim()}`);
  }
  return parts.join("\n\n");
}

function validateInput(input: AnalyzeDamagePhotoInput): string[] {
  const urls = (input.imageUrls ?? []).filter(
    (u): u is string => typeof u === "string" && u.trim().length > 0
  );
  if (urls.length === 0) {
    throw new VisionAnnotationValidationError(
      "imageUrls must contain at least one non-empty string",
      "IMAGE_URLS_REQUIRED"
    );
  }
  if (urls.length > MAX_IMAGES) {
    throw new VisionAnnotationValidationError(
      `imageUrls may contain at most ${MAX_IMAGES} items`,
      "TOO_MANY_IMAGES"
    );
  }
  return urls.map((u) => u.trim());
}

/** Pull the first balanced JSON object out of a model response. */
function extractJsonObject(raw: string): string {
  const withoutFences = raw
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new VisionAnnotationParseError(
      "Model response did not contain a JSON object",
      raw.slice(0, 500)
    );
  }
  return withoutFences.slice(start, end + 1);
}

function coerceEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    const match = allowed.find((a) => a === lowered);
    if (match) return match;
  }
  return fallback;
}

function coerceString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => coerceString(item))
    .filter((item) => item.length > 0);
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function coerceBoundingBox(value: unknown): DamageZoneBoundingBox | undefined {
  if (!value || typeof value !== "object") return undefined;
  const box = value as Record<string, unknown>;
  const hasCorners = ["xMin", "yMin", "xMax", "yMax"].every((key) => typeof box[key] === "number");
  const nums = hasCorners
    ? [box.xMin, box.yMin, (box.xMax as number) - (box.xMin as number), (box.yMax as number) - (box.yMin as number)]
    : ["x", "y", "width", "height"].map((key) => box[key]);
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return undefined;
  }
  const [x, y, width, height] = nums as number[];
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x > 1 || y > 1 || x + width > 1 || y + height > 1) return undefined;
  return {
    x, y, width, height,
  };
}

function coercePolygon(value: unknown): DamageZonePolygonPoint[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const points = value
    .map((point) => {
      if (!point || typeof point !== "object") return null;
      const p = point as Record<string, unknown>;
      if (typeof p.x !== "number" || typeof p.y !== "number") return null;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
      return { x: clamp01(p.x), y: clamp01(p.y) };
    })
    .filter((p): p is DamageZonePolygonPoint => p !== null);
  return points.length >= 3 ? points : undefined;
}

function coercePoints(value: unknown): DamageZonePolygonPoint[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const points = value.map((point) => {
    if (!point || typeof point !== "object") return null;
    const p = point as Record<string, unknown>;
    if (typeof p.x !== "number" || typeof p.y !== "number" || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return null;
    return { x: p.x, y: p.y };
  }).filter((point): point is DamageZonePolygonPoint => point !== null);
  return points.length ? points : undefined;
}

function coerceHeatmap(value: unknown): DamageZoneHeatmap | undefined {
  if (!value || typeof value !== "object") return undefined;
  const hm = value as Record<string, unknown>;
  const intensity =
    typeof hm.intensity === "number" && Number.isFinite(hm.intensity)
      ? clamp01(hm.intensity)
      : undefined;
  const radius =
    typeof hm.radius === "number" && Number.isFinite(hm.radius) && hm.radius > 0
      ? hm.radius
      : undefined;
  const colorHint = coerceEnum(
    hm.colorHint,
    ["red", "orange", "yellow", "blue"] as const,
    "red"
  );
  const hasColorHint = typeof hm.colorHint === "string";
  if (intensity === undefined && radius === undefined && !hasColorHint) return undefined;
  return {
    intensity: intensity ?? 0.5,
    ...(radius !== undefined ? { radius } : {}),
    ...(hasColorHint ? { colorHint } : {}),
  };
}

function coerceZone(value: unknown): DamageZone | null {
  if (!value || typeof value !== "object") return null;
  const zone = value as Record<string, unknown>;
  const label = coerceString(zone.label) || coerceString(zone.name);
  const description = coerceString(zone.description);
  if (!label && !description) return null;
  return {
    id: coerceString(zone.id) || undefined,
    label: label || "Unlabeled zone",
    partName: coerceString(zone.partName) || label || undefined,
    componentName: coerceString(zone.componentName) || coerceString(zone.partName) || label || undefined,
    damageType: coerceEnum(zone.damageType, ["missing", "displaced", "deformed", "cracked", "torn", "scuffed", "broken", "unknown"] as const, "unknown"),
    visibleEvidence: coerceString(zone.visibleEvidence) || description || undefined,
    positivePoints: coercePoints(zone.positivePoints),
    negativePoints: coercePoints(zone.negativePoints),
    segmentationPrompt: coerceString(zone.segmentationPrompt) || undefined,
    description,
    confidence: typeof zone.confidence === "number" && Number.isFinite(zone.confidence)
      ? clamp01(zone.confidence)
      : coerceEnum(zone.confidence, ["high", "medium", "low"] as const, "low") === "high" ? 0.9
        : coerceEnum(zone.confidence, ["high", "medium", "low"] as const, "low") === "medium" ? 0.65 : 0.4,
    severity: coerceEnum(zone.severity, ["high", "medium", "low"] as const, "low"),
    approximateLocation: coerceString(zone.approximateLocation),
    evidenceLimits: coerceString(zone.evidenceLimits),
    boundingBox: coerceBoundingBox(zone.boundingBox),
    polygon: coercePolygon(zone.polygon),
    heatmap: coerceHeatmap(zone.heatmap),
  };
}

export function parseDamageAnnotationResponse(raw: string): DamageAnnotationResult {
  const json = extractJsonObject(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new VisionAnnotationParseError(
      "Model response was not valid JSON",
      error instanceof Error ? error.message : String(error)
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new VisionAnnotationParseError("Model response was not a JSON object", json.slice(0, 500));
  }
  const obj = parsed as Record<string, unknown>;
  const summary = coerceString(obj.summary);
  const zones = Array.isArray(obj.zones)
    ? obj.zones.map(coerceZone).filter((z): z is DamageZone => z !== null)
    : [];
  if (!summary && zones.length === 0) {
    throw new VisionAnnotationParseError(
      "Model response contained no usable summary or zones",
      json.slice(0, 500)
    );
  }
  return {
    summary,
    zones,
    notEstablished: coerceStringArray(obj.notEstablished),
    recommendedNextPhotos: coerceStringArray(obj.recommendedNextPhotos),
  };
}

function wrapUpstreamError(error: unknown, context: string): never {
  const rec = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
  const statusCode = typeof rec?.status === "number" ? rec.status : undefined;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : `fal upstream error (${context})`;
  throw new FalUpstreamError(message, { statusCode, details: error });
}

/**
 * Synchronously run the vision model and parse a structured damage annotation.
 * Throws FalConfigurationError (missing key), VisionAnnotationValidationError
 * (bad input), VisionAnnotationParseError (unusable output) or FalUpstreamError.
 */
export async function analyzeDamagePhoto(
  input: AnalyzeDamagePhotoInput
): Promise<DamageAnnotationResult> {
  const imageUrls = validateInput(input);
  configureFalClient();

  let output: string;
  try {
    const response = await fal.subscribe(FAL_VISION_QUEUE, {
      input: {
        image_urls: imageUrls,
        prompt: buildUserPrompt(input),
        system_prompt: buildSystemPrompt(input.annotationStyle ?? "callout"),
        model: normalizeModel(input.model),
        temperature: 0.1,
      } as never,
      logs: false,
    });
    const data = response.data as Record<string, unknown>;
    if (typeof data?.output !== "string") {
      throw new VisionAnnotationParseError(
        "Vision result did not include a string output",
        response.data
      );
    }
    output = data.output;
  } catch (error) {
    if (
      error instanceof FalConfigurationError ||
      error instanceof VisionAnnotationParseError ||
      error instanceof VisionAnnotationValidationError
    ) {
      throw error;
    }
    wrapUpstreamError(error, "subscribe");
  }

  return parseDamageAnnotationResponse(output);
}
