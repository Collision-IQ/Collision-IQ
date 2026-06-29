"use client";

import React, { useEffect, useRef, useState } from "react";
import { upload as uploadBlob } from "@vercel/blob/client";
import { useAuth, useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import type { AccountEntitlements } from "@/lib/billing/entitlements";
import type { UploadedDocument } from "@/lib/sessionStore";
import {
  formatBytes,
  MAX_UPLOAD_FILE_BYTES,
  validateSelectedVideoDurations,
} from "@/components/chatWidget/attachmentUtils";
import {
  getUploadBatchLimitMessage,
  resolveUploadPlanLimits,
  type UploadPlanLimits,
  VIDEO_UPLOAD_ACCEPT,
  VIDEO_UPLOAD_HINT,
} from "@/lib/uploadSafety/uploadLimits";
import { isNative } from "@/lib/native";
import { VIDEO_MAX_BYTES } from "@/lib/uploadSafety/videoSafety";
import {
  resolveUploadTransport,
  validateDirectUploadCandidate,
} from "@/lib/uploadSafety/directUploadRouting";

type Props = {
  onUploadComplete: (docs: UploadedDocument[]) => void;
  buttonLabel?: string;
};

type UploadStage = "idle" | "uploading" | "extracting_zip" | "preparing_analysis";

const LARGE_UPLOAD_WARNING_BYTES = 10 * 1024 * 1024;
const FALLBACK_UPLOAD_BATCH_FILE_LIMIT = 50;

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
    return `${filename}: ${failure.reason ?? "This upload exceeds the plan limit for this file type."}`;
  }

  if (failure.code === "UPLOAD_BODY_PARSE_FAILED") {
    return `${filename}: ${failure.reason ?? "Upload body could not be read. It may exceed the plan limit for this file type."}`;
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
  const { getToken } = useAuth();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [uploadHint, setUploadHint] = useState(`You can upload PDFs, photos, screenshots, ZIP files, or short videos. ${VIDEO_UPLOAD_HINT}`);
  const [maxUploadBatchFiles, setMaxUploadBatchFiles] = useState<number>(0);
  const [uploadPlanName, setUploadPlanName] = useState<UploadPlanLimits["plan"] | undefined>(undefined);
  const [resolvedUploadLimits, setResolvedUploadLimits] = useState<UploadPlanLimits | null>(null);
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
        const token = await getToken();

        const response = await fetch("/api/account/entitlements", {
          credentials: "same-origin",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!response.ok) {
          console.warn("ENTITLEMENTS_RESPONSE_FAILED", response.status);
          if (cancelled) return;
          setMaxUploadBatchFiles(FALLBACK_UPLOAD_BATCH_FILE_LIMIT);
          setUploadPlanName("starter");
          setResolvedUploadLimits(null);
          setUploadHint("Upload limits are unavailable; the server will validate your upload access.");
          setUploadLimitsLoaded(true);
          return;
        }

        const entitlements = (await response.json()) as AccountEntitlements;
        if (cancelled) return;

        const uploadLimits = resolveUploadPlanLimits(entitlements);
        setMaxUploadBatchFiles(uploadLimits.maxFilesPerReview);
        setUploadPlanName(uploadLimits.plan);
        setResolvedUploadLimits(uploadLimits);

        if (uploadLimits.plan === "admin") {
          setUploadHint(`You can upload PDFs, photos, screenshots, ZIP files, or short videos. ${getUploadBatchLimitMessage(uploadLimits)} Admin ZIP max: 500 MB; videos: 100 MB and 5 seconds max.`);
        } else if (uploadLimits.plan === "pro" || uploadLimits.plan === "trial") {
          setUploadHint(`You can upload PDFs, photos, screenshots, ZIP files, or short videos. ${getUploadBatchLimitMessage(uploadLimits)} Pro ZIP max: 100 MB; videos: 50 MB and 5 seconds max.`);
        } else if (uploadLimits.plan === "free") {
          setUploadHint(`Free accounts can upload one PDF or photo. ZIP and video uploads require an upgrade. Monthly limit: 5 uploads.`);
        } else {
          setUploadHint(`You can upload PDFs, photos, screenshots, and ZIP files. ${getUploadBatchLimitMessage(uploadLimits)} Starter ZIP max: 25 MB; videos require Pro.`);
        }
        setUploadLimitsLoaded(true);
      } catch (error) {
        console.warn("ENTITLEMENTS_LOAD_FAILED", error);
        if (cancelled) return;
        setMaxUploadBatchFiles(FALLBACK_UPLOAD_BATCH_FILE_LIMIT);
        setUploadPlanName("starter");
        setResolvedUploadLimits(null);
        setUploadHint("Upload limits are unavailable; the server will validate your upload access.");
        console.log("FINAL_DERIVED_UPLOAD_CAP", undefined);
        console.log("FINAL_DERIVED_IS_ADMIN", false);
        console.log("FINAL_MAX_UPLOAD_BATCH_FILES", FALLBACK_UPLOAD_BATCH_FILE_LIMIT);
        setUploadLimitsLoaded(true);
      }
    }

    void loadEntitlements();
    return () => {
      cancelled = true;
    };
  }, [getToken, isSignedIn]);

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    if (uploadDisabled) {
      if (!isSignedIn) {
        router.push("/sign-in?next=/");
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

      const uploadLimits = resolvedUploadLimits ?? resolveUploadPlanLimits({
        plan: "starter",
        billingPlan: "starter",
        isPlatformAdmin: false,
        entitlementSource: "starter_subscription",
      });
      const videoFailures = await validateSelectedVideoDurations(
        selectedFiles.slice(0, maxUploadBatchFiles),
        {
          maxVideoBytes: uploadLimits.maxVideoBytes || VIDEO_MAX_BYTES,
          videoAllowed: uploadLimits.videoAllowed,
        }
      );
      const videoRejectedNames = new Set(videoFailures.map((failure) => failure.filename));
      const acceptedFiles = selectedFiles
        .slice(0, maxUploadBatchFiles)
        .filter((file) => {
          if (isZipFile(file) && !uploadLimits.zipAllowed) return false;
          if (isZipFile(file)) return file.size <= uploadLimits.maxZipCompressedBytes;
          const isVideo = /\.(?:mp4|mov|webm)$/i.test(file.name) || file.type.startsWith("video/");
          if (isVideo && !uploadLimits.videoAllowed) return false;
          const maxFileBytes = isVideo ? uploadLimits.maxVideoBytes : uploadLimits.maxUploadBytes || MAX_UPLOAD_FILE_BYTES;
          return file.size <= maxFileBytes && !videoRejectedNames.has(file.name);
        });
      const failures = [
        ...selectedFiles.slice(maxUploadBatchFiles).map(
          (file) => `${file.name}: ${getUploadBatchLimitMessage({ maxFilesPerReview: maxUploadBatchFiles, plan: uploadPlanName })}`
        ),
        ...selectedFiles
          .slice(0, maxUploadBatchFiles)
          .filter((file) => {
            if (isZipFile(file)) return file.size > uploadLimits.maxZipCompressedBytes;
            const isVideo = /\.(?:mp4|mov|webm)$/i.test(file.name) || file.type.startsWith("video/");
            const maxFileBytes = isVideo ? uploadLimits.maxVideoBytes : uploadLimits.maxUploadBytes || MAX_UPLOAD_FILE_BYTES;
            return file.size > maxFileBytes;
          })
          .map(
            (file) => {
              if (isZipFile(file)) {
                return `${file.name}: ${formatBytes(file.size)} exceeds ZIP limit ${formatBytes(uploadLimits.maxZipCompressedBytes)}.`;
              }
              const isVideo = /\.(?:mp4|mov|webm)$/i.test(file.name) || file.type.startsWith("video/");
              const maxFileBytes = isVideo ? uploadLimits.maxVideoBytes : uploadLimits.maxUploadBytes || MAX_UPLOAD_FILE_BYTES;
              return `${file.name}: ${formatBytes(file.size)} exceeds ${formatBytes(maxFileBytes)}.`;
            }
          ),
        ...selectedFiles
          .slice(0, maxUploadBatchFiles)
          .filter((file) => isZipFile(file) && !uploadLimits.zipAllowed)
          .map((file) => `${file.name}: ZIP uploads are not included in your current plan.`),
        ...selectedFiles
          .slice(0, maxUploadBatchFiles)
          .filter((file) => (/\.(?:mp4|mov|webm)$/i.test(file.name) || file.type.startsWith("video/")) && !uploadLimits.videoAllowed)
          .map((file) => `${file.name}: Video uploads are available on Pro and Admin plans.`),
        ...videoFailures.map((failure) => `${failure.filename}: ${failure.reason}`),
      ];

      const docs: UploadedDocument[] = [];

      for (const file of acceptedFiles) {
        const token = await getToken();
        const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;
        const transport = resolveUploadTransport(file, uploadLimits);
        console.info("[upload-client] selected upload route", {
          uploadMode: transport.uploadMode,
          reason: transport.reason,
          filename: file.name,
          sizeBytes: file.size,
          plan: uploadLimits.plan,
          zipDetected: transport.zipDetected,
          videoDetected: transport.videoDetected,
        });

        let res: Response;
        if (transport.uploadMode === "direct-storage") {
          const rejection = validateDirectUploadCandidate(file, uploadLimits);
          if (rejection) {
            failures.push(`${file.name}: ${rejection.reason}`);
            continue;
          }

          console.info("[upload-client] directUploadStarted", {
            uploadMode: "direct-storage",
            filename: file.name,
            sizeBytes: file.size,
            plan: uploadLimits.plan,
            zipDetected: transport.zipDetected,
            videoDetected: transport.videoDetected,
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
          });
          console.info("[upload-client] directUploadCompleted", {
            uploadMode: "direct-storage",
            filename: file.name,
            sizeBytes: file.size,
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
          router.push("/sign-in?next=/");
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
        router.push("/sign-in?next=/");
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
        accept={`.pdf,image/*,application/zip,application/x-zip-compressed,.zip,${VIDEO_UPLOAD_ACCEPT}`}
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
              router.push("/sign-in?next=/");
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
