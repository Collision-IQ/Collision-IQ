"use client";

import { SignInButton, useAuth } from "@clerk/nextjs";
import { useState } from "react";

export default function UploadPage() {
  const { isLoaded, userId } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string>("");

  async function handleUpload() {
    if (!file || !userId) return;

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (res.status === 401) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || "Please sign in on this site before uploading.");
      }

      const data = await res.json();
      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(
        JSON.stringify(
          {
            error: error instanceof Error ? error.message : "Upload failed.",
          },
          null,
          2
        )
      );
    }
  }

  return (
    <div style={{ padding: 40 }}>
      <h1>Upload Docs</h1>

      <label htmlFor="file-input">Select a file to upload:</label>
      <input
        id="file-input"
        type="file"
        disabled={!isLoaded || !userId}
        onChange={(e) => setFile(e.target.files?.[0] || null)}
      />

      {!isLoaded ? (
        <button disabled>Upload</button>
      ) : !userId ? (
        <SignInButton
          mode="modal"
          forceRedirectUrl={typeof window !== "undefined" ? window.location.href : "/upload"}
        >
          <button type="button">Sign in to upload</button>
        </SignInButton>
      ) : (
        <button onClick={() => void handleUpload()}>Upload</button>
      )}

      <pre>{result}</pre>
    </div>
  );
}
  