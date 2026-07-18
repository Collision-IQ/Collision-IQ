"use client";

/**
 * Cross-component signal for reopening a saved chat: the History panel
 * dispatches it, the workspace shell switches to the chat view, and the chat
 * widget loads the thread. Decoupled via a window event because the three
 * components sit in different subtrees.
 */
export const CHAT_REOPEN_EVENT = "collisioniq:chat:reopen";

export type ChatReopenDetail = { threadId: string };

export function requestChatReopen(threadId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ChatReopenDetail>(CHAT_REOPEN_EVENT, { detail: { threadId } })
  );
}
