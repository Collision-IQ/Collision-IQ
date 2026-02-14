"use client";

import Image from "next/image";
import FileUpload from "./FileUpload";
import { useSessionStore, type UploadedDocument } from "@/lib/sessionStore";

export default function WorkspacePanel({ variant }: { variant: "left" | "right" }) {
  const documents = useSessionStore((s) => s.documents);
  const workspaceNotes = useSessionStore((s) => s.workspaceNotes);
  const setWorkspaceNotes = useSessionStore((s) => s.setWorkspaceNotes);
  const addDocuments = useSessionStore((s) => s.addDocuments);
  const clearDocuments = useSessionStore((s) => s.clearDocuments);

  const docCount =
    documents.length === 0
      ? "No documents"
      : documents.length === 1
      ? "1 document"
      : `${documents.length} documents`;

  function onUploadComplete(newDocs: UploadedDocument[]) {
    addDocuments(newDocs);
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="relative h-9 w-9 overflow-hidden rounded-xl border border-border bg-black/30">
          <Image
            src="/brand/Collision Academy Logo Vertical - White.png"
            alt="Collision Academy"
            fill
            className="object-contain p-1.5"
            priority
          />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-text">
            Collision IQ
          </div>
          <div className="text-xs text-muted">
            {variant === "left" ? "Workspace" : "Inspector"} • {docCount}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-black/20 p-3">
        <FileUpload onUploadComplete={onUploadComplete} buttonLabel="Upload documents" />
        <div className="mt-2 text-xs text-muted">
          PDFs, images, estimates — attach anything relevant.
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-black/20 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-semibold text-text">Attached</div>
          <button
            onClick={clearDocuments}
            className="rounded-lg border border-border bg-white/5 px-2 py-1 text-[11px] text-text hover:bg-white/10"
            type="button"
          >
            Clear
          </button>
        </div>

        {documents.length === 0 ? (
          <div className="text-xs text-muted">No files attached yet.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {documents.map((d, idx) => (
              <div
                key={`${d.filename}-${idx}`}
                className="max-w-full rounded-full border border-border bg-white/5 px-3 py-1 text-xs text-text"
                title={d.filename}
              >
                <span className="truncate">{d.filename}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 rounded-2xl border border-border bg-black/20 p-3">
        <div className="mb-2 text-xs font-semibold text-text">Workspace notes</div>
        <textarea
          className="h-[160px] w-full resize-none rounded-xl border border-border bg-black/30 p-3 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
          placeholder="Optional notes: vehicle, insurer, constraints, goals..."
          value={workspaceNotes}
          onChange={(e) => setWorkspaceNotes(e.target.value)}
        />
        <div className="mt-2 text-xs text-muted">
          Notes are included with every request.
        </div>
      </div>
    </div>
  );
}
