"use client";

import React, { useRef, useState } from "react";
import type { UploadedDocument } from "@/lib/sessionStore";

type Props = {
  buttonLabel?: string;
  onUploadComplete: (newDocs: UploadedDocument[]) => void;
};

type UploadResponse = {
  documents?: UploadedDocument[];
  error?: string;
};

function isUploadResponse(x: unknown): x is UploadResponse {
  return !!x && typeof x === "object";
}

export default function FileUpload({
  buttonLabel = "Upload documents",
  onUploadComplete,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePick() {
    inputRef.current?.click();
  }

  async function handleFilesSelected(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    setBusy(true);
    setError(null);

    try {
      const formData = new FormData();
      Array.from(fileList).forEach((f) => formData.append("files", f));

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `Upload failed (${res.status})`);
      }

      const raw: unknown = await res.json().catch(() => ({}));
      if (!isUploadResponse(raw)) throw new Error("Bad upload response");

      const docs = Array.isArray(raw.documents) ? raw.documents : [];
      if (docs.length === 0) {
        throw new Error(raw.error || "No documents returned from upload");
      }

      onUploadComplete(docs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      // allow re-uploading same file
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="w-full">
      <input
        ref={inputRef}
        type="file"
        multiple
        onChange={handleFilesSelected}
        className="hidden"
        aria-label="Upload documents"
      />

      <button
        type="button"
        onClick={handlePick}
        disabled={busy}
        className="w-full rounded bg-orange-500 px-4 py-2 font-medium text-black disabled:opacity-60"
      >
        {busy ? "Uploading..." : buttonLabel}
      </button>

      {error ? (
        <div className="mt-2 rounded bg-red-500/15 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      ) : null}
    </div>
  );
}
