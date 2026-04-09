export type ExportableChatMessage = {
  role: "user" | "assistant";
  content: string;
  kind?: "analysis" | "system_status";
};

export function buildExportMessages(messages: ExportableChatMessage[]) {
  return messages
    .filter((message) => message.kind !== "system_status")
    .map((message) => ({
      role: message.role,
      content: message.content,
    }))
    .filter((message) => message.content.trim().length > 0);
}

export function hasExportContent(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  analysisText: string
) {
  return messages.length > 0 || analysisText.trim().length > 0;
}

export function buildChatExportPayload(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  analysisText: string
) {
  return {
    messages,
    analysisText: analysisText.trim() || undefined,
  };
}

export function getDownloadFilename(contentDisposition?: string | null) {
  return contentDisposition?.match(/filename="([^"]+)"/i)?.[1] ?? "chat-export-redacted.pdf";
}

export function resolveExportErrorMessage(status: number, fallback?: string): string {
  if (status === 401) {
    return "Please sign in to download a redacted chat export.";
  }

  if (status === 403) {
    return "Redacted chat download is not available on this account yet.";
  }

  if (status === 400) {
    return fallback || "There was not enough chat content to build a redacted export.";
  }

  if (status === 501) {
    return "Redacted chat download is not ready yet.";
  }

  return fallback || `Redacted chat download failed (${status}).`;
}
