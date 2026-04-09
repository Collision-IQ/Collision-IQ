import { prisma } from "@/lib/prisma";

export type StoredAttachment = {
  id: string;
  filename: string;
  type: string;
  text: string;
  imageDataUrl?: string;
  pageCount?: number;
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
}): StoredAttachment {
  return {
    id: record.id,
    filename: record.filename,
    type: record.type,
    text: record.text,
    imageDataUrl: record.imageDataUrl ?? undefined,
    pageCount: record.pageCount ?? undefined,
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
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
    },
  });

  return toStoredAttachment(created);
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
