// src/lib/sessionStore.ts
import { create } from "zustand";
import type { UploadedDocument } from "@/types/uploadedDocument";

type SessionState = {
  documents: UploadedDocument[];
  setDocuments: (docs: UploadedDocument[]) => void;
  clearDocuments: () => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  documents: [],
  setDocuments: (docs) => set({ documents: docs }),
  clearDocuments: () => set({ documents: [] }),
}));
