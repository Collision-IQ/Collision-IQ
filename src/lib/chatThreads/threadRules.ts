/**
 * Pure rules for saved chat threads (no server imports so tests stay light).
 * A thread is the persisted transcript of one chat session; users reopen them
 * from History subject to the plan limit in featureAccess.chatHistoryReopenLimit.
 */

export type ChatThreadMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  kind?: "analysis" | "system_status";
};

/** Hard caps so a runaway session can never store unbounded JSON. */
export const MAX_THREAD_MESSAGES = 300;
export const MAX_MESSAGE_CHARS = 24_000;
/** Oldest threads beyond this per-user count are pruned on save. */
export const MAX_THREADS_PER_USER = 30;
export const MAX_THREAD_TITLE_CHARS = 80;

/**
 * Validate and bound an untrusted message payload. Transient system-status
 * messages (upload progress etc.) are dropped — they are meaningless when a
 * chat is reopened later. Keeps the most recent messages when over the cap.
 */
export function sanitizeChatThreadMessages(input: unknown): ChatThreadMessage[] {
  if (!Array.isArray(input)) return [];
  const messages: ChatThreadMessage[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<ChatThreadMessage>;
    if (typeof candidate.id !== "string" || typeof candidate.content !== "string") continue;
    if (candidate.role !== "user" && candidate.role !== "assistant") continue;
    if (candidate.kind === "system_status") continue;
    messages.push({
      id: candidate.id.slice(0, 120),
      role: candidate.role,
      content: candidate.content.slice(0, MAX_MESSAGE_CHARS),
      ...(candidate.kind === "analysis" ? { kind: "analysis" as const } : {}),
    });
  }
  return messages.slice(-MAX_THREAD_MESSAGES);
}

/**
 * A thread is only worth saving once a real exchange exists: at least one user
 * message and one assistant reply beyond the canned greeting.
 */
export function isThreadWorthSaving(messages: ChatThreadMessage[]): boolean {
  return (
    messages.some((message) => message.role === "user") &&
    messages.some(
      (message) => message.role === "assistant" && message.id !== "assistant-initial"
    )
  );
}

/** Title = the first user message, tightened for a list row. */
export function deriveChatThreadTitle(messages: ChatThreadMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user");
  const raw = firstUser?.content.replace(/\s+/g, " ").trim() ?? "";
  if (!raw) return "Saved chat";
  return raw.length > MAX_THREAD_TITLE_CHARS
    ? `${raw.slice(0, MAX_THREAD_TITLE_CHARS - 1).trimEnd()}…`
    : raw;
}
