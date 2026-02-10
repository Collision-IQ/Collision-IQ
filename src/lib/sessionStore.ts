import { create } from "zustand";

export type UploadedDocument = {
  filename: string;
  type: string;
  text: string; // extracted text
};

type SessionState = {
  documents: UploadedDocument[];
  workspaceNotes: string;

  setWorkspaceNotes: (notes: string) => void;
  addDocuments: (docs: UploadedDocument[]) => void;
  clearDocuments: () => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  documents: [],
  workspaceNotes: "",

  setWorkspaceNotes: (notes) => set({ workspaceNotes: notes }),
  addDocuments: (docs) =>
    set((s) => ({
      documents: [...s.documents, ...docs],
    })),
  clearDocuments: () => set({ documents: [] }),
}));
