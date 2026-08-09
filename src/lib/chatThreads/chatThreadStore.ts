import { prisma } from "@/lib/prisma";
import {
  MAX_THREADS_PER_USER,
  deriveChatThreadTitle,
  isThreadWorthSaving,
  sanitizeChatThreadMessages,
  type ChatThreadMessage,
} from "@/lib/chatThreads/threadRules";
import {
  getUploadedAttachments,
  type StoredAttachment,
} from "@/lib/uploadedAttachmentStore";

export type ChatThreadSummary = {
  id: string;
  title: string;
  caseId: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ChatThreadDetail = ChatThreadSummary & {
  messages: ChatThreadMessage[];
  /** Full records for every attachment referenced anywhere in this thread, so
   *  the client can repopulate the attachment tray on reopen. Ids that no
   *  longer resolve are simply absent — the transcript still opens. */
  attachments: StoredAttachment[];
};

function toSummary(thread: {
  id: string;
  title: string;
  caseId: string | null;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}): ChatThreadSummary {
  return {
    id: thread.id,
    title: thread.title,
    caseId: thread.caseId,
    messageCount: thread.messageCount,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
  };
}

/**
 * Create or update the signed-in user's saved chat. Updates are
 * ownership-checked; a save that isn't a real exchange yet is skipped.
 * Returns the thread id, or null when skipped.
 */
export async function saveChatThread(params: {
  ownerUserId: string;
  threadId?: string | null;
  caseId?: string | null;
  messages: unknown;
}): Promise<string | null> {
  const messages = sanitizeChatThreadMessages(params.messages);
  if (!isThreadWorthSaving(messages)) return null;
  const data = {
    title: deriveChatThreadTitle(messages),
    caseId: params.caseId?.trim() || null,
    messages: messages as object[],
    messageCount: messages.length,
  };

  if (params.threadId) {
    const updated = await prisma.chatThread.updateMany({
      where: { id: params.threadId, ownerUserId: params.ownerUserId },
      data,
    });
    if (updated.count === 1) return params.threadId;
    // Fall through: unknown/foreign id becomes a fresh thread.
  }

  const created = await prisma.chatThread.create({
    data: { ...data, ownerUserId: params.ownerUserId },
  });

  // Bound per-user storage for AD-HOC chats only. Threads tied to a case are
  // exempt: a claim's chat history spans months of supplement and appraisal
  // phases, and evicting it because of unrelated chat volume elsewhere in the
  // account would silently destroy the record of an active claim.
  const excess = await prisma.chatThread.findMany({
    where: { ownerUserId: params.ownerUserId, caseId: null },
    orderBy: { updatedAt: "desc" },
    skip: MAX_THREADS_PER_USER,
    select: { id: true },
  });
  if (excess.length) {
    await prisma.chatThread.deleteMany({
      where: { id: { in: excess.map((thread) => thread.id) }, ownerUserId: params.ownerUserId },
    });
  }
  return created.id;
}

/** Most recent threads first, bounded by the caller's plan limit.
 *  Pass `caseId` to scope the list to one claim instead of general recency
 *  browsing. */
export async function listChatThreads(
  ownerUserId: string,
  limit: number,
  caseId?: string | null
): Promise<ChatThreadSummary[]> {
  if (!Number.isFinite(limit)) limit = MAX_THREADS_PER_USER;
  if (limit <= 0) return [];
  const threads = await prisma.chatThread.findMany({
    where: { ownerUserId, ...(caseId ? { caseId } : {}) },
    orderBy: { updatedAt: "desc" },
    take: Math.min(limit, MAX_THREADS_PER_USER),
    select: { id: true, title: true, caseId: true, messageCount: true, createdAt: true, updatedAt: true },
  });
  return threads.map(toSummary);
}

/**
 * Full thread for reopening. Enforces the plan window server-side: the thread
 * must be within the user's most recent `limit` threads, not just owned.
 */
export async function getChatThreadForReopen(
  ownerUserId: string,
  threadId: string,
  limit: number
): Promise<ChatThreadDetail | null> {
  const visible = await listChatThreads(ownerUserId, limit);
  if (!visible.some((thread) => thread.id === threadId)) return null;
  const thread = await prisma.chatThread.findFirst({
    where: { id: threadId, ownerUserId },
  });
  if (!thread) return null;

  const messages = sanitizeChatThreadMessages(thread.messages);
  const attachmentIds = Array.from(
    new Set(messages.flatMap((message) => message.attachmentIds ?? []))
  );
  // Scoped by ownerUserId only, matching how the chat route itself resolves
  // attachments today (extractDocuments is called without a shopId). If shop
  // scope is ever threaded through there, mirror it here or shop-uploaded
  // files will silently fail to resolve for other members of the shop.
  const attachments = attachmentIds.length
    ? await getUploadedAttachments(attachmentIds, { ownerUserId })
    : [];

  return {
    ...toSummary(thread),
    messages,
    attachments,
  };
}

export async function deleteChatThread(ownerUserId: string, threadId: string): Promise<boolean> {
  const deleted = await prisma.chatThread.deleteMany({
    where: { id: threadId, ownerUserId },
  });
  return deleted.count === 1;
}
