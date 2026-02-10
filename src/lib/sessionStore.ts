import { create } from "zustand"

export type UploadedDocument = {
  filename: string
  type: string
  text: string
}

export type SessionState = {
  documents: UploadedDocument[]
  workspaceNotes: string

  addDocuments: (docs: UploadedDocument[]) => void
  clearDocuments: () => void
  setWorkspaceNotes: (notes: string) => void
}

export const useSessionStore = create<SessionState>((set) => ({
  documents: [],
  workspaceNotes: "",

  addDocuments: (docs) =>
    set((s) => ({
      documents: [...s.documents, ...docs],
    })),

  clearDocuments: () =>
    set({
      documents: [],
    }),

  setWorkspaceNotes: (notes) =>
    set({
      workspaceNotes: notes,
    }),
}))
