import { create } from "zustand";

export type UploadedDocument = {
  filename: string;
  type: string;
  text: string;
};

type SessionState = {
  documents: UploadedDocument[];
  workspaceNotes: string;

  setDocuments: (docs: UploadedDocument[]) => void;
  addDocuments: (docs: UploadedDocument[]) => void;
  clearDocuments: () => void;

  setWorkspaceNotes: (notes: string) => void;
  clearWorkspaceNotes: () => void;

  clearAll: () => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  documents: [],
  workspaceNotes: "",

  setDocuments: (docs) => set({ documents: docs }),
  addDocuments: (docs) =>
    set((s) => ({ documents: [...s.documents, ...docs] })),
  clearDocuments: () => set({ documents: [] }),

  setWorkspaceNotes: (notes) => set({ workspaceNotes: notes }),
  clearWorkspaceNotes: () => set({ workspaceNotes: "" }),

  clearAll: () => set({ documents: [], workspaceNotes: "" }),
}));
