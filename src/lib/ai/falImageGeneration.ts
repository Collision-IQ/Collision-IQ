import { fal } from "@fal-ai/client";
export {
  FAL_POLL_ATTEMPTS,
  FAL_POLL_INTERVAL_MS,
  isFalCompleted,
  isFalFailed,
  pollFalStatus,
} from "./falPolling";

const FAL_KREA_MODEL = "fal-ai/krea-2/turbo";

const VALID_SIZE_ENUMS = new Set([
  "square_hd",
  "square",
  "portrait_4_3",
  "portrait_16_9",
  "landscape_4_3",
  "landscape_16_9",
]);
const MIN_DIMENSION = 256;
const MAX_DIMENSION = 2048;
const MAX_IMAGES = 4;

export type FalImageSize =
  | "square_hd"
  | "square"
  | "portrait_4_3"
  | "portrait_16_9"
  | "landscape_4_3"
  | "landscape_16_9"
  | { width: number; height: number };

export type FalImageGenerationInput = {
  prompt: string;
  imageSize?: FalImageSize;
  numImages?: number;
  seed?: number;
  acceleration?: "none" | "regular";
  enablePromptExpansion?: boolean;
  enableSafetyChecker?: boolean;
  outputFormat?: "png" | "jpeg";
  syncMode?: boolean;
};

export type FalGeneratedImage = {
  url: string;
  width: number;
  height: number;
  content_type: string;
};

export type FalImageGenerationResult = {
  images: FalGeneratedImage[];
  seed?: number;
  has_nsfw_concepts?: boolean[];
  prompt?: string;
};

export class FalImageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FalImageConfigurationError";
  }
}

export class FalImageValidationError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "FalImageValidationError";
    this.code = code;
  }
}

export class FalImageUpstreamError extends Error {
  statusCode?: number;
  details?: unknown;
  constructor(message: string, options?: { statusCode?: number; details?: unknown }) {
    super(message);
    this.name = "FalImageUpstreamError";
    this.statusCode = options?.statusCode;
    this.details = options?.details;
  }
}

let configuredKey: string | null = null;

function getFalApiKey(): string {
  const key = process.env.FAL_KEY?.trim();
  if (!key) throw new FalImageConfigurationError("FAL_KEY is not configured.");
  return key;
}

function configureFalClient(): void {
  const key = getFalApiKey();
  if (key !== configuredKey) {
    fal.config({ credentials: key });
    configuredKey = key;
  }
}

function resolveImageSize(raw: unknown): FalImageSize {
  if (raw === undefined || raw === null) return "landscape_16_9";

  if (typeof raw === "string") {
    if (VALID_SIZE_ENUMS.has(raw)) return raw as FalImageSize;
    throw new FalImageValidationError(
      `imageSize must be one of: ${[...VALID_SIZE_ENUMS].join(", ")} or a {width, height} object`,
      "INVALID_IMAGE_SIZE"
    );
  }

  if (typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.width !== "number" || typeof obj.height !== "number") {
      throw new FalImageValidationError(
        "imageSize object must have numeric width and height",
        "INVALID_IMAGE_SIZE"
      );
    }
    if (
      obj.width < MIN_DIMENSION ||
      obj.width > MAX_DIMENSION ||
      obj.height < MIN_DIMENSION ||
      obj.height > MAX_DIMENSION
    ) {
      throw new FalImageValidationError(
        `imageSize dimensions must be between ${MIN_DIMENSION} and ${MAX_DIMENSION}`,
        "INVALID_IMAGE_SIZE"
      );
    }
    return { width: obj.width as number, height: obj.height as number };
  }

  throw new FalImageValidationError(
    "imageSize must be a string enum or {width, height} object",
    "INVALID_IMAGE_SIZE"
  );
}

type ValidatedInput = {
  prompt: string;
  imageSize: FalImageSize;
  numImages: number;
  acceleration: "none" | "regular";
  outputFormat: "png" | "jpeg";
};

function validateInput(raw: Record<string, unknown>): ValidatedInput {
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  if (!prompt) {
    throw new FalImageValidationError("prompt must be a non-empty string", "PROMPT_REQUIRED");
  }

  const imageSize = resolveImageSize(raw.imageSize);

  const numImagesRaw = raw.numImages ?? 1;
  if (
    typeof numImagesRaw !== "number" ||
    !Number.isInteger(numImagesRaw) ||
    numImagesRaw < 1 ||
    numImagesRaw > MAX_IMAGES
  ) {
    throw new FalImageValidationError(
      `numImages must be an integer between 1 and ${MAX_IMAGES}`,
      "INVALID_NUM_IMAGES"
    );
  }

  const acceleration = raw.acceleration ?? "none";
  if (acceleration !== "none" && acceleration !== "regular") {
    throw new FalImageValidationError(
      "acceleration must be 'none' or 'regular'",
      "INVALID_ACCELERATION"
    );
  }

  const outputFormat = raw.outputFormat ?? "png";
  if (outputFormat !== "png" && outputFormat !== "jpeg") {
    throw new FalImageValidationError(
      "outputFormat must be 'png' or 'jpeg'",
      "INVALID_OUTPUT_FORMAT"
    );
  }

  return {
    prompt,
    imageSize,
    numImages: numImagesRaw as number,
    acceleration: acceleration as "none" | "regular",
    outputFormat: outputFormat as "png" | "jpeg",
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
  throw new FalImageUpstreamError(message, { statusCode, details: error });
}

export async function submitFalImageGeneration(
  input: FalImageGenerationInput & Record<string, unknown>
): Promise<{ requestId: string }> {
  const validated = validateInput(input as Record<string, unknown>);
  configureFalClient();

  try {
    const response = await fal.queue.submit(FAL_KREA_MODEL, {
      input: {
        prompt: validated.prompt,
        image_size: validated.imageSize,
        num_images: validated.numImages,
        seed: input.seed,
        acceleration: validated.acceleration,
        enable_prompt_expansion: input.enablePromptExpansion,
        enable_safety_checker: input.enableSafetyChecker ?? true,
        output_format: validated.outputFormat,
        sync_mode: input.syncMode,
      } as never,
    });
    return { requestId: response.request_id };
  } catch (error) {
    if (error instanceof FalImageConfigurationError || error instanceof FalImageValidationError) {
      throw error;
    }
    wrapUpstreamError(error, "submit");
  }
}

export async function getFalImageGenerationStatus(
  requestId: string,
  logs = true
): Promise<unknown> {
  configureFalClient();
  try {
    return await fal.queue.status(FAL_KREA_MODEL, { requestId, logs });
  } catch (error) {
    if (error instanceof FalImageConfigurationError) throw error;
    wrapUpstreamError(error, "status");
  }
}

export async function getFalImageGenerationResult(
  requestId: string
): Promise<{ requestId: string; data: FalImageGenerationResult }> {
  configureFalClient();
  try {
    const response = await fal.queue.result(FAL_KREA_MODEL, { requestId });
    const data = response.data as Record<string, unknown>;
    if (!Array.isArray(data?.images)) {
      throw new FalImageUpstreamError("Unexpected result shape: images is not an array", {
        details: response.data,
      });
    }
    return { requestId: response.requestId, data: response.data as FalImageGenerationResult };
  } catch (error) {
    if (error instanceof FalImageConfigurationError || error instanceof FalImageUpstreamError) {
      throw error;
    }
    wrapUpstreamError(error, "result");
  }
}
