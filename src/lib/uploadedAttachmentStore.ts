export type StoredAttachment = {
  id: string
  filename: string
  type: string
  text: string
  imageDataUrl?: string
  pageCount?: number
}

const attachmentStore = new Map<string, StoredAttachment>()

export function saveUploadedAttachment(
  attachment: Omit<StoredAttachment, "id">
): StoredAttachment {
  const stored: StoredAttachment = {
    id: crypto.randomUUID(),
    ...attachment,
  }

  attachmentStore.set(stored.id, stored)
  return stored
}

export function getUploadedAttachments(ids: string[]): StoredAttachment[] {
  return ids
    .map((id) => attachmentStore.get(id))
    .filter((attachment): attachment is StoredAttachment => Boolean(attachment))
}

export function removeUploadedAttachments(ids: string[]) {
  for (const id of ids) {
    attachmentStore.delete(id)
  }
}
