export type Role = "user" | "assistant";
export type AssistantMessageKind = "analysis" | "system_status";

export type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  kind?: AssistantMessageKind;
  /** Ids of uploaded attachments this message sent, so a reopened thread can
   *  restore the attachment tray rather than losing the files behind it. */
  attachmentIds?: string[];
};

export function createMessage(
  counter: number,
  role: Role,
  content: string,
  kind?: AssistantMessageKind,
  attachmentIds?: string[]
): ChatMessage {
  return {
    id: `${role}-${counter}`,
    role,
    content,
    kind,
    ...(attachmentIds && attachmentIds.length ? { attachmentIds } : {}),
  };
}

export function isSystemStatusMessage(message?: Pick<ChatMessage, "role" | "kind"> | null) {
  return message?.role === "assistant" && message?.kind === "system_status";
}
