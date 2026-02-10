export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface UploadedDocument {
  id: string;
  filename: string;
  text: string;
  mimeType: "application/pdf" | "image/jpeg" | "image/png";
}

export interface WorkspaceContext {
  notes: string;
  documents: UploadedDocument[];
}
