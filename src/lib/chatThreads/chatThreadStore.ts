import { prisma } from "@/lib/prisma";
import {
  MAX_THREADS_PER_USER,
  deriveChatThreadTitle,
  isThreadWorthSaving,
  sanitizeChatThreadMessages,
  type ChatThreadMessage,
} from "@/lib/chatThreads/threadRules";

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

  // Bound per-user storage: prune the oldest threads beyond the cap.
  const excess = await prisma.chatThread.findMany({
    where: { ownerUserId: params.ownerUserId },
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

/** Most recent threads first, bounded by the caller's plan limit. */
export async function listChatThreads(
  ownerUserId: string,
  limit: number
): Promise<ChatThreadSummary[]> {
  if (!Number.isFinite(limit)) limit = MAX_THREADS_PER_USER;
  if (limit <= 0) return [];
  const threads = await prisma.chatThread.findMany({
    where: { ownerUserId },
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
  return {
    ...toSummary(thread),
    messages: sanitizeChatThreadMessages(thread.messages),
  };
}

export async function deleteChatThread(ownerUserId: string, threadId: string): Promise<boolean> {
  const deleted = await prisma.chatThread.deleteMany({
    where: { id: threadId, ownerUserId },
  });
  return deleted.count === 1;
}
