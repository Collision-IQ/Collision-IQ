export type Role = "user" | "assistant";
export type AssistantMessageKind = "analysis" | "system_status";

export type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  kind?: AssistantMessageKind;
};

export function createMessage(
  counter: number,
  role: Role,
  content: string,
  kind?: AssistantMessageKind
): ChatMessage {
  return {
    id: `${role}-${counter}`,
    role,
    content,
    kind,
  };
}

export function isSystemStatusMessage(message?: Pick<ChatMessage, "role" | "kind"> | null) {
  return message?.role === "assistant" && message?.kind === "system_status";
}
