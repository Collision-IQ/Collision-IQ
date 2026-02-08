"use client";

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
  clearDocuments: () => void;
  setWorkspaceNotes: (notes: string) => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  documents: [],
  workspaceNotes: "",

  setDocuments: (docs) => set({ documents: docs }),
  clearDocuments: () => set({ documents: [] }),
  setWorkspaceNotes: (notes) => set({ workspaceNotes: notes }),
}));
