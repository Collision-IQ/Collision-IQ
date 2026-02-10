// src/lib/sessionStore.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UploadedDocument = {
  filename: string;
  type: string;
  text: string;
};

type SessionState = {
  documents: UploadedDocument[];
  workspaceNotes: string;

  addDocuments: (docs: UploadedDocument[]) => void;
  clearDocuments: () => void;

  setWorkspaceNotes: (notes: string) => void;
  clearWorkspaceNotes: () => void;

  clearAll: () => void;
};

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      documents: [],
      workspaceNotes: "",

      addDocuments: (docs) =>
        set({ documents: [...get().documents, ...docs] }),

      clearDocuments: () => set({ documents: [] }),

      setWorkspaceNotes: (notes) => set({ workspaceNotes: notes }),

      clearWorkspaceNotes: () => set({ workspaceNotes: "" }),

      clearAll: () => set({ documents: [], workspaceNotes: "" }),
    }),
    { name: "collision-iq-session" }
  )
);
