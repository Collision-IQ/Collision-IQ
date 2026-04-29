"use client";

import React, { useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import type { UploadedDocument } from "@/lib/sessionStore";
import {
  formatBytes,
  MAX_UPLOAD_BATCH_FILES,
  MAX_UPLOAD_FILE_BYTES,
} from "@/components/chatWidget/attachmentUtils";

type Props = {
  onUploadComplete: (docs: UploadedDocument[]) => void;
  buttonLabel?: string;
};

export default function FileUpload({
  onUploadComplete,
  buttonLabel = "Upload documents",
}: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { isLoaded, isSignedIn } = useUser();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const uploadDisabled = !isLoaded || !isSignedIn;

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    if (uploadDisabled) {
      router.push("/sign-in?next=/chatbot");
      setError("Please sign in before uploading.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const selectedFiles = Array.from(files);
      const acceptedFiles = selectedFiles
        .slice(0, MAX_UPLOAD_BATCH_FILES)
        .filter((file) => file.size <= MAX_UPLOAD_FILE_BYTES);
      const failures = [
        ...selectedFiles.slice(MAX_UPLOAD_BATCH_FILES).map(
          (file) => `${file.name}: only ${MAX_UPLOAD_BATCH_FILES} files can be uploaded at a time.`
        ),
        ...selectedFiles
          .slice(0, MAX_UPLOAD_BATCH_FILES)
          .filter((file) => file.size > MAX_UPLOAD_FILE_BYTES)
          .map(
            (file) =>
              `${file.name}: ${formatBytes(file.size)} exceeds ${formatBytes(MAX_UPLOAD_FILE_BYTES)}.`
          ),
      ];

      const docs: UploadedDocument[] = [];

      for (const file of acceptedFiles) {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/upload", {
          method: "POST",
          credentials: "include",
          body: formData,
        });

        const data = (await res.json().catch(() => null)) as
          | {
              documents?: UploadedDocument[];
              failedUploads?: Array<{ filename?: string; reason?: string }>;
              error?: string;
            }
          | null;

        if (res.status === 401) {
          router.push("/sign-in?next=/chatbot");
          throw new Error("Please sign in before uploading.");
        }

        if (!res.ok) {
          if (data?.failedUploads?.length) {
            failures.push(
              ...data.failedUploads.map(
                (failure) =>
                  `${failure.filename ?? file.name}: ${failure.reason ?? "Upload failed."}`
              )
            );
            continue;
          }

          failures.push(`${file.name}: ${data?.error ?? `Upload failed (${res.status}).`}`);
          continue;
        }

        if (!data?.documents?.length) {
          failures.push(`${file.name}: upload response missing documents.`);
          continue;
        }

        docs.push(...data.documents);
        if (data.failedUploads?.length) {
          failures.push(
            ...data.failedUploads.map(
              (failure) =>
                `${failure.filename ?? file.name}: ${failure.reason ?? "Upload failed."}`
            )
          );
        }
      }

      if (!docs.every((doc) => typeof doc?.filename === "string" && typeof doc?.text === "string")) {
        throw new Error("Upload documents have invalid shape");
      }

      if (docs.length) {
        onUploadComplete(docs);
        setUploaded(docs.map((doc) => doc.filename));
      }

      if (failures.length) {
        setError(`Could not attach ${failures.join("; ")}`);
      }

      if (!docs.length && failures.length) {
        return;
      }

      if (inputRef.current) inputRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);

    if (uploadDisabled) {
      router.push("/sign-in?next=/chatbot");
      setError("Please sign in before uploading.");
      return;
    }

    void uploadFiles(e.dataTransfer.files);
  }

  return (
    <div className="space-y-3">
      <label className="sr-only" htmlFor="file-upload">
        Upload documents
      </label>

      <input
        id="file-upload"
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        disabled={uploadDisabled}
        onChange={(e) => void uploadFiles(e.target.files)}
      />

      <div
        onDragOver={(e) => {
          if (uploadDisabled) return;

          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={`rounded-xl border border-white/10 p-4 text-center transition ${
          uploadDisabled ? "cursor-not-allowed bg-black/30 opacity-60" : "cursor-pointer"
        } ${dragActive ? "bg-white/10" : "bg-black/40"}`}
        onClick={() => {
          if (uploadDisabled) {
            router.push("/sign-in?next=/chatbot");
            setError("Please sign in before uploading.");
            return;
          }

          inputRef.current?.click();
        }}
        title={!isSignedIn ? "Sign in to upload files." : "Upload files"}
      >
        <div className="mb-1 text-sm text-white/70">
          {busy ? "Uploading..." : buttonLabel}
        </div>

        <div className="text-xs text-white/40">
          {uploadDisabled ? (
            "Sign in to upload files"
          ) : (
            "Drag files here or click to browse"
          )}
        </div>
      </div>

      {uploaded.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {uploaded.map((name) => (
            <div
              key={name}
              className="rounded border-glass bg-glass px-2 py-1 text-xs backdrop-blur-md"
            >
              {name}
            </div>
          ))}
        </div>
      )}

      {error && <div className="rounded bg-red-950 px-3 py-2 text-sm text-red-200">{error}</div>}
    </div>
  );
}
