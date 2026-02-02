'use client';

import { useState } from 'react';

export type UploadedFile = {
  filename: string;
  type: string;
  text: string;
};

type Props = {
  onUploaded: (files: UploadedFile[]) => void;
};

export default function FileUpload({ onUploaded }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.length) return;

    setLoading(true);

    const formData = new FormData();
    Array.from(e.target.files).forEach((file) =>
      formData.append('file', file)
    );

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    const data = await res.json();

    const parsed: UploadedFile[] = data.results.map((r: any) => ({
      filename: r.filename,
      type: r.filename.split('.').pop() ?? 'unknown',
      text: r.text,
    }));

    onUploaded(parsed);
    setLoading(false);
  }

  return (
    <div className="space-y-2">
      <input
        type="file"
        multiple
        accept=".pdf,image/*"
        onChange={handleFiles}
      />
      {loading && (
        <div className="text-sm text-muted">
          Parsing documents…
        </div>
      )}
    </div>
  );
}
