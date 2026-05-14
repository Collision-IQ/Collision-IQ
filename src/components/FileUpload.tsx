"use client";

import React, { useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import type { AccountEntitlements } from "@/lib/billing/entitlements";
import type { UploadedDocument } from "@/lib/sessionStore";
import {
  formatBytes,
  MAX_UPLOAD_FILE_BYTES,
} from "@/components/chatWidget/attachmentUtils";
import {
  getUploadBatchLimitMessage,
  resolveUploadPlanLimits,
} from "@/lib/uploadSafety/uploadLimits";

type Props = {
  onUploadComplete: (docs: UploadedDocument[]) => void;
  buttonLabel?: string;
};

type UploadStage = "idle" | "uploading" | "extracting_zip" | "preparing_analysis";

const LARGE_UPLOAD_WARNING_BYTES = 10 * 1024 * 1024;
const STARTER_UPLOAD_LIMITS = resolveUploadPlanLimits({
  plan: "starter",
  billingPlan: "starter",
  isPlatformAdmin: false,
  entitlementSource: "starter_subscription",
  maxUploadsPerReview: 1,
});

function isZipFile(file: Pick<File, "name" | "type">) {
  return (
    file.name.toLowerCase().endsWith(".zip") ||
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed"
  );
}

function formatUploadFailure(filename: string, failure?: { reason?: string; code?: string }) {
  if (!failure) return `${filename}: Upload failed.`;

  if (failure.code === "RUNTIME_BODY_LIMIT_EXCEEDED") {
    return `${filename}: This file is within your plan limit, but exceeds the current platform upload limit. Direct large-file upload support is coming soon. For now, split ZIPs over 20 MB into smaller uploads.`;
  }

  if (failure.code === "UPLOAD_BODY_PARSE_FAILED") {
    return `${filename}: this upload may exceed the current platform upload limit. Direct large-file upload support is coming soon. For now, split ZIPs over 20 MB into smaller uploads.`;
  }

  if (failure.code?.startsWith("ZIP_")) {
    return `${filename}: ${failure.reason ?? "ZIP could not be extracted safely."}`;
  }

  return `${filename}: ${failure.reason ?? "Upload failed."}`;
}

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
  const [uploadHint, setUploadHint] = useState("You can upload PDFs, photos, screenshots, or ZIP files.");
  const [maxUploadBatchFiles, setMaxUploadBatchFiles] = useState(
    STARTER_UPLOAD_LIMITS.maxFilesPerReview
  );
  const [uploadPlanName, setUploadPlanName] = useState(STARTER_UPLOAD_LIMITS.plan);
  const [uploadLimitsLoaded, setUploadLimitsLoaded] = useState(false);
  const [zipSummary, setZipSummary] = useState<string | null>(null);
  const [largeUploadWarning, setLargeUploadWarning] = useState<string | null>(null);
  const [uploadStage, setUploadStage] = useState<UploadStage>("idle");
  const [dragActive, setDragActive] = useState(false);
  const uploadDisabled = !isLoaded || !isSignedIn || (isSignedIn && !uploadLimitsLoaded);

  useEffect(() => {
    if (!isSignedIn) {
      return;
    }

    let cancelled = false;
    async function loadEntitlements() {
      try {
        const response = await fetch("/api/account/entitlements", {
          credentials: "same-origin",
        });
        if (!response.ok) {
          if (cancelled) return;
          setUploadLimitsLoaded(true);
          return;
        }

        const entitlements = (await response.json()) as AccountEntitlements;
        if (cancelled) return;

        const uploadLimits = resolveUploadPlanLimits(entitlements);
        setMaxUploadBatchFiles(uploadLimits.maxFilesPerReview);
        setUploadPlanName(uploadLimits.plan);

        if (uploadLimits.plan === "admin") {
          setUploadHint(`You can upload PDFs, photos, screenshots, or ZIP files. ${getUploadBatchLimitMessage(uploadLimits)} Admin target: 50 MB per file; temporary platform upload limit: 20 MB.`);
        } else if (uploadLimits.plan === "pro" || uploadLimits.plan === "trial") {
          setUploadHint(`You can upload PDFs, photos, screenshots, or ZIP files. ${getUploadBatchLimitMessage(uploadLimits)} Pro trial/Pro target: 30 MB; temporary platform upload limit: 20 MB.`);
        } else if (uploadLimits.plan === "free") {
          setUploadHint(`Free accounts can upload PDFs or photos. ${getUploadBatchLimitMessage(uploadLimits)} Monthly limit: 5 uploads.`);
        } else {
          setUploadHint(`You can upload PDFs, photos, screenshots, or ZIP files. ${getUploadBatchLimitMessage(uploadLimits)} Starter: 10 MB; ZIP files are not included.`);
        }
        setUploadLimitsLoaded(true);
      } catch {
        // Server-side upload limits remain authoritative.
        if (!cancelled) {
          setUploadLimitsLoaded(true);
        }
      }
    }

    void loadEntitlements();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn]);

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    if (uploadDisabled) {
      if (!isSignedIn) {
        router.push("/sign-in?next=/chatbot");
        setError("Please sign in before uploading.");
      } else {
        setError("Upload limits are still loading. Try again in a moment.");
      }
      return;
    }

    setBusy(true);
    setError(null);
    setZipSummary(null);
    setLargeUploadWarning(null);
    setUploadStage("uploading");

    try {
      const selectedFiles = Array.from(files);
      const largeFiles = selectedFiles.filter((file) => file.size >= LARGE_UPLOAD_WARNING_BYTES);
      if (largeFiles.length) {
        setLargeUploadWarning("Large files may take longer. Keep this tab open.");
      }
      if (selectedFiles.some(isZipFile)) {
        setUploadStage("extracting_zip");
      }

      const acceptedFiles = selectedFiles
        .slice(0, maxUploadBatchFiles)
        .filter((file) => file.size <= MAX_UPLOAD_FILE_BYTES);
      const failures = [
        ...selectedFiles.slice(maxUploadBatchFiles).map(
          (file) => `${file.name}: ${getUploadBatchLimitMessage({ maxFilesPerReview: maxUploadBatchFiles, plan: uploadPlanName })}`
        ),
        ...selectedFiles
          .slice(0, maxUploadBatchFiles)
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
              zipSummaries?: Array<{
                archive?: string;
                acceptedFiles?: number;
                rejectedFiles?: number;
                extractedBytes?: number;
              }>;
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
                  formatUploadFailure(failure.filename ?? file.name, failure)
              )
            );
            continue;
          }

          failures.push(
            data?.error
              ? `${file.name}: ${data.error}`
              : `${file.name}: Upload failed (${res.status}).`
          );
          continue;
        }

        if (!data?.documents?.length) {
          failures.push(`${file.name}: upload response missing documents.`);
          continue;
        }

        docs.push(...data.documents);
        if (data.zipSummaries?.length) {
          setUploadStage("preparing_analysis");
          setZipSummary(
            data.zipSummaries
              .map((summary) => {
                const accepted = summary.acceptedFiles ?? 0;
                const rejected = summary.rejectedFiles ?? 0;
                return `${summary.archive ?? "ZIP"}: extracted ${accepted} supported ${accepted === 1 ? "file" : "files"}${rejected ? `, rejected ${rejected}` : ""}.`;
              })
              .join(" ")
          );
        }
        if (data.failedUploads?.length) {
          failures.push(
            ...data.failedUploads.map(
              (failure) =>
                formatUploadFailure(failure.filename ?? file.name, failure)
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
      setUploadStage("idle");
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);

    if (uploadDisabled) {
      if (!isSignedIn) {
        router.push("/sign-in?next=/chatbot");
        setError("Please sign in before uploading.");
      } else {
        setError("Upload limits are still loading. Try again in a moment.");
      }
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
            if (!isSignedIn) {
              router.push("/sign-in?next=/chatbot");
              setError("Please sign in before uploading.");
            } else {
              setError("Upload limits are still loading. Try again in a moment.");
            }
            return;
          }

          inputRef.current?.click();
        }}
        title={!isSignedIn ? "Sign in to upload files." : "Upload files"}
      >
        <div className="mb-1 text-sm text-white/70">
          {busy
            ? uploadStage === "extracting_zip"
              ? "Extracting ZIP..."
              : uploadStage === "preparing_analysis"
                ? "Preparing analysis..."
                : "Uploading..."
            : buttonLabel}
        </div>

        <div className="text-xs text-white/40">
          {uploadDisabled ? (
            isSignedIn ? "Loading upload limits..." : "Sign in to upload files"
          ) : (
            uploadHint
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

      {largeUploadWarning && <div className="text-xs text-amber-200">{largeUploadWarning}</div>}
      {busy && <div className="text-xs text-white/50">Keep this tab open while upload processing finishes.</div>}
      {zipSummary && <div className="rounded bg-slate-900 px-3 py-2 text-sm text-slate-200">{zipSummary}</div>}
      {error && <div className="rounded bg-red-950 px-3 py-2 text-sm text-red-200">{error}</div>}
    </div>
  );
}
