"use client";

import { useState } from "react";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<any>(null);

  async function onUpload() {
    if (!file) return;
    setStatus("Uploading...");
    setResult(null);

    const fd = new FormData();
    fd.append("file", file);

    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setStatus(`Error: ${data?.error ?? res.statusText}`);
      return;
    }

    setStatus("Uploaded!");
    setResult(data);
  }

  return (
    <main style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 12 }}>
        Upload Docs
      </h1>

      <input
        type="file"
        accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />

      <div style={{ marginTop: 12 }}>
        <button onClick={onUpload} disabled={!file}>
          Upload
        </button>
      </div>

      {status && <p style={{ marginTop: 12 }}>{status}</p>}

      {result && (
        <pre style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>
          {JSON.stringify(
            { name: result.name, mime: result.mime, chars: result.chars },
            null,
            2
          )}
        </pre>
      )}
    </main>
  );
}
