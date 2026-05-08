import { prisma } from "@/lib/prisma";
import type {
  CccWorkfileMetadata,
  UploadClassification,
} from "@/lib/ccc/cccWorkfile";
import { getDatabaseUrlHostOnly, warnIfUploadedAttachmentSchemaMismatch } from "@/lib/dbSchemaDiagnostics";

warnIfUploadedAttachmentSchemaMismatch();

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

type UploadedAttachmentDelegate = typeof prisma.uploadedAttachment;

const optionalMetadataColumns = [
  "classification",
  "sizeBytes",
  "sha256",
  "metadata",
  "source",
  "sourceArchive",
] as const;

const fullAttachmentSelect = {
  id: true,
  filename: true,
  type: true,
  text: true,
  imageDataUrl: true,
  pageCount: true,
  classification: true,
  sizeBytes: true,
  sha256: true,
  metadata: true,
  source: true,
  sourceArchive: true,
} as const;

const coreAttachmentSelect = {
  id: true,
  filename: true,
  type: true,
  text: true,
  imageDataUrl: true,
  pageCount: true,
} as const;

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
  return saveUploadedAttachmentWithDelegate(prisma.uploadedAttachment, params);
}

export async function saveUploadedAttachmentWithDelegate(
  uploadedAttachment: UploadedAttachmentDelegate,
  params: {
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
  }
): Promise<StoredAttachment> {
  const owner = resolveOwner({
    ownerUserId: params.ownerUserId,
    shopId: params.shopId,
  });

  try {
    const created = await uploadedAttachment.create({
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
      select: fullAttachmentSelect,
    });

    return toStoredAttachment(created);
  } catch (error) {
    if (!isUploadedAttachmentOptionalColumnMismatch(error)) {
      throw error;
    }

    logUploadedAttachmentSchemaMismatch("retrying core attachment write", error);

    const created = await uploadedAttachment.create({
      data: {
        filename: params.filename,
        type: params.type,
        text: params.text,
        imageDataUrl: params.imageDataUrl ?? null,
        pageCount: params.pageCount ?? null,
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
      },
      select: coreAttachmentSelect,
    });

    return toStoredAttachment(created);
  }
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
    where: buildAttachmentWhere(ids, scope),
    select: fullAttachmentSelect,
  }).catch(async (error) => {
    if (!isUploadedAttachmentOptionalColumnMismatch(error)) {
      throw error;
    }

    logUploadedAttachmentSchemaMismatch("retrying core attachment lookup", error);

    return prisma.uploadedAttachment.findMany({
      where: buildAttachmentWhere(ids, scope),
      select: coreAttachmentSelect,
    });
  });

  const byId = new Map(records.map((record) => [record.id, toStoredAttachment(record)]));
  return ids
    .map((id) => byId.get(id))
    .filter((attachment): attachment is StoredAttachment => Boolean(attachment));
}

function buildAttachmentWhere(ids: string[], scope?: AttachmentOwnerScope) {
  const owner = scope ? resolveOwner(scope) : null;

  return {
    id: {
      in: ids,
    },
    ...(owner
      ? {
          ownerType: owner.ownerType,
          ownerId: owner.ownerId,
        }
      : {}),
  };
}

export function isUploadedAttachmentOptionalColumnMismatch(error: unknown) {
  const maybeError = error as {
    code?: unknown;
    message?: unknown;
    meta?: { column?: unknown; field_name?: unknown };
  };
  const message = typeof maybeError.message === "string" ? maybeError.message : "";
  const metaColumn = [maybeError.meta?.column, maybeError.meta?.field_name]
    .filter((value): value is string => typeof value === "string")
    .join(" ");

  if (maybeError.code && maybeError.code !== "P2022") {
    return false;
  }

  const combined = `${message} ${metaColumn}`;
  const looksLikeMissingColumn =
    maybeError.code === "P2022" ||
    /column|does not exist|no such column|missing/i.test(combined);

  if (!looksLikeMissingColumn) {
    return false;
  }

  return optionalMetadataColumns.some((column) => {
    const prismaColumn = `UploadedAttachment.${column}`;
    return (
      combined.includes(prismaColumn) ||
      new RegExp(`\\b${column}\\b`, "i").test(combined)
    );
  });
}

function logUploadedAttachmentSchemaMismatch(action: string, error: unknown) {
  console.warn("[uploaded-attachment-store] schema mismatch", {
    action,
    databaseUrlHost: getDatabaseUrlHostOnly(),
    message: error instanceof Error ? error.message : "Unknown error",
  });
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
