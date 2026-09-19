/**
 * Session-storage persistence for the live chat transcript.
 *
 * The transcript is mirrored into `sessionStorage` as a remount guard. Before a
 * case exists it lives under the DRAFT key; once the analysis returns a case
 * id the widget switches to a case-scoped key and carries the messages over.
 * The DRAFT snapshot is NOT rewritten after that switch, so it keeps the
 * pre-case slice of the conversation until something removes it.
 *
 * Ending a chat must therefore clear BOTH keys. Clearing only the case key
 * left the stale DRAFT snapshot in place; when the case id dropped to null the
 * key-switch effect read it back and the "ended" transcript reappeared until
 * the user pressed End a second time.
 */

export const CHAT_SESSION_STORAGE_PREFIX = "collision-iq.chat-widget.session";
export const DRAFT_CHAT_SESSION_KEY = `${CHAT_SESSION_STORAGE_PREFIX}:draft`;

export type StoredChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

/** Minimal Storage surface so tests can inject an in-memory store. */
export type ChatSessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function resolveStore(store?: ChatSessionStore | null): ChatSessionStore | null {
  if (store) return store;
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function getChatSessionStorageKey(activeCaseId: string | null | undefined) {
  const normalized = activeCaseId?.trim();
  return normalized
    ? `${CHAT_SESSION_STORAGE_PREFIX}:case:${normalized}`
    : DRAFT_CHAT_SESSION_KEY;
}

export function readStoredChatMessages<T extends StoredChatMessage>(
  storageKey: string,
  store?: ChatSessionStore | null
): T[] | null {
  const target = resolveStore(store);
  if (!target) return null;

  try {
    const parsed = JSON.parse(target.getItem(storageKey) ?? "null") as unknown;
    if (!Array.isArray(parsed)) return null;
    const messages = parsed.filter((item): item is T => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Partial<StoredChatMessage>;
      return (
        typeof candidate.id === "string" &&
        (candidate.role === "user" || candidate.role === "assistant") &&
        typeof candidate.content === "string"
      );
    });
    return messages.length ? messages : null;
  } catch {
    return null;
  }
}

export function writeStoredChatMessages(
  storageKey: string,
  messages: StoredChatMessage[],
  store?: ChatSessionStore | null
) {
  const target = resolveStore(store);
  if (!target) return;

  try {
    target.setItem(storageKey, JSON.stringify(messages));
  } catch {
    // Session persistence is a best-effort remount guard.
  }
}

export function removeStoredChatMessages(storageKey: string, store?: ChatSessionStore | null) {
  const target = resolveStore(store);
  if (!target) return;

  try {
    target.removeItem(storageKey);
  } catch {
    // Ignore storage cleanup failures.
  }
}

/**
 * Clear every session-storage snapshot the ended conversation could be
 * restored from: the key currently being written, the key for the active
 * case (if any), and the DRAFT key that held the pre-case transcript.
 */
export function clearEndedChatSessionStorage(
  params: { currentStorageKey: string; activeCaseId: string | null | undefined },
  store?: ChatSessionStore | null
) {
  const keys = new Set<string>([
    params.currentStorageKey,
    getChatSessionStorageKey(params.activeCaseId),
    DRAFT_CHAT_SESSION_KEY,
  ]);
  for (const key of keys) {
    removeStoredChatMessages(key, store);
  }
}
