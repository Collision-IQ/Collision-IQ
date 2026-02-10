import { create } from "zustand";
import { UploadedDocument } from "@/types/chat";

interface SessionState {
  documents: UploadedDocument[];
  workspaceNotes: string;

  setDocuments: (docs: UploadedDocument[]) => void;
  clearDocuments: () => void;
  setWorkspaceNotes: (v: string) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  documents: [],
  workspaceNotes: "",

  setDocuments: (docs) => set({ documents: docs }),
  clearDocuments: () => set({ documents: [] }),
  setWorkspaceNotes: (v) => set({ workspaceNotes: v }),
}));
