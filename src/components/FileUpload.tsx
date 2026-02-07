import React from "react";
import type { UploadedDocument } from "@/types/uploadedDocument";

type Props = {
  onUploadComplete: (docs: UploadedDocument[]) => void;
  className?: string;
  buttonLabel?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
};

export default function FileUpload({
  onUploadComplete,
  className,
  buttonLabel = "Upload documents",
  inputRef,
}: Props) {
  const innerRef = React.useRef<HTMLInputElement | null>(null);
  const ref = inputRef ?? innerRef;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    const formData = new FormData();
    Array.from(files).forEach((f) => formData.append("files", f));

    const res = await fetch("/api/upload", { method: "POST", body: formData });
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
        multiple
        accept=".pdf,image/*"
        className="hidden"
        aria-label="Upload documents"
        title="Upload documents"
        data-ciq-upload="true"
        onChange={(e) => {
          const files = e.currentTarget.files;
          e.currentTarget.value = ""; // allow re-selecting same file
          handleFiles(files).catch((err) => {
            console.error(err);
            alert(err instanceof Error ? err.message : "Upload failed");
          });
        }}
      />

      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="w-full rounded-xl bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
      >
        {buttonLabel}
      </button>
    </div>
  );
}
