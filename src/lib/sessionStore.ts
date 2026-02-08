import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type UploadedDocument = {
  filename: string;
  type: string;   // "application/pdf", etc.
  text: string;   // extracted text
};

type SessionState = {
  documents: UploadedDocument[];
  workspaceNotes: string;

  setDocuments: (docs: UploadedDocument[]) => void;
  addDocuments: (docs: UploadedDocument[]) => void;
  clearDocuments: () => void;

  setWorkspaceNotes: (notes: string) => void;
  clearWorkspaceNotes: () => void;
};

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      documents: [],
      workspaceNotes: "",

      setDocuments: (docs) => set({ documents: docs }),
      addDocuments: (docs) => set({ documents: [...get().documents, ...docs] }),
      clearDocuments: () => set({ documents: [] }),

      setWorkspaceNotes: (notes) => set({ workspaceNotes: notes }),
      clearWorkspaceNotes: () => set({ workspaceNotes: "" }),
    }),
    {
      name: "collision-iq-session",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({
        documents: s.documents,
        workspaceNotes: s.workspaceNotes,
      }),
    }
  )
);
