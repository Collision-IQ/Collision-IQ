"use client";

import React, { useRef, useState } from "react";
import type { UploadedDocument } from "@/lib/sessionStore";

type Props = {
  buttonLabel?: string;
  onUploadComplete: (docs: UploadedDocument[]) => void;
};

export default function FileUpload({
  buttonLabel = "Upload documents",
  onUploadComplete,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    setError(null);
    setUploading(true);

    try {
      const formData = new FormData();
      Array.from(files).forEach((f) => formData.append("files", f));

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Upload failed (${res.status})`);
      }

      const data: unknown = await res.json();

      // Runtime guard (no `any`)
      if (
        typeof data !== "object" ||
        data === null ||
        !("documents" in data) ||
        !Array.isArray((data as { documents: unknown }).documents)
      ) {
        throw new Error("Upload response missing documents[]");
      }

      const docs = (data as { documents: UploadedDocument[] }).documents;
      onUploadComplete(docs);

      // Clear the input so re-uploading the same file triggers change event
      if (inputRef.current) inputRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="w-full">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          handleFiles(e.target.files)
        }
      />

      <button
        type="button"
        className="w-full rounded bg-orange-500 px-4 py-2 font-semibold text-black disabled:opacity-60"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? "Uploading..." : buttonLabel}
      </button>

      {error && (
        <div className="mt-2 rounded bg-red-900/40 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}
