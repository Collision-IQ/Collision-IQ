import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { UnauthorizedError } from "@/lib/auth/require-current-user";
import { resolveUploadLimitsForCurrentUser } from "@/lib/uploadSafety/uploadEntitlements";
import { validateDirectUploadCandidate } from "@/lib/uploadSafety/directUploadRouting";
import { getUploadExtension, isZipUpload } from "@/lib/uploadSafety/zipSafety";
import { isVideoExtension } from "@/lib/uploadSafety/videoSafety";

export const runtime = "nodejs";

type DirectUploadClientPayload = {
  filename?: string;
  contentType?: string;
  sizeBytes?: number;
  activeCaseId?: string | null;
};

function parseClientPayload(value: string | null): DirectUploadClientPayload {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as DirectUploadClientPayload;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function jsonError(error: string, code: string, status = 400) {
  return NextResponse.json({ error, code }, { status });
}

function getAllowedContentTypes(filename: string, contentType: string) {
  const values = new Set<string>([contentType || "application/octet-stream"]);
  if (isZipUpload({ name: filename, type: contentType })) {
    values.add("application/zip");
    values.add("application/x-zip-compressed");
    values.add("application/octet-stream");
  }
  if (isVideoExtension(getUploadExtension(filename))) {
    values.add("video/mp4");
    values.add("video/quicktime");
    values.add("video/webm");
    values.add("application/octet-stream");
  }
  return Array.from(values);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as HandleUploadBody;
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload, multipart) => {
        const payload = parseClientPayload(clientPayload);
        const filename = payload.filename || pathname.split("/").pop() || pathname;
        const sizeBytes = Number.isFinite(payload.sizeBytes) ? Number(payload.sizeBytes) : 0;
        const contentType = payload.contentType || "application/octet-stream";
        const context = await resolveUploadLimitsForCurrentUser();

        if (!context.canUploadFiles) {
          throw new Error("Uploads are not included in your current plan.");
        }

        const rejection = validateDirectUploadCandidate(
          { name: filename, type: contentType, size: sizeBytes },
          context.uploadLimits
        );
        if (rejection) {
          throw new Error(rejection.reason);
        }

        console.info("[upload-direct] token generated", {
          uploadMode: "direct-storage",
          filename,
          sizeBytes,
          plan: context.uploadLimits.plan,
          multipart,
          activeCaseId: payload.activeCaseId ?? null,
        });

        return {
          allowedContentTypes: getAllowedContentTypes(filename, contentType),
          maximumSizeInBytes: sizeBytes || context.uploadLimits.maxUploadBytes,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            userId: context.user.id,
            filename,
            sizeBytes,
            contentType,
            activeCaseId: payload.activeCaseId ?? null,
            plan: context.uploadLimits.plan,
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        console.info("[upload-direct] upload completed callback", {
          uploadMode: "direct-storage",
          pathname: blob.pathname,
          contentType: blob.contentType,
          tokenPayloadPresent: Boolean(tokenPayload),
        });
      },
    });

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError(error.message, "UNAUTHORIZED", error.status);
    }

    const message = error instanceof Error ? error.message : "Direct upload could not start.";
    console.warn("[upload-direct] token request failed", { message });
    return jsonError(message, "DIRECT_UPLOAD_TOKEN_FAILED", 400);
  }
}
