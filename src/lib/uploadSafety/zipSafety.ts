import path from "node:path";
import JSZip from "jszip";
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  BLOCKED_UPLOAD_EXTENSIONS,
  SCREENSHOT_IMAGE_EXTENSIONS,
  formatUploadLimitBytes,
  type UploadPlanLimits,
} from "@/lib/uploadSafety/uploadLimits";

export type PreparedUploadFile = {
  filename: string;
  type: string;
  buffer: Buffer;
  sizeBytes: number;
  source: "direct_upload" | "zip_extraction";
  sourceArchive?: string;
  classification: "image" | "pdf" | "text" | "docx";
};

export type UploadRejectedFile = {
  filename: string;
  reason: string;
  code: string;
};

export type ZipExtractionSummary = {
  archive: string;
  acceptedFiles: number;
  rejectedFiles: number;
  extractedBytes: number;
};

type ZipAccumulator = {
  accepted: PreparedUploadFile[];
  rejected: UploadRejectedFile[];
  extractedBytes: number;
};

const ZIP_MIME_TYPES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "multipart/x-zip",
]);

export function isZipFilename(filename: string) {
  return path.extname(filename).toLowerCase() === ".zip";
}

export function isZipUpload(file: Pick<File, "name" | "type">) {
  return isZipFilename(file.name) || ZIP_MIME_TYPES.has((file.type || "").toLowerCase());
}

export function getUploadExtension(filename: string) {
  return path.extname(filename).toLowerCase();
}

export function classifyUploadFilename(filename: string): PreparedUploadFile["classification"] {
  const extension = getUploadExtension(filename);
  if (SCREENSHOT_IMAGE_EXTENSIONS.has(extension)) return "image";
  if (extension === ".pdf") return "pdf";
  if (extension === ".docx") return "docx";
  return "text";
}

export function normalizeUploadFilename(filename: string) {
  const normalized = filename.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
  const baseName = path.posix.basename(normalized).trim();
  return baseName.replace(/[^\w.\- ()]/g, "_").replace(/\s+/g, " ").slice(0, 180);
}

export function validateUploadFilename(filename: string): UploadRejectedFile | null {
  const normalized = filename.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const safeName = normalizeUploadFilename(filename);

  if (
    !safeName ||
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized) ||
    segments.includes("..")
  ) {
    return {
      filename,
      reason: "Unsafe archive filename was rejected.",
      code: "UNSAFE_FILENAME",
    };
  }

  const extension = getUploadExtension(safeName);
  if (BLOCKED_UPLOAD_EXTENSIONS.has(extension)) {
    return {
      filename: safeName,
      reason: `File type ${extension} is not allowed.`,
      code: "BLOCKED_EXTENSION",
    };
  }

  if (!ALLOWED_UPLOAD_EXTENSIONS.has(extension)) {
    return {
      filename: safeName,
      reason: `File type ${extension || "unknown"} is not supported.`,
      code: "UNSUPPORTED_EXTENSION",
    };
  }

  return null;
}

export async function prepareUploadFile(file: File, limits: UploadPlanLimits) {
  const buffer = Buffer.from(await file.arrayBuffer());

  if (isZipUpload(file)) {
    return prepareZipUpload({
      filename: file.name,
      buffer,
      limits,
    });
  }

  const rejected = validateUploadFilename(file.name);
  if (rejected) {
    return {
      files: [],
      rejectedFiles: [rejected],
      zipSummaries: [],
    };
  }

  return {
    files: [
      {
        filename: normalizeUploadFilename(file.name),
        type: file.type || mimeTypeForFilename(file.name),
        buffer,
        sizeBytes: buffer.byteLength,
        source: "direct_upload" as const,
        classification: classifyUploadFilename(file.name),
      },
    ],
    rejectedFiles: [],
    zipSummaries: [],
  };
}

export async function prepareZipUpload(params: {
  filename: string;
  buffer: Buffer;
  limits: UploadPlanLimits;
}) {
  const { filename, buffer, limits } = params;

  if (!limits.zipAllowed) {
    return {
      files: [],
      rejectedFiles: [
        {
          filename,
          reason: "ZIP uploads are not included in your current plan.",
          code: "ZIP_NOT_ALLOWED",
        },
      ],
      zipSummaries: [],
    };
  }

  if (hasEncryptedZipEntries(buffer)) {
    return {
      files: [],
      rejectedFiles: [
        {
          filename,
          reason: "Password-protected ZIP files are not supported.",
          code: "ZIP_PASSWORD_PROTECTED",
        },
      ],
      zipSummaries: [],
    };
  }

  const accumulator: ZipAccumulator = {
    accepted: [],
    rejected: [],
    extractedBytes: 0,
  };

  try {
    await extractZipEntries({
      archiveName: normalizeUploadFilename(filename),
      buffer,
      limits,
      depth: 1,
      accumulator,
    });
  } catch (error) {
    accumulator.rejected.push({
      filename,
      reason: error instanceof Error ? error.message : "ZIP extraction failed.",
      code: "ZIP_EXTRACTION_FAILED",
    });
  }

  return {
    files: accumulator.accepted,
    rejectedFiles: accumulator.rejected,
    zipSummaries: [
      {
        archive: normalizeUploadFilename(filename),
        acceptedFiles: accumulator.accepted.length,
        rejectedFiles: accumulator.rejected.length,
        extractedBytes: accumulator.extractedBytes,
      },
    ],
  };
}

