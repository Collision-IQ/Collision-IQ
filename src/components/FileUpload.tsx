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
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    setBusy(true);
    setError(null);

    try {
      const formData = new FormData();
      Array.from(files).forEach((f) => formData.append("files", f));

      const res = await fetch("/api/upload", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `Upload failed (${res.status})`);
      }

      const data: unknown = await res.json();

      if (
        !data ||
        typeof data !== "object" ||
        !("documents" in data) ||
        !Array.isArray((data as { documents: unknown }).documents)
      ) {
        throw new Error("Upload response missing documents[]");
      }

      const docs = (data as { documents: UploadedDocument[] }).documents;

      if (
        !docs.every(
          (d) => typeof d?.filename === "string" && typeof d?.text === "string"
        )
      ) {
        throw new Error("Upload documents have invalid shape");
      }

      onUploadComplete(docs);

      setUploaded(docs.map((d) => d.filename));

      if (inputRef.current) inputRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    uploadFiles(e.dataTransfer.files);
  }

  return (
    <div className="space-y-3">

      {/* Hidden file input */}

      <label className="sr-only" htmlFor="file-upload">
        Upload documents
      </label>

      <input
        id="file-upload"
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => void uploadFiles(e.target.files)}
      />

      {/* Upload area */}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={`border border-white/10 rounded-xl p-4 text-center cursor-pointer transition
        ${dragActive ? "bg-white/10" : "bg-black/40"}`}
        onClick={() => inputRef.current?.click()}
      >

        <div className="text-sm text-white/70 mb-1">
          {busy ? "Uploading…" : buttonLabel}
        </div>

        <div className="text-xs text-white/40">
          Drag files here or click to browse
        </div>

      </div>

      {/* Uploaded file chips */}

      {uploaded.length > 0 && (
        <div className="flex flex-wrap gap-2">

          {uploaded.map((name) => (
            <div
              key={name}
              className="text-xs bg-glass border-glass backdrop-blur-md px-2 py-1 rounded"
            >
              {name}
            </div>
          ))}

        </div>
      )}

      {/* Error */}

      {error && (
        <div className="rounded bg-red-950 px-3 py-2 text-sm text-red-200">
          ⚠️ {error}
        </div>
      )}

    </div>
  );
}
