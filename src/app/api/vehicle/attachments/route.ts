import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import {
  addVehicleAttachment,
  countVehicleAttachments,
  listVehicleAttachments,
  removeVehicleAttachment,
  MAX_VEHICLE_ATTACHMENTS,
  MAX_VEHICLE_ATTACHMENT_BYTES,
} from "@/lib/userVehicleStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_MIME = /^(image\/(png|jpe?g|webp|heic|heif|gif)|application\/pdf)$/i;

/** Approximate decoded byte size of a base64 data URL. */
function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireCurrentUser();
    const body = (await request.json().catch(() => null)) as {
      filename?: unknown;
      mimeType?: unknown;
      dataUrl?: unknown;
    } | null;

    const filename = typeof body?.filename === "string" ? body.filename.trim() : "";
    const mimeType = typeof body?.mimeType === "string" ? body.mimeType.trim() : "";
    const dataUrl = typeof body?.dataUrl === "string" ? body.dataUrl : "";

    if (!dataUrl.startsWith("data:")) {
      return NextResponse.json({ error: "A file data URL is required." }, { status: 400 });
    }
    if (!ALLOWED_MIME.test(mimeType)) {
      return NextResponse.json(
        { error: "Only images (PNG, JPG, WEBP, HEIC) and PDF documents are allowed." },
        { status: 400 }
      );
    }

    const sizeBytes = dataUrlBytes(dataUrl);
    if (sizeBytes > MAX_VEHICLE_ATTACHMENT_BYTES) {
      return NextResponse.json(
        { error: `Each file must be under ${Math.round(MAX_VEHICLE_ATTACHMENT_BYTES / (1024 * 1024))} MB.` },
        { status: 413 }
      );
    }

    const count = await countVehicleAttachments(user.id);
    if (count >= MAX_VEHICLE_ATTACHMENTS) {
      return NextResponse.json(
        { error: `You can store up to ${MAX_VEHICLE_ATTACHMENTS} files. Remove one to add another.` },
        { status: 409 }
      );
    }

    const attachment = await addVehicleAttachment(user.id, {
      filename: filename || "upload",
      mimeType,
      dataUrl,
      sizeBytes,
    });
    return NextResponse.json({ attachment }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error, "upload");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user } = await requireCurrentUser();
    const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
    const id = typeof body?.id === "string" ? body.id : "";
    if (!id) {
      return NextResponse.json({ error: "An attachment id is required." }, { status: 400 });
    }
    await removeVehicleAttachment(user.id, id);
    const attachments = await listVehicleAttachments(user.id);
    return NextResponse.json({ attachments }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error, "remove");
  }
}

function handleError(error: unknown, action: string) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(`[vehicle-attachments] ${action} failed`, {
    message: error instanceof Error ? error.message : "Unknown error",
  });
  return NextResponse.json({ error: `Could not ${action} the file.` }, { status: 500 });
}
