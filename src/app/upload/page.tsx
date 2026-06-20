"use client";

import { upload as uploadBlob } from "@vercel/blob/client";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { useState } from "react";

export default function UploadPage() {
  const { getToken, isLoaded, userId } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string>("");

  function shouldUseDirectUpload(uploadFile: File) {
    return (
      uploadFile.size > 8 * 1024 * 1024 ||
      /\.zip$/i.test(uploadFile.name) ||
      /\.(?:mp4|mov|webm)$/i.test(uploadFile.name) ||
      uploadFile.type.startsWith("video/")
    );
  }

  async function handleUpload() {
    if (!file || !userId) return;

    try {
      const token = await getToken();
      const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;
      let res: Response;

      if (shouldUseDirectUpload(file)) {
        console.info("[upload-client] selected upload route", {
          uploadMode: "direct-storage",
          filename: file.name,
          sizeBytes: file.size,
          zipDetected: /\.zip$/i.test(file.name),
          videoDetected: /\.(?:mp4|mov|webm)$/i.test(file.name) || file.type.startsWith("video/"),
        });
        console.info("[upload-client] directUploadStarted", {
          uploadMode: "direct-storage",
          filename: file.name,
          sizeBytes: file.size,
        });
        const blob = await uploadBlob(`uploads/${Date.now()}-${file.name}`, file, {
          access: "public",
          contentType: file.type || undefined,
          handleUploadUrl: "/api/upload/direct",
          clientPayload: JSON.stringify({
            filename: file.name,
            contentType: file.type,
            sizeBytes: file.size,
            activeCaseId: null,
          }),
          headers: authHeaders,
          multipart: file.size > 8 * 1024 * 1024,
        });
        console.info("[upload-client] directUploadCompleted", {
          uploadMode: "direct-storage",
          filename: file.name,
          pathname: blob.pathname,
        });
        console.info("[upload-client] finalizeStarted", {
          uploadMode: "direct-storage",
          filename: file.name,
          sizeBytes: file.size,
        });
        res = await fetch("/api/upload/finalize", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(authHeaders ?? {}),
          },
          body: JSON.stringify({
            url: blob.url,
            downloadUrl: blob.downloadUrl,
            pathname: blob.pathname,
            filename: file.name,
            contentType: blob.contentType || file.type,
            sizeBytes: file.size,
            activeCaseId: null,
          }),
        });
        console.info("[upload-client] finalizeCompleted", {
          uploadMode: "direct-storage",
          filename: file.name,
          status: res.status,
        });
      } else {
        const formData = new FormData();
        formData.append("file", file);

        res = await fetch("/api/upload", {
          method: "POST",
          credentials: "include",
          headers: authHeaders,
          body: formData,
        });
      }

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
  
