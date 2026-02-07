"use client";

import { useRef } from "react";
import type { UploadedDocument } from "@/types/uploadedDocument";

type Props = {
  onUploadComplete: (docs: UploadedDocument[]) => void;
  buttonLabel?: string;
  className?: string;
  inputRef?: React.RefObject<HTMLInputElement>;
};

export default function FileUpload({
  onUploadComplete,
  buttonLabel = "Upload docs",
  className = "",
  inputRef,
}: Props) {
  const localRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? localRef;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

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

    const data = await res.json();
    const docs: UploadedDocument[] = data?.documents ?? [];
    onUploadComplete(docs);
  }

  return (
    <div className={className}>
      <input
        ref={ref}
        type="file"
        aria-label="Upload documents"
        multiple
        accept=".pdf,image/*"
        className="hidden"
        onChange={(e) => {
          // copy immediately to avoid any synthetic event weirdness
          const files = e.currentTarget.files;
          // reset value so the same file can be re-selected
          e.currentTarget.value = "";
          handleFiles(files).catch((err) => {
            console.error(err);
            alert(err?.message ?? "Upload failed");
          });
        }}
      />

      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="rounded-xl bg-[color:var(--accent)] px-4 py-2 font-semibold text-black hover:opacity-90"
      >
        {buttonLabel}
      </button>
    </div>
  );
}
