'use client';

import { useState } from 'react';

export default function FileUpload() {
  const [files, setFiles] = useState<FileList | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async () => {
    if (!files) return;

    setUploading(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    Array.from(files).forEach(file => {
      formData.append('file', file);
    });

    try {
      const res = await fetch('/api/chat/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-4 rounded-xl border border-gray-300 shadow bg-white max-w-md mx-auto mt-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">Upload PDF or DOCX</label>
      <input
        type="file"
        accept=".pdf,.docx"
        multiple
        onChange={e => setFiles(e.target.files)}
        className="mb-3"
      />

      <button
        onClick={handleUpload}
        disabled={!files || uploading}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {uploading ? 'Uploading...' : 'Upload'}
      </button>

      {error && <p className="text-red-500 mt-2 text-sm">{error}</p>}
      {result && (
        <pre className="mt-3 bg-gray-100 p-2 text-sm rounded overflow-auto max-h-60">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
