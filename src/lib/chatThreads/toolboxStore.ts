/**
 * THE TOOLBOX — chats the user deliberately kept.
 *
 * Distinct from the autosaved history window, and deliberately so. History is
 * passive: threads land there by existing, and fall out of the plan's recency
 * window without anyone deciding anything. A toolbox slot is an act of keeping
 * — "I am coming back to this claim" — so nothing is ever evicted from it
 * silently. When the slots are full, saving requires the user to confirm which
 * chat they are giving up.
 *
 * Membership is `ChatThread.toolboxSavedAt`: non-null means saved, and the
 * value is both the save time and the eviction order. One nullable column
 * rather than a boolean plus a timestamp, because two fields can disagree
 * about whether a thread is in the toolbox and one cannot.
 *
 * Only threads saved from the migration forward can appear here: existing rows
 * default to NULL, so the toolbox starts empty for everyone rather than
 * back-filling itself with whatever happened to be in history.
 */
import { prisma } from "@/lib/prisma";
import { sanitizeChatThreadMessages } from "@/lib/chatThreads/threadRules";
import {
  getUploadedAttachments,
  type StoredAttachment,
} from "@/lib/uploadedAttachmentStore";

export type ToolboxEntry = {
  id: string;
  title: string;
  caseId: string | null;
  messageCount: number;
  /** Number of distinct files carried by the conversation. */
  attachmentCount: number;
  savedAt: string;
  updatedAt: string;
};

export type ToolboxListing = {
  entries: ToolboxEntry[];
  limit: number;
  /** True when the plan has no toolbox at all (free). */
  locked: boolean;
  slotsUsed: number;
  slotsRemaining: number;
};

/**
 * Outcome of a save attempt.
 *
 * `needs_confirmation` is the important one: the slots are full and saving
 * would displace `evicts`. Nothing has been written when this is returned —
 * the caller shows the warning and calls back with `confirmed: true` only if
 * the user accepts. Declining leaves every saved chat exactly as it was.
 */
export type ToolboxSaveResult =
  | { status: "saved"; entry: ToolboxEntry; evicted: ToolboxEntry | null }
  | { status: "needs_confirmation"; evicts: ToolboxEntry }
  | { status: "locked" }
  | { status: "not_found" }
  | { status: "already_saved"; entry: ToolboxEntry };

type ThreadRow = {
  id: string;
  title: string;
  caseId: string | null;
  messages: unknown;
  messageCount: number;
  toolboxSavedAt: Date | null;
  updatedAt: Date;
};

function countAttachments(messages: unknown): number {
  const sanitized = sanitizeChatThreadMessages(messages);
  return new Set(sanitized.flatMap((message) => message.attachmentIds ?? [])).size;
}

function toEntry(thread: ThreadRow): ToolboxEntry {
  return {
    id: thread.id,
    title: thread.title,
    caseId: thread.caseId,
    messageCount: thread.messageCount,
    attachmentCount: countAttachments(thread.messages),
    // Only ever called for saved threads; the fallback keeps the type honest
    // rather than asserting non-null on a column that is nullable by design.
    savedAt: (thread.toolboxSavedAt ?? thread.updatedAt).toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
  };
}

const SAVED_SELECT = {
  id: true,
  title: true,
  caseId: true,
  messages: true,
  messageCount: true,
  toolboxSavedAt: true,
  updatedAt: true,
} as const;

/** Saved chats, newest save first. */
export async function listToolbox(
  ownerUserId: string,
  limit: number
): Promise<ToolboxListing> {
  if (limit <= 0) {
    return { entries: [], limit: 0, locked: true, slotsUsed: 0, slotsRemaining: 0 };
  }
  const threads = await prisma.chatThread.findMany({
    where: { ownerUserId, toolboxSavedAt: { not: null } },
    orderBy: { toolboxSavedAt: "desc" },
    select: SAVED_SELECT,
  });
  const entries = threads.map(toEntry);
  return {
    entries,
    limit,
    locked: false,
    slotsUsed: entries.length,
    slotsRemaining: Math.max(0, limit - entries.length),
  };
}