async function extractZipEntries(params: {
  archiveName: string;
  buffer: Buffer;
  limits: UploadPlanLimits;
  depth: number;
  accumulator: ZipAccumulator;
}) {
  const zip = await JSZip.loadAsync(params.buffer);
  const entries = Object.values(zip.files);

  for (const entry of entries) {
    if (entry.dir) {
      continue;
    }

    const originalName = getOriginalZipEntryName(entry);
    const nestedArchiveName = `${params.archiveName}/${originalName}`;

    if (isZipFilename(originalName)) {
      if (params.depth >= params.limits.maxZipNestingDepth) {
        params.accumulator.rejected.push({
          filename: nestedArchiveName,
          reason: `Nested ZIP depth exceeds ${params.limits.maxZipNestingDepth}.`,
          code: "ZIP_NESTING_LIMIT",
        });
        continue;
      }

      const nestedBuffer = await entry.async("nodebuffer");
      if (hasEncryptedZipEntries(nestedBuffer)) {
        params.accumulator.rejected.push({
          filename: nestedArchiveName,
          reason: "Password-protected ZIP files are not supported.",
          code: "ZIP_PASSWORD_PROTECTED",
        });
        continue;
      }

      await extractZipEntries({
        archiveName: nestedArchiveName,
        buffer: nestedBuffer,
        limits: params.limits,
        depth: params.depth + 1,
        accumulator: params.accumulator,
      });
      continue;
    }

    const rejected = validateUploadFilename(originalName);
    if (rejected) {
      params.accumulator.rejected.push({
        ...rejected,
        filename: `${params.archiveName}/${rejected.filename}`,
      });
      continue;
    }

    if (params.accumulator.accepted.length >= params.limits.maxExtractedFiles) {
      params.accumulator.rejected.push({
        filename: nestedArchiveName,
        reason: `ZIP contains more than ${params.limits.maxExtractedFiles} supported files.`,
        code: "ZIP_TOO_MANY_FILES",
      });
      continue;
    }

    const expectedSize = getZipEntryUncompressedSize(entry);
    const projectedTotal =
      typeof expectedSize === "number"
        ? params.accumulator.extractedBytes + expectedSize
        : params.accumulator.extractedBytes;
    if (
      typeof expectedSize === "number" &&
      projectedTotal > params.limits.maxExtractedTotalBytes
    ) {
      params.accumulator.rejected.push({
        filename: nestedArchiveName,
        reason: `Extracted ZIP files exceed ${formatUploadLimitBytes(params.limits.maxExtractedTotalBytes)} total.`,
        code: "ZIP_EXTRACTED_TOO_LARGE",
      });
      continue;
    }

    const buffer = await entry.async("nodebuffer");
    const nextTotal = params.accumulator.extractedBytes + buffer.byteLength;
    if (nextTotal > params.limits.maxExtractedTotalBytes) {
      params.accumulator.rejected.push({
        filename: nestedArchiveName,
        reason: `Extracted ZIP files exceed ${formatUploadLimitBytes(params.limits.maxExtractedTotalBytes)} total.`,
        code: "ZIP_EXTRACTED_TOO_LARGE",
      });
      continue;
    }

    const filename = normalizeUploadFilename(originalName);
    params.accumulator.accepted.push({
      filename,
      type: mimeTypeForFilename(filename),
      buffer,
      sizeBytes: buffer.byteLength,
      source: "zip_extraction",
      sourceArchive: params.archiveName,
      classification: classifyUploadFilename(filename),
    });
    params.accumulator.extractedBytes = nextTotal;
  }
}

function getOriginalZipEntryName(entry: JSZip.JSZipObject) {
  const maybeUnsafe = entry as JSZip.JSZipObject & { unsafeOriginalName?: string };
  return maybeUnsafe.unsafeOriginalName || entry.name;
}

function getZipEntryUncompressedSize(entry: JSZip.JSZipObject) {
  const maybeSized = entry as JSZip.JSZipObject & {
    _data?: { uncompressedSize?: number };
  };
  const size = maybeSized._data?.uncompressedSize;
  return typeof size === "number" && Number.isFinite(size) ? size : null;
}

export function hasEncryptedZipEntries(buffer: Buffer) {
  let offset = 0;

  while (offset <= buffer.length - 46) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      offset += 1;
      continue;
    }

    const flags = buffer.readUInt16LE(offset + 8);
    if ((flags & 0x0001) === 0x0001) {
      return true;
    }

    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return false;
}

export function mimeTypeForFilename(filename: string) {
  switch (getUploadExtension(filename)) {
    case ".pdf":
      return "application/pdf";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".heic":
      return "image/heic";
    case ".txt":
      return "text/plain";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return "application/octet-stream";
  }
}
