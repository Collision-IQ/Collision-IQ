'use client';

import { useRef, useState } from 'react';
import type { UploadedDocument } from '@/types/uploadedDocument';

type Props = {
  onUploadComplete: (docs: UploadedDocument[]) => void;
};

export default function FileUpload({ onUploadComplete }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files || !e.target.files.length) return;

    setLoading(true);

    const formData = new FormData();
    Array.from(e.target.files).forEach((file) =>
      formData.append('files', file)
    );

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (data.success) {
        onUploadComplete(data.documents);
      } else {
        console.error('Upload failed:', data.error);
      }
    } catch (err) {
      console.error('Upload error:', err);
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="flex items-center gap-3">
      {/* Hidden native input */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.png,.jpg,.jpeg"
        onChange={handleFiles}
        className="hidden"
      />

      {/* Button trigger */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className="rounded px-3 py-2 text-sm font-medium
                   bg-orange-600 text-white
                   hover:bg-orange-700
                   disabled:opacity-60"
      >
        {loading ? 'Uploading…' : 'Upload documents'}
      </button>

      {loading && (
        <span className="text-xs opacity-70">
          Parsing documents…
        </span>
      )}
    </div>
  );
}
