// src/components/FileUpload.tsx
"use client";

import React, { useRef, useState } from "react";
import { useSessionStore, type UploadedDocument } from "@/lib/sessionStore";

type Props = {
  buttonLabel?: string;
};

export default function FileUpload({ buttonLabel = "Upload documents" }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<string>("");

  const addDocuments = useSessionStore((s) => s.addDocuments);

  async function onPickFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    setStatus("Uploading…");

    const formData = new FormData();
    Array.from(files).forEach((f) => formData.append("files", f));

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `Upload failed (${res.status})`);
      }

      const data = (await res.json()) as { documents: UploadedDocument[] };
      const docs = Array.isArray(data.documents) ? data.documents : [];

      addDocuments(docs);
      setStatus(`Uploaded ${docs.length} document(s). Ask a question and I’ll use them as context.`);
    } catch (e: any) {
      setStatus(`Upload error: ${String(e?.message ?? e)}`);
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="w-full">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        multiple
        onChange={(e) => onPickFiles(e.target.files)}
        accept=".pdf,.png,.jpg,.jpeg,.txt"
      />

      <button
        type="button"
        className="w-full rounded bg-orange-600 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-700"
        onClick={() => inputRef.current?.click()}
      >
        {buttonLabel}
      </button>

      {status ? (
        <div className="mt-2 rounded bg-neutral-800 p-2 text-xs text-neutral-100">
          {status}
        </div>
      ) : null}
    </div>
  );
}
