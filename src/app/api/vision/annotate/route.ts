import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";
import { getUploadedAttachments } from "@/lib/uploadedAttachmentStore";
import {
  FalConfigurationError,
  VisionAnnotationValidationError,
} from "@/lib/ai/visionDamageAnnotation";
import { runDamageAnnotation, coerceAnnotationStyle } from "@/lib/ai/runDamageAnnotation";
import {
  dataUrlToBuffer,
  normalizeNonEmptyString,
  stringifyVehicleContext,
} from "@/lib/ai/annotateHelpers";

export const runtime = "nodejs";
export const maxDuration = 120;

type AnnotateBody = {
  attachmentId?: unknown;
  imageUrl?: unknown;
  imageDataUrl?: unknown;
  prompt?: unknown;
  vehicleContext?: unknown;
  estimateContext?: unknown;
  annotationStyle?: unknown;
};

function jsonError(error: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

async function parseBody(req: Request): Promise<AnnotateBody | null> {
  try {
    return (await req.json()) as AnnotateBody;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const { user, isPlatformAdmin } = await requireCurrentUser();

    const body = await parseBody(req);
    if (!body) {
      return jsonError("INVALID_JSON", 400);
    }

    const attachmentId = normalizeNonEmptyString(body.attachmentId);
    const directImageDataUrl = normalizeNonEmptyString(body.imageDataUrl);
    const directImageUrl = normalizeNonEmptyString(body.imageUrl);
    const annotationStyle = coerceAnnotationStyle(body.annotationStyle);

    // Resolve the image: an owned attachment id, a data URL, or a remote URL.
    let visionImageUrl: string; // what the vision model fetches
    let renderSource: string | Buffer; // what the renderer draws on

    if (attachmentId) {
      const [attachment] = await getUploadedAttachments([attachmentId], {
        ownerUserId: user.id,
      });
      if (!attachment) {
        return jsonError("ATTACHMENT_NOT_FOUND", 404);
      }
      if (!attachment.imageDataUrl) {
        return jsonError("ATTACHMENT_NOT_IMAGE", 400, {
          message: "The referenced attachment has no image data to annotate.",
        });
      }
      visionImageUrl = attachment.imageDataUrl;
      renderSource = dataUrlToBuffer(attachment.imageDataUrl) ?? attachment.imageDataUrl;
    } else if (directImageDataUrl) {
      visionImageUrl = directImageDataUrl;
      renderSource = dataUrlToBuffer(directImageDataUrl) ?? directImageDataUrl;
    } else if (directImageUrl) {
      visionImageUrl = directImageUrl;
      renderSource = directImageUrl;
    } else {
      return jsonError("IMAGE_REQUIRED", 400, {
        message: "Provide an attachmentId, an imageDataUrl, or an imageUrl.",
      });
    }

    const result = await runDamageAnnotation({
      visionImageUrl,
      renderSource,
      prompt: normalizeNonEmptyString(body.prompt) ?? undefined,
      vehicleContext: stringifyVehicleContext(body.vehicleContext),
      estimateContext: normalizeNonEmptyString(body.estimateContext) ?? undefined,
      annotationStyle,
    });

    // Persist the artifact so it can be inserted into customer reports.
    let annotatedImageUrl: string | null = null;
    const warnings: string[] = [];
    try {
      const pathname = `vision-annotations/${user.id}/${Date.now()}.png`;
      const stored = await put(pathname, result.pngBuffer, {
        access: "public",
        contentType: "image/png",
      });
      annotatedImageUrl = stored.url;
    } catch (error) {
      warnings.push("ARTIFACT_SAVE_FAILED");
      console.warn("[vision-annotate] artifact save failed (non-blocking)", {
        ownerUserId: user.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    console.info("[vision-annotate] completed", {
      ownerUserId: user.id,
      isPlatformAdmin,
      annotationStyle,
      zoneCount: result.zones.length,
      artifactSaved: annotatedImageUrl !== null,
    });

    return NextResponse.json(
      {
        ok: true,
        summary: result.summary,
        annotationStyle: result.annotationStyle,
        zones: result.zones,
        notEstablished: result.notEstablished,
        recommendedNextPhotos: result.recommendedNextPhotos,
        annotatedImageDataUrl: result.annotatedImageDataUrl,
        originalImageDataUrl: result.originalImageDataUrl,
        annotatedImageUrl,
        disclaimer: result.disclaimer,
        overlayAvailable: result.overlayAvailable,
        overlayMessage: result.overlayMessage,
        processingMetadata: result.processingMetadata,
        ...(warnings.length ? { warnings } : {}),
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof FalConfigurationError) {
      return jsonError("FAL_NOT_CONFIGURED", 503);
    }
    if (error instanceof VisionAnnotationValidationError) {
      return jsonError(error.code, 400, { message: error.message });
    }

    console.error("[vision-annotate] failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonError("VISION_ANNOTATE_UPSTREAM_ERROR", 502);
  }
}
