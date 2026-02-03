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
    if (!e.target.files?.length) return;

    setLoading(true);

    const formData = new FormData();
    Array.from(e.target.files).forEach((f) =>
      formData.append('files', f)
    );

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    const data = await res.json();

    if (data.success) {
      onUploadComplete(data.documents);
    }

    setLoading(false);
    e.target.value = '';
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.png,.jpg,.jpeg"
        onChange={handleFiles}
        className="hidden"
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className="w-full rounded-md bg-orange-600 px-4 py-2 text-sm text-white hover:bg-orange-700 disabled:opacity-50"
      >
        {loading ? 'Uploading…' : 'Upload documents'}
      </button>
    </div>
  );
}
// This component provides a file upload interface that allows users to select
// and upload multiple documents. It handles the file selection, sends the files
// to the server via a POST request, and invokes a callback with the uploaded
// document metadata upon successful upload. The component also manages loading
// state to provide user feedback during the upload process.