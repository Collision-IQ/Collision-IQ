"use client";

import * as React from "react";

export type UploadedDocument = {
  filename: string;
  type: string;
  text: string;
};

type Props = {
  buttonLabel?: string;
  onUploadComplete: (newDocs: UploadedDocument[]) => void;
};

export default function FileUpload({ buttonLabel = "Upload documents", onUploadComplete }: Props) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      Array.from(files).forEach((f) => formData.append("files", f));

      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `Upload failed (${res.status})`);
      }

      const json = (await res.json()) as { documents?: UploadedDocument[] };
      const docs = Array.isArray(json.documents) ? json.documents : [];
      onUploadComplete(docs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.txt,.md,.doc,.docx,image/*"
        onChange={handlePick}
        className="hidden"
        aria-label="Upload documents"
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="w-full rounded bg-orange-500 px-3 py-2 text-sm font-medium text-black disabled:opacity-60"
      >
        {uploading ? "Uploading…" : buttonLabel}
      </button>

      {error ? <div className="text-xs text-red-400">{error}</div> : null}
    </div>
  );
}
