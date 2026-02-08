"use client";

import { UploadedDocument } from "@/lib/sessionStore";

type Props = {
  buttonLabel?: string;
  onUploadComplete: (docs: UploadedDocument[]) => void;
};

export default function FileUpload({
  buttonLabel = "Upload documents",
  onUploadComplete,
}: Props) {
  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files) return;

    const formData = new FormData();
    Array.from(e.target.files).forEach((f) => formData.append("files", f));

    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();
    onUploadComplete(data.documents ?? []);
  }

  return (
    <label className="cursor-pointer">
      <input type="file" multiple hidden onChange={handleChange} />
      <div className="btn">{buttonLabel}</div>
    </label>
  );
}
