"use client";

import React, { useRef, useState } from "react";
import type { UploadedDocument } from "@/lib/sessionStore";

type Props = {
  onUploadComplete: (docs: UploadedDocument[]) => void;
  buttonLabel?: string;
};

export default function FileUpload({
  onUploadComplete,
  buttonLabel = "Upload documents",
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    setBusy(true);
    setError(null);

    try {
      const formData = new FormData();
      Array.from(files).forEach((f) => formData.append("files", f));

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `Upload failed (${res.status})`);
      }

      const data: unknown = await res.json();

      // runtime-safe parse
      if (
        !data ||
        typeof data !== "object" ||
        !("documents" in data) ||
        !Array.isArray((data as { documents: unknown }).documents)
      ) {
        throw new Error("Upload response missing documents[]");
      }

      const docs = (data as { documents: UploadedDocument[] }).documents;

      // sanity
      if (!docs.every((d) => typeof d?.filename === "string" && typeof d?.text === "string")) {
        throw new Error("Upload documents have invalid shape");
      }

      onUploadComplete(docs);

      // clear input so re-uploading same file works
      if (inputRef.current) inputRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="sr-only" htmlFor="file-upload-input">
        Upload files
      </label>
      <input
        id="file-upload-input"
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => void uploadFiles(e.target.files)}
      />

      <button
        type="button"
        className="w-full rounded bg-orange-600 px-4 py-2 font-semibold text-black disabled:opacity-60"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "Uploading..." : buttonLabel}
      </button>

      {error ? (
        <div className="rounded bg-red-950 px-3 py-2 text-sm text-red-200">
          ⚠️ {error}
        </div>
      ) : null}
    </div>
  );
}