/**
 * Save a thread to the toolbox.
 *
 * Re-saving a thread already in the toolbox refreshes its save time rather
 * than consuming a second slot — the user is updating where they left off, not
 * keeping two copies. That case must be checked BEFORE capacity, or a user at
 * their limit would be told they have to evict something to re-save a chat
 * that is already saved.
 */
export async function saveToToolbox(params: {
  ownerUserId: string;
  threadId: string;
  limit: number;
  confirmed?: boolean;
  now?: Date;
}): Promise<ToolboxSaveResult> {
  const { ownerUserId, threadId, limit } = params;
  if (limit <= 0) return { status: "locked" };

  const thread = await prisma.chatThread.findFirst({
    where: { id: threadId, ownerUserId },
    select: SAVED_SELECT,
  });
  if (!thread) return { status: "not_found" };

  const now = params.now ?? new Date();

  if (thread.toolboxSavedAt) {
    const refreshed = await prisma.chatThread.update({
      where: { id: threadId },
      data: { toolboxSavedAt: now },
      select: SAVED_SELECT,
    });
    return { status: "already_saved", entry: toEntry(refreshed) };
  }

  const saved = await prisma.chatThread.findMany({
    where: { ownerUserId, toolboxSavedAt: { not: null } },
    orderBy: { toolboxSavedAt: "asc" },
    select: SAVED_SELECT,
  });

  let evicted: ToolboxEntry | null = null;
  if (saved.length >= limit) {
    const oldest = saved[0];
    if (!params.confirmed) {
      // Nothing written. The caller warns, and only calls back with
      // confirmed: true if the user accepts losing this one.
      return { status: "needs_confirmation", evicts: toEntry(oldest) };
    }
    // Evicting removes it from the TOOLBOX, not from existence: the thread
    // stays in ordinary history and is still subject to the normal window.
    // A user who confirms should lose a slot, not a conversation.
    await prisma.chatThread.update({
      where: { id: oldest.id },
      data: { toolboxSavedAt: null },
    });
    evicted = toEntry(oldest);
  }

  const updated = await prisma.chatThread.update({
    where: { id: threadId },
    data: { toolboxSavedAt: now },
    select: SAVED_SELECT,
  });
  return { status: "saved", entry: toEntry(updated), evicted };
}

/** Remove from the toolbox by hand. The thread itself is untouched. */
export async function removeFromToolbox(
  ownerUserId: string,
  threadId: string
): Promise<boolean> {
  const updated = await prisma.chatThread.updateMany({
    where: { id: threadId, ownerUserId, toolboxSavedAt: { not: null } },
    data: { toolboxSavedAt: null },
  });
  return updated.count === 1;
}

/**
 * Reopen a saved chat in full: every message plus every attachment it carried,
 * so the user resumes with their estimates and photos rather than an empty
 * tray.
 *
 * Unlike ordinary history this is NOT gated by the plan's recency window — a
 * chat the user deliberately kept is always openable while it occupies a slot.
 * Gating it by the window would make "saved" mean nothing.
 */
export async function getToolboxThread(
  ownerUserId: string,
  threadId: string
): Promise<{
  id: string;
  title: string;
  caseId: string | null;
  savedAt: string;
  messages: ReturnType<typeof sanitizeChatThreadMessages>;
  attachments: StoredAttachment[];
} | null> {
  const thread = await prisma.chatThread.findFirst({
    where: { id: threadId, ownerUserId, toolboxSavedAt: { not: null } },
    select: SAVED_SELECT,
  });
  if (!thread) return null;

  const messages = sanitizeChatThreadMessages(thread.messages);
  const attachmentIds = Array.from(
    new Set(messages.flatMap((message) => message.attachmentIds ?? []))
  );
  const attachments = attachmentIds.length
    ? await getUploadedAttachments(attachmentIds, { ownerUserId })
    : [];

  return {
    id: thread.id,
    title: thread.title,
    caseId: thread.caseId,
    savedAt: (thread.toolboxSavedAt ?? thread.updatedAt).toISOString(),
    messages,
    attachments,
  };
}
