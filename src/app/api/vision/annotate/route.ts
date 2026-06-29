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
  VISION_AID_DISCLAIMER,
  analyzeDamagePhoto,
} from "@/lib/ai/visionDamageAnnotation";
import { renderDamageOverlay } from "@/lib/ai/renderDamageOverlay";

export const runtime = "nodejs";
export const maxDuration = 120;

type AnnotateBody = {
  attachmentId?: unknown;
  imageUrl?: unknown;
  prompt?: unknown;
  vehicleContext?: unknown;
  estimateContext?: unknown;
};

function jsonError(error: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function parseBody(req: Request): Promise<AnnotateBody | null> {
  try {
    return (await req.json()) as AnnotateBody;
  } catch {
    return null;
  }
}

/** Decode a data URL into raw bytes for the renderer. */
function dataUrlToBuffer(dataUrl: string): Buffer | null {
  const match = /^data:[^;,]+;base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  try {
    return Buffer.from(match[1], "base64");
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
    const directImageUrl = normalizeNonEmptyString(body.imageUrl);

    // Resolve the image: an owned attachment id, or a directly supplied URL.
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
    } else if (directImageUrl) {
      visionImageUrl = directImageUrl;
      renderSource = directImageUrl;
    } else {
      return jsonError("IMAGE_REQUIRED", 400, {
        message: "Provide either an attachmentId or an imageUrl.",
      });
    }

    const analysis = await analyzeDamagePhoto({
      imageUrls: [visionImageUrl],
      userPrompt: normalizeNonEmptyString(body.prompt) ?? undefined,
      vehicleContext: normalizeNonEmptyString(body.vehicleContext) ?? undefined,
      estimateContext: normalizeNonEmptyString(body.estimateContext) ?? undefined,
    });

    const overlayPng = await renderDamageOverlay({
      imageSource: renderSource,
      zones: analysis.zones,
      disclaimer: VISION_AID_DISCLAIMER,
    });

    // Persist the artifact so it can be inserted into customer reports.
    let annotatedImageUrl: string | null = null;
    const warnings: string[] = [];
    try {
      const pathname = `vision-annotations/${user.id}/${Date.now()}.png`;
      const stored = await put(pathname, overlayPng, {
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
      zoneCount: analysis.zones.length,
      artifactSaved: annotatedImageUrl !== null,
    });

    return NextResponse.json(
      {
        ok: true,
        summary: analysis.summary,
        zones: analysis.zones,
        notEstablished: analysis.notEstablished,
        recommendedNextPhotos: analysis.recommendedNextPhotos,
        annotatedImageUrl,
        disclaimer: VISION_AID_DISCLAIMER,
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
