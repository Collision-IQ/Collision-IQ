'use client';

import { useState } from 'react';
import type { UploadedDocument } from '@/types/uploadedDocument';

type Props = {
  onUploadComplete: (docs: UploadedDocument[]) => void;
};

export default function FileUpload({ onUploadComplete }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.length) return;

    setLoading(true);

    const formData = new FormData();
    Array.from(e.target.files).forEach((f) => formData.append('files', f));

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    const data = await res.json();

    if (data.success) {
      onUploadComplete(data.documents);
    }

    setLoading(false);
  }

  return (
    <div className="text-sm">
      <input
        type="file"
        multiple
        accept=".pdf,.png,.jpg,.jpeg"
        onChange={handleFiles}
        disabled={loading}
      />
      {loading && <p className="text-xs opacity-60">Parsing documents…</p>}
    </div>
  );
}
