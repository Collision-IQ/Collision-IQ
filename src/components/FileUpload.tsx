"use client";

import React, { useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
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
  const { isLoaded, isSignedIn } = useUser();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const uploadDisabled = !isLoaded || !isSignedIn;

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    if (uploadDisabled) {
      setError("Please sign in before uploading.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const formData = new FormData();
      Array.from(files).forEach((file) => formData.append("files", file));

      const res = await fetch("/api/upload", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (res.status === 401) {
        throw new Error("Please sign in before uploading.");
      }

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

      if (!docs.every((doc) => typeof doc?.filename === "string" && typeof doc?.text === "string")) {
        throw new Error("Upload documents have invalid shape");
      }

      onUploadComplete(docs);
      setUploaded(docs.map((doc) => doc.filename));

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

    if (uploadDisabled) {
      setError("Please sign in before uploading.");
      return;
    }

    void uploadFiles(e.dataTransfer.files);
  }

  return (
    <div className="space-y-3">
      <label className="sr-only" htmlFor="file-upload">
        Upload documents
      </label>

      <input
        id="file-upload"
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        disabled={uploadDisabled}
        onChange={(e) => void uploadFiles(e.target.files)}
      />

      <div
        onDragOver={(e) => {
          if (uploadDisabled) return;

          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={`rounded-xl border border-white/10 p-4 text-center transition ${
          uploadDisabled ? "cursor-not-allowed bg-black/30 opacity-60" : "cursor-pointer"
        } ${dragActive ? "bg-white/10" : "bg-black/40"}`}
        onClick={() => {
          if (uploadDisabled) {
            setError("Please sign in before uploading.");
            return;
          }

          inputRef.current?.click();
        }}
        title={!isSignedIn ? "Sign in to upload files." : "Upload files"}
      >
        <div className="mb-1 text-sm text-white/70">
          {busy ? "Uploading..." : buttonLabel}
        </div>

        <div className="text-xs text-white/40">
          {uploadDisabled ? "Sign in to upload files" : "Drag files here or click to browse"}
        </div>
      </div>

      {uploaded.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {uploaded.map((name) => (
            <div
              key={name}
              className="rounded border-glass bg-glass px-2 py-1 text-xs backdrop-blur-md"
            >
              {name}
            </div>
          ))}
        </div>
      )}

      {error && <div className="rounded bg-red-950 px-3 py-2 text-sm text-red-200">{error}</div>}
    </div>
  );
}
