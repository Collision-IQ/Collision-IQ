import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";
import { getUploadedAttachments } from "@/lib/uploadedAttachmentStore";
import {
  FalConfigurationError,
  disclaimerForAnnotationStyle,
} from "@/lib/ai/visionDamageAnnotation";
import { runDamageAnnotation, coerceAnnotationStyle } from "@/lib/ai/runDamageAnnotation";
import {
  dataUrlToBuffer,
  normalizeNonEmptyString,
  stringifyVehicleContext,
} from "@/lib/ai/annotateHelpers";

export const runtime = "nodejs";
export const maxDuration = 300;

const HARD_MAX_IMAGES = 10;

type BatchBody = {
  attachmentIds?: unknown;
  annotationStyle?: unknown;
  maxImages?: unknown;
  prompt?: unknown;
  vehicleContext?: unknown;
};

function jsonError(error: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

async function parseBody(req: Request): Promise<BatchBody | null> {
  try {
    return (await req.json()) as BatchBody;
  } catch {
    return null;
  }
}

/**
 * Batch damage annotation: reuse already-uploaded image attachments and return
 * one annotated artifact per photo. Caps at 10 images per pass so a large upload
 * set does not run unbounded; over the cap the caller is asked to narrow down.
 */
export async function POST(req: Request) {
  try {
    const { user, isPlatformAdmin } = await requireCurrentUser();

    const body = await parseBody(req);
    if (!body) return jsonError("INVALID_JSON", 400);

    const ids = Array.isArray(body.attachmentIds)
      ? [...new Set(body.attachmentIds.map((v) => normalizeNonEmptyString(v)).filter((v): v is string => v !== null))]
      : [];
    if (ids.length === 0) {
      return jsonError("ATTACHMENT_IDS_REQUIRED", 400, {
        message: "Provide attachmentIds for already-uploaded photos.",
      });
    }

    const annotationStyle = coerceAnnotationStyle(body.annotationStyle);
    const disclaimer = disclaimerForAnnotationStyle(annotationStyle);
    const requestedMax =
      typeof body.maxImages === "number" && Number.isFinite(body.maxImages)
        ? Math.floor(body.maxImages)
        : HARD_MAX_IMAGES;
    const maxImages = Math.max(1, Math.min(HARD_MAX_IMAGES, requestedMax));

    if (ids.length > maxImages) {
      return NextResponse.json(
        {
          ok: false,
          error: "TOO_MANY_IMAGES",
          count: ids.length,
          maxImages,
          message: `I found ${ids.length} photos. I can create annotations for the most relevant damage photos first, or you can choose specific photos.`,
        },
        { status: 200 }
      );
    }

    const prompt = normalizeNonEmptyString(body.prompt) ?? undefined;
    const vehicleContext = stringifyVehicleContext(body.vehicleContext);

    const attachments = await getUploadedAttachments(ids, { ownerUserId: user.id });
    const byId = new Map(attachments.map((a) => [a.id, a]));

    const results: Array<Record<string, unknown>> = [];
    for (const id of ids) {
      const attachment = byId.get(id);
      if (!attachment || !attachment.imageDataUrl) {
        results.push({ attachmentId: id, ok: false, error: attachment ? "ATTACHMENT_NOT_IMAGE" : "ATTACHMENT_NOT_FOUND" });
        continue;
      }
      try {
        const result = await runDamageAnnotation({
          visionImageUrl: attachment.imageDataUrl,
          renderSource: dataUrlToBuffer(attachment.imageDataUrl) ?? attachment.imageDataUrl,
          prompt,
          vehicleContext,
          annotationStyle,
        });

        let annotatedImageUrl: string | null = null;
        try {
          const stored = await put(
            `vision-annotations/${user.id}/${Date.now()}-${id}.png`,
            result.pngBuffer,
            { access: "public", contentType: "image/png" }
          );
          annotatedImageUrl = stored.url;
        } catch {
          // Non-blocking: the data URL still carries the artifact.
        }

        results.push({
          attachmentId: id,
          ok: true,
          summary: result.summary,
          zones: result.zones,
          notEstablished: result.notEstablished,
          recommendedNextPhotos: result.recommendedNextPhotos,
          annotatedImageDataUrl: result.annotatedImageDataUrl,
          originalImageDataUrl: result.originalImageDataUrl,
          annotatedImageUrl,
          overlayAvailable: result.overlayAvailable,
          overlayMessage: result.overlayMessage,
          processingMetadata: result.processingMetadata,
        });
      } catch (error) {
        if (error instanceof FalConfigurationError) throw error; // whole batch can't run
        console.warn("[vision-annotate-batch] image failed (non-blocking)", {
          ownerUserId: user.id,
          message: error instanceof Error ? error.message : String(error),
        });
        results.push({ attachmentId: id, ok: false, error: "ANNOTATE_FAILED" });
      }
    }

    console.info("[vision-annotate-batch] completed", {
      ownerUserId: user.id,
      isPlatformAdmin,
      annotationStyle,
      requested: ids.length,
      succeeded: results.filter((r) => r.ok).length,
    });

    return NextResponse.json(
      { ok: true, annotationStyle, results, disclaimer },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof FalConfigurationError) {
      return jsonError("FAL_NOT_CONFIGURED", 503);
    }
    console.error("[vision-annotate-batch] failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonError("VISION_ANNOTATE_UPSTREAM_ERROR", 502);
  }
}
