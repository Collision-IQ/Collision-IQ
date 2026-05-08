import { prisma } from "@/lib/prisma";
import type {
  CccWorkfileMetadata,
  UploadClassification,
} from "@/lib/ccc/cccWorkfile";

export type StoredAttachment = {
  id: string;
  filename: string;
  type: string;
  text: string;
  imageDataUrl?: string;
  pageCount?: number;
  classification?: UploadClassification;
  sizeBytes?: number;
  sha256?: string;
  metadata?: CccWorkfileMetadata;
  source?: "direct_upload" | "zip_extraction";
  sourceArchive?: string;
};

type AttachmentOwnerScope = {
  ownerUserId: string;
  shopId?: string | null;
};

function resolveOwner(params: AttachmentOwnerScope) {
  if (params.shopId) {
    return {
      ownerType: "SHOP" as const,
      ownerId: params.shopId,
    };
  }

  return {
    ownerType: "USER" as const,
    ownerId: params.ownerUserId,
  };
}

function toStoredAttachment(record: {
  id: string;
  filename: string;
  type: string;
  text: string;
  imageDataUrl: string | null;
  pageCount: number | null;
  classification?: string | null;
  sizeBytes?: number | null;
  sha256?: string | null;
  metadata?: unknown;
  source?: string | null;
  sourceArchive?: string | null;
}): StoredAttachment {
  return {
    id: record.id,
    filename: record.filename,
    type: record.type,
    text: record.text,
    imageDataUrl: record.imageDataUrl ?? undefined,
    pageCount: record.pageCount ?? undefined,
    classification: isUploadClassification(record.classification)
      ? record.classification
      : undefined,
    sizeBytes: record.sizeBytes ?? undefined,
    sha256: record.sha256 ?? undefined,
    metadata: isCccWorkfileMetadata(record.metadata) ? record.metadata : undefined,
    source:
      record.source === "direct_upload" || record.source === "zip_extraction"
        ? record.source
        : undefined,
    sourceArchive: record.sourceArchive ?? undefined,
  };
}

export async function saveUploadedAttachment(params: {
  ownerUserId: string;
  shopId?: string | null;
  filename: string;
  type: string;
  text: string;
  imageDataUrl?: string;
  pageCount?: number;
  classification?: UploadClassification;
  sizeBytes?: number;
  sha256?: string;
  metadata?: CccWorkfileMetadata;
  source?: "direct_upload" | "zip_extraction";
  sourceArchive?: string;
}): Promise<StoredAttachment> {
  const owner = resolveOwner({
    ownerUserId: params.ownerUserId,
    shopId: params.shopId,
  });

  const created = await prisma.uploadedAttachment.create({
    data: {
      filename: params.filename,
      type: params.type,
      text: params.text,
      imageDataUrl: params.imageDataUrl ?? null,
      pageCount: params.pageCount ?? null,
      classification: params.classification ?? null,
      sizeBytes: params.sizeBytes ?? null,
      sha256: params.sha256 ?? null,
      metadata: params.metadata ?? undefined,
      source: params.source ?? null,
      sourceArchive: params.sourceArchive ?? null,
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
    },
  });

  return toStoredAttachment(created);
}

function isUploadClassification(value: unknown): value is UploadClassification {
  return (
    value === "image" ||
    value === "pdf" ||
    value === "text" ||
    value === "docx" ||
    value === "ccc_workfile" ||
    value === "ccc_awf" ||
    value === "ccc_companion_file"
  );
}

function isCccWorkfileMetadata(value: unknown): value is CccWorkfileMetadata {
  const maybeMetadata = value as { artifactFamily?: unknown } | null;
  return (
    typeof maybeMetadata === "object" &&
    maybeMetadata !== null &&
    maybeMetadata.artifactFamily === "ccc_workfile"
  );
}

export async function getUploadedAttachments(
  ids: string[],
  scope?: AttachmentOwnerScope
): Promise<StoredAttachment[]> {
  if (!ids.length) {
    return [];
  }

  const records = await prisma.uploadedAttachment.findMany({
    where: {
      id: {
        in: ids,
      },
      ...(scope
        ? {
            ownerType: resolveOwner(scope).ownerType,
            ownerId: resolveOwner(scope).ownerId,
          }
        : {}),
    },
  });

  const byId = new Map(records.map((record) => [record.id, toStoredAttachment(record)]));
  return ids
    .map((id) => byId.get(id))
    .filter((attachment): attachment is StoredAttachment => Boolean(attachment));
}

export async function removeUploadedAttachments(
  ids: string[],
  scope: AttachmentOwnerScope
) {
  if (!ids.length) {
    return;
  }

  const owner = resolveOwner(scope);
  await prisma.uploadedAttachment.deleteMany({
    where: {
      id: {
        in: ids,
      },
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
    },
  });
}
